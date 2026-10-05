package com.example.opale.data

/** Path rules shared by the private-file and Storage Access Framework stores. */
internal object VaultPath {
    private val reservedWindowsName = Regex("^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\\..*)?$", RegexOption.IGNORE_CASE)
    private val forbiddenCharacters = setOf('<', '>', ':', '\\', '"', '|', '?', '*')

    fun clean(input: String, allowRoot: Boolean = false, allowHidden: Boolean = false): String {
        val raw = input.replace('\\', '/').trim()
        if (raw.startsWith('/') || Regex("^[a-zA-Z]:").containsMatchIn(raw)) {
            throw IllegalArgumentException("Le chemin doit être relatif au coffre.")
        }

        val parts = raw.split('/').filter { it.isNotEmpty() && it != "." }
        if (parts.isEmpty()) {
            if (allowRoot) return ""
            throw IllegalArgumentException("Le chemin est vide.")
        }

        for (part in parts) {
            if (part == "..") throw IllegalArgumentException("Le chemin sort du coffre.")
            if (part.any { it.code < 0x20 || it in forbiddenCharacters }) {
                throw IllegalArgumentException("Le nom « $part » contient un caractère interdit.")
            }
            if (part.endsWith('.') || part.endsWith(' ')) {
                throw IllegalArgumentException("Un nom ne peut pas finir par un point ou un espace.")
            }
            if (part.length > 240) throw IllegalArgumentException("Le nom « $part » est trop long.")
            if (reservedWindowsName.matches(part)) throw IllegalArgumentException("« $part » est un nom réservé.")
            if (!allowHidden && part.startsWith('.')) throw IllegalArgumentException("Les chemins cachés sont réservés à Opale.")
        }
        return parts.joinToString("/")
    }

    fun parent(path: String): String = path.substringBeforeLast('/', "")

    fun leaf(path: String): String = path.substringAfterLast('/')

    fun extension(path: String): String {
        val leaf = leaf(path)
        val dot = leaf.lastIndexOf('.')
        return if (dot > 0) leaf.substring(dot + 1).lowercase() else ""
    }

    fun stem(path: String): String {
        val leaf = leaf(path)
        val dot = leaf.lastIndexOf('.')
        return if (dot > 0) leaf.substring(0, dot) else leaf
    }

    fun safeAttachmentName(name: String): String {
        val leaf = name.replace('\\', '/').substringAfterLast('/').trim()
        val safe = leaf.map { ch ->
            if (ch.code < 0x20 || ch in forbiddenCharacters) '_' else ch
        }.joinToString("").trim().trimEnd('.', ' ')
        val normalized = safe.ifBlank { "Fichier" }.take(240)
        return if (reservedWindowsName.matches(normalized)) "_${normalized}" else normalized
    }
}
