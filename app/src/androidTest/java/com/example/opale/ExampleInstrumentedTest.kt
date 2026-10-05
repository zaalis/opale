package com.example.opale

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.geometry.center
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.assertEquals
import androidx.test.platform.app.InstrumentationRegistry

class NativeAppTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    @Test fun createsEditsAndRestoresNativeMarkdown() {
        assertEquals("fr.zaalis.opale", InstrumentationRegistry.getInstrumentation().targetContext.packageName)
        val title = "Android validation " + System.currentTimeMillis()
        val project = "Projet tactile " + System.currentTimeMillis()
        compose.waitUntil(15000) { compose.onAllNodesWithText("Actions").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithContentDescription("Créer dans le coffre").performClick()
        compose.onNodeWithText("Nouveau projet").performClick()
        compose.onNode(hasSetTextAction()).performTextInput(project)
        compose.onNodeWithText("Valider").performClick()
        compose.waitUntil(15000) { compose.onAllNodesWithContentDescription("Déposer dans $project").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithContentDescription("Créer dans le coffre").performClick()
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
        compose.waitUntil(15000) { compose.onAllNodesWithContentDescription("Maintenir puis glisser $title.md vers un projet").fetchSemanticsNodes().isNotEmpty() }
        val source = compose.onNodeWithContentDescription("Maintenir puis glisser $title.md vers un projet")
        val sourceBounds = source.fetchSemanticsNode().boundsInRoot
        val destinationBounds = compose.onNodeWithContentDescription("Déposer dans $project").fetchSemanticsNode().boundsInRoot
        source.performTouchInput {
            down(center)
            advanceEventTime(700)
            moveTo(destinationBounds.center - sourceBounds.topLeft)
            up()
        }
        compose.waitUntil(15000) {
            compose.onNodeWithContentDescription("Maintenir puis glisser $title.md vers un projet").fetchSemanticsNode().boundsInRoot.left > sourceBounds.left
        }
        compose.waitUntil(15000) { compose.onAllNodesWithContentDescription("Recherche").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithContentDescription("Recherche").performClick()
        compose.onNode(hasSetTextAction()).performTextInput("tag:android")
        compose.waitUntil(15000) { compose.onAllNodesWithText("$project/$title.md").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithContentDescription("Réglages").performClick()
        compose.onNodeWithText("Sombre").performClick()
        compose.onNodeWithText("Sombre").assertIsDisplayed()
    }
}
