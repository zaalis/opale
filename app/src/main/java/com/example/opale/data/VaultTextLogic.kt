package com.example.opale.data

import java.text.Normalizer
import java.util.Locale

/** Small, platform-neutral pieces of Markdown/query logic used by the vault. */
object VaultTextLogic {
    private val wikiLink = Regex("!?\\[\\[([^\\[\\]\\n]+?)]]")
    private val inlineCode = Regex("(`+)(.+?)\\1")
    private val frontmatterTag = Regex("(?m)^\\s*(?:tags?\\s*:\\s*)(.*)$", RegexOption.IGNORE_CASE)
    private val hashTag = Regex("(?<![\\w/])#([\\p{L}\\p{N}_/-]+)")

    /** Returns distinct wiki-link destinations, without aliases or headings. */
    fun extractWikiLinks(markdown: String): List<String> {
        val visible = maskCode(markdown)
        val seen = linkedSetOf<String>()
        wikiLink.findAll(visible).forEach { match ->
            val target = match.groupValues[1]
                .substringBefore('|')
                .substringBefore('#')
                .trim()
            if (target.isNotEmpty()) seen += target
        }
        return seen.toList()
    }

    /** Extracts simple tags from frontmatter and visible Markdown text. */
    fun extractTags(markdown: String): Set<String> {
        val tags = linkedSetOf<String>()
        val fm = Regex("(?s)^---\\s*\\n(.*?)\\n(?:---|\\.\\.\\.)\\s*(?:\\n|$)").find(markdown)
        fm?.groupValues?.getOrNull(1)?.let { yaml ->
            frontmatterTag.findAll(yaml).forEach { line ->
                val raw = line.groupValues[1].trim()
                val values = if (raw.startsWith('[') && raw.endsWith(']')) raw.substring(1, raw.length - 1) else raw
                values.split(Regex("[,\\s]+"))
                    .map { it.trim().trim('"', '\'', '#') }
                    .filter { it.isNotEmpty() }
                    .forEach { tags += it }
            }
        }
        hashTag.findAll(maskCode(markdown)).forEach { tags += it.groupValues[1] }
        return tags
    }

    /**
     * Evaluates the existing lightweight Opale query language: words/phrases,
     * `-exclude`, `OR`, `/regex/`, and `file:`, `path:`, `content:` and `tag:`.
     */
    fun matchesSearchQuery(
        query: String,
        path: String,
        content: String,
        tags: Set<String> = emptySet(),
    ): Boolean {
        val groups = parseQuery(query)
        if (groups.isEmpty()) return false
        val maskedContent = maskCode(content)
        val baseName = path.substringAfterLast('/').substringBeforeLast('.', path.substringAfterLast('/'))
        val allTags = (tags + extractTags(content)).mapTo(linkedSetOf()) { normalize(it.removePrefix("#")) }

        return groups.any { group ->
            group.all { clause ->
                val found = when (clause.field) {
                    "file" -> clause.pattern.containsMatchIn(normalize(path.substringAfterLast('/')))
                    "path" -> clause.pattern.containsMatchIn(normalize(path))
                    "content" -> clause.pattern.containsMatchIn(normalize(maskedContent))
                    "tag" -> {
                        val wanted = normalize(clause.value.removePrefix("#"))
                        allTags.any { it == wanted || it.startsWith("$wanted/") }
                    }
                    else -> clause.pattern.containsMatchIn(normalize(baseName)) || clause.pattern.containsMatchIn(normalize(maskedContent))
                }
                found != clause.negate
            }
        }
    }

    private data class Clause(
        val field: String,
        val value: String,
        val pattern: Regex,
        val negate: Boolean,
    )

    private fun parseQuery(query: String): List<List<Clause>> {
        val groups = mutableListOf(mutableListOf<Clause>())
        val text = query
        var i = 0
        while (i < text.length) {
            if (text[i].isWhitespace()) { i++; continue }
            var negate = false
            if (text[i] == '-' && i + 1 < text.length && !text[i + 1].isWhitespace()) { negate = true; i++ }

            var field = "any"
            val fieldMatch = Regex("^(file|path|tag|content):", RegexOption.IGNORE_CASE).find(text.substring(i))
            if (fieldMatch != null) {
                field = fieldMatch.groupValues[1].lowercase(Locale.ROOT)
                i += fieldMatch.value.length
            }

            var regexMode = false
            val value: String
            when {
                i < text.length && text[i] == '"' -> {
                    val end = text.indexOf('"', i + 1)
                    value = text.substring(i + 1, if (end < 0) text.length else end)
                    i = if (end < 0) text.length else end + 1
                }
                i < text.length && text[i] == '/' && text.indexOf('/', i + 1) > i -> {
                    val end = text.indexOf('/', i + 1)
                    value = text.substring(i + 1, end)
                    i = end + 1
                    regexMode = true
                }
                else -> {
                    val start = i
                    while (i < text.length && !text[i].isWhitespace()) i++
                    value = text.substring(start, i)
                }
            }
            if (value.isEmpty()) continue
            if (field == "any" && !negate && !regexMode && value == "OR") {
                if (groups.last().isNotEmpty()) groups.add(mutableListOf())
                continue
            }
            groups.last().add(Clause(field, value, compilePattern(value, regexMode), negate))
        }
        return groups.filter { it.isNotEmpty() }
    }

    private fun compilePattern(value: String, regexMode: Boolean): Regex {
        if (regexMode && value.length <= 160) {
            try { return Regex(value, setOf(RegexOption.IGNORE_CASE, RegexOption.MULTILINE)) }
            catch (_: IllegalArgumentException) { /* Treat an invalid expression as literal text. */ }
        }
        return Regex(Regex.escape(normalize(value)))
    }

    private fun normalize(value: String): String = Normalizer
        .normalize(value.lowercase(Locale.ROOT), Normalizer.Form.NFD)
        .filterNot { Character.getType(it) == Character.NON_SPACING_MARK.toInt() }

    /** Masks fenced/inline code and Obsidian comments while preserving line boundaries. */
    internal fun maskCode(source: String): String {
        val lines = source.split('\n').toMutableList()
        var fenceChar: Char? = null
        var fenceLength = 0
        var inComment = false
        for (index in lines.indices) {
            val line = lines[index]
            val fence = Regex("^\\s{0,3}(`{3,}|~{3,})").find(line)
            if (fenceChar != null) {
                val closing = Regex("^\\s{0,3}([`~]+)\\s*$").find(line)?.groupValues?.get(1)
                lines[index] = " ".repeat(line.length)
                if (closing != null && closing.firstOrNull() == fenceChar && closing.length >= fenceLength) fenceChar = null
                continue
            }
            if (fence != null) {
                fenceChar = fence.groupValues[1].first()
                fenceLength = fence.groupValues[1].length
                lines[index] = " ".repeat(line.length)
                continue
            }

            var visible = line
            if (inComment) {
                val close = visible.indexOf("%%")
                if (close < 0) { lines[index] = " ".repeat(line.length); continue }
                visible = " ".repeat(close + 2) + visible.substring(close + 2)
                inComment = false
            }
            val commentStart = visible.indexOf("%%")
            if (commentStart >= 0) {
                val commentEnd = visible.indexOf("%%", commentStart + 2)
                if (commentEnd >= 0) {
                    visible = visible.substring(0, commentStart) + " ".repeat(commentEnd + 2 - commentStart) + visible.substring(commentEnd + 2)
                } else {
                    visible = visible.substring(0, commentStart) + " ".repeat(visible.length - commentStart)
                    inComment = true
                }
            }
            lines[index] = inlineCode.replace(visible) { match -> " ".repeat(match.value.length) }
        }
        return lines.joinToString("\n")
    }
}
