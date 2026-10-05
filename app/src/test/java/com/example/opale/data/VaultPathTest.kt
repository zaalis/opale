package com.example.opale.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class VaultPathTest {
    @Test
    fun cleansRelativePathsAndKeepsUnicodeNames() {
        assertEquals("Notes/Été.md", VaultPath.clean("Notes\\Été.md"))
        assertEquals("Pièces jointes", VaultPath.safeAttachmentName("C:\\tmp\\Pièces jointes"))
        assertEquals("_con.txt", VaultPath.safeAttachmentName("con.txt"))
    }

    @Test
    fun rejectsTraversalAbsoluteHiddenAndReservedPaths() {
        listOf("../secret.md", "a/../../secret.md", "/private.md", "C:\\private.md", ".trash/item.md", "CON.txt").forEach { path ->
            assertThrows(IllegalArgumentException::class.java) { VaultPath.clean(path) }
        }
    }
}
