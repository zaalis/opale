package com.example.opale

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.geometry.Offset
import androidx.test.platform.app.InstrumentationRegistry
import com.example.opale.board.BoardEditor
import com.example.opale.data.VaultRepository
import com.example.opale.ui.theme.OpaleTheme
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.assertEquals

class BoardTouchTest {
    @get:Rule val compose=createComposeRule()
    @Test fun panDoesNotMoveObjectsAndTapRequiresExplicitModify() {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val repository=VaultRepository(context.createDeviceProtectedStorageContext()).apply { useLocalVault() }
        val content="""{"nodes":[{"id":"touch","type":"text","x":10,"y":10,"width":200,"height":120,"text":"Objet tactile","opale":{"kind":"sticky","data":{"text":"Objet tactile"},"style":{}}}],"edges":[]}"""
        var published=content
        compose.setContent { OpaleTheme { BoardEditor(content,"Touch.canvas",repository,{published=it},{},{}) } }
        val canvas=compose.onNodeWithContentDescription("Moodboard tactile.",substring=true)
        val density=context.resources.displayMetrics.density
        canvas.performTouchInput { click(Offset(80*density,70*density)) }
        compose.onNodeWithText("Modifier").assertIsEnabled()
        compose.onAllNodes(hasSetTextAction()).assertCountEquals(0)
        canvas.performTouchInput { swipe(Offset(80*density,70*density),Offset(140*density,140*density),500) }
        compose.runOnIdle { assertEquals(content,published) }
        compose.onNodeWithText("Modifier").performClick()
        compose.onAllNodes(hasSetTextAction()).onFirst().assertExists()
        compose.onAllNodesWithText("Annuler",useUnmergedTree=true).onLast().assertExists()
    }
}
