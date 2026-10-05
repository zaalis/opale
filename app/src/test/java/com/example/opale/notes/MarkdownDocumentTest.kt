package com.example.opale.notes

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MarkdownDocumentTest {
    @Test
    fun parsesImageOptionsWithoutBreakingEscapedTargetPipe() {
        val content = "Intro\n\n![[assets\\|wide.png|Cover|left|320]]\n"
        val image = noteImages(parseNoteBlocks(content)).single()

        assertEquals("assets\\|wide.png", image.target)
        assertEquals("Cover", image.options.alt)
        assertEquals(ImageAlignment.LEFT, image.options.alignment)
        assertEquals(320, image.options.width)
    }

    @Test
    fun imageOptionEditsKeepTargetAndMarkdownSurroundings() {
        val content = "Intro\n\n![[assets\\|wide.png|Cover|left|320]]\n\nTail\n"
        val image = noteImages(parseNoteBlocks(content)).single()
        val updated = replaceImage(content, image) {
            it.copy(alignment = ImageAlignment.RIGHT, width = 480)
        }

        assertEquals("Intro\n\n![[assets\\|wide.png|Cover|right|480]]\n\nTail\n", updated)
    }

    @Test
    fun parsesAndRewritesStandardMarkdownImageSyntax() {
        val content = "![Cover|center|240](assets/photo.png \"Title\")"
        val image = noteImages(parseNoteBlocks(content)).single()

        assertEquals("assets/photo.png", image.target)
        assertEquals(240, image.options.width)
        val updated = replaceImage(content, image) {
            it.copy(alignment = ImageAlignment.LEFT, width = 360)
        }
        assertEquals("![Cover|left|360](assets/photo.png \"Title\")", updated)
    }

    @Test
    fun movingImageBetweenSlotsPreservesOtherMarkdownAndImageSyntax() {
        val content = "First\n\n![[photo.png|left|320]]\n\nLast\n"
        val image = noteImages(parseNoteBlocks(content)).single()

        val movedBeforeFirstBlock = moveImage(content, image, 0)
        val afterMovingToEnd = noteImages(parseNoteBlocks(movedBeforeFirstBlock)).single()
        val movedToEnd = moveImage(movedBeforeFirstBlock, afterMovingToEnd, movedBeforeFirstBlock.length)

        assertTrue(movedBeforeFirstBlock.startsWith("![[photo.png|left|320]]\n\nFirst"))
        assertTrue(movedToEnd.endsWith("Last\n\n![[photo.png|left|320]]\n"))
        assertEquals(1, noteImages(parseNoteBlocks(movedToEnd)).size)
        assertTrue(movedToEnd.contains("First\n\nLast"))
    }

    @Test
    fun insertsNewImageAsMarkdownParagraph() {
        assertEquals("Title\n\n![[Images/photo.png]]\n", insertImage("Title\n", "Images\\photo.png"))
        assertEquals("![[photo.png]]\n", insertImage("", "photo.png"))
        assertEquals("Title", insertImage("Title", "  "))
    }

    @Test
    fun editsTaskMarkerWithoutNormalizingItsText() {
        val content = "- [ ] keep  spacing\n\nParagraph\n"
        val task = parseNoteBlocks(content).firstOrNull { it.kind == BlockKind.TASK }
        assertNotNull(task)

        assertEquals("- [x] keep  spacing\n\nParagraph\n", editTask(content, task!!))
    }
}
