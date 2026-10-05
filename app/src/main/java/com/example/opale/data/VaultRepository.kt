package com.example.opale.data

import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.system.Os
import android.system.OsConstants
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileNotFoundException
import java.io.IOException
import java.io.InputStream
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

data class VaultEntry(
    val path: String,
    val name: String,
    val isDirectory: Boolean,
    val modified: Long = 0,
    val size: Long = 0,
)

data class DocumentSnapshot(val content: String, val revision: String)

class VaultConflictException(
    val path: String,
    val expectedRevision: String,
    val actualRevision: String?,
) : IOException("Le fichier « $path » a été modifié ailleurs.")

class VaultRepository(context: Context) {
    private sealed class Root {
        data class Local(val directory: File) : Root()
        data class Tree(val uri: Uri, val name: String) : Root()
    }

    private data class DocumentInfo(
        val uri: Uri,
        val name: String,
        val mimeType: String,
        val modified: Long,
        val size: Long,
    ) {
        val isDirectory: Boolean get() = mimeType == DocumentsContract.Document.MIME_TYPE_DIR
    }

    private data class RewritePlan(
        val pathBeforeMove: String,
        val pathAfterMove: String,
        val before: DocumentSnapshot,
        val after: String,
    )

    private val appContext = context.applicationContext
    private val resolver: ContentResolver = appContext.contentResolver
    private val preferences = appContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
    private val lock = ReentrantLock()
    private val localDirectory = File(appContext.filesDir, LOCAL_VAULT_DIRECTORY)
    @Volatile
    private var root: Root

    val name: String
        get() = when (val current = root) {
            is Root.Local -> current.directory.name.ifBlank { "Opale" }
            is Root.Tree -> current.name
        }

    val isExternal: Boolean
        get() = root is Root.Tree

    /** Stable vault identity that distinguishes roots with the same display name. */
    val identity: String
        get() = when (val current = root) {
            is Root.Local -> "local:${current.directory.absolutePath}"
            is Root.Tree -> "tree:${current.uri}"
        }

    init {
        if (!localDirectory.exists() && !localDirectory.mkdirs()) {
            throw IOException("Impossible de créer le coffre privé d’Opale.")
        }
        ensureWelcomeNote()
        root = restoreRoot()
    }

    /** Opens an Android document tree and retains the grant across restarts. */
    fun openVault(uri: Uri) = lock.withLock {
        if (!DocumentsContract.isTreeUri(uri)) {
            throw IllegalArgumentException("Choisissez un dossier avec le sélecteur Android.")
        }
        val rootDocument = rootDocumentUri(uri)
        val info = queryDocument(rootDocument)
            ?: throw FileNotFoundException("Le dossier choisi n’est plus disponible.")
        if (!info.isDirectory) throw IllegalArgumentException("Le coffre choisi n’est pas un dossier.")

        val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        try {
            resolver.takePersistableUriPermission(uri, flags)
        } catch (error: SecurityException) {
            throw IOException("Android n’a pas accordé l’accès persistant en lecture et écriture à ce coffre.", error)
        } catch (error: IllegalArgumentException) {
            throw IOException("Le sélecteur n’a pas fourni une autorisation persistante pour ce dossier.", error)
        }

        val retained = resolver.persistedUriPermissions.any {
            it.uri == uri && it.isReadPermission && it.isWritePermission
        }
        if (!retained) throw IOException("L’accès au coffre ne peut pas être conservé après fermeture d’Opale.")

        val displayName = info.name.ifBlank { "Coffre Android" }
        preferences.edit()
            .putString(KEY_TREE_URI, uri.toString())
            .putString(KEY_TREE_NAME, displayName)
            .putString(KEY_ACTIVE_ROOT, ROOT_TREE)
            .apply()
        root = Root.Tree(uri, displayName)
    }

    /** Switches to the app-private vault, creating a welcome note if it is empty. */
    fun useLocalVault() = lock.withLock {
        ensureWelcomeNote()
        preferences.edit().putString(KEY_ACTIVE_ROOT, ROOT_LOCAL).apply()
        root = Root.Local(localDirectory)
    }

    /** Lists every visible vault entry recursively; Opale's internal folders stay hidden. */
    fun listEntries(): List<VaultEntry> = lock.withLock {
        val visible = mutableListOf<VaultEntry>()
        when (val current = root) {
            is Root.Local -> listLocal(current.directory, "", visible)
            is Root.Tree -> listTree(current, rootDocumentUri(current.uri), "", visible)
        }
        visible.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.path })
    }

    fun readDocument(path: String): DocumentSnapshot = lock.withLock {
        val clean = VaultPath.clean(path)
        val bytes = when (val current = root) {
            is Root.Local -> {
                val file = localFile(current, clean)
                if (!file.isFile) throw FileNotFoundException("Le fichier « $clean » est introuvable.")
                file.readBytes()
            }
            is Root.Tree -> {
                val document = findTreeDocument(current, clean)
                    ?: throw FileNotFoundException("Le fichier « $clean » est introuvable.")
                if (document.isDirectory) throw IOException("« $clean » est un dossier.")
                resolver.openInputStream(document.uri)?.use(InputStream::readBytes)
                    ?: throw IOException("Impossible de lire « $clean ».")
            }
        }
        val text = bytes.toString(Charsets.UTF_8).removePrefix("\uFEFF").replace("\r\n", "\n").replace('\r', '\n')
        DocumentSnapshot(text, revision(bytes))
    }

    /** Writes UTF-8 text only if the caller's optional revision still matches. */
    fun writeDocument(path: String, content: String, expectedRevision: String? = null): DocumentSnapshot = lock.withLock {
        val clean = VaultPath.clean(path)
        val encoded = content.toByteArray(Charsets.UTF_8)
        val existing = findEntry(clean)
        val actualRevision = existing?.let {
            if (it.isDirectory) throw IOException("« $clean » est un dossier.")
            readDocument(clean).revision
        }
        if (expectedRevision != null && actualRevision != expectedRevision) {
            throw VaultConflictException(clean, expectedRevision, actualRevision)
        }
        ensureParentExists(VaultPath.parent(clean))
        when (val current = root) {
            is Root.Local -> writeLocal(current, clean, encoded)
            is Root.Tree -> {
                val uri = existing?.uri ?: createTreeDocument(current, VaultPath.parent(clean), VaultPath.leaf(clean), mimeTypeFor(clean))
                writeTreeDocument(uri, encoded, clean)
                val persisted = readDocument(clean)
                val intendedRevision = revision(encoded)
                if (persisted.revision != intendedRevision) {
                    throw IOException("Le fournisseur Android n’a pas conservé exactement le contenu écrit dans « $clean ». Le document peut avoir été modifié simultanément.")
                }
            }
        }
        DocumentSnapshot(content, revision(encoded))
    }

    fun createNote(name: String, folder: String = "", board: Boolean = false): String = lock.withLock {
        val requested = name.trim().removeSuffix(".md").removeSuffix(".MD")
            .let { value -> if (board && value.endsWith(".canvas", ignoreCase = true)) value.dropLast(7) else value }
            .trim()
        if (requested.isBlank() || requested.contains('/') || requested.contains('\\')) {
            throw IllegalArgumentException("Indiquez un nom de fichier simple.")
        }
        val safeBase = VaultPath.clean(requested).also {
            if (it.contains('/')) throw IllegalArgumentException("Indiquez un nom de fichier simple.")
        }
        val directory = if (folder.isBlank()) "" else VaultPath.clean(folder)
        if (directory.isNotEmpty()) createFolder(directory)
        val suffix = if (board) ".canvas" else ".md"
        val leaf = safeBase + suffix
        val path = uniquePath(directory, leaf)
        val content = if (board) emptyCanvas() else ""
        writeDocument(path, content)
        path
    }

    fun createFolder(path: String): Unit = lock.withLock {
        val clean = VaultPath.clean(path)
        when (val current = root) {
            is Root.Local -> {
                val directory = localFile(current, clean)
                if (directory.exists() && !directory.isDirectory) throw IOException("Un fichier porte déjà le nom « $clean ».")
                if (!directory.exists() && !directory.mkdirs()) throw IOException("Impossible de créer le dossier « $clean ».")
            }
            is Root.Tree -> ensureTreeFolder(current, clean)
        }
    }

    /** Moves/renames a note, attachment or directory and updates references. */
    fun rename(path: String, newPath: String) = lock.withLock {
        val source = VaultPath.clean(path)
        val target = VaultPath.clean(newPath)
        if (source.equals(target, ignoreCase = true) && source == target) return@withLock

        val sourceInfo = findEntry(source) ?: throw FileNotFoundException("« $source » est introuvable.")
        val isDirectory = sourceInfo.isDirectory
        val sourceEntry = VaultEntry(source, sourceInfo.name, isDirectory, sourceInfo.modified, sourceInfo.size)
        if (isDirectory && target.startsWith("$source/", ignoreCase = true)) {
            throw IllegalArgumentException("Un dossier ne peut pas être déplacé dans lui-même.")
        }
        val targetEntry = findEntry(target)
        if (targetEntry != null && !target.equals(source, ignoreCase = true)) {
            throw IOException("Un fichier ou dossier porte déjà le nom « $target ».")
        }
        ensureParentExists(VaultPath.parent(target))

        val beforeEntries = listEntries()
        val affected = if (isDirectory) {
            beforeEntries.filter { !it.isDirectory && it.path.startsWith("$source/", ignoreCase = true) }
        } else listOf(sourceEntry)
        val mapping = linkedMapOf<String, String>()
        if (isDirectory) {
            affected.forEach { mapping[it.path] = target + it.path.substring(source.length) }
        } else mapping[source] = target
        val pathsBefore = beforeEntries.filterNot { it.isDirectory }.map { it.path }
        val plans = planReferenceUpdates(mapping, pathsBefore)

        when (val current = root) {
            is Root.Local -> moveLocal(current, source, target)
            is Root.Tree -> moveTree(current, source, target)
        }

        for (plan in plans) {
            writeDocument(plan.pathAfterMove, plan.after, plan.before.revision)
        }
    }

    /** Moves the entry under hidden .trash storage without deleting its contents. */
    fun trash(path: String) = lock.withLock {
        val source = VaultPath.clean(path)
        if (findEntry(source) == null) throw FileNotFoundException("« $source » est introuvable.")
        val stamp = SimpleDateFormat("yyyyMMdd-HHmmss-SSS", Locale.ROOT).format(Date())
        val trashFolder = ".trash/$stamp-${UUID.randomUUID().toString().take(8)}"
        ensureInternalFolder(trashFolder)
        val target = "$trashFolder/${VaultPath.leaf(source)}"
        when (val current = root) {
            is Root.Local -> moveLocal(current, source, target, allowHidden = true)
            is Root.Tree -> moveTree(current, source, target, allowHidden = true)
        }
    }

    /** Copies a user-selected content URI into the default attachment folder. */
    fun importAttachment(uri: Uri): String = lock.withLock {
        val displayName = runCatching {
            resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                val column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (cursor.moveToFirst() && column >= 0) cursor.getString(column) else null
            }
        }.getOrNull()
        val safeName = VaultPath.safeAttachmentName(displayName ?: uri.lastPathSegment ?: "Fichier")
        val folder = DEFAULT_ATTACHMENT_FOLDER
        createFolder(folder)
        val destination = uniquePath(folder, safeName)
        val output = createNewEntry(destination, mimeTypeFor(destination))
        try {
            resolver.openInputStream(uri)?.use { input ->
                openOutput(output)?.use { sink -> input.copyTo(sink) }
                    ?: throw IOException("Impossible d’écrire la pièce jointe.")
            } ?: throw IOException("Impossible d’ouvrir le fichier sélectionné.")
        } catch (error: Exception) {
            try { deleteEntry(output) } catch (_: Exception) { }
            throw if (error is IOException) error else IOException("Impossible d’importer la pièce jointe.", error)
        }
        destination
    }

    fun readBytes(path: String): ByteArray = lock.withLock {
        val clean = VaultPath.clean(path)
        when (val current = root) {
            is Root.Local -> {
                val file = localFile(current, clean)
                if (!file.isFile) throw FileNotFoundException("Le fichier « $clean » est introuvable.")
                file.readBytes()
            }
            is Root.Tree -> {
                val document = findTreeDocument(current, clean)
                    ?: throw FileNotFoundException("Le fichier « $clean » est introuvable.")
                if (document.isDirectory) throw IOException("« $clean » est un dossier.")
                resolver.openInputStream(document.uri)?.use(InputStream::readBytes)
                    ?: throw IOException("Impossible de lire « $clean ».")
            }
        }
    }

    private fun restoreRoot(): Root {
        val local = Root.Local(localDirectory)
        if (preferences.getString(KEY_ACTIVE_ROOT, ROOT_LOCAL) != ROOT_TREE) return local
        val rawUri = preferences.getString(KEY_TREE_URI, null) ?: return local
        val uri = runCatching { Uri.parse(rawUri) }.getOrNull() ?: return local
        val hasGrant = resolver.persistedUriPermissions.any {
            it.uri == uri && it.isReadPermission && it.isWritePermission
        }
        if (!hasGrant || !DocumentsContract.isTreeUri(uri)) return local
        val storedName = preferences.getString(KEY_TREE_NAME, null).orEmpty().ifBlank { "Coffre Android" }
        return Root.Tree(uri, storedName)
    }

    private fun ensureWelcomeNote() {
        val existing = localDirectory.listFiles().orEmpty().any { !it.name.startsWith('.') }
        if (!existing) {
            File(localDirectory, "Bienvenue.md").writeText(
                "# Bienvenue dans Opale\n\n" +
                    "Vos notes restent dans ce coffre privé sur cet appareil. " +
                    "Vous pouvez aussi ouvrir un dossier de notes avec le sélecteur Android.\n",
                Charsets.UTF_8,
            )
        }
    }

    private fun emptyCanvas(): String = JSONObject()
        .put("nodes", JSONArray())
        .put("edges", JSONArray())
        .put("opale", JSONObject()
            .put("version", 1)
            .put("layers", JSONArray().put(JSONObject()
                .put("id", "base")
                .put("name", "Calque 1")
                .put("visible", true)
                .put("locked", false)))
            .put("settings", JSONObject()
                .put("grid", "dots")
                .put("snap", true)
                .put("privateMode", false)))
        .toString(2) + "\n"

    private fun listLocal(root: File, relative: String, out: MutableList<VaultEntry>) {
        val directory = if (relative.isEmpty()) root else File(root, relative)
        val children = directory.listFiles()?.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.name }) ?: return
        for (child in children) {
            if (child.name.startsWith('.') || child.isSymbolicLink()) continue
            val canonicalRoot = root.canonicalFile.path.trimEnd(File.separatorChar)
            val canonicalChild = child.canonicalFile.path
            if (!canonicalChild.startsWith(canonicalRoot + File.separator)) continue
            val childPath = if (relative.isEmpty()) child.name else "$relative/${child.name}"
            runCatching { VaultPath.clean(childPath) }.getOrElse { continue }
            val entry = VaultEntry(childPath, child.name, child.isDirectory, child.lastModified(), if (child.isFile) child.length() else 0L)
            out += entry
            if (child.isDirectory) listLocal(root, childPath, out)
        }
    }

    private fun listTree(root: Root.Tree, parent: Uri, relative: String, out: MutableList<VaultEntry>) {
        for (child in queryChildren(root.uri, parent)) {
            if (child.name.startsWith('.')) continue
            val childPath = if (relative.isEmpty()) child.name else "$relative/${child.name}"
            runCatching { VaultPath.clean(childPath) }.getOrElse { continue }
            out += VaultEntry(childPath, child.name, child.isDirectory, child.modified, child.size)
            if (child.isDirectory) listTree(root, child.uri, childPath, out)
        }
    }

    private fun findEntry(path: String): DocumentInfo? = when (val current = root) {
        is Root.Local -> {
            val file = localFile(current, path, allowHidden = path.startsWith('.'))
            if (!file.exists()) null else DocumentInfo(
                uri = Uri.fromFile(file),
                name = file.name,
                mimeType = if (file.isDirectory) DocumentsContract.Document.MIME_TYPE_DIR else mimeTypeFor(path),
                modified = file.lastModified(),
                size = if (file.isFile) file.length() else 0L,
            )
        }
        is Root.Tree -> findTreeDocument(current, path)
    }

    private fun ensureParentExists(path: String) {
        if (path.isEmpty()) return
        when (val current = root) {
            is Root.Local -> {
                val directory = localFile(current, path)
                if (!directory.isDirectory) throw FileNotFoundException("Le dossier « $path » est introuvable.")
            }
            is Root.Tree -> {
                val document = findTreeDocument(current, path)
                    ?: throw FileNotFoundException("Le dossier « $path » est introuvable.")
                if (!document.isDirectory) throw IOException("« $path » n’est pas un dossier.")
            }
        }
    }

    private fun ensureInternalFolder(path: String) {
        when (val current = root) {
            is Root.Local -> {
                val folder = localFile(current, path, allowHidden = true)
                if (folder.exists() && !folder.isDirectory) throw IOException("Un fichier porte déjà ce nom.")
                if (!folder.exists() && !folder.mkdirs()) throw IOException("Impossible de préparer la corbeille Opale.")
            }
            is Root.Tree -> ensureTreeFolder(current, path, allowHidden = true)
        }
    }

    private fun ensureTreeFolder(root: Root.Tree, path: String, allowHidden: Boolean = false): Uri {
        val clean = VaultPath.clean(path, allowHidden = allowHidden)
        var parent = rootDocumentUri(root.uri)
        var built = ""
        for (segment in clean.split('/')) {
            built = if (built.isEmpty()) segment else "$built/$segment"
            val existing = findChild(root.uri, parent, segment)
            if (existing != null) {
                if (!existing.isDirectory) throw IOException("« $built » n’est pas un dossier.")
                parent = existing.uri
            } else {
                parent = DocumentsContract.createDocument(resolver, parent, DocumentsContract.Document.MIME_TYPE_DIR, segment)
                    ?: throw IOException("Le fournisseur Android n’a pas créé le dossier « $built ».")
            }
        }
        return parent
    }

    private fun findTreeDocument(root: Root.Tree, path: String, allowHidden: Boolean = false): DocumentInfo? {
        val clean = VaultPath.clean(path, allowHidden = allowHidden, allowRoot = allowHidden && path.isEmpty())
        if (clean.isEmpty()) return queryDocument(rootDocumentUri(root.uri))
        var parent = rootDocumentUri(root.uri)
        var found: DocumentInfo? = null
        val segments = clean.split('/')
        for ((index, segment) in segments.withIndex()) {
            found = findChild(root.uri, parent, segment) ?: return null
            if (index < segments.lastIndex && !found.isDirectory) return null
            parent = found.uri
        }
        return found
    }

    private fun findChild(treeUri: Uri, parent: Uri, name: String): DocumentInfo? {
        val matches = queryChildren(treeUri, parent).filter { it.name.equals(name, ignoreCase = true) }
        return matches.firstOrNull { it.name == name } ?: matches.firstOrNull()
    }

    private fun queryChildren(treeUri: Uri, parent: Uri): List<DocumentInfo> {
        val parentId = try { DocumentsContract.getDocumentId(parent) }
        catch (error: IllegalArgumentException) { throw IOException("Le fournisseur Android a retourné un document invalide.", error) }
        val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentId)
        val projection = arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_LAST_MODIFIED,
            DocumentsContract.Document.COLUMN_SIZE,
        )
        val result = mutableListOf<DocumentInfo>()
        val cursor = resolver.query(childrenUri, projection, null, null, null)
            ?: throw IOException("Le fournisseur Android ne peut pas lister ce dossier.")
        cursor.use {
            val idColumn = it.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
            val nameColumn = it.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
            val mimeColumn = it.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE)
            val modifiedColumn = it.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED)
            val sizeColumn = it.getColumnIndex(DocumentsContract.Document.COLUMN_SIZE)
            if (idColumn < 0 || nameColumn < 0 || mimeColumn < 0) {
                throw IOException("Le fournisseur Android ne retourne pas les métadonnées requises.")
            }
            while (it.moveToNext()) {
                val id = it.getString(idColumn) ?: continue
                val childName = it.getString(nameColumn) ?: continue
                val mime = it.getString(mimeColumn) ?: "application/octet-stream"
                val modified = if (modifiedColumn >= 0 && !it.isNull(modifiedColumn)) it.getLong(modifiedColumn) else 0L
                val size = if (sizeColumn >= 0 && !it.isNull(sizeColumn)) it.getLong(sizeColumn).coerceAtLeast(0L) else 0L
                result += DocumentInfo(
                    DocumentsContract.buildDocumentUriUsingTree(treeUri, id), childName, mime, modified, size,
                )
            }
        }
        return result
    }

    private fun queryDocument(uri: Uri): DocumentInfo? {
        val projection = arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_LAST_MODIFIED,
            DocumentsContract.Document.COLUMN_SIZE,
        )
        val cursor: Cursor = resolver.query(uri, projection, null, null, null) ?: return null
        cursor.use {
            if (!it.moveToFirst()) return null
            val name = it.getString(it.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DISPLAY_NAME)).orEmpty()
            val mime = it.getString(it.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_MIME_TYPE)).orEmpty()
            val modifiedIndex = it.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED)
            val sizeIndex = it.getColumnIndex(DocumentsContract.Document.COLUMN_SIZE)
            return DocumentInfo(
                uri,
                name,
                mime,
                if (modifiedIndex >= 0 && !it.isNull(modifiedIndex)) it.getLong(modifiedIndex) else 0L,
                if (sizeIndex >= 0 && !it.isNull(sizeIndex)) it.getLong(sizeIndex).coerceAtLeast(0L) else 0L,
            )
        }
    }

    private fun rootDocumentUri(tree: Uri): Uri {
        val documentId = try { DocumentsContract.getTreeDocumentId(tree) }
        catch (error: IllegalArgumentException) { throw IOException("L’URI sélectionnée n’est pas un arbre de documents.", error) }
        return DocumentsContract.buildDocumentUriUsingTree(tree, documentId)
    }

    private fun createTreeDocument(root: Root.Tree, parentPath: String, name: String, mimeType: String): Uri {
        val parent = if (parentPath.isEmpty()) rootDocumentUri(root.uri) else {
            findTreeDocument(root, parentPath)?.uri ?: throw FileNotFoundException("Le dossier « $parentPath » est introuvable.")
        }
        val parentInfo = queryDocument(parent) ?: throw FileNotFoundException("Le dossier de destination est introuvable.")
        if (!parentInfo.isDirectory) throw IOException("Le dossier de destination n’est pas un dossier.")
        if (findChild(root.uri, parent, name) != null) throw IOException("Un fichier porte déjà le nom « $name ».")
        return DocumentsContract.createDocument(resolver, parent, mimeType, name)
            ?: throw IOException("Le fournisseur Android n’a pas créé « $name ».")
    }

    private fun createNewEntry(path: String, mimeType: String): DocumentInfo {
        val clean = VaultPath.clean(path, allowHidden = path.startsWith('.'))
        val parent = VaultPath.parent(clean)
        ensureParentExists(parent)
        return when (val current = root) {
            is Root.Local -> {
                val file = localFile(current, clean, allowHidden = clean.startsWith('.'))
                if (file.exists() || !file.createNewFile()) throw IOException("Un fichier porte déjà le nom « $clean ».")
                DocumentInfo(Uri.fromFile(file), file.name, mimeType, file.lastModified(), file.length())
            }
            is Root.Tree -> {
                val uri = createTreeDocument(current, parent, VaultPath.leaf(clean), mimeType)
                queryDocument(uri) ?: DocumentInfo(uri, VaultPath.leaf(clean), mimeType, 0L, 0L)
            }
        }
    }

    private fun writeTreeDocument(uri: Uri, bytes: ByteArray, path: String) {
        try {
            resolver.openOutputStream(uri, "wt")?.use { it.write(bytes) }
                ?: throw IOException("Le fournisseur Android ne peut pas écrire « $path ».")
        } catch (error: Exception) {
            throw if (error is IOException) error else IOException("Impossible d’écrire « $path » dans ce coffre.", error)
        }
    }

    private fun openOutput(info: DocumentInfo) = when (val current = root) {
        is Root.Local -> localFileFromUri(current, info.uri).outputStream()
        is Root.Tree -> resolver.openOutputStream(info.uri, "wt")
    }

    private fun writeLocal(root: Root.Local, path: String, bytes: ByteArray) {
        val destination = localFile(root, path)
        if (destination.exists() && !destination.isFile) throw IOException("« $path » n’est pas un fichier.")
        if (destination.parentFile?.isDirectory != true) throw FileNotFoundException("Le dossier de destination n’existe pas.")
        val temporary = File(destination.parentFile, ".opale-${UUID.randomUUID()}.tmp")
        try {
            temporary.outputStream().use { it.write(bytes) }
            if (Build.VERSION.SDK_INT >= 26) {
                try {
                    java.nio.file.Files.move(
                        temporary.toPath(), destination.toPath(),
                        java.nio.file.StandardCopyOption.ATOMIC_MOVE,
                        java.nio.file.StandardCopyOption.REPLACE_EXISTING,
                    )
                } catch (_: Exception) {
                    java.nio.file.Files.move(
                        temporary.toPath(), destination.toPath(),
                        java.nio.file.StandardCopyOption.REPLACE_EXISTING,
                    )
                }
            } else {
                val backup = if (destination.exists()) File(destination.parentFile, ".opale-${UUID.randomUUID()}.bak") else null
                if (backup != null && !destination.renameTo(backup)) throw IOException("Impossible de préserver l’ancienne version de « $path ».")
                if (!temporary.renameTo(destination)) {
                    if (backup != null && !backup.renameTo(destination)) {
                        throw IOException("Écriture impossible et restauration de « $path » échouée. Copie conservée : ${backup.name}.")
                    }
                    throw IOException("Impossible d’installer la nouvelle version de « $path ».")
                }
                if (backup != null) backup.delete()
            }
        } finally {
            if (temporary.exists()) temporary.delete()
        }
    }

    private fun localFile(root: Root.Local, path: String, allowHidden: Boolean = false): File {
        val clean = VaultPath.clean(path, allowRoot = true, allowHidden = allowHidden)
        val base = root.directory.canonicalFile
        val target = if (clean.isEmpty()) base else File(base, clean.replace('/', File.separatorChar)).canonicalFile
        val basePath = base.path.trimEnd(File.separatorChar)
        if (target != base && !target.path.startsWith(basePath + File.separator)) {
            throw SecurityException("Le chemin sort du coffre.")
        }
        return target
    }

    private fun localFileFromUri(root: Root.Local, uri: Uri): File {
        val rawPath = uri.path ?: throw IOException("Chemin local invalide.")
        val base = root.directory.canonicalFile
        val target = File(rawPath).canonicalFile
        val basePath = base.path.trimEnd(File.separatorChar)
        if (!target.path.startsWith(basePath + File.separator)) {
            throw SecurityException("Le chemin sort du coffre.")
        }
        return target
    }

    private fun File.isSymbolicLink(): Boolean = try {
        val mode = Os.lstat(absolutePath).st_mode
        mode and OsConstants.S_IFMT == OsConstants.S_IFLNK
    } catch (_: Exception) {
        false
    }

    private fun uniquePath(folder: String, requestedName: String): String {
        val cleanName = VaultPath.clean(requestedName)
        val extensionIndex = cleanName.lastIndexOf('.')
        val stem = if (extensionIndex > 0) cleanName.substring(0, extensionIndex) else cleanName
        val extension = if (extensionIndex > 0) cleanName.substring(extensionIndex) else ""
        var suffix = 0
        while (true) {
            val candidateName = if (suffix == 0) cleanName else "$stem ($suffix)$extension"
            val candidate = if (folder.isEmpty()) candidateName else "$folder/$candidateName"
            if (findEntry(candidate) == null) return candidate
            suffix++
        }
    }

    private fun mimeTypeFor(path: String): String = when (VaultPath.extension(path)) {
        "md", "markdown" -> "text/markdown"
        "canvas" -> "application/json"
        "txt" -> "text/plain"
        "png" -> "image/png"
        "jpg", "jpeg" -> "image/jpeg"
        "gif" -> "image/gif"
        "webp" -> "image/webp"
        "svg" -> "image/svg+xml"
        "pdf" -> "application/pdf"
        else -> "application/octet-stream"
    }

    private fun moveLocal(root: Root.Local, sourcePath: String, targetPath: String, allowHidden: Boolean = false) {
        val source = localFile(root, sourcePath, allowHidden = allowHidden || sourcePath.startsWith('.'))
        val target = localFile(root, targetPath, allowHidden = allowHidden || targetPath.startsWith('.'))
        if (!source.exists()) throw FileNotFoundException("« $sourcePath » est introuvable.")
        if (target.exists()) throw IOException("Un fichier ou dossier porte déjà le nom « $targetPath ».")
        if (target.parentFile?.isDirectory != true) throw FileNotFoundException("Le dossier de destination n’existe pas.")
        if (Build.VERSION.SDK_INT >= 26) {
            try {
                java.nio.file.Files.move(source.toPath(), target.toPath(), java.nio.file.StandardCopyOption.ATOMIC_MOVE)
            } catch (_: Exception) {
                try { java.nio.file.Files.move(source.toPath(), target.toPath()) }
                catch (moveError: Exception) { throw IOException("Impossible de déplacer « $sourcePath » vers « $targetPath ».", moveError) }
            }
        } else if (!source.renameTo(target)) {
            throw IOException("Impossible de déplacer « $sourcePath » vers « $targetPath ».")
        }
    }

    private fun moveTree(root: Root.Tree, sourcePath: String, targetPath: String, allowHidden: Boolean = false) {
        val source = findTreeDocument(root, sourcePath, allowHidden)
            ?: throw FileNotFoundException("« $sourcePath » est introuvable.")
        val sourceParentPath = VaultPath.parent(sourcePath)
        val targetParentPath = VaultPath.parent(targetPath)
        val sourceParent = if (sourceParentPath.isEmpty()) rootDocumentUri(root.uri) else {
            findTreeDocument(root, sourceParentPath, allowHidden)?.uri ?: throw FileNotFoundException("Le dossier source est introuvable.")
        }
        val targetParent = if (targetParentPath.isEmpty()) rootDocumentUri(root.uri) else {
            findTreeDocument(root, targetParentPath, allowHidden)?.uri ?: throw FileNotFoundException("Le dossier de destination n’existe pas.")
        }
        val targetName = VaultPath.leaf(targetPath)
        if (sourceParent == targetParent) {
            try {
                val renamed = DocumentsContract.renameDocument(resolver, source.uri, targetName)
                if (renamed != null) return
            } catch (_: Exception) { /* Providers may not implement rename; copy safely below. */ }
        } else {
            val moved = try {
                DocumentsContract.moveDocument(resolver, source.uri, sourceParent, targetParent)
            } catch (_: Exception) {
                null
            }
            if (moved != null) {
                if (VaultPath.leaf(sourcePath) == targetName) return
                val renamed = try { DocumentsContract.renameDocument(resolver, moved, targetName) }
                catch (_: Exception) { null }
                if (renamed != null) return

                // A provider may support move but not rename. Restore the original location
                // before falling back to copy/delete so no second copy can silently appear.
                try {
                    val restored = DocumentsContract.moveDocument(resolver, moved, targetParent, sourceParent)
                    if (restored == null) throw IOException("Le fournisseur n’a pas restauré le déplacement.")
                } catch (error: Exception) {
                    throw IOException("Le document a été déplacé, mais son renommage a échoué et le retour arrière aussi.", error)
                }
            }
        }

        val copy = copyTreeDocument(root.uri, source.uri, targetParent, targetName)
        try {
            if (!DocumentsContract.deleteDocument(resolver, source.uri)) {
                throw IOException("Le fournisseur a copié le fichier, mais n’a pas pu retirer son ancien emplacement.")
            }
        } catch (error: Exception) {
            runCatching { DocumentsContract.deleteDocument(resolver, copy) }
            throw if (error is IOException) error else IOException("Impossible de retirer l’ancien fichier après copie.", error)
        }
    }

    private fun copyTreeDocument(treeUri: Uri, source: Uri, targetParent: Uri, targetName: String): Uri {
        val info = queryDocument(source) ?: throw FileNotFoundException("Le document à copier est introuvable.")
        val created = DocumentsContract.createDocument(resolver, targetParent, info.mimeType, targetName)
            ?: throw IOException("Le fournisseur Android n’a pas créé « $targetName ».")
        try {
            if (info.isDirectory) {
                for (child in queryChildren(treeUri, source)) {
                    copyTreeDocument(treeUri, child.uri, created, child.name)
                }
            } else {
                resolver.openInputStream(source)?.use { input ->
                    resolver.openOutputStream(created, "wt")?.use { output -> input.copyTo(output) }
                        ?: throw IOException("Le fournisseur ne peut pas écrire la copie de « ${info.name} ».")
                } ?: throw IOException("Le fournisseur ne peut pas lire « ${info.name} ».")
            }
        } catch (error: Exception) {
            runCatching { DocumentsContract.deleteDocument(resolver, created) }
            throw if (error is IOException) error else IOException("Impossible de copier « ${info.name} ».", error)
        }
        return created
    }

    private fun deleteEntry(info: DocumentInfo) {
        when (val current = root) {
            is Root.Local -> {
                val file = info.uri.path?.let { File(it) } ?: throw IOException("Chemin local invalide.")
                if (file.isDirectory) file.deleteRecursively() else file.delete()
            }
            is Root.Tree -> DocumentsContract.deleteDocument(resolver, info.uri)
        }
    }

    private fun planReferenceUpdates(mapping: Map<String, String>, allPaths: List<String>): List<RewritePlan> {
        if (mapping.isEmpty()) return emptyList()
        val currentEntries = listEntries().filter { !it.isDirectory && (it.path.endsWith(".md", true) || it.path.endsWith(".canvas", true)) }
        val plans = mutableListOf<RewritePlan>()
        val markdownLink = Regex("(!?)\\[\\[([^\\[\\]\\n]+?)]]")
        for (entry in currentEntries) {
            val snapshot = readDocument(entry.path)
            val oldSource = mapping.entries.firstOrNull { it.value == entry.path }?.key ?: entry.path
            val newSource = mapping[oldSource] ?: entry.path
            val rewritten = if (entry.path.endsWith(".canvas", true)) {
                rewriteCanvasReferences(snapshot.content, oldSource, mapping, allPaths)
            } else {
                rewriteMarkdownReferences(snapshot.content, oldSource, newSource, mapping, allPaths, markdownLink)
            }
            if (rewritten != snapshot.content) plans += RewritePlan(entry.path, newSource, snapshot, rewritten)
        }
        return plans
    }

    private fun rewriteCanvasReferences(content: String, source: String, mapping: Map<String, String>, allPaths: List<String>): String {
        val document = try { JSONObject(content) } catch (_: Exception) { return content }
        fun visit(value: Any?) {
            when (value) {
                is JSONObject -> {
                    val keys = value.keys().asSequence().toList()
                    for (key in keys) {
                        val child = value.opt(key)
                        if (key == "file" && child is String) {
                            val resolved = resolveReference(child, source, allPaths)
                            val renamed = resolved?.let { old -> mapping[old] ?: mapping.entries.firstOrNull { it.key.equals(old, true) }?.value }
                            if (renamed != null) value.put(key, renamed)
                        } else visit(child)
                    }
                }
                is JSONArray -> for (index in 0 until value.length()) visit(value.opt(index))
            }
        }
        visit(document)
        return document.toString(2) + "\n"
    }

    private fun rewriteMarkdownReferences(
        content: String,
        sourceBefore: String,
        sourceAfter: String,
        mapping: Map<String, String>,
        allPaths: List<String>,
        wikiPattern: Regex,
    ): String {
        data class Edit(val start: Int, val end: Int, val replacement: String)
        val visible = VaultTextLogic.maskCode(content)
        val edits = mutableListOf<Edit>()

        for (match in wikiPattern.findAll(visible)) {
            val inner = match.groupValues[2]
            val body = inner.substringBefore('|')
            val heading = body.substringAfter('#', "").let { if (it.isEmpty()) "" else "#$it" }
            val rawTarget = body.substringBefore('#').trim()
            if (isExternalReference(rawTarget)) continue
            val resolved = resolveReference(Uri.decode(rawTarget), sourceBefore, allPaths) ?: continue
            val renamed = mapping.entries.firstOrNull { it.key.equals(resolved, true) }?.value ?: continue
            val oldHadExtension = rawTarget.substringBefore('#').substringAfterLast('/').contains('.')
            val linkTarget = if (!oldHadExtension && renamed.endsWith(".md", true)) renamed.dropLast(3) else renamed
            val alias = inner.substringAfter('|', "").let { if (it.isEmpty()) "" else "|$it" }
            edits += Edit(match.range.first, match.range.last + 1, "${match.groupValues[1]}[[${linkTarget}$heading$alias]]")
        }

        val markdownLink = Regex("(!?)\\[([^]\\n]*)]\\((<[^>\\n]+>|[^)\\s]+)([^)\\n]*)\\)")
        for (match in markdownLink.findAll(visible)) {
            val originalDestination = match.groupValues[3]
            val wrapped = originalDestination.startsWith('<') && originalDestination.endsWith('>')
            val destination = if (wrapped) originalDestination.substring(1, originalDestination.length - 1) else originalDestination
            if (isExternalReference(destination)) continue
            val suffixIndex = listOf(destination.indexOf('?'), destination.indexOf('#')).filter { it >= 0 }.minOrNull() ?: destination.length
            val target = destination.substring(0, suffixIndex)
            val suffix = destination.substring(suffixIndex)
            if (target.isBlank()) continue
            val resolved = resolveReference(Uri.decode(target), sourceBefore, allPaths) ?: continue
            val renamed = mapping.entries.firstOrNull { it.key.equals(resolved, true) }?.value ?: continue
            val relativeTarget = Uri.encode(relativePath(VaultPath.parent(sourceAfter), renamed), "/")
            val rewrittenDestination = if (wrapped) "<$relativeTarget$suffix>" else "$relativeTarget$suffix"
            val replacement = "${match.groupValues[1]}[${match.groupValues[2]}]($rewrittenDestination${match.groupValues[4]})"
            edits += Edit(match.range.first, match.range.last + 1, replacement)
        }

        if (edits.isEmpty()) return content
        val result = StringBuilder(content)
        for (edit in edits.sortedByDescending { it.start }) {
            result.replace(edit.start, edit.end, edit.replacement)
        }
        return result.toString()
    }

    private fun isExternalReference(reference: String): Boolean =
        reference.startsWith("//") || Regex("^[a-z][a-z0-9+.-]*:", RegexOption.IGNORE_CASE).containsMatchIn(reference)

    private fun relativePath(fromDirectory: String, toPath: String): String {
        val from = fromDirectory.split('/').filter { it.isNotEmpty() }
        val to = toPath.split('/').filter { it.isNotEmpty() }
        var common = 0
        while (common < from.size && common < to.size && from[common].equals(to[common], true)) common++
        val relative = (List(from.size - common) { ".." } + to.drop(common)).joinToString("/")
        return relative.ifEmpty { VaultPath.leaf(toPath) }
    }

    private fun resolveReference(reference: String, sourcePath: String, paths: List<String>): String? {
        val raw = reference.trim().replace('\\', '/')
        if (raw.isEmpty()) return null
        val candidatesByLower = paths.associateBy { it.lowercase(Locale.ROOT) }
        fun normalizeRelative(input: String): String? {
            val stack = mutableListOf<String>()
            for (part in input.split('/')) {
                when (part) {
                    "", "." -> Unit
                    ".." -> if (stack.isEmpty()) return null else stack.removeAt(stack.lastIndex)
                    else -> stack += part
                }
            }
            return stack.joinToString("/")
        }
        val sourceParent = VaultPath.parent(sourcePath)
        val potential = linkedSetOf<String>()
        val supplied = raw.removePrefix("/")
        val relative = normalizeRelative(if (raw.startsWith('/')) supplied else "$sourceParent/$supplied")
        if (relative != null) potential += relative
        normalizeRelative(supplied)?.let { potential += it }
        for (candidate in potential) {
            candidatesByLower[candidate.lowercase(Locale.ROOT)]?.let { return it }
            if (!candidate.contains('.')) candidatesByLower["${candidate}.md".lowercase(Locale.ROOT)]?.let { return it }
        }
        val last = supplied.substringAfterLast('/').substringBeforeLast('.', supplied.substringAfterLast('/'))
        val matches = paths.filter { VaultPath.stem(it).equals(last, true) }
        return matches.singleOrNull()
    }

    private fun revision(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
        .digest(bytes)
        .joinToString("") { byte -> "%02x".format(Locale.ROOT, byte) }

    private fun ensureInternalRoot() {
        if (!localDirectory.exists() && !localDirectory.mkdirs()) throw IOException("Impossible de créer le coffre privé.")
    }

    companion object {
        private const val PREFERENCES = "opale_vault"
        private const val KEY_ACTIVE_ROOT = "active_root"
        private const val KEY_TREE_URI = "tree_uri"
        private const val KEY_TREE_NAME = "tree_name"
        private const val ROOT_LOCAL = "local"
        private const val ROOT_TREE = "tree"
        private const val LOCAL_VAULT_DIRECTORY = "opale-vault"
        private const val DEFAULT_ATTACHMENT_FOLDER = "Pièces jointes"
    }
}
