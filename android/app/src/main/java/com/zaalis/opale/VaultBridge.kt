package com.zaalis.opale

import android.content.Context
import android.graphics.BitmapFactory
import android.graphics.pdf.PdfDocument
import android.util.Base64
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream

/**
 * The page's access to the vaults. Each vault is a plain folder of Markdown
 * notes, .board moodboards and images under
 * Android/data/com.zaalis.opale/files/Coffres, so it can be copied over USB.
 * Every path is resolved inside its vault; nothing outside can be reached.
 */
class VaultBridge(private val activity: MainActivity) {
    private val prefs = activity.getSharedPreferences("opale", Context.MODE_PRIVATE)

    private val root: File
        get() = File(activity.getExternalFilesDir(null) ?: activity.filesDir, "Coffres").apply { mkdirs() }

    private fun vaultDir(name: String): File {
        require(name.isNotBlank() && !name.startsWith(".") && name.none { it in "\\/:*?\"<>|" }) { "Nom de coffre invalide" }
        return File(root, name)
    }

    private fun resolve(vault: String, path: String): File {
        val base = vaultDir(vault).canonicalFile
        val file = File(base, path).canonicalFile
        require(file.path.startsWith(base.path + File.separator)) { "Chemin hors du coffre" }
        return file
    }

    @JavascriptInterface
    fun vaults(): String {
        val names = root.listFiles()?.filter { it.isDirectory && !it.name.startsWith(".") }?.map { it.name }?.sorted().orEmpty()
        return JSONArray(names).toString()
    }

    @JavascriptInterface
    fun createVault(name: String): Boolean = runCatching { vaultDir(name).let { it.isDirectory || it.mkdirs() } }.getOrDefault(false)

    @JavascriptInterface
    fun vaultPath(name: String): String = runCatching { vaultDir(name).absolutePath }.getOrDefault("")

    /** Every file of the vault: notes and moodboards with their text, other files by name only. */
    @JavascriptInterface
    fun load(vault: String): String {
        val files = JSONArray()
        val folders = JSONArray()
        runCatching {
            val base = vaultDir(vault).apply { mkdirs() }
            base.walkTopDown().onEnter { it == base || it.name != TRASH }.forEach { file ->
                if (file == base || (file.isFile && file.name.startsWith("."))) return@forEach
                val rel = file.relativeTo(base).invariantSeparatorsPath
                if (file.isDirectory) {
                    folders.put(rel)
                } else {
                    val type = typeOf(file.name)
                    val entry = JSONObject().put("p", rel).put("t", type)
                    if (type == "note" || type == "board") entry.put("x", file.readText())
                    files.put(entry)
                }
            }
        }
        return JSONObject().put("files", files).put("folders", folders).toString()
    }

    @JavascriptInterface
    fun write(vault: String, path: String, text: String): Boolean = runCatching {
        val file = resolve(vault, path)
        file.parentFile?.mkdirs()
        val temp = File(file.parentFile, ".${file.name}.tmp")
        temp.writeText(text)
        if (!temp.renameTo(file)) {
            file.writeText(text)
            temp.delete()
        }
        true
    }.getOrDefault(false)

    @JavascriptInterface
    fun writeBase64(vault: String, path: String, data: String): Boolean = runCatching {
        val file = resolve(vault, path)
        file.parentFile?.mkdirs()
        file.writeBytes(Base64.decode(data, Base64.DEFAULT))
        true
    }.getOrDefault(false)

    /** Deleting moves the file to the vault's .trash folder, as on the desktop. */
    @JavascriptInterface
    fun remove(vault: String, path: String): Boolean = runCatching {
        val file = resolve(vault, path)
        val trash = File(vaultDir(vault), TRASH).apply { mkdirs() }
        var target = File(trash, file.name)
        var n = 1
        while (target.exists()) target = File(trash, "${file.nameWithoutExtension} ${n++}.${file.extension}")
        file.renameTo(target) || run {
            file.copyTo(target)
            file.delete()
        }
    }.getOrDefault(false)

    @JavascriptInterface
    fun move(vault: String, from: String, to: String): Boolean = runCatching {
        val source = resolve(vault, from)
        val target = resolve(vault, to)
        if (!source.exists() || target.exists()) return@runCatching false
        target.parentFile?.mkdirs()
        source.renameTo(target)
    }.getOrDefault(false)

    @JavascriptInterface
    fun mkdir(vault: String, path: String): Boolean = runCatching { resolve(vault, path).let { it.isDirectory || it.mkdirs() } }.getOrDefault(false)

    @JavascriptInterface
    fun dataUrl(vault: String, path: String): String = runCatching {
        val file = resolve(vault, path)
        val mime = when (file.extension.lowercase()) {
            "png" -> "image/png"
            "gif" -> "image/gif"
            "webp" -> "image/webp"
            "bmp" -> "image/bmp"
            "svg" -> "image/svg+xml"
            else -> "image/jpeg"
        }
        "data:$mime;base64," + Base64.encodeToString(file.readBytes(), Base64.NO_WRAP)
    }.getOrDefault("")

    /** Turns a JPEG rendering of a moodboard into a one-page PDF. */
    @JavascriptInterface
    fun savePdf(vault: String, path: String, jpegBase64: String): Boolean = runCatching {
        val bytes = Base64.decode(jpegBase64, Base64.DEFAULT)
        val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return@runCatching false
        val document = PdfDocument()
        try {
            val page = document.startPage(PdfDocument.PageInfo.Builder(bitmap.width, bitmap.height, 1).create())
            page.canvas.drawBitmap(bitmap, 0f, 0f, null)
            document.finishPage(page)
            val file = resolve(vault, path)
            file.parentFile?.mkdirs()
            FileOutputStream(file).use { document.writeTo(it) }
        } finally {
            document.close()
            bitmap.recycle()
        }
        true
    }.getOrDefault(false)

    @JavascriptInterface
    fun getState(): String = prefs.getString("state", "") ?: ""

    @JavascriptInterface
    fun setState(json: String) {
        prefs.edit().putString("state", json).apply()
    }

    @JavascriptInterface
    fun setDark(dark: Boolean) {
        activity.runOnUiThread { activity.applyTheme(dark) }
    }

    private fun typeOf(name: String): String = when (name.substringAfterLast('.', "").lowercase()) {
        "md" -> "note"
        "board" -> "board"
        "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg" -> "image"
        else -> "other"
    }

    private companion object {
        const val TRASH = ".trash"
    }
}
