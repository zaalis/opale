package com.example.opale.board

import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.util.UUID
import kotlin.math.max

/**
 * A lossless-enough view over JSON Canvas. We keep each original node/edge and
 * the original document object; geometry edits only change the fields they
 * own. Unknown Canvas fields and Opale extensions therefore survive a round
 * trip instead of being normalized away by a smaller Android model.
 */
internal data class BoardElement(
    val id: String,
    val kind: String,
    val x: Float,
    val y: Float,
    val width: Float,
    val height: Float,
    val rotation: Float,
    val z: Int,
    val raw: JSONObject,
    val isEdge: Boolean,
    val layer: String = "base",
    val locked: Boolean = false,
    val fromId: String = "",
    val fromSide: String = "",
    val toId: String = "",
    val toSide: String = "",
    val freeFromX: Float? = null,
    val freeFromY: Float? = null,
    val freeToX: Float? = null,
    val freeToY: Float? = null,
) {
    val meta: JSONObject get() = raw.optJSONObject("opale") ?: JSONObject()
    val data: JSONObject get() = meta.optJSONObject("data") ?: JSONObject()
    val style: JSONObject get() = meta.optJSONObject("style") ?: JSONObject()
    val file: String get() = raw.optString("file").ifBlank { data.optString("file") }
    val title: String get() = when {
        data.has("title") -> data.optString("title")
        raw.has("label") -> raw.optString("label")
        data.has("question") -> data.optString("question")
        data.has("name") -> data.optString("name")
        data.has("text") -> data.optString("text")
        raw.has("text") -> raw.optString("text")
        file.isNotBlank() -> file.substringAfterLast('/')
        else -> kind.replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }
    }
}

internal data class BoardLayer(
    val id: String,
    val name: String,
    val visible: Boolean,
    val locked: Boolean,
)

internal data class BoardDocument(
    val root: JSONObject,
    val elements: List<BoardElement>,
    val problem: String? = null,
    val layers: List<BoardLayer> = emptyList(),
)

private fun JSONObject.number(name: String, fallback: Float = 0f): Float {
    val value = opt(name)
    return when (value) {
        is Number -> value.toFloat().takeIf(Float::isFinite) ?: fallback
        is String -> value.toFloatOrNull()?.takeIf(Float::isFinite) ?: fallback
        else -> fallback
    }
}

private fun JSONObject.child(name: String): JSONObject = optJSONObject(name) ?: JSONObject()

private fun newElementId(): String = UUID.randomUUID().toString().replace("-", "").take(16)

private fun deepCopy(value: JSONObject): JSONObject = JSONObject(value.toString())

private fun encode(root: JSONObject): String = root.toString(2) + "\n"

fun emptyBoard(): String {
    val layer = JSONObject().put("id", "base").put("name", "Calque 1").put("visible", true).put("locked", false)
    val metadata = JSONObject()
        .put("version", 1)
        .put("layers", JSONArray().put(layer))
        .put("settings", JSONObject().put("grid", "dots").put("snap", true).put("privateMode", false))
    return encode(JSONObject().put("nodes", JSONArray()).put("edges", JSONArray()).put("opale", metadata))
}

internal fun parseBoard(content: String): BoardDocument {
    val source = content.removePrefix("\uFEFF").trim()
    if (source.isEmpty()) return parseBoard(emptyBoard())
    val root = try {
        JSONTokener(source).nextValue() as? JSONObject
            ?: return BoardDocument(JSONObject(), emptyList(), "Ce fichier n’est pas un document JSON Canvas.")
    } catch (error: Exception) {
        return BoardDocument(JSONObject(), emptyList(), "Fichier illisible : ${error.message ?: "JSON invalide"}")
    }

    val entries = mutableListOf<Pair<Int, BoardElement>>()
    val seen = mutableSetOf<String>()
    val metaRoot = root.child("opale")
    val layers = (metaRoot.optJSONArray("layers") ?: JSONArray()).let { sourceLayers ->
        val parsed = (0 until sourceLayers.length()).mapNotNull { index ->
            val layer = sourceLayers.optJSONObject(index) ?: return@mapNotNull null
            BoardLayer(
                id = layer.optString("id").ifBlank { "layer-$index" },
                name = layer.optString("name").ifBlank { "Calque ${index + 1}" },
                visible = layer.optBoolean("visible", true),
                locked = layer.optBoolean("locked", false),
            )
        }
        if (parsed.none { it.id == "base" }) listOf(BoardLayer("base", "Calque 1", true, false)) + parsed else parsed
    }
    val nodes = root.optJSONArray("nodes") ?: JSONArray()
    for (index in 0 until nodes.length()) {
        val node = nodes.optJSONObject(index) ?: continue
        val meta = node.child("opale")
        val data = meta.child("data")
        val type = node.optString("type", "text")
        val file = node.optString("file", data.optString("file"))
        val inferredKind = when (type) {
            "file" -> when (file.substringAfterLast('.', "").lowercase()) {
                "png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "svg" -> "image"
                "md", "markdown" -> "note"
                "mp4", "mov", "mkv", "webm" -> "video"
                else -> "file"
            }
            "link" -> "link"
            "group" -> "frame"
            else -> "mdcard"
        }
        val kind = meta.optString("kind").ifBlank { inferredKind }
        val id = node.optString("id").ifBlank { newElementId() }.let { candidate ->
            var unique = candidate
            while (!seen.add(unique)) unique = newElementId()
            unique
        }
        val nodeCopy = deepCopy(node).put("id", id)
        val width = node.number("width", 260f).coerceAtLeast(1f)
        val height = node.number("height", 120f).coerceAtLeast(1f)
        val fromEnd = meta.child("ends").child("from")
        val toEnd = meta.child("ends").child("to")
        entries += meta.number("z", index.toFloat()).toInt() to BoardElement(
            id = id,
            kind = kind,
            x = node.number("x"),
            y = node.number("y"),
            width = width,
            height = height,
            rotation = meta.number("rotation"),
            z = meta.number("z", index.toFloat()).toInt(),
            raw = nodeCopy,
            isEdge = false,
            layer = meta.optString("layer", "base").ifBlank { "base" },
            locked = meta.optBoolean("locked", false),
            fromId = fromEnd.optString("id"),
            fromSide = fromEnd.optString("side"),
            toId = toEnd.optString("id"),
            toSide = toEnd.optString("side"),
            freeFromX = fromEnd.number("x").takeIf { meta.child("ends").has("from") },
            freeFromY = fromEnd.number("y").takeIf { meta.child("ends").has("from") },
            freeToX = toEnd.number("x").takeIf { meta.child("ends").has("to") },
            freeToY = toEnd.number("y").takeIf { meta.child("ends").has("to") },
        )
    }

    val edges = root.optJSONArray("edges") ?: JSONArray()
    for (index in 0 until edges.length()) {
        val edge = edges.optJSONObject(index) ?: continue
        val meta = edge.child("opale")
        val id = edge.optString("id").ifBlank { newElementId() }.let { candidate ->
            var unique = candidate
            while (!seen.add(unique)) unique = newElementId()
            unique
        }
        val edgeCopy = deepCopy(edge).put("id", id)
        val data = meta.child("data")
        entries += meta.number("z", (nodes.length() + index).toFloat()).toInt() to BoardElement(
            id = id,
            kind = meta.optString("kind", "connector").ifBlank { "connector" },
            x = 0f,
            y = 0f,
            width = 0f,
            height = 0f,
            rotation = 0f,
            z = meta.number("z", (nodes.length() + index).toFloat()).toInt(),
            raw = edgeCopy,
            isEdge = true,
            layer = meta.optString("layer", "base").ifBlank { "base" },
            locked = meta.optBoolean("locked", false),
            fromId = edge.optString("fromNode"),
            fromSide = edge.optString("fromSide"),
            toId = edge.optString("toNode"),
            toSide = edge.optString("toSide"),
            freeFromX = meta.child("ends").child("from").number("x").takeIf { meta.child("ends").has("from") },
            freeFromY = meta.child("ends").child("from").number("y").takeIf { meta.child("ends").has("from") },
            freeToX = meta.child("ends").child("to").number("x").takeIf { meta.child("ends").has("to") },
            freeToY = meta.child("ends").child("to").number("y").takeIf { meta.child("ends").has("to") },
        )
        @Suppress("UNUSED_VARIABLE")
        val keepDataReadForFormat = data // Keep parsing tolerant of older connector payloads.
    }
    return BoardDocument(root, entries.sortedBy { it.first }.map { it.second }, layers = layers)
}

internal fun isLayerVisible(document: BoardDocument, element: BoardElement): Boolean =
    document.layers.firstOrNull { it.id == element.layer }?.visible ?: true

internal fun isBoardElementLocked(document: BoardDocument, element: BoardElement): Boolean =
    element.locked || document.layers.firstOrNull { it.id == element.layer }?.locked == true

internal fun canMoveBoardElement(document: BoardDocument, element: BoardElement): Boolean {
    if (!isLayerVisible(document, element) || isBoardElementLocked(document, element)) return false
    if (element.kind != "connector") return true
    val hasFreeFrom = element.fromId.isBlank() && element.freeFromX != null && element.freeFromY != null
    val hasFreeTo = element.toId.isBlank() && element.freeToX != null && element.freeToY != null
    return hasFreeFrom || hasFreeTo
}

internal fun boardToString(document: BoardDocument): String = encode(document.root)

private fun addNode(content: String, make: (JSONObject, Int) -> JSONObject): String {
    val doc = parseBoard(content)
    if (doc.problem != null) return content
    val root = deepCopy(doc.root)
    val nodes = root.optJSONArray("nodes") ?: JSONArray().also { root.put("nodes", it) }
    val nextZ = (doc.elements.maxOfOrNull { it.z } ?: -1) + 1
    nodes.put(make(root, nextZ))
    if (root.optJSONArray("edges") == null) root.put("edges", JSONArray())
    return encode(root)
}

internal fun addBoardElement(content: String, kind: String, positionX: Float = 72f, positionY: Float = 72f): Pair<String, String> {
    val doc = parseBoard(content)
    if (doc.problem != null) return content to ""
    val index = doc.elements.size
    val x = positionX + (index % 4) * 24f
    val y = positionY + (index % 5) * 24f
    val id = newElementId()
    // Keep the same creation geometry as shared/board.js KINDS on Windows.
    val size = when (kind) {
        "text" -> 260f to 44f
        "sticky" -> 200f to 200f
        "mdcard" -> 320f to 180f
        "shape" -> 180f to 120f
        "connector", "stroke" -> 0f to 0f
        "image" -> 320f to 240f
        "note" -> 360f to 280f
        "file" -> 260f to 72f
        "link" -> 320f to 96f
        "embed" -> 560f to 340f
        "video" -> 480f to 270f
        "frame" -> 800f to 520f
        "grid" -> 720f to 480f
        "code" -> 460f to 220f
        "table" -> 480f to 180f
        "kanban" -> 900f to 460f
        "mindmap" -> 420f to 220f
        "card" -> 300f to 170f
        "flipcard" -> 260f to 180f
        "usercard" -> 300f to 200f
        "timeline" -> 960f to 300f
        "comment" -> 36f to 36f
        "emoji" -> 80f to 80f
        "sticker" -> 140f to 140f
        "icon" -> 64f to 64f
        "ui" -> 160f to 44f
        "mermaid" -> 520f to 360f
        "poll" -> 340f to 240f
        "wheel" -> 320f to 360f
        "scale" -> 520f to 150f
        "activity" -> 420f to 300f
        else -> 320f to 200f
    }
    val (width, height) = size
    val style = when (kind) {
        "text" -> JSONObject().put("color", "").put("fontSize", 22).put("align", "left").put("bold", false).put("italic", false).put("font", "sans")
        "sticky" -> JSONObject().put("fill", "#fff59d").put("color", "#1f1d16").put("fontSize", 0).put("align", "center")
        "mdcard" -> JSONObject().put("fill", "").put("stroke", "").put("color", "")
        "shape" -> JSONObject().put("fill", "#ffffff").put("stroke", "#1f2937").put("strokeWidth", 2).put("dash", "solid").put("color", "#111827").put("fontSize", 18).put("align", "center").put("valign", "middle").put("opacity", 1)
        "connector" -> JSONObject().put("color", "#64748b").put("width", 2).put("dash", "solid").put("path", "curve").put("start", "none").put("end", "arrow")
        "stroke" -> JSONObject().put("color", "#1f2937").put("width", 4).put("opacity", 1).put("tool", "pen")
        "image" -> JSONObject().put("radius", 6).put("opacity", 1)
        "note" -> JSONObject().put("fill", "")
        "frame" -> JSONObject().put("fill", "").put("stroke", "")
        "grid" -> JSONObject().put("stroke", "")
        "card" -> JSONObject().put("accent", "#6366f1")
        "flipcard" -> JSONObject().put("fill", "#ffffff")
        "usercard" -> JSONObject().put("accent", "#0ea5e9")
        "icon" -> JSONObject().put("color", "#1f2937")
        "mindmap" -> JSONObject().put("color", "#6366f1")
        else -> JSONObject()
    }
    val data = when (kind) {
        "text", "sticky", "shape", "mdcard" -> JSONObject().put("text", if (kind == "text") "Texte" else "")
        "image" -> JSONObject().put("file", "").put("alt", "")
        "note" -> JSONObject().put("file", "").put("subpath", "")
        "file" -> JSONObject().put("file", "")
        "link" -> JSONObject().put("url", "").put("title", "")
        "embed" -> JSONObject().put("url", "")
        "video" -> JSONObject().put("file", "").put("url", "")
        "frame" -> JSONObject().put("title", "Cadre")
        "grid" -> JSONObject().put("title", "Grille").put("rows", 3).put("cols", 3)
        "connector" -> JSONObject().put("label", "").put("relation", "")
        "stroke" -> JSONObject().put("points", JSONArray())
        "table" -> JSONObject().put("rows", JSONArray().put(JSONArray().put("").put("").put("")).put(JSONArray().put("").put("").put("")).put(JSONArray().put("").put("").put(""))).put("header", true)
        "kanban" -> JSONObject().put("title", "Kanban").put("columns", JSONArray())
        "code" -> JSONObject().put("code", "").put("lang", "txt")
        "mermaid" -> JSONObject().put("source", "flowchart TD\n  A[Début] --> B{Choix}\n  B -->|Oui| C[Action]\n  B -->|Non| D[Fin]")
        "poll" -> JSONObject().put("question", "Question").put("options", JSONArray())
        "activity" -> JSONObject().put("type", "choice").put("question", "Question").put("options", JSONArray()).put("answers", JSONArray()).put("revealed", false)
        "card" -> JSONObject().put("title", "").put("description", "").put("assignee", "").put("due", "").put("status", "todo").put("points", "").put("tshirt", "").put("tags", JSONArray())
        "flipcard" -> JSONObject().put("front", "").put("back", "").put("flipped", false)
        "usercard" -> JSONObject().put("name", "").put("role", "").put("image", "").put("notes", "")
        "timeline" -> JSONObject().put("title", "Planning").put("start", "").put("unit", "week").put("count", 8).put("lanes", JSONArray()).put("items", JSONArray())
        "mindmap" -> JSONObject().put("root", JSONObject().put("id", newElementId()).put("text", "Idée centrale").put("children", JSONArray()))
        "comment" -> JSONObject().put("thread", JSONArray()).put("resolved", false)
        "emoji" -> JSONObject().put("char", "😀")
        "sticker" -> JSONObject().put("sticker", "star")
        "icon" -> JSONObject().put("icon", "star")
        "ui" -> JSONObject().put("ui", "button").put("text", "Bouton")
        "wheel" -> JSONObject().put("entries", JSONArray()).put("result", "")
        "scale" -> JSONObject().put("left", "").put("right", "").put("steps", 5).put("marks", JSONArray())
        else -> JSONObject().put("text", "")
    }

    val type = when (kind) {
        "image", "note", "file", "video" -> "file"
        "link", "embed" -> "link"
        "frame", "grid" -> "group"
        else -> "text"
    }
    val node = JSONObject()
        .put("id", id)
        .put("type", type)
        .put("x", x.toInt())
        .put("y", y.toInt())
        .put("width", width.toInt())
        .put("height", height.toInt())
    when (type) {
        "file" -> node.put("file", data.optString("file"))
        "link" -> node.put("url", data.optString("url"))
        "group" -> node.put("label", data.optString("title", kind.replaceFirstChar(Char::uppercase)))
        else -> node.put("text", data.optString("text"))
    }
    if (kind in setOf("sticky", "mdcard", "frame") && style.optString("fill").isNotBlank()) {
        node.put("color", style.optString("fill"))
    }
    val opale = JSONObject().put("kind", kind).put("z", doc.elements.maxOfOrNull { it.z }?.plus(1) ?: 0)
    if (style.length() > 0) opale.put("style", style)
    if (data.length() > 0) opale.put("data", data)
    if (kind == "connector") {
        opale.put("ends", JSONObject()
            .put("from", JSONObject().put("x", x).put("y", y + height / 2))
            .put("to", JSONObject().put("x", x + 180).put("y", y + height / 2)))
        opale.put("style", JSONObject().put("color", "#64748b").put("width", 2).put("path", "straight").put("end", "arrow"))
        node.put("width", 1).put("height", 1).put("text", "")
    }
    node.put("opale", opale)
    val result = addNode(content, { _, _ -> node })
    return result to id
}

/** Add a real JSON Canvas file node while preserving all other document data. */
fun addImageToBoard(content: String, path: String): String {
    if (path.isBlank()) return content
    return addNode(content) { root, z ->
        val nodes = root.optJSONArray("nodes") ?: JSONArray()
        val count = nodes.length()
        JSONObject()
            .put("id", newElementId())
            .put("type", "file")
            .put("file", path)
            .put("x", 72 + (count % 4) * 36)
            .put("y", 72 + (count % 5) * 36)
            .put("width", 320)
            .put("height", 240)
            .put("opale", JSONObject()
                .put("kind", "image")
                .put("z", z)
                .put("style", JSONObject().put("radius", 6).put("opacity", 1))
                .put("data", JSONObject().put("alt", "")))
    }
}

internal fun addDrawnStroke(content: String, points: List<Pair<Float, Float>>, color: String = "#1f2937", width: Float = 4f): String {
    if (points.size < 2) return content
    val left = points.minOf { it.first }
    val top = points.minOf { it.second }
    val right = points.maxOf { it.first }
    val bottom = points.maxOf { it.second }
    val local = JSONArray()
    points.forEach { (x, y) -> local.put(JSONArray().put(x - left).put(y - top).put(0.5)) }
    val id = newElementId()
    return addNode(content) { _, z ->
        JSONObject().put("id", id).put("type", "text")
            .put("x", left.toInt()).put("y", top.toInt())
            .put("width", max(1, (right - left).toInt())).put("height", max(1, (bottom - top).toInt()))
            .put("text", "")
            .put("opale", JSONObject().put("kind", "stroke").put("z", z)
                .put("style", JSONObject().put("color", color).put("width", width).put("opacity", 1).put("tool", "pen"))
                .put("data", JSONObject().put("points", local)))
    }
}

internal fun moveBoardElement(content: String, id: String, dx: Float, dy: Float): String {
    if (dx == 0f && dy == 0f) return content
    val doc = parseBoard(content)
    if (doc.problem != null) return content
    val element = doc.elements.firstOrNull { it.id == id } ?: return content
    if (!canMoveBoardElement(doc, element)) return content
    val root = deepCopy(doc.root)
    val nodes = root.optJSONArray("nodes")
    if (nodes != null) for (index in 0 until nodes.length()) {
        val node = nodes.optJSONObject(index) ?: continue
        if (node.optString("id") != id) continue
        if (element.kind == "connector") {
            translateFreeEnds(node, dx, dy)
        } else {
            node.put("x", node.number("x") + dx).put("y", node.number("y") + dy)
        }
        return encode(root)
    }
    // JSON Canvas edges are separate objects. Move only free extension endpoints;
    // node-attached endpoints stay anchored to their referenced nodes.
    val edges = root.optJSONArray("edges") ?: return content
    for (index in 0 until edges.length()) {
        val edge = edges.optJSONObject(index) ?: continue
        if (edge.optString("id") != id) continue
        translateFreeEnds(edge, dx, dy)
        return encode(root)
    }
    return content
}

private fun translateFreeEnds(item: JSONObject, dx: Float, dy: Float) {
    val meta = item.optJSONObject("opale") ?: return
    val ends = meta.optJSONObject("ends") ?: return
    for ((key, anchoredField) in listOf("from" to "fromNode", "to" to "toNode")) {
        val endpoint = ends.optJSONObject(key) ?: continue
        val nodeId = endpoint.optString("id").ifBlank { item.optString(anchoredField) }
        if (nodeId.isNotBlank()) continue
        endpoint.put("x", endpoint.number("x") + dx).put("y", endpoint.number("y") + dy)
    }
}

internal fun updateBoardLayer(content: String, layerId: String, visible: Boolean? = null, locked: Boolean? = null): String {
    val doc = parseBoard(content)
    if (doc.problem != null) return content
    val root = deepCopy(doc.root)
    val meta = root.optJSONObject("opale") ?: JSONObject().also { root.put("opale", it) }
    val layers = meta.optJSONArray("layers") ?: JSONArray().also { meta.put("layers", it) }
    if ((0 until layers.length()).none { layers.optJSONObject(it)?.optString("id") == layerId } && layerId == "base") {
        layers.put(JSONObject().put("id", "base").put("name", "Calque 1").put("visible", true).put("locked", false))
    }
    for (index in 0 until layers.length()) {
        val layer = layers.optJSONObject(index) ?: continue
        if (layer.optString("id") != layerId) continue
        visible?.let { layer.put("visible", it) }
        locked?.let { layer.put("locked", it) }
        return encode(root)
    }
    return content
}

internal fun replaceBoardElement(content: String, id: String, edited: JSONObject): String {
    val doc = parseBoard(content)
    if (doc.problem != null) return content
    val element = doc.elements.firstOrNull { it.id == id } ?: return content
    if (!isLayerVisible(doc, element) || isBoardElementLocked(doc, element)) return content
    val root = deepCopy(doc.root)
    for (key in listOf("nodes", "edges")) {
        val array = root.optJSONArray(key) ?: continue
        for (index in 0 until array.length()) {
            val current = array.optJSONObject(index) ?: continue
            if (current.optString("id") != id) continue
            array.put(index, deepCopy(edited).put("id", id))
            return encode(root)
        }
    }
    return content
}

internal fun removeBoardElement(content: String, id: String): String {
    val doc = parseBoard(content)
    if (doc.problem != null) return content
    val element = doc.elements.firstOrNull { it.id == id } ?: return content
    if (!isLayerVisible(doc, element) || isBoardElementLocked(doc, element)) return content
    val root = deepCopy(doc.root)
    for (key in listOf("nodes", "edges")) {
        val old = root.optJSONArray(key) ?: continue
        val next = JSONArray()
        var removed = false
        for (index in 0 until old.length()) {
            val item = old.optJSONObject(index) ?: continue
            if (item.optString("id") == id) removed = true else next.put(item)
        }
        if (removed) root.put(key, next)
    }
    return encode(root)
}
