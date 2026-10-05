package com.example.opale.notes

import android.graphics.BitmapFactory
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import com.example.opale.data.VaultRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Native note editor. Markdown remains the saved document; rendered blocks are
 * a view over that string and every edit is written back to the same source.
 */
@Composable
fun NoteEditor(
    content: String,
    path: String,
    repository: VaultRepository,
    sourceMode: Boolean,
    readOnly: Boolean,
    onChange: (String) -> Unit,
    onOpenLink: (String) -> Unit,
    onAddImage: () -> Unit,
) {
    var document by remember(path) { mutableStateOf(content) }
    var lastPublished by remember(path) { mutableStateOf(content) }
    var sourceValue by remember(path) { mutableStateOf(TextFieldValue(content, TextRange(content.length))) }
    var activeEdit by remember(path) { mutableStateOf<BlockEdit?>(null) }
    var selectedImageStart by remember(path) { mutableStateOf<Int?>(null) }
    var dragState by remember(path) { mutableStateOf<ImageDragState?>(null) }
    val slotBounds = remember(path) { mutableStateMapOf<Int, Rect>() }
    var listBounds by remember(path) { mutableStateOf<Rect?>(null) }
    val editFocus = remember(path) { FocusRequester() }
    val sourceFocus = remember(path) { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    val density = LocalDensity.current
    val compactScreen = LocalConfiguration.current.screenHeightDp < 450

    LaunchedEffect(path, content) {
        if (content != lastPublished) {
            document = content
            lastPublished = content
            sourceValue = TextFieldValue(content, TextRange(content.length))
            activeEdit = null
            selectedImageStart = null
        }
    }
    LaunchedEffect(path, sourceMode, readOnly) {
        if (sourceMode || readOnly) activeEdit = null
        if (sourceMode && !readOnly) sourceValue = TextFieldValue(document, TextRange(document.length))
    }
    LaunchedEffect(path, activeEdit?.start, sourceMode) {
        if (activeEdit != null && !sourceMode && !readOnly) {
            runCatching { editFocus.requestFocus() }
            keyboard?.show()
        } else if (sourceMode && !readOnly) {
            runCatching { sourceFocus.requestFocus() }
        }
    }

    fun publish(next: String) {
        if (next == document) return
        document = next
        lastPublished = next
        onChange(next)
    }

    fun updateEdit(value: TextFieldValue) {
        val edit = activeEdit ?: return
        val start = edit.start.coerceIn(0, document.length)
        val end = (start + edit.value.text.length).coerceIn(start, document.length)
        val next = document.replaceRange(start, end, value.text)
        activeEdit = edit.copy(value = value)
        publish(next)
    }

    val blockSource = activeEdit?.let { edit ->
        val start = edit.start.coerceIn(0, document.length)
        val end = (start + edit.value.text.length).coerceIn(start, document.length)
        document.replaceRange(start, end, edit.originalRaw)
    } ?: document
    val blocks = remember(blockSource) { parseNoteBlocks(blockSource) }
    val images = remember(blocks) { noteImages(blocks) }
    val slotOffsets = remember(blocks, document.length) {
        blocks.map { it.start } + listOf(document.length)
    }
    val touchSlopPx = with(density) { 72.dp.toPx() }

    fun stopEdit() {
        activeEdit = null
        selectedImageStart = null
        keyboard?.hide()
    }

    fun beginEdit(block: NoteBlock) {
        if (readOnly || sourceMode) return
        if (activeEdit != null) {
            stopEdit()
            return
        }
        activeEdit = BlockEdit(block.start, block.raw, TextFieldValue(block.raw, TextRange(block.raw.length)))
        selectedImageStart = null
    }

    fun applyTask(block: NoteBlock) {
        if (readOnly) return
        if (activeEdit != null) { stopEdit(); return }
        publish(editTask(document, block))
    }

    fun updateImage(image: NoteImage, update: (ImageOptions) -> ImageOptions) {
        if (readOnly || activeEdit != null) return
        publish(replaceImage(document, image, update))
        selectedImageStart = image.start
    }

    fun moveImageTo(image: NoteImage, slot: Int) {
        if (readOnly || activeEdit != null) return
        val offset = slotOffsets.getOrNull(slot) ?: document.length
        publish(moveImage(document, image, offset))
        selectedImageStart = null
    }

    fun refreshDropTarget(position: Offset) {
        val bounds = listBounds ?: return
        if (position.x < bounds.left - touchSlopPx || position.x > bounds.right + touchSlopPx ||
            position.y < bounds.top - touchSlopPx || position.y > bounds.bottom + touchSlopPx) {
            dragState = dragState?.copy(pointer = position, targetSlot = null)
            return
        }
        val target = slotBounds.entries.minByOrNull { (_, rect) -> abs(position.y - rect.center.y) }
        val nearest = target?.takeIf { abs(position.y - it.value.center.y) <= touchSlopPx }?.key
        dragState = dragState?.copy(pointer = position, targetSlot = nearest)
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal))
            .imePadding(),
    ) {
        if (!compactScreen) Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    when {
                        readOnly -> "Lecture"
                        sourceMode -> "Markdown source"
                        else -> "Aperçu en direct · touchez un bloc pour écrire"
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (!readOnly) {
                Button(
                    onClick = onAddImage,
                    modifier = Modifier.defaultMinSize(minWidth = 48.dp, minHeight = 48.dp),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 14.dp, vertical = 8.dp),
                ) { Text("+ Image") }
            }
        }

        if (sourceMode) {
            if (readOnly) {
                SelectionContainer {
                    Text(
                        document,
                        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
                        style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
                    )
                }
            } else {
                BasicTextField(
                    value = sourceValue,
                    onValueChange = { value ->
                        sourceValue = value
                        publish(value.text)
                    },
                    modifier = Modifier.fillMaxSize().focusRequester(sourceFocus).verticalScroll(rememberScrollState()).padding(16.dp),
                    textStyle = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace, color = MaterialTheme.colorScheme.onSurface),
                    cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                    keyboardOptions = KeyboardOptions.Default.copy(capitalization = KeyboardCapitalization.Sentences),
                )
            }
            return@Column
        }

        BoxWithConstraints(modifier = Modifier.fillMaxSize()) {
            val availableWidth = maxWidth - 28.dp
            val orderedImagesByBlock = images.groupBy { it.blockIndex }
            val scrollState = rememberScrollState()
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .onGloballyPositioned { listBounds = it.boundsInRoot() }
                    .verticalScroll(scrollState)
                    .padding(horizontal = 14.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(0.dp),
            ) {
                blocks.forEachIndexed { blockIndex, block ->
                    InsertionSlot(
                        slot = blockIndex,
                        bounds = slotBounds,
                        highlighted = dragState?.targetSlot == blockIndex,
                    )
                    if (activeEdit?.start == block.start && !readOnly) {
                        BlockEditor(
                            edit = activeEdit!!,
                            focusRequester = editFocus,
                            onChange = ::updateEdit,
                            onFormat = { transform -> updateEdit(transform(activeEdit!!.value)) },
                            onDone = ::stopEdit,
                        )
                    } else {
                        NoteBlockView(
                            block = block,
                            images = orderedImagesByBlock[blockIndex].orEmpty(),
                            path = path,
                            repository = repository,
                            readOnly = readOnly,
                            selectedImageStart = selectedImageStart,
                            availableWidth = availableWidth,
                            onTapBlock = { beginEdit(block) },
                            onTask = { applyTask(block) },
                            onOpenLink = onOpenLink,
                            onImageTap = { image ->
                                if (activeEdit != null) stopEdit() else selectedImageStart = image.start
                            },
                            onImageOptions = ::updateImage,
                            onMoveImage = ::moveImageTo,
                            onDragBegin = { image, rootPosition ->
                                if (!readOnly && activeEdit == null) {
                                    selectedImageStart = image.start
                                    dragState = ImageDragState(image, rootPosition, null)
                                }
                            },
                            onDragMove = ::refreshDropTarget,
                            onDragEnd = {
                                val drag = dragState
                                val slot = drag?.targetSlot
                                dragState = null
                                if (drag != null && slot != null) moveImageTo(drag.image, slot)
                            },
                            onDragCancel = { dragState = null },
                        )
                    }
                    Spacer(Modifier.height(4.dp))
                }
                InsertionSlot(
                    slot = blocks.size,
                    bounds = slotBounds,
                    highlighted = dragState?.targetSlot == blocks.size,
                )
            }
            dragState?.let { drag ->
                Surface(
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(start = 18.dp, top = 4.dp),
                    shape = RoundedCornerShape(50),
                    color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.96f),
                    shadowElevation = 5.dp,
                ) {
                    Text("Déplacer l’image · relâchez sur une séparation", modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp), color = MaterialTheme.colorScheme.onPrimaryContainer, style = MaterialTheme.typography.labelMedium)
                }
            }
        }
    }
}

private data class BlockEdit(val start: Int, val originalRaw: String, val value: TextFieldValue)
private data class ImageDragState(val image: NoteImage, val pointer: Offset, val targetSlot: Int?)

@Composable
private fun InsertionSlot(slot: Int, bounds: MutableMap<Int, Rect>, highlighted: Boolean) {
    val color = MaterialTheme.colorScheme.primary
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(14.dp)
            .onGloballyPositioned { bounds[slot] = it.boundsInRoot() },
        contentAlignment = Alignment.Center,
    ) {
        if (highlighted) Box(Modifier.fillMaxWidth().height(3.dp).clip(RoundedCornerShape(2.dp)).background(color))
    }
}

@Composable
private fun BlockEditor(
    edit: BlockEdit,
    focusRequester: FocusRequester,
    onChange: (TextFieldValue) -> Unit,
    onFormat: ((TextFieldValue) -> TextFieldValue) -> Unit,
    onDone: () -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary),
        tonalElevation = 1.dp,
    ) {
        Column(Modifier.padding(10.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                FormatButton("B", "Gras") { onFormat { value -> wrapSelection(value, "**", "**") } }
                FormatButton("I", "Italique") { onFormat { value -> wrapSelection(value, "*", "*") } }
                FormatButton("H1", "Titre 1") { onFormat { value -> prefixLines(value, "# ") } }
                FormatButton("•", "Liste") { onFormat { value -> prefixLines(value, "- ") } }
                FormatButton("☐", "Tâche") { onFormat { value -> prefixLines(value, "- [ ] ") } }
                FormatButton("</>", "Code") { onFormat { value -> wrapSelection(value, "`", "`") } }
                Button(
                    onClick = onDone,
                    modifier = Modifier.defaultMinSize(minWidth = 48.dp, minHeight = 48.dp),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 10.dp, vertical = 6.dp),
                ) { Text("Terminé") }
            }
            Spacer(Modifier.height(8.dp))
            BasicTextField(
                value = edit.value,
                onValueChange = onChange,
                modifier = Modifier.fillMaxWidth().focusRequester(focusRequester).padding(horizontal = 6.dp, vertical = 4.dp),
                textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
                cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                keyboardOptions = KeyboardOptions.Default.copy(capitalization = KeyboardCapitalization.Sentences),
            )
        }
    }
}

@Composable
private fun FormatButton(label: String, description: String, onClick: () -> Unit) {
    TextButton(
        onClick = onClick,
        modifier = Modifier.defaultMinSize(minWidth = 48.dp, minHeight = 48.dp).semantics { contentDescription = description },
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 10.dp, vertical = 6.dp),
    ) { Text(label, style = MaterialTheme.typography.labelLarge, maxLines = 1) }
}

private fun wrapSelection(value: TextFieldValue, left: String, right: String): TextFieldValue {
    val text = value.text
    val start = value.selection.min.coerceIn(0, text.length)
    val end = value.selection.max.coerceIn(start, text.length)
    val chosen = text.substring(start, end)
    val output = text.substring(0, start) + left + chosen + right + text.substring(end)
    val selection = if (start == end) TextRange(start + left.length, start + left.length) else TextRange(start + left.length, end + left.length)
    return value.copy(text = output, selection = selection)
}

private fun prefixLines(value: TextFieldValue, prefix: String): TextFieldValue {
    val text = value.text
    val start = value.selection.min.coerceIn(0, text.length)
    val end = value.selection.max.coerceIn(start, text.length)
    val lineStart = text.lastIndexOf('\n', (start - 1).coerceAtLeast(0)).let { if (start == 0) 0 else it + 1 }
    val lineEnd = text.indexOf('\n', end).let { if (it < 0) text.length else it }
    val selected = text.substring(lineStart, lineEnd)
    val prefixed = selected.lineSequence().joinToString("\n") { line -> if (line.startsWith(prefix)) line.removePrefix(prefix) else prefix + line }
    val output = text.substring(0, lineStart) + prefixed + text.substring(lineEnd)
    val delta = prefixed.length - selected.length
    return value.copy(text = output, selection = TextRange((start + if (lineStart <= start) prefix.length else 0).coerceAtMost(output.length), (end + delta).coerceIn(lineStart, output.length)))
}

@Composable
private fun NoteBlockView(
    block: NoteBlock,
    images: List<NoteImage>,
    path: String,
    repository: VaultRepository,
    readOnly: Boolean,
    selectedImageStart: Int?,
    availableWidth: Dp,
    onTapBlock: () -> Unit,
    onTask: () -> Unit,
    onOpenLink: (String) -> Unit,
    onImageTap: (NoteImage) -> Unit,
    onImageOptions: (NoteImage, (ImageOptions) -> ImageOptions) -> Unit,
    onMoveImage: (NoteImage, Int) -> Unit,
    onDragBegin: (NoteImage, Offset) -> Unit,
    onDragMove: (Offset) -> Unit,
    onDragEnd: () -> Unit,
    onDragCancel: () -> Unit,
) {
    val imageByStart = images.associateBy { it.start - block.start }
    val blockAction = if (readOnly) Modifier else Modifier.clickable(onClick = onTapBlock)
    when (block.kind) {
        BlockKind.TASK -> {
            val task = taskBody(block.raw)
            Row(
                modifier = blockAction.fillMaxWidth().padding(vertical = 3.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    modifier = Modifier.sizeIn(minWidth = 48.dp, minHeight = 48.dp)
                        .then(if (readOnly) Modifier else Modifier.clickable(onClick = onTask)),
                    contentAlignment = Alignment.Center,
                ) { Text(if (block.taskChecked) "☑" else "☐", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.primary) }
                Text(
                    text = task.second,
                    modifier = Modifier.weight(1f).clickable(enabled = !readOnly, onClick = onTapBlock).padding(vertical = 10.dp),
                    style = if (block.taskChecked) MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurfaceVariant) else MaterialTheme.typography.bodyLarge,
                )
            }
        }
        BlockKind.HEADING -> {
            val annotated = buildInlineText(block.body, onOpenLink)
            Text(
                text = annotated,
                modifier = Modifier.fillMaxWidth().clickable(onClick = onTapBlock).padding(top = if (block.headingLevel == 1) 12.dp else 6.dp, bottom = 4.dp),
                style = headingStyle(block.headingLevel).copy(color = MaterialTheme.colorScheme.onSurface),
            )
        }
        BlockKind.CODE, BlockKind.FRONTMATTER, BlockKind.UNSUPPORTED -> {
            val code = block.kind == BlockKind.CODE || block.kind == BlockKind.FRONTMATTER
            Surface(
                modifier = Modifier.fillMaxWidth().then(if (readOnly) Modifier else Modifier.clickable(onClick = onTapBlock)),
                shape = RoundedCornerShape(10.dp),
                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = if (code) 0.72f else 0.42f),
            ) {
                Text(
                    block.raw,
                    modifier = Modifier.padding(12.dp),
                    style = MaterialTheme.typography.bodyMedium.copy(
                        fontFamily = if (code || block.kind == BlockKind.UNSUPPORTED) FontFamily.Monospace else FontFamily.Default,
                        color = MaterialTheme.colorScheme.onSurface,
                    ),
                )
            }
        }
        BlockKind.LIST -> {
            val annotated = buildInlineText(block.body, onOpenLink)
            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
                verticalAlignment = Alignment.Top,
            ) {
                Text(block.listMarker, modifier = Modifier.width(32.dp).padding(top = 5.dp), color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodyLarge)
                Text(
                    text = annotated,
                    modifier = Modifier.weight(1f).clickable(onClick = onTapBlock).padding(vertical = 3.dp),
                    style = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
                )
            }
        }
        BlockKind.PARAGRAPH -> {
            if (images.isEmpty()) {
                val annotated = buildInlineText(block.raw, onOpenLink)
                Text(
                    text = annotated,
                    modifier = Modifier.fillMaxWidth().clickable(onClick = onTapBlock).padding(vertical = 3.dp),
                    style = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface, lineHeight = 25.sp),
                )
            } else {
                BlockImageContent(
                    block = block,
                    imageByStart = imageByStart,
                    repository = repository,
                    path = path,
                    readOnly = readOnly,
                    selectedImageStart = selectedImageStart,
                    availableWidth = availableWidth,
                    onTapBlock = onTapBlock,
                    onOpenLink = onOpenLink,
                    onImageTap = onImageTap,
                    onImageOptions = onImageOptions,
                    onMoveImage = onMoveImage,
                    onDragBegin = onDragBegin,
                    onDragMove = onDragMove,
                    onDragEnd = onDragEnd,
                    onDragCancel = onDragCancel,
                )
            }
        }
    }
}

private fun taskBody(raw: String): Pair<Boolean, String> {
    val match = Regex("^\\s*[-+*]\\s+\\[([ xX])]\\s+(.*)$").matchEntire(raw)
    return (match?.groupValues?.get(1)?.lowercase() == "x") to (match?.groupValues?.get(2) ?: raw)
}

@Composable
private fun BlockImageContent(
    block: NoteBlock,
    imageByStart: Map<Int, NoteImage>,
    repository: VaultRepository,
    path: String,
    readOnly: Boolean,
    selectedImageStart: Int?,
    availableWidth: Dp,
    onTapBlock: () -> Unit,
    onOpenLink: (String) -> Unit,
    onImageTap: (NoteImage) -> Unit,
    onImageOptions: (NoteImage, (ImageOptions) -> ImageOptions) -> Unit,
    onMoveImage: (NoteImage, Int) -> Unit,
    onDragBegin: (NoteImage, Offset) -> Unit,
    onDragMove: (Offset) -> Unit,
    onDragEnd: () -> Unit,
    onDragCancel: () -> Unit,
) {
    val ordered = imageByStart.values.sortedBy { it.start }
    val raw = block.raw
    Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
        var cursor = 0
        ordered.forEach { image ->
            val localStart = image.start - block.start
            val localEnd = image.endExclusive - block.start
            if (localStart > cursor) {
                val fragment = raw.substring(cursor, localStart)
                val annotated = buildInlineText(fragment, onOpenLink)
                Text(
                    text = annotated,
                    modifier = Modifier.fillMaxWidth().clickable(onClick = onTapBlock).padding(vertical = 2.dp),
                    style = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface, lineHeight = 25.sp),
                )
            }
            NoteImageCard(
                image = image,
                path = path,
                repository = repository,
                readOnly = readOnly,
                selected = selectedImageStart == image.start,
                availableWidth = availableWidth,
                onTap = { onImageTap(image) },
                onOptions = { update -> onImageOptions(image, update) },
                onMove = { slot -> onMoveImage(image, slot) },
                onDragBegin = { position -> onDragBegin(image, position) },
                onDragMove = onDragMove,
                onDragEnd = onDragEnd,
                onDragCancel = onDragCancel,
            )
            cursor = localEnd
        }
        if (cursor < raw.length) {
            val fragment = raw.substring(cursor)
            val annotated = buildInlineText(fragment, onOpenLink)
            Text(
                text = annotated,
                modifier = Modifier.fillMaxWidth().clickable(onClick = onTapBlock).padding(vertical = 2.dp),
                style = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface, lineHeight = 25.sp),
            )
        }
    }
}

@Composable
private fun NoteImageCard(
    image: NoteImage,
    path: String,
    repository: VaultRepository,
    readOnly: Boolean,
    selected: Boolean,
    availableWidth: Dp,
    onTap: () -> Unit,
    onOptions: ((ImageOptions) -> ImageOptions) -> Unit,
    onMove: (Int) -> Unit,
    onDragBegin: (Offset) -> Unit,
    onDragMove: (Offset) -> Unit,
    onDragEnd: () -> Unit,
    onDragCancel: () -> Unit,
) {
    val resolvedPath = remember(path, image.target) { resolveVaultImagePath(path, image.target) }
    val bitmap by produceState<ImageBitmap?>(initialValue = null, repository, resolvedPath) {
        value = null
        if (resolvedPath != null) {
            value = withContext(Dispatchers.IO) {
                runCatching {
                    val bytes = repository.readBytes(resolvedPath)
                    decodeNoteBitmap(bytes, 2048)?.asImageBitmap()
                }.getOrNull()
            }
        }
    }
    var coordinates by remember(image.key) { mutableStateOf<LayoutCoordinates?>(null) }
    var dragRoot by remember(image.key) { mutableStateOf<Offset?>(null) }
    val alignment = when (image.options.alignment) {
        ImageAlignment.LEFT, ImageAlignment.INLINE -> Alignment.CenterStart
        ImageAlignment.CENTER -> Alignment.Center
        ImageAlignment.RIGHT -> Alignment.CenterEnd
    }
    val width = image.options.width?.let { minOf(availableWidth, it.dp) } ?: availableWidth

    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .onGloballyPositioned { coordinates = it }
                .then(
                    if (readOnly) Modifier else Modifier
                        .clickable(onClick = onTap)
                        .pointerInput(image.key) {
                            detectDragGesturesAfterLongPress(
                                onDragStart = { local ->
                                    val root = coordinates?.localToRoot(local)
                                    dragRoot = root
                                    if (root != null) onDragBegin(root)
                                },
                                onDrag = { change, delta ->
                                    change.consume()
                                    dragRoot = dragRoot?.plus(delta)
                                    dragRoot?.let(onDragMove)
                                },
                                onDragEnd = {
                                    dragRoot = null
                                    onDragEnd()
                                },
                                onDragCancel = {
                                    dragRoot = null
                                    onDragCancel()
                                },
                            )
                        },
                ),
            contentAlignment = alignment,
        ) {
            if (bitmap != null) {
                androidx.compose.foundation.Image(
                    bitmap = bitmap!!,
                    contentDescription = image.options.alt.ifBlank { image.target.substringAfterLast('/') },
                    modifier = Modifier
                        .width(width)
                        .clip(RoundedCornerShape(8.dp))
                        .then(if (selected) Modifier.background(MaterialTheme.colorScheme.primary.copy(alpha = 0.08f)) else Modifier),
                    contentScale = androidx.compose.ui.layout.ContentScale.Fit,
                )
            } else {
                Surface(
                    modifier = Modifier.width(minOf(width, 320.dp)).height(120.dp),
                    shape = RoundedCornerShape(8.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant,
                    border = BorderStroke(1.dp, if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant),
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        if (resolvedPath != null && bitmap == null) {
                            Text("Image indisponible\n${image.target.substringAfterLast('/')}", modifier = Modifier.padding(12.dp), style = MaterialTheme.typography.bodySmall)
                        } else {
                            Text("Image web non chargée\n${image.target}", modifier = Modifier.padding(12.dp), style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
        }
        if (selected && !readOnly) {
            Row(
                modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(top = 3.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                ImageAction("S", "Petite") { onOptions { it.copy(width = (availableWidth.value * 0.25f).roundToInt().coerceAtLeast(48)) } }
                ImageAction("M", "Moyenne") { onOptions { it.copy(width = (availableWidth.value * 0.5f).roundToInt().coerceAtLeast(48)) } }
                ImageAction("L", "Grande") { onOptions { it.copy(width = availableWidth.value.roundToInt().coerceAtLeast(48)) } }
                ImageAction("1:1", "Taille d’origine") { onOptions { it.copy(width = null, height = null) } }
                Spacer(Modifier.width(4.dp))
                ImageAction("Texte", "Alignée au texte") { onOptions { it.copy(alignment = ImageAlignment.INLINE) } }
                ImageAction("Gauche", "À gauche") { onOptions { it.copy(alignment = ImageAlignment.LEFT) } }
                ImageAction("Centre", "Centrée") { onOptions { it.copy(alignment = ImageAlignment.CENTER) } }
                ImageAction("Droite", "À droite") { onOptions { it.copy(alignment = ImageAlignment.RIGHT) } }
                Spacer(Modifier.width(4.dp))
                ImageAction("↑", "Déplacer vers le haut") { onMove((image.blockIndex - 1).coerceAtLeast(0)) }
                ImageAction("↓", "Déplacer vers le bas") { onMove(image.blockIndex + 2) }
            }
        }
    }
}

@Composable
private fun ImageAction(label: String, description: String, onClick: () -> Unit) {
    TextButton(
        onClick = onClick,
        modifier = Modifier.defaultMinSize(minWidth = 48.dp, minHeight = 48.dp).semantics { contentDescription = description },
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 10.dp, vertical = 6.dp),
    ) { Text(label, style = MaterialTheme.typography.labelMedium, maxLines = 1) }
}

private fun decodeNoteBitmap(bytes: ByteArray, maxDimension: Int): android.graphics.Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    var sample = 1
    while (bounds.outWidth / sample > maxDimension || bounds.outHeight / sample > maxDimension) sample *= 2
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
}

@Composable
private fun headingStyle(level: Int): TextStyle = when (level) {
    1 -> MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.Bold)
    2 -> MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.SemiBold)
    3 -> MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.SemiBold)
    else -> MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold)
}

@Composable
private fun buildInlineText(text: String, onOpenLink: (String) -> Unit): AnnotatedString {
    val tokens = Regex("\\[\\[([^]\\n]+)]]|\\[([^]\\n]+)]\\(([^)\\n]+)\\)|\\*\\*([^*]+)\\*\\*|`([^`]+)`|(?<!\\*)\\*([^*]+)\\*")
    val linkColor = MaterialTheme.colorScheme.primary
    return buildAnnotatedString {
        var last = 0
        tokens.findAll(text).forEach { match ->
            append(text.substring(last, match.range.first))
            val value = match.value
            when {
                value.startsWith("[[") -> {
                    val (target, label) = wikiLinkTarget(match.groupValues[1])
                    withLink(
                        LinkAnnotation.Clickable(
                            tag = target,
                            styles = TextLinkStyles(SpanStyle(color = linkColor, textDecoration = TextDecoration.Underline)),
                            linkInteractionListener = androidx.compose.ui.text.LinkInteractionListener {
                                onOpenLink(target)
                            },
                        ),
                    ) {
                        append(label.ifBlank { target.substringAfterLast('/').substringAfterLast('#') })
                    }
                }
                value.startsWith("[") -> {
                    val label = match.groupValues[2]
                    val target = match.groupValues[3]
                    withLink(
                        LinkAnnotation.Clickable(
                            tag = target,
                            styles = TextLinkStyles(SpanStyle(color = linkColor, textDecoration = TextDecoration.Underline)),
                            linkInteractionListener = androidx.compose.ui.text.LinkInteractionListener {
                                onOpenLink(target)
                            },
                        ),
                    ) { append(label) }
                }
                value.startsWith("**") -> withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(match.groupValues[4]) }
                value.startsWith('`') -> withStyle(SpanStyle(fontFamily = FontFamily.Monospace, background = MaterialTheme.colorScheme.surfaceVariant)) { append(match.groupValues[5]) }
                else -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(match.groupValues[6]) }
            }
            last = match.range.last + 1
        }
        append(text.substring(last))
    }
}
