package com.example.opale.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VaultTextLogicTest {
    @Test
    fun extractsUniqueWikiTargetsAndSkipsCodeAndComments() {
        val markdown = """
            [[Projet/Note#Vue|la note]] ![[Pièces jointes/photo.png]]
            `[[code/ignore]]`
            ```md
            [[bloc/ignore]]
            ```
            %% [[commentaire/ignore]] %%
            [[Projet/Note|doublon]]
        """.trimIndent()

        assertEquals(
            listOf("Projet/Note", "Pièces jointes/photo.png"),
            VaultTextLogic.extractWikiLinks(markdown),
        )
    }

    @Test
    fun extractsFrontmatterAndVisibleTags() {
        val markdown = """
            ---
            tags: [projet, "à-faire"]
            ---
            Texte #mobile et #équipe/design.
            `#code`
            ```
            #dans-code
            ```
        """.trimIndent()

        assertEquals(setOf("projet", "à-faire", "mobile", "équipe/design"), VaultTextLogic.extractTags(markdown))
    }

    @Test
    fun searchSupportsAccentInsensitiveFieldsPhrasesNegationAndOr() {
        val path = "Cours/Électricité.md"
        val content = "Une note sur le réseau électrique domestique."

        assertTrue(VaultTextLogic.matchesSearchQuery("electricite", path, content))
        assertTrue(VaultTextLogic.matchesSearchQuery("path:cours content:\"réseau électrique\"", path, content))
        assertFalse(VaultTextLogic.matchesSearchQuery("content:réseau -content:domestique", path, content))
        assertTrue(VaultTextLogic.matchesSearchQuery("file:absent OR content:domestique", path, content))
        assertTrue(VaultTextLogic.matchesSearchQuery("tag:équipe", path, content, setOf("équipe/design")))
    }

    @Test
    fun searchRegexAndCodeMaskingWork() {
        val content = "visible value\n`hidden-token`\n```\nhidden-block\n```"

        assertTrue(VaultTextLogic.matchesSearchQuery("/vis.*value/", "note.md", content))
        assertFalse(VaultTextLogic.matchesSearchQuery("hidden-token", "note.md", content))
        assertFalse(VaultTextLogic.matchesSearchQuery("hidden-block", "note.md", content))
    }
}
