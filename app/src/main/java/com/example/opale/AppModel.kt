package com.example.opale

import android.app.Application
import android.net.Uri
import androidx.compose.runtime.*
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.opale.data.*
import com.example.opale.data.VaultTextLogic.matchesSearchQuery
import com.example.opale.notes.insertImage
import com.example.opale.board.addImageToBoard
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.text.SimpleDateFormat
import java.util.*

data class OpenDocument(val path: String, val content: String, val revision: String, val dirty: Boolean = false)
data class SearchHit(val path: String, val excerpt: String)

class AppModel(application: Application) : AndroidViewModel(application) {
    val repository = VaultRepository(application)
    private var vaultIdentity = repository.identity
    private val prefs = application.getSharedPreferences("opale-ui", 0)
    private val gate = Mutex()
    private var saveJob: Job? = null
    private var searchJob: Job? = null
    var entries by mutableStateOf<List<VaultEntry>>(emptyList()); private set
    var document by mutableStateOf<OpenDocument?>(null); private set
    var recent by mutableStateOf<List<String>>(emptyList()); private set
    var error by mutableStateOf<String?>(null)
    var conflict by mutableStateOf(false); private set
    var busy by mutableStateOf(false); private set
    var saving by mutableStateOf(false); private set
    var vaultName by mutableStateOf(repository.name); private set
    var results by mutableStateOf<List<SearchHit>>(emptyList()); private set
    var allTexts by mutableStateOf<Map<String, String>>(emptyMap()); private set
    var theme by mutableStateOf(prefs.getString("theme", "system") ?: "system")
    var fontScale by mutableFloatStateOf(prefs.getFloat("fontScale", 1f))
    var bookmarks by mutableStateOf(prefs.getStringSet("bookmarks:" + vaultIdentity, emptySet())!!.toSet())
        private set

    init {
        refresh()
        val restored = prefs.getString("last:" + vaultIdentity, null)
        if (!restored.isNullOrBlank()) open(restored)
    }
    private fun fail(e: Throwable) { error = e.message ?: "L’opération a échoué." }
    private suspend fun index() {
        val fresh = withContext(Dispatchers.IO) { repository.listEntries() }
        entries = fresh
        val texts = withContext(Dispatchers.IO) {
            fresh.filter { !it.isDirectory && it.path.endsWith(".md", true) }
                .associate { it.path to runCatching { repository.readDocument(it.path).content }.getOrDefault("") }
        }
        allTexts = texts
    }
    fun refresh() { viewModelScope.launch { gate.withLock { try { index() } catch(e: Exception) { fail(e) } } } }
    fun open(path: String) {
        saveJob?.cancel()
        viewModelScope.launch {
            gate.withLock {
                busy = true
                try {
                    saveLocked()
                    if (conflict) return@withLock
                    val file = withContext(Dispatchers.IO) { repository.readDocument(path) }
                    val draftKey = "draft:" + vaultIdentity + ":" + path
                    val draft = prefs.getString(draftKey, null)
                    val base = prefs.getString(draftKey + ":revision", null)
                    document = OpenDocument(path, draft ?: file.content, file.revision, draft != null && draft != file.content)
                    conflict = draft != null && base != file.revision && draft != file.content
                    recent = (recent + path).distinct().takeLast(8)
                    prefs.edit().putString("last:" + vaultIdentity, path).apply()
                    if (document?.dirty == true && !conflict) scheduleSave()
                } catch(e: Exception) { fail(e) } finally { busy = false }
            }
        }
    }
    fun followLink(raw: String) {
        val clean = raw.substringBefore('|').substringBefore('#').trim()
        if (clean.isEmpty()) return
        val from = document?.path?.substringBeforeLast('/', "") ?: ""
        val candidates = listOf(clean, clean + ".md", if(from.isEmpty()) clean else from + "/" + clean,
            if(from.isEmpty()) clean + ".md" else from + "/" + clean + ".md")
        val entry = entries.firstOrNull { !it.isDirectory && it.path in candidates }
            ?: entries.firstOrNull { it.name.substringBeforeLast('.').equals(clean.substringAfterLast('/'), true) }
        if (entry != null) open(entry.path) else create(clean, false)
    }
    fun change(content: String) {
        val before = document ?: return
        if (before.content == content) return
        document = before.copy(content = content, dirty = true)
        val key = "draft:" + vaultIdentity + ":" + before.path
        prefs.edit().putString(key, content).putString(key + ":revision", before.revision).apply()
        if (!conflict) scheduleSave()
    }
    private fun scheduleSave() {
        saveJob?.cancel()
        saveJob = viewModelScope.launch { delay(650); gate.withLock { withContext(NonCancellable) { saveLocked() } } }
    }
    private suspend fun saveLocked(force: Boolean = false) {
        val draft = document ?: return
        if (!draft.dirty || (conflict && !force)) return
        saving = true
        try {
            val saved = withContext(Dispatchers.IO) {
                repository.writeDocument(draft.path, draft.content, if(force) null else draft.revision)
            }
            if (document?.path == draft.path) {
                val latest = document!!
                document = latest.copy(revision = saved.revision, dirty = latest.content != draft.content)
                conflict = false
                val key = "draft:" + vaultIdentity + ":" + draft.path
                if (!document!!.dirty) prefs.edit().remove(key).remove(key + ":revision").apply()
                else prefs.edit().putString(key + ":revision", saved.revision).apply()
                if (draft.path.endsWith(".md", true)) allTexts = allTexts + (draft.path to draft.content)
            }
        } catch(e: Exception) {
            conflict = true
            fail(e)
        } finally { saving = false }
    }
    fun saveNow(force: Boolean = false) {
        saveJob?.cancel()
        viewModelScope.launch { gate.withLock { withContext(NonCancellable) { saveLocked(force) } } }
    }
    fun reload() {
        val path = document?.path ?: return
        saveJob?.cancel()
        viewModelScope.launch { gate.withLock {
            try {
                val file = withContext(Dispatchers.IO) { repository.readDocument(path) }
                document = OpenDocument(path, file.content, file.revision)
                conflict = false
                val key = "draft:" + vaultIdentity + ":" + path
                prefs.edit().remove(key).remove(key + ":revision").apply()
            } catch(e: Exception) { fail(e) }
        } }
    }
    fun close() {
        saveJob?.cancel()
        viewModelScope.launch { gate.withLock {
            saveLocked()
            if(!conflict) { document = null; prefs.edit().remove("last:" + vaultIdentity).apply() }
        } }
    }
    fun switchVault(uri: Uri?) {
        saveJob?.cancel()
        viewModelScope.launch { gate.withLock {
            busy = true
            try {
                saveLocked()
                if(conflict) return@withLock
                withContext(Dispatchers.IO) { if(uri == null) repository.useLocalVault() else repository.openVault(uri) }
                document = null; recent = emptyList(); conflict = false
                vaultIdentity = repository.identity
                vaultName = repository.name
                bookmarks = prefs.getStringSet("bookmarks:" + vaultIdentity, emptySet())!!.toSet()
                index()
            } catch(e: Exception) { fail(e) } finally { busy = false }
        } }
    }
    fun create(name: String, board: Boolean, folder: String = "") {
        viewModelScope.launch {
            var created: String? = null
            gate.withLock {
                try {
                    saveLocked()
                    if(conflict) return@withLock
                    created = withContext(Dispatchers.IO) { repository.createNote(name, folder, board) }
                    index()
                } catch(e: Exception) { fail(e) }
            }
            created?.let { open(it) }
        }
    }
    fun folder(path: String) { viewModelScope.launch { gate.withLock {
        try { withContext(Dispatchers.IO) { repository.createFolder(path) }; index() } catch(e: Exception) { fail(e) }
    } } }
    fun daily() {
        val name = SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(Date())
        val path = "Quotidien/$name.md"
        if(entries.any { it.path == path }) open(path) else create(name, false, "Quotidien")
    }
    fun rename(newPath: String) {
        val old = document?.path ?: return
        viewModelScope.launch {
            var renamed = false
            gate.withLock {
                try {
                    saveLocked()
                    if(conflict) return@withLock
                    withContext(Dispatchers.IO) { repository.rename(old, newPath) }
                    document = null
                    recent = recent.map { if(it == old) newPath else it }
                    if(old in bookmarks) { bookmarks = bookmarks - old + newPath; prefs.edit().putStringSet("bookmarks:" + vaultIdentity,bookmarks).apply() }
                    index(); renamed = true
                } catch(e: Exception) { fail(e) }
            }
            if(renamed) open(newPath)
        }
    }
    fun trash() {
        val path = document?.path ?: return
        viewModelScope.launch { gate.withLock {
            try {
                saveLocked()
                if(conflict) return@withLock
                withContext(Dispatchers.IO) { repository.trash(path) }
                document = null; recent = recent - path
                val key = "draft:" + vaultIdentity + ":" + path
                prefs.edit().remove(key).remove(key + ":revision").remove("last:" + vaultIdentity).apply()
                index()
            } catch(e: Exception) { fail(e) }
        } }
    }
    fun importImage(uri: Uri) {
        val target = document?.path ?: return
        viewModelScope.launch {
            try {
                val file = withContext(Dispatchers.IO) { repository.importAttachment(uri) }
                if(document?.path != target) { error = "Image importée dans le coffre : " + file; refresh(); return@launch }
                val doc = document!!
                change(if(target.endsWith(".canvas",true)) addImageToBoard(doc.content,file) else insertImage(doc.content,file))
                refresh()
            } catch(e: Exception) { fail(e) }
        }
    }
    fun importDocument(uri: Uri, name: String) {
        viewModelScope.launch {
            var target: String? = null
            gate.withLock {
                try {
                    saveLocked()
                    if(conflict) return@withLock
                    target = withContext(Dispatchers.IO) {
                        val content = getApplication<Application>().contentResolver.openInputStream(uri)!!.bufferedReader().use { it.readText() }
                        val path = repository.createNote(name.substringBeforeLast('.'), board = name.endsWith(".canvas", true))
                        repository.writeDocument(path,content)
                        path
                    }
                    index()
                } catch(e: Exception) { fail(e) }
            }
            target?.let { open(it) }
        }
    }
    fun duplicate() {
        val doc = document ?: return
        viewModelScope.launch {
            var target: String? = null
            gate.withLock {
                try {
                    target = withContext(Dispatchers.IO) {
                        val path = repository.createNote(doc.path.substringAfterLast('/').substringBeforeLast('.') + " copie",
                            doc.path.substringBeforeLast('/', ""), doc.path.endsWith(".canvas",true))
                        repository.writeDocument(path,doc.content); path
                    }
                    index()
                } catch(e: Exception) { fail(e) }
            }
            target?.let { open(it) }
        }
    }
    fun search(query: String) {
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            delay(150)
            val texts = allTexts
            val hits = withContext(Dispatchers.Default) { texts.entries.filter { matchesSearchQuery(query,it.key,it.value) }
                .take(100).map { SearchHit(it.key,it.value.lineSequence().firstOrNull { line -> line.contains(query,true) }?.take(180)
                    ?: it.value.replace('\n',' ').take(180)) } }
            results = hits
        }
    }
    fun toggleBookmark(path: String) {
        bookmarks = if(path in bookmarks) bookmarks - path else bookmarks + path
        prefs.edit().putStringSet("bookmarks:" + vaultIdentity, bookmarks).apply()
    }
    fun preferences() { prefs.edit().putString("theme",theme).putFloat("fontScale",fontScale).apply() }
}
