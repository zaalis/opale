package com.example.opale.board

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Exercises the real Android org.json implementation against Opale/JSON Canvas files. */
@RunWith(AndroidJUnit4::class)
class BoardModelInstrumentedTest {
    @Test
    fun emptyBoardMatchesTheWindowsCanvasEnvelope() {
        val root = JSONObject(emptyBoard())
        assertTrue(root.optJSONArray("nodes")!!.length() == 0)
        assertTrue(root.optJSONArray("edges")!!.length() == 0)
        assertEquals(1, root.getJSONObject("opale").getInt("version"))
        assertEquals("base", root.getJSONObject("opale").getJSONArray("layers").getJSONObject(0).getString("id"))
        assertEquals("dots", root.getJSONObject("opale").getJSONObject("settings").getString("grid"))
    }

    @Test
    fun parseAndSerializeKeepOpaqueCanvasAndOpaleFields() {
        val source = JSONObject()
            .put("canvasVendor", JSONObject().put("build", 17).put("future", JSONArray().put("a").put(9)))
            .put("nodes", JSONArray().put(
                JSONObject()
                    .put("id", "timeline-1")
                    .put("type", "text")
                    .put("x", 13)
                    .put("y", -27)
                    .put("width", 760)
                    .put("height", 260)
                    .put("text", "## Planning\n- Revue")
                    .put("color", "6")
                    .put("vendorNode", JSONObject().put("flag", true))
                    .put("opale", JSONObject()
                        .put("kind", "timeline")
                        .put("z", 5)
                        .put("layer", "research")
                        .put("locked", true)
                        .put("rotation", 12.5)
                        .put("style", JSONObject().put("borderDash", "dot").put("vendorStyle", "v3"))
                        .put("data", JSONObject()
                            .put("title", "Planning")
                            .put("lanes", JSONArray().put(JSONObject().put("id", "l1").put("title", "Équipe")))
                            .put("items", JSONArray().put(JSONObject().put("id", "i1").put("text", "Revue").put("color", "#a882ff")))
                            .put("privateWidgetState", JSONObject().put("cursor", 4)))
                        .put("futureOpaleKey", JSONArray().put(1).put(2)))
            ))
            .put("edges", JSONArray().put(
                JSONObject()
                    .put("id", "edge-1")
                    .put("fromNode", "timeline-1")
                    .put("fromSide", "right")
                    .put("toNode", "unknown-target")
                    .put("toSide", "left")
                    .put("label", "suite")
                    .put("futureEdgeKey", "keep-me")
                    .put("opale", JSONObject()
                        .put("kind", "connector")
                        .put("z", 6)
                        .put("data", JSONObject().put("relation", "dependency"))
                        .put("ends", JSONObject()
                            .put("from", JSONObject().put("id", "timeline-1").put("side", "right").put("x", 773.0).put("y", 103.0))
                            .put("to", JSONObject().put("id", "unknown-target").put("side", "left").put("x", 900.0).put("y", 103.0)))
                        .put("futureEdgeExtension", true))
            ))
            .put("opale", JSONObject()
                .put("version", 1)
                .put("layers", JSONArray().put(JSONObject().put("id", "research").put("name", "Recherche").put("visible", true).put("locked", false).put("blend", "multiply")))
                .put("settings", JSONObject().put("grid", "lines").put("snap", false).put("zoomAnchor", "center"))
                .put("vote", JSONObject().put("active", true).put("votes", JSONObject().put("timeline-1", 2)))
                .put("futureRootKey", JSONObject().put("keep", "yes")))

        val parsed = parseBoard(source.toString())
        assertEquals(null, parsed.problem)
        assertEquals(listOf("timeline", "connector"), parsed.elements.map { it.kind })

        val saved = JSONObject(boardToString(parsed))
        assertEquals("yes", saved.getJSONObject("opale").getJSONObject("futureRootKey").getString("keep"))
        assertEquals("center", saved.getJSONObject("opale").getJSONObject("settings").getString("zoomAnchor"))
        assertEquals("multiply", saved.getJSONObject("opale").getJSONArray("layers").getJSONObject(0).getString("blend"))
        val node = saved.getJSONArray("nodes").getJSONObject(0)
        assertEquals("v3", node.getJSONObject("opale").getJSONObject("style").getString("vendorStyle"))
        assertEquals(4, node.getJSONObject("opale").getJSONObject("data").getJSONObject("privateWidgetState").getInt("cursor"))
        assertEquals(2, node.getJSONObject("opale").getJSONArray("futureOpaleKey").length())
        assertTrue(node.getJSONObject("vendorNode").getBoolean("flag"))
        assertEquals("#a882ff", node.getJSONObject("opale").getJSONObject("data").getJSONArray("items").getJSONObject(0).getString("color"))
        val edge = saved.getJSONArray("edges").getJSONObject(0)
        assertEquals("keep-me", edge.getString("futureEdgeKey"))
        assertTrue(edge.getJSONObject("opale").getBoolean("futureEdgeExtension"))
        assertEquals(773.0, edge.getJSONObject("opale").getJSONObject("ends").getJSONObject("from").getDouble("x"), 0.0)
    }

    @Test
    fun geometryChangesOnlyOwnedCoordinatesAndPreservesExtensions() {
        val original = JSONObject()
            .put("sourcePlugin", JSONObject().put("version", 8))
            .put("nodes", JSONArray().put(
                JSONObject()
                    .put("id", "n1").put("type", "text").put("x", 10).put("y", 20).put("width", 100).put("height", 50)
                    .put("text", "Carte")
                    .put("vendorNode", JSONArray().put("opaque"))
                    .put("opale", JSONObject().put("kind", "card").put("z", 3)
                        .put("style", JSONObject().put("accent", "#123456").put("newStyle", true))
                        .put("data", JSONObject().put("title", "Tâche").put("tags", JSONArray().put("ux")))
                        .put("extra", "untouched"))
            ))
            .put("edges", JSONArray())
            .put("opale", JSONObject().put("version", 1).put("customMetadata", "untouched"))

        val moved = JSONObject(moveBoardElement(original.toString(), "n1", 12.5f, -7.25f))
        val node = moved.getJSONArray("nodes").getJSONObject(0)
        assertEquals(22.5, node.getDouble("x"), 0.0)
        assertEquals(12.75, node.getDouble("y"), 0.0)
        assertEquals(100, node.getInt("width"))
        assertEquals("opaque", node.getJSONArray("vendorNode").getString(0))
        assertEquals("untouched", node.getJSONObject("opale").getString("extra"))
        assertTrue(node.getJSONObject("opale").getJSONObject("style").getBoolean("newStyle"))
        assertEquals("untouched", moved.getJSONObject("opale").getString("customMetadata"))
        assertEquals(8, moved.getJSONObject("sourcePlugin").getInt("version"))
    }

    @Test
    fun imageHelperAddsWindowsCompatibleFileNodeWithoutNormalizingExistingData() {
        val existing = JSONObject()
            .put("nodes", JSONArray().put(JSONObject()
                .put("id", "old").put("type", "text").put("x", 1).put("y", 2).put("width", 100).put("height", 40).put("text", "Garder")
                .put("opale", JSONObject().put("kind", "text").put("data", JSONObject().put("text", "Garder").put("custom", 37)))))
            .put("edges", JSONArray())
            .put("opale", JSONObject().put("version", 1).put("plugin", JSONObject().put("setting", "keep")))

        val result = JSONObject(addImageToBoard(existing.toString(), "Photos/photo.png"))
        assertEquals("keep", result.getJSONObject("opale").getJSONObject("plugin").getString("setting"))
        assertEquals(2, result.getJSONArray("nodes").length())
        val image = result.getJSONArray("nodes").getJSONObject(1)
        assertEquals("file", image.getString("type"))
        assertEquals("Photos/photo.png", image.getString("file"))
        assertEquals("image", image.getJSONObject("opale").getString("kind"))
        assertEquals("", image.getJSONObject("opale").getJSONObject("data").getString("alt"))
        assertFalse(image.getJSONObject("opale").getJSONObject("data").has("file"))
        assertNotNull(image.getJSONObject("opale").getJSONObject("style"))
        assertEquals(37, result.getJSONArray("nodes").getJSONObject(0).getJSONObject("opale").getJSONObject("data").getInt("custom"))
        assertEquals(existing.getJSONArray("nodes").getJSONObject(0).getString("id"), result.getJSONArray("nodes").getJSONObject(0).getString("id"))
    }

    @Test
    fun blankImagePathDoesNotChangeTheDocument() {
        val before = emptyBoard()
        assertEquals(before, addImageToBoard(before, " "))
    }

    @Test
    fun newWidgetsUseWindowsSharedBoardDefaultGeometry() {
        val sizes = mapOf(
            "text" to (260f to 44f), "sticky" to (200f to 200f), "mdcard" to (320f to 180f),
            "shape" to (180f to 120f), "connector" to (1f to 1f), "stroke" to (1f to 1f),
            "image" to (320f to 240f), "note" to (360f to 280f), "file" to (260f to 72f),
            "link" to (320f to 96f), "embed" to (560f to 340f), "video" to (480f to 270f),
            "frame" to (800f to 520f), "grid" to (720f to 480f), "code" to (460f to 220f),
            "table" to (480f to 180f), "kanban" to (900f to 460f), "mindmap" to (420f to 220f),
            "card" to (300f to 170f), "flipcard" to (260f to 180f), "usercard" to (300f to 200f),
            "timeline" to (960f to 300f), "comment" to (36f to 36f), "emoji" to (80f to 80f),
            "sticker" to (140f to 140f), "icon" to (64f to 64f), "ui" to (160f to 44f),
            "mermaid" to (520f to 360f), "poll" to (340f to 240f), "wheel" to (320f to 360f),
            "scale" to (520f to 150f), "activity" to (420f to 300f),
        )
        for ((kind, size) in sizes) {
            val (content, id) = addBoardElement(emptyBoard(), kind)
            val element = parseBoard(content).elements.first { it.id == id }
            assertEquals("$kind width", size.first, element.width, 0f)
            assertEquals("$kind height", size.second, element.height, 0f)
        }
    }

    @Test
    fun hiddenAndLockedLayersGateBoardActions() {
        val root = JSONObject(emptyBoard())
        root.getJSONObject("opale").getJSONArray("layers").put(
            JSONObject().put("id", "notes").put("name", "Notes").put("visible", true).put("locked", false).put("plugin", "keep")
        )
        root.getJSONArray("nodes").put(
            JSONObject().put("id", "note-card").put("type", "text").put("x", 10).put("y", 20).put("width", 120).put("height", 60)
                .put("text", "Conserver")
                .put("opale", JSONObject().put("kind", "sticky").put("layer", "notes").put("data", JSONObject().put("text", "Conserver").put("extra", 42)))
        )
        val source = root.toString()
        var document = parseBoard(source)
        val element = document.elements.single()
        assertTrue(isLayerVisible(document, element))
        assertFalse(isBoardElementLocked(document, element))

        val hidden = updateBoardLayer(source, "notes", visible = false)
        document = parseBoard(hidden)
        val hiddenElement = document.elements.single()
        assertFalse(isLayerVisible(document, hiddenElement))
        assertEquals(hidden, moveBoardElement(hidden, "note-card", 40f, 50f))

        val locked = updateBoardLayer(source, "notes", locked = true)
        document = parseBoard(locked)
        val lockedElement = document.elements.single()
        assertTrue(isBoardElementLocked(document, lockedElement))
        assertEquals(locked, moveBoardElement(locked, "note-card", 40f, 50f))
        assertEquals(locked, replaceBoardElement(locked, "note-card", JSONObject().put("text", "Ne pas remplacer")))
        assertEquals(locked, removeBoardElement(locked, "note-card"))
        assertEquals("keep", JSONObject(locked).getJSONObject("opale").getJSONArray("layers").getJSONObject(1).getString("plugin"))
    }

    @Test
    fun movingConnectorsTranslatesFreeEndsAndKeepsNodeAnchors() {
        val root = JSONObject(emptyBoard())
        root.getJSONArray("nodes").put(
            JSONObject().put("id", "anchor").put("type", "text").put("x", 0).put("y", 0).put("width", 100).put("height", 80)
                .put("text", "Anchor").put("opale", JSONObject().put("kind", "text"))
        )
        root.getJSONArray("nodes").put(
            JSONObject().put("id", "free-connector").put("type", "text").put("x", 0).put("y", 0).put("width", 1).put("height", 1).put("text", "")
                .put("opale", JSONObject().put("kind", "connector").put("z", 1)
                    .put("ends", JSONObject()
                        .put("from", JSONObject().put("id", "anchor").put("side", "right").put("x", 100).put("y", 40))
                        .put("to", JSONObject().put("x", 180).put("y", 40)))
                    .put("style", JSONObject().put("path", "straight")))
        )
        root.getJSONArray("edges").put(
            JSONObject().put("id", "partly-linked-edge").put("fromNode", "anchor").put("fromSide", "right").put("toNode", "")
                .put("opale", JSONObject().put("kind", "connector").put("z", 2)
                    .put("ends", JSONObject()
                        .put("from", JSONObject().put("id", "anchor").put("side", "right").put("x", 100).put("y", 40))
                        .put("to", JSONObject().put("x", 210).put("y", 60))))
        )
        val source = root.toString()
        val parsed = parseBoard(source)
        val nodeConnector = parsed.elements.first { it.id == "free-connector" }
        assertEquals("anchor", nodeConnector.fromId)
        assertTrue(canMoveBoardElement(parsed, nodeConnector))
        val afterNodeMove = JSONObject(moveBoardElement(source, nodeConnector.id, 25f, -10f))
        val nodeEnds = afterNodeMove.getJSONArray("nodes").getJSONObject(1).getJSONObject("opale").getJSONObject("ends")
        assertEquals(100.0, nodeEnds.getJSONObject("from").getDouble("x"), 0.0)
        assertEquals(40.0, nodeEnds.getJSONObject("from").getDouble("y"), 0.0)
        assertEquals(205.0, nodeEnds.getJSONObject("to").getDouble("x"), 0.0)
        assertEquals(30.0, nodeEnds.getJSONObject("to").getDouble("y"), 0.0)

        val edge = parsed.elements.first { it.id == "partly-linked-edge" }
        val afterEdgeMove = JSONObject(moveBoardElement(source, edge.id, -15f, 20f))
        val edgeEnds = afterEdgeMove.getJSONArray("edges").getJSONObject(0).getJSONObject("opale").getJSONObject("ends")
        assertEquals("anchor", edgeEnds.getJSONObject("from").getString("id"))
        assertEquals(100.0, edgeEnds.getJSONObject("from").getDouble("x"), 0.0)
        assertEquals(195.0, edgeEnds.getJSONObject("to").getDouble("x"), 0.0)
        assertEquals(80.0, edgeEnds.getJSONObject("to").getDouble("y"), 0.0)
    }
}
