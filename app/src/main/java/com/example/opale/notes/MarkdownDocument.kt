package com.example.opale.notes

import java.net.URLDecoder
import java.nio.charset.StandardCharsets

internal enum class BlockKind { PARAGRAPH, HEADING, TASK, LIST, CODE, FRONTMATTER, UNSUPPORTED }

internal data class NoteBlock(
    val key: String,
    val start: Int,
    val endExclusive: Int,
    val raw: String,
    val kind: BlockKind,
    val headingLevel: Int = 0,
    val taskChecked: Boolean = false,
    val body: String = raw,
    val listMarker: String = "",
)

internal enum class ImageAlignment { INLINE, LEFT, CENTER, RIGHT }

internal data class ImageOptions(
    val alt: String = "",
    val alignment: ImageAlignment = ImageAlignment.INLINE,
    val width: Int? = null,
    val height: Int? = null,
)

internal data class NoteImage(
    val start: Int,
    val endExclusive: Int,
    val raw: String,
    val target: String,
    val options: ImageOptions,
    val blockIndex: Int,
    val wiki: Boolean,
    val markdownTargetSuffix: String = "",
) {
    val key: String get() = "$start:$endExclusive"
}

private data class SourceLine(val start: Int, val contentEnd: Int, val nextStart: Int, val raw: String) {
    val trimmed: String get() = raw.trim()
}

private val wikiImageRegex = Regex("!\\[\\[(.+?)]]")
private val markdownImageRegex = Regex("!\\[(.*?)\\]\\(([^)\\n]+)\\)")
private val blockStartRegex = Regex("^(?:#{1,6}\\s+|[-+*]\\s+|\\d+[.)]\\s+|>\\s?|\\|.*\\||-{3,}\\s*$)")
private val headingRegex = Regex("^(#{1,6})\\s+(.*)$")
private val taskRegex = Regex("^\\s*([-+*])\\s+\\[([ xX])]\\s+(.*)$")
private val listRegex = Regex("^\\s*((?:[-+*])|(?:\\d+[.)]))\\s+(.*)$")

internal fun parseNoteBlocks(content: String): List<NoteBlock> {
    if (content.isEmpty()) return listOf(NoteBlock("paragraph:0", 0, 0, "", BlockKind.PARAGRAPH))
    val lines = sourceLines(content)
    val result = mutableListOf<NoteBlock>()
    var i = 0
    var offset = 0

    fun append(from: Int, until: Int, kind: BlockKind, headingLevel: Int = 0, body: String? = null, marker: String = "") {
        val first = lines[from]
        val last = lines[until]
        val raw = content.substring(first.start, last.contentEnd)
        val parsedBody = body ?: raw
        val task = taskRegex.matchEntire(raw)
        result += NoteBlock(
            key = "${kind.name.lowercase()}:${first.start}",
            start = first.start,
            endExclusive = last.contentEnd,
            raw = raw,
            kind = if (task != null) BlockKind.TASK else kind,
            headingLevel = headingLevel,
            taskChecked = task?.groupValues?.get(2)?.lowercase() == "x",
            body = if (task != null) task.groupValues[3] else parsedBody,
            listMarker = if (task != null) task.groupValues[1] else marker,
        )
    }

    // YAML frontmatter is recognized only at the beginning of the note.
    if (lines.firstOrNull()?.trimmed == "---") {
        val closing = (1 until lines.size).firstOrNull { lines[it].trimmed == "---" }
        val last = closing ?: lines.lastIndex
        append(0, last, BlockKind.FRONTMATTER)
        i = last + 1
    }

    while (i < lines.size) {
        val line = lines[i]
        val trimmed = line.trimmed
        if (trimmed.isEmpty()) { i++; continue }

        if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
            val fence = trimmed.take(3)
            var end = i + 1
            while (end < lines.size && !lines[end].trimmed.startsWith(fence)) end++
            if (end < lines.size) append(i, end, BlockKind.CODE)
            else append(i, lines.lastIndex, BlockKind.CODE)
            i = if (end < lines.size) end + 1 else lines.size
            continue
        }

        val heading = headingRegex.matchEntire(trimmed)
        if (heading != null) {
            append(i, i, BlockKind.HEADING, heading.groupValues[1].length, heading.groupValues[2])
            i++
            continue
        }

        val list = listRegex.matchEntire(line.raw)
        if (list != null) {
            append(i, i, BlockKind.LIST, body = list.groupValues[2], marker = list.groupValues[1])
            i++
            continue
        }

        if (blockStartRegex.containsMatchIn(trimmed)) {
            append(i, i, BlockKind.UNSUPPORTED)
            i++
            continue
        }

        var end = i
        while (end + 1 < lines.size) {
            val next = lines[end + 1]
            if (next.trimmed.isEmpty() || blockStartRegex.containsMatchIn(next.trimmed) || next.trimmed.startsWith("```") || next.trimmed.startsWith("~~~")) break
            end++
        }
        append(i, end, BlockKind.PARAGRAPH)
        i = end + 1
    }

    // The parser intentionally skips blank lines. They stay in the source text
    // between block ranges, so tapping or reordering a block never normalizes them.
    if (result.isEmpty() && content.endsWith('\n')) {
        result += NoteBlock("paragraph:${content.length}", content.length, content.length, "", BlockKind.PARAGRAPH)
    }
    return result
}

private fun sourceLines(content: String): List<SourceLine> {
    val lines = mutableListOf<SourceLine>()
    var start = 0
    while (start <= content.length) {
        val newline = content.indexOf('\n', start)
        val contentEnd = if (newline < 0) content.length else if (newline > start && content[newline - 1] == '\r') newline - 1 else newline
        val next = if (newline < 0) content.length else newline + 1
        lines += SourceLine(start, contentEnd, next, content.substring(start, contentEnd))
        if (newline < 0) break
        start = next
    }
    return lines
}

internal fun noteImages(blocks: List<NoteBlock>): List<NoteImage> {
    val images = mutableListOf<NoteImage>()
    blocks.forEachIndexed { blockIndex, block ->
        if (block.kind == BlockKind.CODE || block.kind == BlockKind.FRONTMATTER || block.kind == BlockKind.UNSUPPORTED) return@forEachIndexed
        val wikiMatches = wikiImageRegex.findAll(block.raw).map { match ->
            val inner = match.groupValues[1]
            val split = firstUnescapedPipe(inner)
            val target = if (split < 0) inner else inner.substring(0, split)
            val label = if (split < 0) "" else inner.substring(split + 1)
            NoteImage(block.start + match.range.first, block.start + match.range.last + 1, match.value, target.trim(), parseImageOptions(label), blockIndex, true)
        }.toList()
        val markdownMatches = markdownImageRegex.findAll(block.raw).map { match ->
            val label = match.groupValues[1]
            val targetPart = match.groupValues[2].trim()
            val target = targetPart.removeSurrounding("<", ">").substringBeforeLast(" \"").trim()
            val suffix = targetPart.substring(target.length)
            NoteImage(block.start + match.range.first, block.start + match.range.last + 1, match.value, target, parseImageOptions(label), blockIndex, false, suffix)
        }.toList()
        images += (wikiMatches + markdownMatches).sortedBy { it.start }
    }
    return images
}

private fun firstUnescapedPipe(value: String): Int {
    for (i in value.indices) if (value[i] == '|' && (i == 0 || value[i - 1] != '\\')) return i
    return -1
}

internal fun parseImageOptions(label: String): ImageOptions {
    var alignment = ImageAlignment.INLINE
    var width: Int? = null
    var height: Int? = null
    val altParts = mutableListOf<String>()
    var sizeSeen = false
    var alignmentSeen = false
    splitImageLabel(label).forEach { part ->
        val value = part.trim()
        val size = Regex("^(\\d{1,4})(?:x(\\d{1,4}))?$").matchEntire(value)
        if (!sizeSeen && size != null) {
            width = size.groupValues[1].toIntOrNull()
            height = size.groupValues[2].takeIf(String::isNotEmpty)?.toIntOrNull()
            sizeSeen = true
            return@forEach
        }
        if (!alignmentSeen) {
            val next = when (value.lowercase()) {
                "left", "gauche" -> ImageAlignment.LEFT
                "center", "centre" -> ImageAlignment.CENTER
                "right", "droite" -> ImageAlignment.RIGHT
                "inline" -> ImageAlignment.INLINE
                else -> null
            }
            if (next != null) { alignment = next; alignmentSeen = true; return@forEach }
        }
        if (value.isNotEmpty()) altParts += value.replace("\\|", "|")
    }
    return ImageOptions(altParts.joinToString("|"), alignment, width, height)
}

private fun splitImageLabel(label: String): List<String> {
    val parts = mutableListOf<String>()
    val current = StringBuilder()
    var index = 0
    while (index < label.length) {
        val char = label[index]
        if (char == '\\' && label.getOrNull(index + 1) == '|') {
            current.append('|')
            index += 2
        } else if (char == '|') {
            parts += current.toString()
            current.setLength(0)
            index++
        } else {
            current.append(char)
            index++
        }
    }
    parts += current.toString()
    return parts
}

internal fun rewriteImage(raw: String, options: ImageOptions): String {
    val label = buildList {
        if (options.alt.isNotBlank()) add(options.alt.replace("|", "\\|"))
        when (options.alignment) {
            ImageAlignment.INLINE -> Unit
            ImageAlignment.LEFT -> add("left")
            ImageAlignment.CENTER -> add("center")
            ImageAlignment.RIGHT -> add("right")
        }
        options.width?.let { add(if (options.height != null) "${it}x${options.height}" else it.toString()) }
    }
    val wiki = Regex("^!\\[\\[(.+?)]]$").matchEntire(raw)
    if (wiki != null) {
        val inner = wiki.groupValues[1]
        val split = firstUnescapedPipe(inner)
        val target = if (split < 0) inner else inner.substring(0, split)
        return "![["+target+(if (label.isEmpty()) "" else "|"+label.joinToString("|"))+"]]"
    }
    val markdown = Regex("^!\\[(.*?)]\\(([^)]*)\\)$").matchEntire(raw)
    if (markdown != null) {
        return "!["+label.joinToString("|")+ "]("+markdown.groupValues[2]+")"
    }
    return raw
}

internal fun replaceImage(content: String, image: NoteImage, change: (ImageOptions) -> ImageOptions): String {
    val nextRaw = rewriteImage(image.raw, change(image.options))
    return content.replaceRange(image.start, image.endExclusive, nextRaw)
}

/** Inserts an image embed at the end of a note as a new Markdown paragraph. */
fun insertImage(content: String, file: String): String {
    val target = file.trim().replace('\\', '/')
    if (target.isEmpty()) return content
    val embed = "![[${target.replace("|", "\\|")}]]"
    val before = content.trimEnd()
    return if (before.isEmpty()) "$embed\n" else "$before\n\n$embed\n"
}

/** Moves a Markdown image token to a block insertion point without losing its syntax. */
internal fun moveImage(content: String, image: NoteImage, destinationOffset: Int): String {
    val offset = destinationOffset.coerceIn(0, content.length)
    if (offset in image.start..image.endExclusive) return content
    val marker = '\u0000'
    val marked = content.substring(0, offset) + marker + content.substring(offset)
    val shift = if (offset <= image.start) 1 else 0
    val removed = removeImageSpan(marked, image.start + shift, image.endExclusive + shift)
    val at = removed.indexOf(marker)
    if (at < 0) return content
    val withoutMarker = removed.removeRange(at, at + 1)
    return insertParagraphAt(withoutMarker, at, image.raw)
}

private fun removeImageSpan(text: String, from: Int, to: Int): String {
    val lineStart = text.lastIndexOf('\n', from - 1) + 1
    val lineEnd = text.indexOf('\n', to).let { if (it < 0) text.length else it }
    if (text.substring(lineStart, from).isBlank() && text.substring(to, lineEnd).isBlank()) {
        var cut = lineStart
        val after = if (lineEnd < text.length) lineEnd + 1 else lineEnd
        if (after == text.length && cut > 0) cut--
        val out = text.substring(0, cut) + text.substring(after)
        var before = cut
        var afterBlank = cut
        while (before > 0 && out[before - 1] == '\n') before--
        while (afterBlank < out.length && out[afterBlank] == '\n') afterBlank++
        if (afterBlank - before > 2 || before == 0) {
            val replacement = if (before == 0) "" else if (afterBlank == out.length) "\n" else "\n\n"
            return out.substring(0, before) + replacement + out.substring(afterBlank)
        }
        return out
    }
    var start = from
    var end = to
    if (text.getOrNull(start - 1) in listOf(' ', '\t') && (text.getOrNull(end) in listOf(' ', '\t') || end == lineEnd)) start--
    else if (start == lineStart && text.getOrNull(end) in listOf(' ', '\t')) end++
    return text.removeRange(start, end)
}

private fun insertParagraphAt(text: String, offset: Int, token: String): String {
    val before = text.substring(0, offset).trimEnd()
    val remaining = text.substring(offset)
    val blankLines = Regex("^(?:[ \\t]*\\n)+").find(remaining)
    val after = if (blankLines == null) remaining else remaining.substring(blankLines.range.last + 1)
    val prefix = if (before.isEmpty()) "" else "$before\n\n"
    val suffix = if (after.isEmpty()) "\n" else "\n\n$after"
    return prefix + token + suffix
}

internal fun resolveVaultImagePath(notePath: String, target: String): String? {
    val decoded = runCatching {
        URLDecoder.decode(target.replace("+", "%2B"), StandardCharsets.UTF_8.name())
    }.getOrDefault(target).substringBefore('#').substringBefore('?').trim()
    if (decoded.isBlank() || decoded.startsWith("http://", true) || decoded.startsWith("https://", true) || decoded.contains("://")) return null
    val base = if (decoded.startsWith('/')) emptyList() else notePath.replace('\\', '/').substringBeforeLast('/', "").split('/').filter(String::isNotEmpty)
    val parts = base.toMutableList()
    decoded.removePrefix("/").replace('\\', '/').split('/').forEach { segment ->
        when (segment) {
            "", "." -> Unit
            ".." -> if (parts.isEmpty()) return null else parts.removeAt(parts.lastIndex)
            else -> parts += segment
        }
    }
    return parts.joinToString("/").takeIf(String::isNotBlank)
}

internal fun replaceBlock(content: String, block: NoteBlock, newRaw: String): String =
    content.replaceRange(block.start, block.endExclusive, newRaw)

internal fun editTask(content: String, block: NoteBlock): String {
    val next = if (block.taskChecked) {
        block.raw.replaceFirst(Regex("\\[xX]"), "[ ]")
    } else {
        block.raw.replaceFirst("[ ]", "[x]")
    }
    return replaceBlock(content, block, next)
}

internal fun wikiLinkTarget(inner: String): Pair<String, String> {
    val pipe = firstUnescapedPipe(inner)
    val target = (if (pipe < 0) inner else inner.substring(0, pipe)).trim()
    val label = if (pipe < 0) "" else inner.substring(pipe + 1).replace("\\|", "|").trim()
    return target to label
}
