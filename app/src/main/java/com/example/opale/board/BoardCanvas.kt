package com.example.opale.board

import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

internal fun DrawScope.drawBoardCanvas(
    document: BoardDocument,
    selectedId: String?,
    cameraX: Float,
    cameraY: Float,
    zoom: Float,
    density: Float,
    images: Map<String, ImageBitmap?>,
    movePreview: Offset,
    inkPreview: List<Pair<Float, Float>>,
    accentColor: androidx.compose.ui.graphics.Color,
    backgroundColor: androidx.compose.ui.graphics.Color,
    surfaceColor: androidx.compose.ui.graphics.Color,
    textColor: androidx.compose.ui.graphics.Color,
    outlineColor: androidx.compose.ui.graphics.Color,
) {
    drawRect(backgroundColor)
    val step = 30f * density * zoom
    if (step > 6f && step < 180f) {
        val phaseX = ((cameraX * density) % step + step) % step
        val phaseY = ((cameraY * density) % step + step) % step
        val dot = outlineColor.copy(alpha = 0.42f)
        var y = phaseY
        while (y < size.height) {
            var x = phaseX
            while (x < size.width) {
                drawCircle(dot, radius = 1.2f * density.coerceAtMost(1.5f), center = Offset(x, y))
                x += step
            }
            y += step
        }
    }

    drawIntoCanvas { composeCanvas ->
        val canvas = composeCanvas.nativeCanvas
        val save = canvas.save()
        canvas.translate(cameraX * density, cameraY * density)
        canvas.scale(zoom * density, zoom * density)
        val byId = document.elements.associateBy { it.id }
        val visibleElements = document.elements.filter { isLayerVisible(document, it) }
        for (element in visibleElements) {
            if (element.isEdge || element.kind == "connector" && element.fromId.isNotBlank()) continue
            val move = if (element.id == selectedId) movePreview else Offset.Zero
            drawElement(canvas, element, byId, images, move.x, move.y, surfaceColor.toArgb(), textColor.toArgb(), outlineColor.toArgb())
        }
        for (edge in visibleElements.filter { it.isEdge || it.kind == "connector" && it.fromId.isNotBlank() }) {
            drawConnector(canvas, edge, byId, selectedId == edge.id, accentColor.toArgb(), textColor.toArgb(), if (selectedId == edge.id) movePreview else Offset.Zero)
        }
        if (selectedId != null) {
            val element = byId[selectedId]
            if (element != null && isLayerVisible(document, element) && !element.isEdge && element.kind !in setOf("connector", "stroke")) {
                drawSelection(canvas, element, movePreview.x, movePreview.y, accentColor.toArgb())
            }
        }
        if (inkPreview.size > 1) drawWorldStroke(canvas, inkPreview, accentColor.toArgb(), 3f)
        canvas.restoreToCount(save)
    }
}

private fun drawElement(
    canvas: android.graphics.Canvas,
    element: BoardElement,
    all: Map<String, BoardElement>,
    images: Map<String, ImageBitmap?>,
    moveX: Float,
    moveY: Float,
    defaultSurface: Int,
    defaultText: Int,
    outline: Int,
) {
    val x = element.x + moveX
    val y = element.y + moveY
    val rect = RectF(x, y, x + element.width, y + element.height)
    val fill = colorValue(element.style.optString("fill"), when (element.kind) {
        "sticky" -> 0xfffff59d.toInt()
        else -> defaultSurface
    })
    val ink = colorValue(element.style.optString("color"), defaultText)
    val stroke = colorValue(element.style.optString("stroke"), outline)
    val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = fill
        style = Paint.Style.FILL
        alpha = (alpha * element.style.numberValue("opacity", 1f)).toInt().coerceIn(0, 255)
    }
    val linePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = stroke
        style = Paint.Style.STROKE
        strokeWidth = element.style.numberValue("strokeWidth", 1.4f).coerceAtLeast(0.5f)
        strokeJoin = Paint.Join.ROUND
        strokeCap = Paint.Cap.ROUND
    }
    val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = ink
        textSize = element.style.numberValue("fontSize", 15f).coerceIn(9f, 64f)
        typeface = if (element.style.optBoolean("bold")) Typeface.create(Typeface.DEFAULT, Typeface.BOLD) else Typeface.create(Typeface.DEFAULT, Typeface.NORMAL)
    }

    canvas.save()
    if (element.rotation != 0f) canvas.rotate(element.rotation, rect.centerX(), rect.centerY())

    when (element.kind) {
        "stroke" -> drawElementStroke(canvas, element, x, y)
        "connector" -> {
            val start = connectorPoint(element, true, all)
            val end = connectorPoint(element, false, all)
            if (start != null && end != null) {
                val movedStart = if (element.fromId.isBlank()) start + Offset(moveX, moveY) else start
                val movedEnd = if (element.toId.isBlank()) end + Offset(moveX, moveY) else end
                drawArrowLine(canvas, movedStart, movedEnd, linePaint, element.style.optString("path", "straight"))
            }
        }
        "image" -> {
            val image = images[element.file]
            val androidBitmap = image?.asAndroidBitmap()
            if (androidBitmap != null && !androidBitmap.isRecycled) {
                val bitmapPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
                val radius = element.style.numberValue("radius", 6f).coerceAtLeast(0f)
                canvas.save()
                val clip = Path().apply { addRoundRect(rect, radius, radius, Path.Direction.CW) }
                canvas.clipPath(clip)
                canvas.drawBitmap(androidBitmap, null, rect, bitmapPaint)
                canvas.restore()
            } else {
                drawCard(canvas, rect, fillPaint, linePaint, element.title, "Image à charger", textPaint)
            }
        }
        "frame" -> {
            canvas.drawRoundRect(rect, 12f, 12f, fillPaint.apply { alpha = 36 })
            canvas.drawRoundRect(rect, 12f, 12f, linePaint)
            drawTextBlock(canvas, element.title, RectF(x + 12f, y + 8f, x + element.width - 12f, y + 34f), textPaint)
        }
        "grid" -> {
            canvas.drawRoundRect(rect, 8f, 8f, fillPaint)
            canvas.drawRoundRect(rect, 8f, 8f, linePaint)
            val rows = element.data.optInt("rows", 3).coerceIn(1, 50)
            val cols = element.data.optInt("cols", 3).coerceIn(1, 50)
            for (row in 1 until rows) {
                val yy = y + element.height * row / rows
                canvas.drawLine(x, yy, x + element.width, yy, linePaint)
            }
            for (col in 1 until cols) {
                val xx = x + element.width * col / cols
                canvas.drawLine(xx, y, xx, y + element.height, linePaint)
            }
            drawTextBlock(canvas, element.title, RectF(x + 8f, y + 4f, x + element.width - 8f, y + 28f), textPaint)
        }
        "table" -> drawTable(canvas, element, rect, fillPaint, linePaint, textPaint)
        "kanban" -> drawKanban(canvas, element, rect, fillPaint, linePaint, textPaint)
        "shape" -> drawShape(canvas, element, rect, fillPaint, linePaint, textPaint)
        "text" -> drawTextBlock(canvas, element.data.optString("text", element.raw.optString("text")), rect, textPaint)
        "emoji" -> drawTextBlock(canvas, element.data.optString("char", "★"), rect, textPaint.apply { textSize = min(element.width, element.height) * 0.72f; textAlign = Paint.Align.CENTER }, centered = true)
        "sticker", "icon" -> drawTextBlock(canvas, element.data.optString("sticker", element.data.optString("icon", "★")), rect, textPaint.apply { textSize = min(element.width, element.height) * 0.5f; textAlign = Paint.Align.CENTER }, centered = true)
        else -> {
            canvas.drawRoundRect(rect, 9f, 9f, fillPaint)
            canvas.drawRoundRect(rect, 9f, 9f, linePaint)
            val subtitle = summary(element)
            drawTextBlock(canvas, element.title, RectF(x + 11f, y + 9f, x + element.width - 11f, y + 32f), textPaint.apply { textSize = 15f; typeface = Typeface.DEFAULT_BOLD })
            drawTextBlock(canvas, subtitle, RectF(x + 11f, y + 36f, x + element.width - 11f, y + element.height - 8f), textPaint.apply { textSize = 12.5f; typeface = Typeface.DEFAULT })
        }
    }
    canvas.restore()
}

private fun drawCard(canvas: android.graphics.Canvas, rect: RectF, fill: Paint, border: Paint, title: String, body: String, text: Paint) {
    canvas.drawRoundRect(rect, 8f, 8f, fill)
    canvas.drawRoundRect(rect, 8f, 8f, border)
    drawTextBlock(canvas, title, RectF(rect.left + 10, rect.top + 8, rect.right - 10, rect.top + 29), text.apply { textSize = 13f; typeface = Typeface.DEFAULT_BOLD })
    drawTextBlock(canvas, body, RectF(rect.left + 10, rect.top + 32, rect.right - 10, rect.bottom - 8), text.apply { textSize = 12f; typeface = Typeface.DEFAULT })
}

private fun drawShape(canvas: android.graphics.Canvas, element: BoardElement, rect: RectF, fill: Paint, line: Paint, text: Paint) {
    when (element.data.optString("shape", "rect")) {
        "ellipse", "circle" -> { canvas.drawOval(rect, fill); canvas.drawOval(rect, line) }
        "diamond", "rhombus" -> {
            val path = Path().apply { moveTo(rect.centerX(), rect.top); lineTo(rect.right, rect.centerY()); lineTo(rect.centerX(), rect.bottom); lineTo(rect.left, rect.centerY()); close() }
            canvas.drawPath(path, fill); canvas.drawPath(path, line)
        }
        "round", "roundrect" -> { canvas.drawRoundRect(rect, 18f, 18f, fill); canvas.drawRoundRect(rect, 18f, 18f, line) }
        else -> { canvas.drawRect(rect, fill); canvas.drawRect(rect, line) }
    }
    drawTextBlock(canvas, element.data.optString("text", element.raw.optString("text")), RectF(rect.left + 8f, rect.top + 8f, rect.right - 8f, rect.bottom - 8f), text, centered = true)
}

private fun drawTable(canvas: android.graphics.Canvas, element: BoardElement, rect: RectF, fill: Paint, line: Paint, text: Paint) {
    canvas.drawRoundRect(rect, 8f, 8f, fill)
    canvas.drawRoundRect(rect, 8f, 8f, line)
    val rows = element.data.optJSONArray("rows") ?: JSONArray()
    val count = rows.length().coerceIn(1, 12)
    val columns = (0 until count).mapNotNull { rows.optJSONArray(it) }.maxOfOrNull { it.length() }?.coerceIn(1, 8) ?: 1
    val cellH = rect.height() / count
    val cellW = rect.width() / columns
    for (r in 1 until count) canvas.drawLine(rect.left, rect.top + r * cellH, rect.right, rect.top + r * cellH, line)
    for (c in 1 until columns) canvas.drawLine(rect.left + c * cellW, rect.top, rect.left + c * cellW, rect.bottom, line)
    for (r in 0 until count) {
        val row = rows.optJSONArray(r) ?: continue
        for (c in 0 until min(columns, row.length())) {
            val value = row.optString(c)
            drawTextBlock(canvas, value, RectF(rect.left + c * cellW + 6, rect.top + r * cellH + 3, rect.left + (c + 1) * cellW - 4, rect.top + (r + 1) * cellH - 2), text.apply { textSize = 12f }, centered = false, maxLines = 2)
        }
    }
}

private fun drawKanban(canvas: android.graphics.Canvas, element: BoardElement, rect: RectF, fill: Paint, line: Paint, text: Paint) {
    canvas.drawRoundRect(rect, 8f, 8f, fill)
    canvas.drawRoundRect(rect, 8f, 8f, line)
    val columns = element.data.optJSONArray("columns") ?: JSONArray()
    val count = columns.length().coerceIn(1, 8)
    val gap = 8f
    val colWidth = ((rect.width() - gap * (count + 1)) / count).coerceAtLeast(48f)
    for (index in 0 until count) {
        val column = columns.optJSONObject(index) ?: JSONObject()
        val left = rect.left + gap + index * (colWidth + gap)
        val colRect = RectF(left, rect.top + 32, left + colWidth, rect.bottom - 8)
        canvas.drawRoundRect(colRect, 6f, 6f, fill)
        canvas.drawRoundRect(colRect, 6f, 6f, line)
        drawTextBlock(canvas, column.optString("title", "Colonne ${index + 1}"), RectF(left + 5, rect.top + 5, left + colWidth - 5, rect.top + 29), text.apply { textSize = 12f; typeface = Typeface.DEFAULT_BOLD })
        val cards = column.optJSONArray("cards") ?: JSONArray()
        for (cardIndex in 0 until min(cards.length(), 8)) {
            val card = cards.optJSONObject(cardIndex) ?: continue
            val cardRect = RectF(left + 5, colRect.top + 6 + cardIndex * 54f, left + colWidth - 5, colRect.top + 48 + cardIndex * 54f)
            canvas.drawRoundRect(cardRect, 5f, 5f, fill)
            canvas.drawRoundRect(cardRect, 5f, 5f, line)
            drawTextBlock(canvas, card.optString("text"), RectF(cardRect.left + 5, cardRect.top + 3, cardRect.right - 5, cardRect.bottom - 3), text.apply { textSize = 11f })
        }
    }
    if (columns.length() == 0) drawTextBlock(canvas, element.title, RectF(rect.left + 12, rect.top + 8, rect.right - 12, rect.top + 30), text)
}

private fun drawElementStroke(canvas: android.graphics.Canvas, element: BoardElement, x: Float, y: Float) {
    val points = element.data.optJSONArray("points") ?: return
    val path = Path()
    var started = false
    for (index in 0 until points.length()) {
        val point = points.optJSONArray(index) ?: continue
        if (point.length() < 2) continue
        val px = x + point.optDouble(0, 0.0).toFloat()
        val py = y + point.optDouble(1, 0.0).toFloat()
        if (!started) { path.moveTo(px, py); started = true } else path.lineTo(px, py)
    }
    if (!started) return
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = colorValue(element.style.optString("color"), 0xff1f2937.toInt())
        style = Paint.Style.STROKE
        strokeWidth = element.style.numberValue("width", 4f).coerceAtLeast(1f)
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    canvas.drawPath(path, paint)
}

private fun drawWorldStroke(canvas: android.graphics.Canvas, points: List<Pair<Float, Float>>, color: Int, width: Float) {
    val path = Path()
    points.forEachIndexed { index, (x, y) -> if (index == 0) path.moveTo(x, y) else path.lineTo(x, y) }
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = color; style = Paint.Style.STROKE; strokeWidth = width; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND }
    canvas.drawPath(path, paint)
}

private fun drawConnector(canvas: android.graphics.Canvas, edge: BoardElement, elements: Map<String, BoardElement>, selected: Boolean, accent: Int, defaultText: Int, move: Offset) {
    val start = connectorPoint(edge, true, elements) ?: return
    val end = connectorPoint(edge, false, elements) ?: return
    val movedStart = if (edge.fromId.isBlank()) start + move else start
    val movedEnd = if (edge.toId.isBlank()) end + move else end
    val style = edge.style
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = colorValue(style.optString("color", edge.raw.optString("color")), defaultText)
        this.style = Paint.Style.STROKE
        strokeWidth = style.numberValue("width", 2.3f).coerceAtLeast(1f) + if (selected) 2f else 0f
        strokeCap = Paint.Cap.ROUND
    }
    if (selected) paint.color = accent
    drawArrowLine(canvas, movedStart, movedEnd, paint, style.optString("path", "straight"), style.optString("end", edge.raw.optString("toEnd", "arrow")) != "none")
    val label = edge.data.optString("label", edge.raw.optString("label"))
    if (label.isNotBlank()) {
        val labelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = defaultText; textSize = 13f; textAlign = Paint.Align.CENTER }
        canvas.drawText(label, (start.x + end.x) / 2, (start.y + end.y) / 2 - 5, labelPaint)
    }
}

private fun drawArrowLine(canvas: android.graphics.Canvas, start: Offset, end: Offset, paint: Paint, pathKind: String, arrow: Boolean = true) {
    val path = Path().apply {
        moveTo(start.x, start.y)
        if (pathKind == "curve") {
            val midX = (start.x + end.x) / 2
            cubicTo(midX, start.y, midX, end.y, end.x, end.y)
        } else if (pathKind == "elbow") {
            val midX = (start.x + end.x) / 2
            lineTo(midX, start.y); lineTo(midX, end.y); lineTo(end.x, end.y)
        } else lineTo(end.x, end.y)
    }
    canvas.drawPath(path, paint)
    if (!arrow) return
    val angle = atan2(end.y - start.y, end.x - start.x)
    val length = 10f
    val left = Offset(end.x - length * cos(angle - 0.45f), end.y - length * sin(angle - 0.45f))
    val right = Offset(end.x - length * cos(angle + 0.45f), end.y - length * sin(angle + 0.45f))
    val head = Path().apply { moveTo(end.x, end.y); lineTo(left.x, left.y); lineTo(right.x, right.y); close() }
    canvas.drawPath(head, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = paint.color; style = Paint.Style.FILL })
}

private fun connectorPoint(element: BoardElement, from: Boolean, elements: Map<String, BoardElement>): Offset? {
    val id = if (from) element.fromId else element.toId
    val side = if (from) element.fromSide else element.toSide
    if (id.isNotBlank()) {
        val target = elements[id] ?: return null
        val centerX = target.x + target.width / 2f
        val centerY = target.y + target.height / 2f
        return when (side) {
            "top" -> Offset(centerX, target.y)
            "right" -> Offset(target.x + target.width, centerY)
            "bottom" -> Offset(centerX, target.y + target.height)
            "left" -> Offset(target.x, centerY)
            else -> Offset(centerX, centerY)
        }
    }
    val x = if (from) element.freeFromX else element.freeToX
    val y = if (from) element.freeFromY else element.freeToY
    return if (x != null && y != null) Offset(x, y) else null
}

private fun drawSelection(canvas: android.graphics.Canvas, element: BoardElement, moveX: Float, moveY: Float, color: Int) {
    val rect = RectF(element.x + moveX - 4, element.y + moveY - 4, element.x + moveX + element.width + 4, element.y + moveY + element.height + 4)
    canvas.save()
    if (element.rotation != 0f) canvas.rotate(element.rotation, rect.centerX(), rect.centerY())
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = color; style = Paint.Style.STROKE; strokeWidth = 2f }
    canvas.drawRoundRect(rect, 5f, 5f, paint)
    canvas.restore()
}

private fun drawTextBlock(
    canvas: android.graphics.Canvas,
    value: String,
    rect: RectF,
    paint: Paint,
    centered: Boolean = false,
    maxLines: Int = 8,
) {
    if (rect.width() <= 0 || rect.height() <= 0 || value.isBlank()) return
    val oldAlign = paint.textAlign
    if (centered) paint.textAlign = Paint.Align.CENTER
    val sourceLines = value.replace("\r", "").split('\n')
    val lines = ArrayList<String>()
    for (source in sourceLines) {
        if (source.isEmpty()) { lines += ""; continue }
        var line = StringBuilder()
        for (word in source.split(Regex("\\s+"))) {
            val candidate = if (line.isEmpty()) word else "$line $word"
            if (paint.measureText(candidate) <= rect.width() || line.isEmpty()) {
                line = StringBuilder(candidate)
            } else {
                lines += line.toString()
                line = StringBuilder(word)
            }
        }
        if (line.isNotEmpty()) lines += line.toString()
    }
    val lineHeight = (paint.textSize * 1.22f).coerceAtLeast(12f)
    val visible = lines.take(min(maxLines, (rect.height() / lineHeight).toInt().coerceAtLeast(1)))
    val metrics = paint.fontMetrics
    val blockHeight = visible.size * lineHeight
    var baseline = if (centered) rect.centerY() - blockHeight / 2f - metrics.ascent else rect.top - metrics.ascent
    val x = if (centered) rect.centerX() else rect.left
    for (line in visible) {
        canvas.drawText(line, x, baseline, paint)
        baseline += lineHeight
    }
    paint.textAlign = oldAlign
}

private fun summary(element: BoardElement): String {
    val data = element.data
    val candidates = listOf("text", "description", "question", "code", "source", "url", "file", "name", "role", "left")
    for (key in candidates) {
        val value = data.optString(key).ifBlank { if (key == "file") element.raw.optString("file") else "" }
        if (value.isNotBlank()) return value.lines().take(5).joinToString("\n")
    }
    return when (element.kind) {
        "table" -> "Tableau modifiable"
        "kanban" -> "Colonnes et cartes"
        "mindmap" -> "Carte mentale éditable"
        "timeline" -> "Planning éditable"
        "poll", "activity" -> "Options et résultats"
        else -> "Appuyez sur Modifier pour ouvrir les données complètes."
    }
}

private fun JSONObject.numberValue(key: String, fallback: Float): Float {
    val value = opt(key)
    return when (value) {
        is Number -> value.toFloat().takeIf(Float::isFinite) ?: fallback
        is String -> value.toFloatOrNull()?.takeIf(Float::isFinite) ?: fallback
        else -> fallback
    }
}

private fun colorValue(value: String, fallback: Int): Int {
    val text = value.trim()
    if (text.isEmpty()) return fallback
    val preset = mapOf("1" to "#fb464c", "2" to "#e9973f", "3" to "#e0de71", "4" to "#44cf6e", "5" to "#53dfdd", "6" to "#a882ff")[text]
    val hex = preset ?: text
    return runCatching {
        when {
            hex.matches(Regex("#[0-9a-fA-F]{3}")) -> android.graphics.Color.rgb(
                hex[1].digitToInt(16) * 17,
                hex[2].digitToInt(16) * 17,
                hex[3].digitToInt(16) * 17,
            )
            hex.matches(Regex("#[0-9a-fA-F]{6}")) -> android.graphics.Color.parseColor(hex)
            hex.matches(Regex("#[0-9a-fA-F]{8}")) -> {
                val rgba = hex.drop(1).toLong(16)
                android.graphics.Color.argb(
                    (rgba and 0xff).toInt(),
                    ((rgba shr 24) and 0xff).toInt(),
                    ((rgba shr 16) and 0xff).toInt(),
                    ((rgba shr 8) and 0xff).toInt(),
                )
            }
            else -> android.graphics.Color.parseColor(hex)
        }
    }.getOrDefault(fallback)
}
