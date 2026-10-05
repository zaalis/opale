package com.example.opale.data

import android.content.Context
import android.content.ContextWrapper
import android.content.SharedPreferences
import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.After
import org.junit.Test
import org.junit.runner.RunWith
import org.json.JSONObject
import java.io.File
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class VaultRepositoryInstrumentedTest {
    private val testId: String by lazy { UUID.randomUUID().toString() }
    private val context: Context by lazy {
        val base = InstrumentationRegistry.getInstrumentation().targetContext
        val isolatedFiles = File(base.cacheDir, "vault-repository-test-$testId").apply { mkdirs() }
        object : ContextWrapper(base) {
            override fun getApplicationContext(): Context = this
            override fun getFilesDir(): File = isolatedFiles
            override fun getSharedPreferences(name: String, mode: Int): SharedPreferences =
                base.getSharedPreferences("vault-repository-test-$testId-$name", mode)
        }
    }

    private fun localRepository(): VaultRepository = VaultRepository(context).apply { useLocalVault() }

    @After
    fun cleanIsolatedStore() {
        context.getSharedPreferences("opale_vault", Context.MODE_PRIVATE).edit().clear().commit()
        runCatching { File(context.filesDir.path).deleteRecursively() }
    }

    @Test
    fun localDocumentRoundTripAndRevisionConflictPreserveLatestContent() {
        val repository = localRepository()
        val path = repository.createNote("android-roundtrip-${UUID.randomUUID()}")
        val first = repository.writeDocument(path, "Première version\n")

        val latest = repository.writeDocument(path, "Version récente ✓\n", first.revision)
        val conflict = assertThrows(VaultConflictException::class.java) {
            repository.writeDocument(path, "Écriture périmée\n", first.revision)
        }

        assertEquals(path, conflict.path)
        assertEquals("Version récente ✓\n", repository.readDocument(path).content)
        assertEquals(latest.revision, repository.readDocument(path).revision)
    }

    @Test
    fun renameUpdatesWikiMarkdownAttachmentAndCanvasReferences() {
        val repository = localRepository()
        val suffix = UUID.randomUUID().toString().take(8)
        val index = repository.createNote("index-$suffix")
        val target = repository.createNote("target-$suffix")
        val attachment = "Pièces jointes/image-$suffix.png"
        val movedAttachment = "Pièces jointes/image-renamed-$suffix.png"
        repository.createFolder("Pièces jointes")
        repository.writeDocument(attachment, "fake-png-$suffix")
        repository.writeDocument(index, "[[target-$suffix]]\n![image](Pi%C3%A8ces%20jointes/image-$suffix.png)\n")
        val board = repository.createNote("board-$suffix", board = true)
        repository.writeDocument(
            board,
            """{"nodes":[{"id":"n1","file":"$attachment"}],"edges":[],"opale":{"version":1}}""",
        )

        val renamedTarget = "renamed-target-$suffix.md"
        repository.rename(target, renamedTarget)
        assertTrue(repository.readDocument(index).content.contains("[[renamed-target-$suffix]]"))

        repository.rename(attachment, movedAttachment)
        val rewrittenIndex = repository.readDocument(index).content
        assertTrue(rewrittenIndex.contains("image-renamed-$suffix.png"))
        assertFalse(rewrittenIndex.contains("image-$suffix.png)"))
        val rewrittenBoard = repository.readDocument(board).content
        val boardFile = JSONObject(rewrittenBoard)
            .getJSONArray("nodes")
            .getJSONObject(0)
            .getString("file")
        assertEquals(movedAttachment, boardFile)
    }

    @Test
    fun trashHidesEntryAndRestartKeepsTheSelectedLocalVault() {
        val repository = localRepository()
        val path = repository.createNote("restart-${UUID.randomUUID()}")
        repository.writeDocument(path, "persisted")
        val identity = repository.identity
        val restarted = VaultRepository(context)

        assertEquals(identity, restarted.identity)
        assertEquals("persisted", restarted.readDocument(path).content)

        restarted.trash(path)
        assertFalse(restarted.listEntries().any { it.path == path })
        val retained = File(context.filesDir, "opale-vault/.trash")
            .walkTopDown()
            .firstOrNull { it.isFile && it.name == path.substringAfterLast('/') }
        assertEquals("persisted", retained?.readText())
        assertEquals(identity, VaultRepository(context).identity)
    }

    @Test
    fun importsBytesFromAReadableUriIntoTheAttachmentFolder() {
        val repository = localRepository()
        val sourceBytes = byteArrayOf(0, 1, 2, 3, 10, 13, -1)
        val source = File(context.cacheDir, "selected-${UUID.randomUUID()}.bin")
        source.writeBytes(sourceBytes)
        try {
            val importedPath = repository.importAttachment(Uri.fromFile(source))

            assertTrue(importedPath.startsWith("Pièces jointes/"))
            assertArrayEquals(sourceBytes, repository.readBytes(importedPath))
        } finally {
            source.delete()
        }
    }
}
