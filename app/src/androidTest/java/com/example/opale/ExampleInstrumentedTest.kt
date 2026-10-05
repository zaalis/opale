package com.example.opale

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.assertEquals
import androidx.test.platform.app.InstrumentationRegistry

class NativeAppTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    @Test fun createsEditsAndRestoresNativeMarkdown() {
        assertEquals("fr.zaalis.opale", InstrumentationRegistry.getInstrumentation().targetContext.packageName)
        val title = "Android validation " + System.currentTimeMillis()
        compose.waitUntil(15000) { compose.onAllNodesWithText("Actions").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Actions").performClick()
        compose.onNodeWithText("Nouvelle note").performClick()
        compose.onNode(hasSetTextAction()).performTextInput(title)
        compose.onNodeWithText("Valider").performClick()
        compose.waitUntil(15000) { compose.onAllNodesWithText("Source").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Source").performClick()
        compose.onAllNodes(hasSetTextAction()).onFirst().performTextReplacement("# " + title + "\n\nTexte tactile sauvegardé.\n[[Accueil]]\n#android")
        compose.waitUntil(15000) { compose.onAllNodesWithText("Enregistré").fetchSemanticsNodes().isNotEmpty() }
        compose.activityRule.scenario.recreate()
        compose.waitUntil(15000) { compose.onAllNodesWithText("Texte tactile sauvegardé.", substring=true).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Retour").performClick()
        compose.waitUntil(15000) { compose.onAllNodesWithText("Recherche").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Recherche").performClick()
        compose.onNode(hasSetTextAction()).performTextInput("tag:android")
        compose.waitUntil(15000) { compose.onAllNodesWithText(title + ".md").fetchSemanticsNodes().isNotEmpty() }
    }
}
