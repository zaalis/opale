package com.example.opale.board

import android.graphics.BitmapFactory
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.changedToUp
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.DialogProperties
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.layout.onSizeChanged
import com.example.opale.data.VaultRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import kotlin.math.max
import kotlin.math.min

private enum class BoardGesture { NONE, PAN, MOVE, DRAW, PINCH }

private val elementCatalog = listOf(
    "text" to "Texte", "sticky" to "Pense-bête", "shape" to "Forme", "image" to "Image",
    "note" to "Note", "connector" to "Connecteur", "stroke" to "Dessin", "frame" to "Cadre",
    "grid" to "Grille", "table" to "Tableau", "kanban" to "Kanban", "mindmap" to "Carte mentale",
    "card" to "Tâche", "flipcard" to "Carte recto-verso", "usercard" to "Profil",
    "timeline" to "Planning", "code" to "Code", "mermaid" to "Diagramme Mermaid",
    "poll" to "Sondage", "activity" to "Activité", "wheel" to "Roue", "scale" to "Échelle",
    "comment" to "Commentaire", "emoji" to "Caractère", "sticker" to "Autocollant",
    "icon" to "Icône", "ui" to "Composant", "link" to "Lien", "embed" to "Intégration",
    "video" to "Vidéo", "file" to "Fichier", "mdcard" to "Carte Markdown",
)

/** Native, touch-first JSON Canvas editor. The parent screen owns vault selection and saving. */
@Composable
fun BoardEditor(
    content: String,
    path: String,
    repository: VaultRepository,
    onChange: (String) -> Unit,
    onOpenNote: (String) -> Unit,
    onAddImage: () -> Unit = {},
) {
    val vaultKey = repository.name
    var source by remember(vaultKey, path) { mutableStateOf(content.ifBlank { emptyBoard() }) }
    val sentToParent = remember(vaultKey, path) { mutableStateOf("") }
    val undo = remember(vaultKey, path) { mutableStateListOf<String>() }
    val redo = remember(vaultKey, path) { mutableStateListOf<String>() }
    var selectedId by remember(vaultKey, path) { mutableStateOf<String?>(null) }
    var moveMode by remember(vaultKey, path) { mutableStateOf(false) }
    var drawMode by remember(vaultKey, path) { mutableStateOf(false) }
    var showLibrary by remember(vaultKey, path) { mutableStateOf(false) }
    var showLayers by remember(vaultKey, path) { mutableStateOf(false) }
    var editingId by remember(vaultKey, path) { mutableStateOf<String?>(null) }
    var canvasSize by remember(vaultKey, path) { mutableStateOf(IntSize.Zero) }
    var panX by remember(vaultKey, path) { mutableFloatStateOf(24f) }
    var panY by remember(vaultKey, path) { mutableFloatStateOf(24f) }
    var zoom by remember(vaultKey, path) { mutableFloatStateOf(0.82f) }
    var movePreview by remember(vaultKey, path) { mutableStateOf(Offset.Zero) }
    var inkPreview by remember(vaultKey, path) { mutableStateOf<List<Pair<Float, Float>>>(emptyList()) }
    val imageCache = remember(vaultKey, path) { mutableStateMapOf<String, androidx.compose.ui.graphics.ImageBitmap?>() }
    val imageLoading = remember(vaultKey, path) { mutableStateMapOf<String, Boolean>() }
    val document = remember(source) { parseBoard(source) }
    val selected = document.elements.firstOrNull { it.id == selectedId }?.takeIf { isLayerVisible(document, it) }
    val selectedLocked = selected?.let { isBoardElementLocked(document, it) } ?: false
    val selectedMovable = selected?.let { canMoveBoardElement(document, it) } ?: false
    val baseLayerLocked = document.layers.firstOrNull { it.id == "base" }?.locked == true
    val imagePaths = remember(document) { document.elements.filter { it.kind == "image" || it.kind == "video" }.map { it.file }.filter(String::isNotBlank).distinct() }

    LaunchedEffect(content, path, vaultKey) {
        if (content.isNotBlank() && content != source && content != sentToParent.value) {
            source = content
            undo.clear()
            redo.clear()
            selectedId = null
        }
        if (content == sentToParent.value) sentToParent.value = ""
    }

    LaunchedEffect(imagePaths, repository, vaultKey) {
        for (imagePath in imagePaths) {
            if (imageCache.containsKey(imagePath) || imageLoading[imagePath] == true) continue
            imageLoading[imagePath] = true
            val bitmap = withContext(Dispatchers.IO) {
                runCatching {
                    val bytes = repository.readBytes(imagePath)
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
                }.getOrNull()
            }
            imageCache[imagePath] = bitmap
            imageLoading[imagePath] = false
        }
    }

    LaunchedEffect(document.elements, selectedId) {
        if (selectedId != null && document.elements.none { it.id == selectedId && isLayerVisible(document, it) }) selectedId = null
    }

    LaunchedEffect(selected?.id, selectedMovable) {
        if (!selectedMovable) moveMode = false
    }

    fun commit(next: String) {
        if (next == source || parseBoard(source).problem != null) return
        undo.add(source)
        if (undo.size > 80) undo.removeAt(0)
        redo.clear()
        source = next
        sentToParent.value = next
        onChange(next)
    }

    fun undoChange() {
        if (undo.isEmpty()) return
        redo.add(source)
        source = undo.removeAt(undo.lastIndex)
        sentToParent.value = source
        selectedId = null
        onChange(source)
    }

    fun redoChange() {
        if (redo.isEmpty()) return
        undo.add(source)
        source = redo.removeAt(redo.lastIndex)
        sentToParent.value = source
        selectedId = null
        onChange(source)
    }

    val density = LocalDensity.current.density
    val canvasColors = MaterialTheme.colorScheme
    val latestDocument by rememberUpdatedState(document)
    val latestSelectedId by rememberUpdatedState(selectedId)
    val latestMoveMode by rememberUpdatedState(moveMode)
    val latestDrawMode by rememberUpdatedState(drawMode)
    val latestPanX by rememberUpdatedState(panX)
    val latestPanY by rememberUpdatedState(panY)
    val latestZoom by rememberUpdatedState(zoom)
    val latestSource by rememberUpdatedState(source)
    val latestCommit by rememberUpdatedState<(String) -> Unit> { next -> commit(next) }
    val latestSelect by rememberUpdatedState<(String?) -> Unit> { id -> selectedId = id }
    val latestMovePreview by rememberUpdatedState<(Offset) -> Unit> { value -> movePreview = value }
    val latestInkPreview by rememberUpdatedState<(List<Pair<Float, Float>>) -> Unit> { value -> inkPreview = value }
    val latestPan by rememberUpdatedState<(Float, Float) -> Unit> { x, y -> panX = x; panY = y }
    val latestZoomUpdate by rememberUpdatedState<(Float) -> Unit> { value -> zoom = value }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        Surface(color = MaterialTheme.colorScheme.surface, tonalElevation = 2.dp) {
            Row(
                modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 8.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Column(modifier = Modifier.weight(1f).padding(start = 4.dp)) {
                    Text("Moodboard", style = MaterialTheme.typography.titleMedium, maxLines = 1)
                    Text(path.substringAfterLast('/').ifBlank { "Nouveau moodboard" }, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                TextButton(onClick = ::undoChange, enabled = undo.isNotEmpty(), modifier = Modifier.defaultMinSize(minWidth = 48.dp, minHeight = 48.dp)) { Text("Annuler") }
                TextButton(onClick = ::redoChange, enabled = redo.isNotEmpty(), modifier = Modifier.defaultMinSize(minWidth = 48.dp, minHeight = 48.dp)) { Text("Rétablir") }
            }
        }

        Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
            Canvas(
                modifier = Modifier
                    .fillMaxSize()
                    .onSizeChanged { canvasSize = it }
                    .semantics {
                        contentDescription = buildString {
                            append("Moodboard tactile. Glissez un doigt pour déplacer la vue, pincez pour zoomer.")
                            selected?.let { append(" Élément sélectionné : ${it.title}.") }
                        }
                    }
                    .pointerInput(density) {
                        val touchSlop = viewConfiguration.touchSlop
                        awaitEachGesture {
                            val first = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Main)
                            val down = first.position
                            var last = down
                            var gesture = BoardGesture.NONE
                            var multiTouch = false
                            var moved = false
                            var moveId: String? = null
                            var moveDx = 0f
                            var moveDy = 0f
                            val startWorld = Offset(
                                (down.x / density - latestPanX) / latestZoom,
                                (down.y / density - latestPanY) / latestZoom,
                            )
                            val tappedId = hitTest(latestDocument, startWorld)
                            if (latestMoveMode && tappedId == latestSelectedId) {
                                val candidate = latestDocument.elements.firstOrNull { it.id == tappedId }
                                if (candidate != null && canMoveBoardElement(latestDocument, candidate)) moveId = tappedId
                            }
                            val drawing = mutableListOf<Pair<Float, Float>>()
                            var lastCentroid = Offset.Zero
                            var lastSpan = 0f
                            var pinchReady = false
                            var mainId = first.id

                            var completedNormally = false
                            try {
                            while (true) {
                                val event = awaitPointerEvent(PointerEventPass.Main)
                                val pressed = event.changes.filter { it.pressed }
                                if (pressed.size >= 2) {
                                    val center = Offset(
                                        (pressed.sumOf { it.position.x.toDouble() } / pressed.size).toFloat(),
                                        (pressed.sumOf { it.position.y.toDouble() } / pressed.size).toFloat(),
                                    )
                                    val span = averageSpan(pressed.map { it.position }, center)
                                    if (!multiTouch) {
                                        multiTouch = true
                                        gesture = BoardGesture.PINCH
                                        latestMovePreview(Offset.Zero)
                                        lastCentroid = center
                                        lastSpan = span
                                        pinchReady = true
                                    } else if (pinchReady && lastSpan > 0f) {
                                        val oldZoom = latestZoom
                                        val newZoom = (oldZoom * (span / lastSpan)).coerceIn(0.18f, 4.5f)
                                        val oldFocus = Offset(lastCentroid.x / density, lastCentroid.y / density)
                                        val newFocus = Offset(center.x / density, center.y / density)
                                        val worldAnchor = Offset(
                                            (oldFocus.x - latestPanX) / oldZoom,
                                            (oldFocus.y - latestPanY) / oldZoom,
                                        )
                                        latestPan(
                                            newFocus.x - worldAnchor.x * newZoom,
                                            newFocus.y - worldAnchor.y * newZoom,
                                        )
                                        latestZoomUpdate(newZoom)
                                        lastCentroid = center
                                        lastSpan = span
                                        moved = true
                                    }
                                    event.changes.filter { it.pressed }.forEach { it.consume() }
                                } else {
                                    if (multiTouch && pressed.size == 1) {
                                        // Rebase after lifting one finger to avoid a camera jump.
                                        gesture = BoardGesture.PAN
                                        last = pressed.first().position
                                        mainId = pressed.first().id
                                    }
                                    val change = event.changes.firstOrNull { it.id == mainId }
                                        ?: event.changes.firstOrNull()
                                    val position = change?.position ?: last
                                    val delta = position - last
                                    val total = position - down
                                    if (!multiTouch && gesture == BoardGesture.NONE && total.getDistance() > touchSlop) {
                                        gesture = when {
                                            latestDrawMode -> BoardGesture.DRAW
                                            moveId != null -> BoardGesture.MOVE
                                            else -> BoardGesture.PAN
                                        }
                                        if (gesture == BoardGesture.DRAW) drawing.add(startWorld.x to startWorld.y)
                                    }
                                    if (gesture != BoardGesture.NONE && delta != Offset.Zero) {
                                        moved = true
                                        when (gesture) {
                                            BoardGesture.PAN -> latestPan(latestPanX + delta.x / density, latestPanY + delta.y / density)
                                            BoardGesture.MOVE -> {
                                                moveDx += delta.x / density / latestZoom
                                                moveDy += delta.y / density / latestZoom
                                                latestMovePreview(Offset(moveDx, moveDy))
                                            }
                                            BoardGesture.DRAW -> {
                                                val wx = (position.x / density - latestPanX) / latestZoom
                                                val wy = (position.y / density - latestPanY) / latestZoom
                                                drawing.add(wx to wy)
                                                latestInkPreview(drawing.toList())
                                            }
                                            else -> Unit
                                        }
                                    }
                                    last = position
                                    event.changes.filter { it.pressed }.forEach { it.consume() }
                                    if (pressed.isEmpty()) { completedNormally = event.changes.any { it.changedToUp() }; break }
                                }
                                if (pressed.isEmpty()) { completedNormally = event.changes.any { it.changedToUp() }; break }
                            }

                            if (!completedNormally) return@awaitEachGesture
                            when {
                                gesture == BoardGesture.MOVE && moveId != null && moved -> {
                                    latestCommit(moveBoardElement(latestSource, moveId!!, moveDx, moveDy))
                                    latestMovePreview(Offset.Zero)
                                }
                                gesture == BoardGesture.DRAW && drawing.size > 1 -> {
                                    latestCommit(addDrawnStroke(latestSource, drawing))
                                    latestInkPreview(emptyList())
                                }
                                gesture == BoardGesture.DRAW -> latestInkPreview(emptyList())
                                gesture == BoardGesture.NONE && !multiTouch -> latestSelect(tappedId)
                                else -> latestMovePreview(Offset.Zero)
                            }
                            } finally {
                                // A canceled pointerInput gesture must never leave a preview behind.
                                latestMovePreview(Offset.Zero)
                                latestInkPreview(emptyList())
                            }
                        }
                    },
            ) {
                drawBoardCanvas(
                    document = document,
                    selectedId = selectedId,
                    cameraX = panX,
                    cameraY = panY,
                    zoom = zoom,
                    density = density,
                    images = imageCache,
                    movePreview = movePreview,
                    inkPreview = inkPreview,
                    accentColor = canvasColors.primary,
                    backgroundColor = canvasColors.background,
                    surfaceColor = canvasColors.surface,
                    textColor = canvasColors.onSurface,
                    outlineColor = canvasColors.outlineVariant,
                )
            }

            Column(
                modifier = Modifier.align(Alignment.TopStart).padding(10.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Surface(color = MaterialTheme.colorScheme.surface.copy(alpha = 0.94f), shape = MaterialTheme.shapes.medium, tonalElevation = 3.dp) {
                    Text("${(zoom * 100).toInt()} %", modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp), style = MaterialTheme.typography.labelLarge)
                }
                if (document.problem != null) {
                    Surface(color = MaterialTheme.colorScheme.errorContainer, shape = MaterialTheme.shapes.medium) {
                        Text(document.problem, modifier = Modifier.widthIn(max = 300.dp).padding(12.dp), color = MaterialTheme.colorScheme.onErrorContainer, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }

        Surface(color = MaterialTheme.colorScheme.surface, tonalElevation = 3.dp) {
            Row(
                modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                TextButton(onClick = { showLibrary = true }, enabled = document.problem == null && !baseLayerLocked, modifier = Modifier.defaultMinSize(minWidth = 56.dp, minHeight = 48.dp)) { Text("Ajouter") }
                TextButton(
                    onClick = onAddImage,
                    enabled = document.problem == null && !baseLayerLocked,
                    modifier = Modifier.defaultMinSize(minWidth = 56.dp, minHeight = 48.dp),
                ) { Text("Image") }
                TextButton(onClick = { editingId = selected?.id }, enabled = selected != null && !selectedLocked && document.problem == null, modifier = Modifier.defaultMinSize(minWidth = 56.dp, minHeight = 48.dp)) { Text("Modifier") }
                TextButton(onClick = { moveMode = !moveMode; drawMode = false }, enabled = selectedMovable && document.problem == null, modifier = Modifier.defaultMinSize(minWidth = 56.dp, minHeight = 48.dp)) { Text(if (moveMode) "Déplacer : oui" else "Déplacer") }
                TextButton(onClick = { drawMode = !drawMode; moveMode = false }, enabled = document.problem == null && !baseLayerLocked, modifier = Modifier.defaultMinSize(minWidth = 56.dp, minHeight = 48.dp)) { Text(if (drawMode) "Terminer dessin" else "Dessiner") }
                TextButton(onClick = { selected?.takeIf { it.kind == "note" }?.file?.let(onOpenNote) }, enabled = selected?.kind == "note" && selected.file.isNotBlank(), modifier = Modifier.defaultMinSize(minWidth = 56.dp, minHeight = 48.dp)) { Text("Ouvrir note") }
                TextButton(onClick = { selected?.let { commit(removeBoardElement(source, it.id)); selectedId = null } }, enabled = selected != null && !selectedLocked && document.problem == null, modifier = Modifier.defaultMinSize(minWidth = 56.dp, minHeight = 48.dp)) { Text("Supprimer") }
                TextButton(onClick = { showLayers = true }, modifier = Modifier.defaultMinSize(minWidth = 56.dp, minHeight = 48.dp)) { Text("Calques") }
                TextButton(
                    onClick = { recenter(document, canvasSize, density)?.let { (newZoom, newPanX, newPanY) -> zoom = newZoom; panX = newPanX; panY = newPanY } },
                    enabled = document.elements.any { isLayerVisible(document, it) && !it.isEdge && it.kind !in setOf("connector", "stroke") },
                    modifier = Modifier.defaultMinSize(minWidth = 56.dp, minHeight = 48.dp),
                ) { Text("Centrer") }
                TextButton(onClick = { zoom = (zoom / 1.2f).coerceAtLeast(0.18f) }, modifier = Modifier.defaultMinSize(minWidth = 48.dp, minHeight = 48.dp)) { Text("−") }
                TextButton(onClick = { zoom = (zoom * 1.2f).coerceAtMost(4.5f) }, modifier = Modifier.defaultMinSize(minWidth = 48.dp, minHeight = 48.dp)) { Text("+") }
            }
        }
    }

    if (showLibrary) {
        BoardLibraryDialog(
            enabled = document.problem == null && !baseLayerLocked,
            onDismiss = { showLibrary = false },
            onAdd = { kind ->
                if (kind == "stroke") {
                    drawMode = true
                    moveMode = false
                } else {
                    val (next, id) = addBoardElement(source, kind)
                    if (next != source) {
                        commit(next)
                        selectedId = id
                    }
                }
                showLibrary = false
            },
        )
    }

    if (showLayers) {
        BoardLayersDialog(
            layers = document.layers,
            onDismiss = { showLayers = false },
            onVisibilityChange = { layer, visible ->
                commit(updateBoardLayer(source, layer.id, visible = visible))
                if (!visible && selected?.layer == layer.id) selectedId = null
                moveMode = false
                drawMode = false
            },
            onLockChange = { layer, locked ->
                commit(updateBoardLayer(source, layer.id, locked = locked))
                if (locked) { moveMode = false; drawMode = false }
            },
        )
    }

    val elementToEdit = document.elements.firstOrNull { it.id == editingId }
    if (elementToEdit != null) {
        BoardElementEditorDialog(
            element = elementToEdit,
            onDismiss = { editingId = null },
            onSave = { edited ->
                commit(replaceBoardElement(source, elementToEdit.id, edited))
                editingId = null
            },
        )
    }
}

@Composable
private fun BoardLibraryDialog(enabled: Boolean, onDismiss: () -> Unit, onAdd: (String) -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Ajouter au moodboard") },
        text = {
            LazyColumn(modifier = Modifier.fillMaxWidth().heightIn(max = 500.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                items(elementCatalog) { (kind, label) ->
                    TextButton(
                        onClick = { onAdd(kind) },
                        enabled = enabled,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                    ) { Text(label, modifier = Modifier.fillMaxWidth()) }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Fermer") } },
        properties = DialogProperties(usePlatformDefaultWidth = false),
        modifier = Modifier.fillMaxWidth(0.92f),
    )
}

@Composable
private fun BoardLayersDialog(
    layers: List<BoardLayer>,
    onDismiss: () -> Unit,
    onVisibilityChange: (BoardLayer, Boolean) -> Unit,
    onLockChange: (BoardLayer, Boolean) -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Calques") },
        text = {
            LazyColumn(modifier = Modifier.fillMaxWidth().heightIn(max = 480.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                items(layers, key = { it.id }) { layer ->
                    Surface(shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceVariant) {
                        Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 6.dp)) {
                            Text(layer.name, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(layer.id, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                TextButton(onClick = { onVisibilityChange(layer, !layer.visible) }, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) {
                                    Text(if (layer.visible) "Masquer" else "Afficher")
                                }
                                TextButton(onClick = { onLockChange(layer, !layer.locked) }, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) {
                                    Text(if (layer.locked) "Déverrouiller" else "Verrouiller")
                                }
                            }
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss, modifier = Modifier.heightIn(min = 48.dp)) { Text("Fermer") } },
        properties = DialogProperties(usePlatformDefaultWidth = false),
        modifier = Modifier.fillMaxWidth(0.92f),
    )
}

@Composable
private fun BoardElementEditorDialog(element: BoardElement, onDismiss: () -> Unit, onSave: (JSONObject) -> Unit) {
    val initial = remember(element.id, element.raw.toString()) { JSONObject(element.raw.toString()) }
    var x by remember(element.id, element.raw.toString()) { mutableStateOf(element.x.toString()) }
    var y by remember(element.id, element.raw.toString()) { mutableStateOf(element.y.toString()) }
    var width by remember(element.id, element.raw.toString()) { mutableStateOf(element.width.toString()) }
    var height by remember(element.id, element.raw.toString()) { mutableStateOf(element.height.toString()) }
    var fill by remember(element.id, element.raw.toString()) { mutableStateOf(element.style.optString("fill", element.raw.optString("color"))) }
    var ink by remember(element.id, element.raw.toString()) { mutableStateOf(element.style.optString("color")) }
    var border by remember(element.id, element.raw.toString()) { mutableStateOf(element.style.optString("stroke")) }
    val data = element.data
    val contentKey = when (element.kind) {
        "text", "sticky", "shape", "mdcard" -> "text"
        "frame", "grid", "kanban", "timeline", "card" -> "title"
        "poll", "activity" -> "question"
        "code" -> "code"
        "mermaid" -> "source"
        "emoji" -> "char"
        "sticker" -> "sticker"
        "icon" -> "icon"
        "usercard" -> "name"
        else -> "text"
    }
    val isFile = element.kind in setOf("image", "note", "file")
    val isUrl = element.kind in setOf("link", "embed")
    var content by remember(element.id, element.raw.toString()) {
        mutableStateOf(data.optString(contentKey, if (contentKey == "text") initial.optString("text") else ""))
    }
    var title by remember(element.id, element.raw.toString()) { mutableStateOf(data.optString("title", initial.optString("label"))) }
    var file by remember(element.id, element.raw.toString()) { mutableStateOf(element.file) }
    var url by remember(element.id, element.raw.toString()) { mutableStateOf(data.optString("url", initial.optString("url"))) }
    var subpath by remember(element.id, element.raw.toString()) { mutableStateOf(initial.optString("subpath").removePrefix("#")) }
    var description by remember(element.id, element.raw.toString()) { mutableStateOf(data.optString("description")) }
    var role by remember(element.id, element.raw.toString()) { mutableStateOf(data.optString("role")) }
    var notes by remember(element.id, element.raw.toString()) { mutableStateOf(data.optString("notes")) }
    var back by remember(element.id, element.raw.toString()) { mutableStateOf(data.optString("back")) }
    var front by remember(element.id, element.raw.toString()) { mutableStateOf(data.optString("front")) }
    var alt by remember(element.id, element.raw.toString()) { mutableStateOf(data.optString("alt")) }
    var tableText by remember(element.id, element.raw.toString()) { mutableStateOf(tableToText(data.optJSONArray("rows"))) }
    var kanbanText by remember(element.id, element.raw.toString()) { mutableStateOf(kanbanToText(data.optJSONArray("columns"))) }
    var gridRows by remember(element.id, element.raw.toString()) { mutableStateOf(data.optString("rows", "3")) }
    var gridCols by remember(element.id, element.raw.toString()) { mutableStateOf(data.optString("cols", "3")) }
    var advanced by remember(element.id) { mutableStateOf(false) }
    var advancedText by remember(element.id, element.raw.toString()) { mutableStateOf(initial.toString(2)) }
    var advancedTouched by remember(element.id) { mutableStateOf(false) }
    var error by remember(element.id) { mutableStateOf<String?>(null) }

    fun formResult(): JSONObject {
        val output = JSONObject(initial.toString())
        val parsedX = x.toFloatOrNull()?.takeIf(Float::isFinite) ?: throw IllegalArgumentException("X doit être un nombre fini.")
        val parsedY = y.toFloatOrNull()?.takeIf(Float::isFinite) ?: throw IllegalArgumentException("Y doit être un nombre fini.")
        val parsedWidth = width.toFloatOrNull()?.takeIf(Float::isFinite) ?: throw IllegalArgumentException("La largeur doit être un nombre fini.")
        val parsedHeight = height.toFloatOrNull()?.takeIf(Float::isFinite) ?: throw IllegalArgumentException("La hauteur doit être un nombre fini.")
        if (element.kind !in setOf("connector", "stroke") && (parsedWidth <= 0f || parsedHeight <= 0f)) {
            throw IllegalArgumentException("La largeur et la hauteur doivent être supérieures à zéro.")
        }
        output.put("x", parsedX).put("y", parsedY).put("width", parsedWidth).put("height", parsedHeight)
        val meta = JSONObject(output.optJSONObject("opale")?.toString() ?: "{}")
        val nextData = JSONObject(meta.optJSONObject("data")?.toString() ?: "{}")
        val nextStyle = JSONObject(meta.optJSONObject("style")?.toString() ?: "{}")

        when {
            element.kind in setOf("text", "sticky", "shape", "mdcard") -> {
                nextData.put("text", content)
                output.put("text", content)
            }
            element.kind == "video" -> {
                if (file.isNotBlank()) { output.put("type", "file"); output.put("file", file.trim()); output.remove("url"); nextData.remove("file"); nextData.remove("url") }
                else { output.put("type", "link"); output.put("url", url.trim()); output.remove("file"); nextData.remove("file"); nextData.remove("url") }
            }
            isFile -> {
                output.put("file", file.trim())
                nextData.remove("file")
                if (subpath.isBlank()) output.remove("subpath") else output.put("subpath", "#${subpath.trim().removePrefix("#")}")
                if (element.kind == "image") nextData.put("alt", alt)
            }
            isUrl -> {
                output.put("url", url.trim())
                nextData.remove("url")
            }
            element.kind == "frame" -> { nextData.put("title", title); output.put("label", title) }
            element.kind == "grid" -> {
                val rows = gridRows.toIntOrNull()?.coerceIn(1, 50) ?: throw IllegalArgumentException("Le nombre de lignes doit être compris entre 1 et 50.")
                val cols = gridCols.toIntOrNull()?.coerceIn(1, 50) ?: throw IllegalArgumentException("Le nombre de colonnes doit être compris entre 1 et 50.")
                nextData.put("title", title).put("rows", rows).put("cols", cols)
                output.put("label", title)
            }
            element.kind == "table" -> nextData.put("rows", textToTable(tableText, nextData.optJSONArray("rows")))
            element.kind == "kanban" -> nextData.put("title", title).put("columns", textToKanban(kanbanText, nextData.optJSONArray("columns")))
            element.kind == "card" -> nextData.put("title", title).put("description", description)
            element.kind == "flipcard" -> nextData.put("front", front).put("back", back)
            element.kind == "usercard" -> nextData.put("name", content).put("role", role).put("notes", notes)
            else -> nextData.put(contentKey, content)
        }
        if (fill.isBlank()) { nextStyle.remove("fill"); output.remove("color") }
        else { nextStyle.put("fill", fill.trim()); output.put("color", fill.trim()) }
        if (ink.isBlank()) nextStyle.remove("color") else nextStyle.put("color", ink.trim())
        if (border.isBlank()) nextStyle.remove("stroke") else nextStyle.put("stroke", border.trim())
        meta.put("data", nextData).put("style", nextStyle)
        output.put("opale", meta)
        return output
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Modifier · ${element.title}") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth().heightIn(max = 570.dp).verticalScroll(rememberScrollState())) {
                Text("Propriétés", style = MaterialTheme.typography.titleSmall)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(x, { x = it }, modifier = Modifier.weight(1f), label = { Text("Position X") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                    OutlinedTextField(y, { y = it }, modifier = Modifier.weight(1f), label = { Text("Position Y") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(width, { width = it }, modifier = Modifier.weight(1f), label = { Text("Largeur") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                    OutlinedTextField(height, { height = it }, modifier = Modifier.weight(1f), label = { Text("Hauteur") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(fill, { fill = it }, modifier = Modifier.weight(1f), label = { Text("Couleur de fond") }, singleLine = true)
                    OutlinedTextField(ink, { ink = it }, modifier = Modifier.weight(1f), label = { Text("Couleur du texte") }, singleLine = true)
                }
                OutlinedTextField(border, { border = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Couleur du contour") }, singleLine = true)
                when {
                    element.kind == "video" -> {
                        OutlinedTextField(file, { file = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Chemin du fichier vidéo (facultatif)") }, singleLine = true)
                        OutlinedTextField(url, { url = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Adresse vidéo (si aucun fichier)") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri))
                    }
                    isFile -> {
                        OutlinedTextField(file, { file = it }, modifier = Modifier.fillMaxWidth(), label = { Text(if (element.kind == "image") "Chemin de l’image" else "Chemin du fichier ou de la note") }, singleLine = true)
                        if (element.kind == "note") OutlinedTextField(subpath, { subpath = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Section de la note (facultatif)") }, singleLine = true)
                        if (element.kind == "image") OutlinedTextField(alt, { alt = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Description de l’image") }, singleLine = true)
                    }
                    isUrl -> OutlinedTextField(url, { url = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Adresse du lien") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri))
                    element.kind == "table" -> OutlinedTextField(tableText, { tableText = it }, modifier = Modifier.fillMaxWidth().height(180.dp), label = { Text("Cellules · colonnes séparées par tabulation") }, minLines = 4)
                    element.kind == "kanban" -> {
                        OutlinedTextField(title, { title = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Titre du tableau") }, singleLine = true)
                        OutlinedTextField(kanbanText, { kanbanText = it }, modifier = Modifier.fillMaxWidth().height(180.dp), label = { Text("Colonnes · une par ligne, Cartes : carte 1 | carte 2") }, minLines = 4)
                    }
                    element.kind == "frame" || element.kind == "grid" || element.kind == "card" || element.kind == "timeline" -> OutlinedTextField(title, { title = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Titre") }, singleLine = true)
                    else -> OutlinedTextField(content, { content = it }, modifier = Modifier.fillMaxWidth().heightIn(min = 96.dp), label = { Text(contentLabel(element.kind, contentKey)) }, minLines = 3)
                }
                if (element.kind == "grid") {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(gridRows, { gridRows = it }, modifier = Modifier.weight(1f), label = { Text("Lignes") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                        OutlinedTextField(gridCols, { gridCols = it }, modifier = Modifier.weight(1f), label = { Text("Colonnes") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                    }
                }
                if (element.kind == "card") OutlinedTextField(description, { description = it }, modifier = Modifier.fillMaxWidth().heightIn(min = 80.dp), label = { Text("Description") }, minLines = 2)
                if (element.kind == "flipcard") {
                    OutlinedTextField(front, { front = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Recto") }, minLines = 2)
                    OutlinedTextField(back, { back = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Verso") }, minLines = 2)
                }
                if (element.kind == "usercard") {
                    OutlinedTextField(role, { role = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Rôle") }, singleLine = true)
                    OutlinedTextField(notes, { notes = it }, modifier = Modifier.fillMaxWidth(), label = { Text("Notes") }, minLines = 2)
                }
                TextButton(onClick = { advanced = !advanced }, modifier = Modifier.heightIn(min = 48.dp)) { Text(if (advanced) "Masquer les données avancées" else "Données avancées · JSON") }
                if (advanced) {
                    Text("Pour modifier les extensions Opale ou un widget complexe, éditez ses champs complets ici.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    OutlinedTextField(
                        value = advancedText,
                        onValueChange = { advancedText = it; advancedTouched = true; error = null },
                        modifier = Modifier.fillMaxWidth().height(260.dp),
                        label = { Text("JSON complet du nœud") },
                        textStyle = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 12.sp),
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, keyboardType = KeyboardType.Ascii),
                        maxLines = 24,
                    )
                }
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                runCatching {
                    if (advancedTouched) JSONObject(advancedText) else formResult()
                }.onSuccess(onSave).onFailure { error = it.message ?: "Vérifiez les champs saisis." }
            }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Enregistrer") }
        },
        dismissButton = { TextButton(onClick = onDismiss, modifier = Modifier.heightIn(min = 48.dp)) { Text("Annuler") } },
        properties = DialogProperties(usePlatformDefaultWidth = false),
        modifier = Modifier.fillMaxWidth(0.96f),
    )
}

private fun contentLabel(kind: String, key: String): String = when {
    key == "text" -> when (kind) { "sticky" -> "Texte du pense-bête"; "shape" -> "Texte dans la forme"; else -> "Contenu" }
    key == "title" -> "Titre"
    key == "question" -> "Question"
    key == "code" -> "Code"
    key == "source" -> "Source Mermaid"
    key == "char" -> "Caractère"
    key == "sticker" -> "Autocollant"
    key == "icon" -> "Icône"
    else -> "Nom"
}

private fun tableToText(rows: org.json.JSONArray?): String {
    if (rows == null || rows.length() == 0) return ""
    return (0 until rows.length()).map { index ->
        val row = rows.optJSONArray(index) ?: org.json.JSONArray()
        (0 until row.length()).joinToString("\t") { column -> row.optString(column) }
    }.joinToString("\n")
}

private fun textToTable(value: String, previous: org.json.JSONArray?): org.json.JSONArray {
    val lines = value.split('\n')
    val result = org.json.JSONArray()
    lines.forEachIndexed { rowIndex, line ->
        val old = previous?.optJSONArray(rowIndex)
        val cells = line.split('\t')
        val row = org.json.JSONArray()
        cells.forEachIndexed { columnIndex, cell -> row.put(cell) }
        result.put(row)
    }
    return result
}

private fun kanbanToText(columns: org.json.JSONArray?): String {
    if (columns == null) return ""
    return (0 until columns.length()).map { index ->
        val column = columns.optJSONObject(index) ?: JSONObject()
        val cards = column.optJSONArray("cards") ?: org.json.JSONArray()
        val cardText = (0 until cards.length()).mapNotNull { cards.optJSONObject(it)?.optString("text")?.takeIf(String::isNotBlank) }
        "${column.optString("title", "Colonne ${index + 1}")}: ${cardText.joinToString(" | ")}"
    }.joinToString("\n")
}

private fun textToKanban(value: String, previous: org.json.JSONArray?): org.json.JSONArray {
    val result = org.json.JSONArray()
    value.lines().filter(String::isNotBlank).forEachIndexed { index, line ->
        val old = previous?.optJSONObject(index)
        val column = JSONObject(old?.toString() ?: "{}")
        val split = line.split(':', limit = 2)
        val title = split.first().trim().ifBlank { "Colonne ${index + 1}" }
        column.put("title", title)
        val oldCards = old?.optJSONArray("cards")
        val cardTexts = split.getOrElse(1) { "" }.split('|').map(String::trim).filter(String::isNotBlank)
        val cards = org.json.JSONArray()
        cardTexts.forEachIndexed { cardIndex, text ->
            val card = JSONObject(oldCards?.optJSONObject(cardIndex)?.toString() ?: "{}")
            card.put("text", text)
            cards.put(card)
        }
        column.put("cards", cards)
        result.put(column)
    }
    return result
}

private fun recenter(document: BoardDocument, viewport: IntSize, density: Float): Triple<Float, Float, Float>? {
    if (viewport.width <= 0 || viewport.height <= 0 || density <= 0f) return null
    val elements = document.elements.filter {
        isLayerVisible(document, it) && !it.isEdge && it.kind !in setOf("connector", "stroke")
    }
    if (elements.isEmpty()) return null
    val left = elements.minOf { it.x }
    val top = elements.minOf { it.y }
    val right = elements.maxOf { it.x + it.width }
    val bottom = elements.maxOf { it.y + it.height }
    val contentWidth = max(1f, right - left)
    val contentHeight = max(1f, bottom - top)
    val widthDp = viewport.width / density
    val heightDp = viewport.height / density
    val margin = 48f
    val targetZoom = min((widthDp - margin * 2f) / contentWidth, (heightDp - margin * 2f) / contentHeight).coerceIn(0.18f, 2f)
    val centerX = (left + right) / 2f
    val centerY = (top + bottom) / 2f
    val panX = widthDp / 2f - centerX * targetZoom
    val panY = heightDp / 2f - centerY * targetZoom
    return Triple(targetZoom, panX, panY)
}

private fun averageSpan(points: List<Offset>, center: Offset): Float {
    if (points.size < 2) return 0f
    return points.sumOf { (it - center).getDistance().toDouble() }.toFloat() / points.size
}

private fun hitTest(document: BoardDocument, point: Offset): String? {
    val byId = document.elements.associateBy { it.id }
    for (element in document.elements.asReversed()) {
        if (!isLayerVisible(document, element)) continue
        if (element.isEdge || element.kind == "connector" || element.kind == "stroke") continue
        val cx = element.x + element.width / 2f
        val cy = element.y + element.height / 2f
        val angle = Math.toRadians(-element.rotation.toDouble())
        val dx = point.x - cx
        val dy = point.y - cy
        val localX = cx + dx * kotlin.math.cos(angle).toFloat() - dy * kotlin.math.sin(angle).toFloat()
        val localY = cy + dx * kotlin.math.sin(angle).toFloat() + dy * kotlin.math.cos(angle).toFloat()
        if (localX >= element.x && localX <= element.x + element.width && localY >= element.y && localY <= element.y + element.height) return element.id
    }
    // Connectors have a generous hit band because their visible stroke is narrow.
    for (element in document.elements.asReversed()) {
        if (!isLayerVisible(document, element) || element.kind != "connector") continue
        val from = connectorPoint(element, true, byId) ?: continue
        val to = connectorPoint(element, false, byId) ?: continue
        if (distanceToSegment(point, from, to) <= 20f) return element.id
    }
    return null
}

private fun connectorPoint(element: BoardElement, from: Boolean, elements: Map<String, BoardElement>): Offset? {
    val id = if (from) element.fromId else element.toId
    val side = if (from) element.fromSide else element.toSide
    if (id.isNotBlank()) {
        val target = elements[id] ?: return null
        return when (side) {
            "top" -> Offset(target.x + target.width / 2f, target.y)
            "right" -> Offset(target.x + target.width, target.y + target.height / 2f)
            "bottom" -> Offset(target.x + target.width / 2f, target.y + target.height)
            "left" -> Offset(target.x, target.y + target.height / 2f)
            else -> Offset(target.x + target.width / 2f, target.y + target.height / 2f)
        }
    }
    val x = if (from) element.freeFromX else element.freeToX
    val y = if (from) element.freeFromY else element.freeToY
    return if (x != null && y != null) Offset(x, y) else null
}

private fun distanceToSegment(point: Offset, start: Offset, end: Offset): Float {
    val dx = end.x - start.x
    val dy = end.y - start.y
    val length2 = dx * dx + dy * dy
    if (length2 <= 0.001f) return (point - start).getDistance()
    val t = (((point.x - start.x) * dx + (point.y - start.y) * dy) / length2).coerceIn(0f, 1f)
    return (point - Offset(start.x + t * dx, start.y + t * dy)).getDistance()
}
