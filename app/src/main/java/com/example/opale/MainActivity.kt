package com.example.opale

import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*
import androidx.core.content.FileProvider
import androidx.lifecycle.ViewModelProvider
import com.example.opale.board.BoardEditor
import com.example.opale.notes.NoteEditor
import com.example.opale.data.VaultTextLogic.extractWikiLinks
import com.example.opale.ui.theme.OpaleTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.math.*

class MainActivity : ComponentActivity() {
    private lateinit var model: AppModel
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        model = ViewModelProvider(this)[AppModel::class.java]
        enableEdgeToEdge()
        setContent {
            OpaleTheme(model.theme) {
                val density = LocalDensity.current
                CompositionLocalProvider(LocalDensity provides Density(density.density, density.fontScale * model.fontScale)) {
                    OpaleApp(model)
                }
            }
        }
    }
    override fun onStop() { if(::model.isInitialized) model.saveNow(); super.onStop() }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OpaleApp(model: AppModel) {
    val context = LocalContext.current
    val compactScreen = LocalConfiguration.current.screenHeightDp < 450
    val compactTyping = compactScreen && WindowInsets.ime.getBottom(LocalDensity.current) > 0
    val scope = rememberCoroutineScope()
    var page by rememberSaveable { mutableIntStateOf(0) }
    var folder by rememberSaveable { mutableStateOf("") }
    var query by rememberSaveable { mutableStateOf("") }
    var mode by rememberSaveable { mutableStateOf("live") }
    var dialog by remember { mutableStateOf("") }
    var input by remember { mutableStateOf("") }
    var more by remember { mutableStateOf(false) }
    var attachment by remember { mutableStateOf<String?>(null) }
    var exportSnapshot by remember { mutableStateOf<Pair<String,String>?>(null) }
    val expandedProjects = remember { mutableStateMapOf<String, Boolean>() }
    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
        if(uri != null) {
            try {
                context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
                model.switchVault(uri); folder = ""
            } catch(e: Exception) { model.error = e.message }
        }
    }
    val imagePicker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> uri?.let { model.importImage(it) } }
    val importPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if(uri != null) {
            val name = context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME),null,null,null)?.use { cursor ->
                if(cursor.moveToFirst()) cursor.getString(0) else "Note importée.md"
            } ?: "Note importée.md"
            model.importDocument(uri,name)
        }
    }
    val exportPicker = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        val snapshot = exportSnapshot
        if(uri != null && snapshot != null) scope.launch {
            try { withContext(Dispatchers.IO) { context.contentResolver.openOutputStream(uri, "wt")!!.use { it.write(snapshot.second.toByteArray(Charsets.UTF_8)) } } }
            catch(e: Exception) { model.error = e.message }
        }
    }
    val doc = model.document
    BackHandler((page == 0 && doc != null) || attachment != null || folder.isNotEmpty()) {
        when { attachment != null -> attachment = null; page == 0 && doc != null -> model.close(); else -> folder = folder.substringBeforeLast('/', "") }
    }
    val addPhoto = { imagePicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }
    val openPath: (String) -> Unit = { path ->
        if(path.endsWith(".md",true) || path.endsWith(".canvas",true)) model.open(path) else attachment = path
    }
    Row(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)) {
        OpaleRail(page = page, onPage = { page = it; attachment = null })
        VerticalDivider()
        ProjectSidebar(
            entries = model.entries,
            selectedFolder = folder,
            selectedDocument = doc?.path,
            expanded = expandedProjects,
            onFolder = { path -> page = 0; folder = path; attachment = null },
            onOpen = { path -> page = 0; openPath(path) },
            onCreate = { kind -> input = ""; dialog = kind },
            onGraph = { page = 3; attachment = null }
        )
        VerticalDivider()
        Column(Modifier.weight(1f).fillMaxHeight().imePadding()) {
            if(!compactTyping) TopAppBar(title = {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    if(doc == null || page != 0) Image(painterResource(R.drawable.opale_mark),null,Modifier.size(32.dp))
                    Column {
                        Text(if(page == 0) doc?.path?.substringAfterLast('/')?.substringBeforeLast('.') ?: "Opale" else listOf("Notes", "Recherche", "Moodboards", "Graphe", "Réglages")[page],maxLines=1,overflow=TextOverflow.Ellipsis)
                        Text(if(doc == null || page != 0) model.vaultName else if(model.saving) "Enregistrement…" else if(model.conflict) "Conflit à résoudre" else if(doc.dirty) "Modifications en cours" else "Enregistré",style=MaterialTheme.typography.labelSmall)
                    }
                }
            }, navigationIcon = {
                if(page == 0 && (doc != null || attachment != null)) TextButton(onClick={ if(attachment != null) attachment = null else model.close() }) { Text("Retour") }
            }, actions = {
                Box {
                    TextButton(onClick={ more = true }) { Text("Actions") }
                    DropdownMenu(expanded=more,onDismissRequest={more=false}) {
                        fun action(label:String, run:()->Unit): @Composable ()->Unit = {
                            DropdownMenuItem(text={Text(label)},onClick={more=false;run()})
                        }
                        if(doc == null || page != 0) {
                            action("Nouvelle note") { input="";dialog="note" }()
                            action("Nouveau moodboard") { input="";dialog="board" }()
                            action("Nouveau projet") { input="";dialog="project" }()
                            action("Nouveau dossier") { input="";dialog="folder" }()
                            action("Note du jour") { model.daily() }()
                            action("Ouvrir un coffre") { filePicker.launch(null) }()
                            action("Importer un document") { importPicker.launch(arrayOf("text/*","application/json","application/octet-stream")) }()
                            action("Actualiser") { model.refresh() }()
                        } else {
                            action("Enregistrer maintenant") { model.saveNow() }()
                            action(if(doc.path in model.bookmarks) "Retirer le signet" else "Ajouter un signet") { model.toggleBookmark(doc.path) }()
                            action("Dupliquer") { model.duplicate() }()
                            action("Insérer une image") { addPhoto() }()
                            action("Renommer / déplacer") { input=doc.path;dialog="rename" }()
                            if(doc.path.endsWith(".md",true)) {
                                action("Liens et propriétés") { dialog="links" }()
                                action("Propriétés YAML") {
                                    input=Regex("^---\\r?\\n([\\s\\S]*?)\\r?\\n---(?:\\r?\\n|$)").find(doc.content)?.groupValues?.get(1) ?: "tags: []"
                                    dialog="properties"
                                }()
                            }
                            action("Exporter le fichier") { exportSnapshot=doc.path to doc.content;exportPicker.launch(doc.path.substringAfterLast('/')) }()
                            action("Partager") { scope.launch { try { shareDocument(context,doc.path,doc.content.toByteArray()) } catch(e:Exception) { model.error=e.message } } }()
                            action("Mettre à la corbeille") { dialog="trash" }()
                        }
                    }
                }
            })
            if(page == 0 && doc != null && !compactScreen && model.recent.size > 1) WorkspaceTabs(model.recent, doc.path, { model.open(it) }, { model.close() })
            Column(Modifier.fillMaxSize()) {
            if(model.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            if(model.conflict && doc != null) Surface(color=MaterialTheme.colorScheme.errorContainer) {
                Column(Modifier.fillMaxWidth().padding(12.dp)) {
                    Text("Le document a changé ou son écriture a échoué. Votre brouillon est conservé.")
                    Row(Modifier.horizontalScroll(rememberScrollState())) {
                        TextButton(onClick={dialog="force"}) {Text("Garder mon brouillon")}
                        TextButton(onClick={dialog="reload"}) {Text("Recharger le fichier")}
                        TextButton(onClick={exportSnapshot=doc.path to doc.content;exportPicker.launch(doc.path.substringAfterLast('/'))}) {Text("Exporter le brouillon")}
                    }
                }
            }
            when {
                attachment != null -> AttachmentView(attachment!!,model)
                doc != null && page == 0 -> {
                    key(doc.path) {
                        if(doc.path.endsWith(".canvas",true)) Box(Modifier.weight(1f)) { BoardEditor(doc.content,doc.path,model.repository,model::change,model::followLink,addPhoto) }
                        else {
                            if(!compactTyping) Row(Modifier.padding(horizontal=16.dp).horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                                listOf("live" to "Écrire","reading" to "Lire","source" to "Source").forEach { (value,label) ->
                                    FilterChip(selected=mode==value,onClick={mode=value},label={Text(label)})
                                }
                            }
                            Box(Modifier.weight(1f)) {
                                NoteEditor(doc.content,doc.path,model.repository,mode=="source",mode=="reading",model::change,model::followLink,addPhoto)
                            }
                        }
                    }
                }
                page == 4 -> SettingsView(model,{filePicker.launch(null)},{model.switchVault(null)})
                page == 3 -> GraphView(model.allTexts,model::open)
                page == 1 -> {
                    OutlinedTextField(query,{query=it;model.search(it)},label={Text("Rechercher dans le coffre")},singleLine=true,modifier=Modifier.fillMaxWidth().padding(16.dp))
                    Text("Expressions : mots, \"phrase\", tag:, file:, path:, /regex/, OR, -exclu",style=MaterialTheme.typography.bodySmall,modifier=Modifier.padding(horizontal=16.dp))
                    LazyColumn(Modifier.weight(1f),contentPadding=PaddingValues(16.dp)) {
                        items(model.results,key={it.path}) { hit -> ListItem(headlineContent={Text(hit.path)},supportingContent={Text(hit.excerpt,maxLines=3)},modifier=Modifier.clickable {model.open(hit.path)}) }
                    }
                }
                else -> {
                    if(page==0 && model.bookmarks.isNotEmpty()) {
                        Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal=16.dp),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                            model.bookmarks.filter { path -> model.entries.any { it.path==path } }.forEach { path -> AssistChip(onClick={model.open(path)},label={Text(path.substringAfterLast('/'))}) }
                        }
                    }
                    Row(Modifier.fillMaxWidth().padding(horizontal=16.dp),verticalAlignment=Alignment.CenterVertically) {
                        Text(if(page==2) "Vos moodboards" else if(folder.isEmpty()) "Votre coffre" else folder,style=MaterialTheme.typography.titleMedium,modifier=Modifier.weight(1f))
                        if(folder.isNotEmpty() && page==0) TextButton(onClick={folder=folder.substringBeforeLast('/',"")}) {Text("Parent")}
                    }
                    val listed = model.entries.filter {
                        if(page==2) !it.isDirectory && it.path.endsWith(".canvas",true)
                        else it.path.substringBeforeLast('/',"")==folder
                    }.sortedWith(compareByDescending<com.example.opale.data.VaultEntry> {it.isDirectory}.thenBy {it.name.lowercase()})
                    if(listed.isEmpty()) Box(Modifier.fillMaxSize().padding(32.dp),contentAlignment=Alignment.Center) {
                        Column(horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(12.dp)) {
                            Text(if(page==2) "Un espace pour vos idées" else "Ce dossier est prêt pour vos notes",style=MaterialTheme.typography.titleLarge)
                            Text(if(page==2) "Créez un moodboard et déplacez la vue avec un doigt." else "Ajoutez une note, une image ou ouvrez un coffre existant.")
                            Button(onClick={input="";dialog=if(page==2) "board" else "note"}) {Text("Créer")}
                        }
                    } else LazyColumn(Modifier.weight(1f),contentPadding=PaddingValues(start=12.dp,end=12.dp,bottom=88.dp),verticalArrangement=Arrangement.spacedBy(4.dp)) {
                        items(listed,key={it.path}) { item ->
                            Surface(shape=RoundedCornerShape(12.dp),color=MaterialTheme.colorScheme.surface) {
                                ListItem(headlineContent={Text(item.name.substringBeforeLast('.',item.name),maxLines=1,overflow=TextOverflow.Ellipsis)},supportingContent={Text(if(item.isDirectory) "Dossier" else if(item.path.endsWith(".canvas",true)) "Moodboard" else if(item.path.endsWith(".md",true)) "Note Markdown" else "Pièce jointe")},leadingContent={AppGlyph(if(item.isDirectory) 5 else if(item.path.endsWith(".canvas",true)) 2 else 0)},modifier=Modifier.clickable {if(item.isDirectory) folder=item.path else openPath(item.path)})
                            }
                        }
                    }
                }
            }
        }
            }
        }
    if(dialog in listOf("note","board","folder","project","rename","properties")) {
        val title = when(dialog) {"board"->"Nouveau moodboard";"project"->"Nouveau projet";"folder"->"Nouveau dossier";"rename"->"Renommer / déplacer";"properties"->"Propriétés YAML";else->"Nouvelle note"}
        AlertDialog(onDismissRequest={dialog=""},title={Text(title)},text={OutlinedTextField(input,{input=it},label={Text(if(dialog=="properties") "Métadonnées" else "Nom ou chemin relatif")},singleLine=dialog!="properties",minLines=if(dialog=="properties") 5 else 1)},confirmButton={TextButton(enabled=input.isNotBlank(),onClick={
            when(dialog) {
                "project"->model.folder(input)
                "folder"->model.folder(if(folder.isEmpty()) input else folder+"/"+input)
                "rename"->model.rename(input)
                "properties"->{if(doc!=null) {val body=doc.content.replaceFirst(Regex("^---\\r?\\n[\\s\\S]*?\\r?\\n---(?:\\r?\\n|$)"),"");model.change("---\n"+input.trim()+"\n---\n\n"+body)}}
                else->model.create(input,dialog=="board",if(page==0) folder else "")
            };dialog=""
        }) {Text("Valider")}},dismissButton={TextButton(onClick={dialog=""}) {Text("Annuler")}})
    }
    if(dialog in listOf("trash","reload","force")) AlertDialog(onDismissRequest={dialog=""},title={Text(when(dialog){"trash"->"Mettre à la corbeille ?";"reload"->"Recharger le fichier ?";else->"Remplacer la version du coffre ?"})},text={Text(when(dialog){"trash"->"Le fichier sera conservé dans la corbeille du coffre.";"reload"->"Le brouillon local sera remplacé par le document du coffre. Vous pouvez l’exporter auparavant.";else->"Cette action écrit votre brouillon à la place du document actuellement enregistré."})},confirmButton={TextButton(onClick={when(dialog){"trash"->model.trash();"reload"->model.reload();else->model.saveNow(true)};dialog=""}) {Text("Confirmer")}},dismissButton={TextButton(onClick={dialog=""}) {Text("Annuler")}})
    if(dialog=="links" && doc!=null) {
        val stem=doc.path.substringAfterLast('/').substringBeforeLast('.')
        val incoming=model.allTexts.filter { (path,body)->path!=doc.path && extractWikiLinks(body).any {it.substringBefore('#').substringAfterLast('/').removeSuffix(".md").equals(stem,true)} }.keys
        val outgoing=extractWikiLinks(doc.content).distinct()
        AlertDialog(onDismissRequest={dialog=""},title={Text("Liens de la note")},text={Column(Modifier.verticalScroll(rememberScrollState())) {
            Text("Rétroliens",fontWeight=FontWeight.Bold)
            if(incoming.isEmpty()) Text("Aucune autre note ne pointe ici.")
            incoming.forEach {path->TextButton(onClick={dialog="";model.open(path)}) {Text(path)}}
            Text("Liens sortants",fontWeight=FontWeight.Bold)
            outgoing.forEach {path->TextButton(onClick={dialog="";model.followLink(path)}) {Text(path)}}
            val tags=Regex("(?<![\\w#])#([\\p{L}\\d_/-]+)").findAll(doc.content).map {it.groupValues[1]}.distinct().toList()
            if(tags.isNotEmpty()) {Text("Étiquettes",fontWeight=FontWeight.Bold);tags.forEach { tag->TextButton(onClick={dialog="";model.close();query="tag:"+tag;model.search(query);page=1}) {Text("#"+tag)}}}
        }},confirmButton={TextButton(onClick={dialog=""}) {Text("Fermer")}})
    }
    model.error?.let { message -> AlertDialog(onDismissRequest={model.error=null},title={Text("Opale")},text={Text(message)},confirmButton={TextButton(onClick={model.error=null}) {Text("OK")}}) }
}

@Composable
private fun OpaleRail(page:Int,onPage:(Int)->Unit) {
    val items = listOf("Notes", "Recherche", "Moodboards", "Graphe", "Réglages")
    Column(
        Modifier.width(64.dp).fillMaxHeight().padding(vertical=8.dp),
        horizontalAlignment=Alignment.CenterHorizontally,
        verticalArrangement=Arrangement.spacedBy(6.dp)
    ) {
        Image(painterResource(R.drawable.opale_mark), "Opale", Modifier.size(36.dp).padding(bottom=4.dp))
        items.forEachIndexed { index, label ->
            val selected = page == index
            Surface(
                modifier=Modifier.size(48.dp).semantics { contentDescription = label }.clickable { onPage(index) },
                shape=RoundedCornerShape(14.dp),
                color=if(selected) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent
            ) { Box(contentAlignment=Alignment.Center) { AppGlyph(index) } }
        }
        Spacer(Modifier.weight(1f))
    }
}

private data class ProjectTreeItem(val entry:com.example.opale.data.VaultEntry,val depth:Int)

private fun projectTree(entries:List<com.example.opale.data.VaultEntry>, expanded:Map<String,Boolean>):List<ProjectTreeItem> {
    val byParent=entries.groupBy { it.path.substringBeforeLast('/', "") }
    val result=mutableListOf<ProjectTreeItem>()
    fun walk(parent:String,depth:Int) {
        val children=byParent[parent].orEmpty().sortedWith(compareByDescending<com.example.opale.data.VaultEntry>{it.isDirectory}.thenBy {it.name.lowercase()})
        children.forEach { entry ->
            result += ProjectTreeItem(entry,depth)
            if(entry.isDirectory && (expanded[entry.path] ?: depth == 0)) walk(entry.path,depth+1)
        }
    }
    walk("",0)
    return result
}

@Composable
private fun ProjectSidebar(
    entries:List<com.example.opale.data.VaultEntry>,
    selectedFolder:String,
    selectedDocument:String?,
    expanded:MutableMap<String,Boolean>,
    onFolder:(String)->Unit,
    onOpen:(String)->Unit,
    onCreate:(String)->Unit,
    onGraph:()->Unit,
) {
    var createMenu by remember { mutableStateOf(false) }
    val rows=projectTree(entries,expanded)
    Column(Modifier.widthIn(min=208.dp,max=272.dp).fillMaxHeight().background(MaterialTheme.colorScheme.surfaceContainerLow)) {
        Row(Modifier.fillMaxWidth().heightIn(min=56.dp).padding(start=16.dp,end=4.dp),verticalAlignment=Alignment.CenterVertically) {
            Text("Projets",style=MaterialTheme.typography.titleMedium,modifier=Modifier.weight(1f))
            Box {
                IconButton(onClick={createMenu=true},modifier=Modifier.semantics { contentDescription="Créer dans le coffre" }) { AppGlyph(6) }
                DropdownMenu(expanded=createMenu,onDismissRequest={createMenu=false}) {
                    listOf("Nouvelle note" to "note", "Nouveau moodboard" to "board", "Nouveau projet" to "project", "Nouveau dossier" to "folder").forEach {(label,kind)->
                        DropdownMenuItem(text={Text(label)},leadingIcon={AppGlyph(when(kind){"board"->2;"note"->0;else->5})},onClick={createMenu=false;onCreate(kind)})
                    }
                    HorizontalDivider()
                    DropdownMenuItem(text={Text("Ouvrir le graphe")},leadingIcon={AppGlyph(3)},onClick={createMenu=false;onGraph()})
                }
            }
        }
        HorizontalDivider()
        Row(
            Modifier.fillMaxWidth().heightIn(min=48.dp).padding(horizontal=8.dp).clip(RoundedCornerShape(10.dp))
                .background(if(selectedFolder.isEmpty() && selectedDocument==null) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent)
                .clickable { onFolder("") },verticalAlignment=Alignment.CenterVertically
        ) { Box(Modifier.size(40.dp),contentAlignment=Alignment.Center) { AppGlyph(9) }; Text("Toutes les notes",maxLines=1,overflow=TextOverflow.Ellipsis) }
        if(rows.isEmpty()) Text("Créez un projet pour organiser vos notes.",style=MaterialTheme.typography.bodySmall,modifier=Modifier.padding(16.dp))
        else Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(vertical=4.dp)) {
            rows.forEach { row ->
                val item=row.entry
                val opened=expanded[item.path] ?: row.depth == 0
                val selected=if(item.isDirectory) selectedFolder==item.path else selectedDocument==item.path
                Row(
                    Modifier.fillMaxWidth().heightIn(min=48.dp).padding(start=(8+row.depth*16).dp,end=6.dp).clip(RoundedCornerShape(10.dp))
                        .background(if(selected) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent)
                        .clickable { if(item.isDirectory) onFolder(item.path) else onOpen(item.path) },verticalAlignment=Alignment.CenterVertically
                ) {
                    if(item.isDirectory) IconButton(onClick={expanded[item.path]=!opened},modifier=Modifier.size(40.dp).semantics { contentDescription=if(opened) "Replier ${item.name}" else "Déplier ${item.name}" }) { AppGlyph(if(opened) 7 else 10) }
                    else Box(Modifier.size(40.dp),contentAlignment=Alignment.Center) { AppGlyph(if(item.path.endsWith(".canvas",true)) 2 else 0) }
                    Text(item.name.substringBeforeLast('.',item.name),maxLines=1,overflow=TextOverflow.Ellipsis,style=MaterialTheme.typography.bodyMedium)
                }
            }
        }
    }
}

@Composable
private fun WorkspaceTabs(paths:List<String>,active:String,onOpen:(String)->Unit,onClose:()->Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min=48.dp).horizontalScroll(rememberScrollState()).padding(horizontal=8.dp),horizontalArrangement=Arrangement.spacedBy(4.dp),verticalAlignment=Alignment.CenterVertically) {
        paths.forEach { path ->
            val selected=path==active
            Surface(shape=RoundedCornerShape(10.dp),color=if(selected) MaterialTheme.colorScheme.surfaceContainerHighest else Color.Transparent,modifier=Modifier.heightIn(min=40.dp).clickable { onOpen(path) }) {
                Row(Modifier.padding(start=12.dp,end=4.dp),verticalAlignment=Alignment.CenterVertically) {
                    Text(path.substringAfterLast('/').substringBeforeLast('.'),maxLines=1,overflow=TextOverflow.Ellipsis,modifier=Modifier.widthIn(max=150.dp))
                    if(selected) IconButton(onClick=onClose,modifier=Modifier.size(36.dp).semantics { contentDescription="Fermer ${path.substringAfterLast('/')}" }) { AppGlyph(8) }
                }
            }
        }
    }
    HorizontalDivider()
}

@Composable
private fun SettingsView(model:AppModel,choose:()->Unit,local:()->Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
        Text("Votre espace",style=MaterialTheme.typography.headlineMedium)
        Text(model.vaultName+if(model.repository.isExternal) " · dossier Android autorisé" else " · stockage privé de l’application")
        Button(onClick=choose) {Text("Ouvrir un dossier de notes")}
        OutlinedButton(onClick=local) {Text("Revenir au coffre local")}
        HorizontalDivider()
        Text("Apparence",style=MaterialTheme.typography.titleLarge)
        Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            listOf("system" to "Système","light" to "Clair","dark" to "Sombre").forEach {(mode,label)->FilterChip(model.theme==mode,{model.theme=mode;model.preferences()},label={Text(label)})}
        }
        Text("Taille du texte")
        Slider(model.fontScale,{model.fontScale=it;model.preferences()},valueRange=0.9f..1.4f)
        HorizontalDivider()
        Text("Vos fichiers restent des notes Markdown et des moodboards Canvas. Les images sont copiées dans le coffre. Pour partager le même contenu avec Windows, utilisez un dossier synchronisé ou exportez les fichiers.")
        Text("Moodboard : faites glisser la surface avec un doigt, touchez un élément pour le sélectionner, puis utilisez Modifier. Pincez avec deux doigts pour zoomer.")
        Text("Opale Android · 0.1.0",style=MaterialTheme.typography.labelMedium)
    }
}

@Composable
private fun AttachmentView(path:String,model:AppModel) {
    val context=LocalContext.current
    val scope=rememberCoroutineScope()
    val bitmap by produceState<android.graphics.Bitmap?>(null,path) { value=withContext(Dispatchers.IO){runCatching {
        val bytes=model.repository.readBytes(path)
        val options=BitmapFactory.Options().apply { inJustDecodeBounds=true }
        BitmapFactory.decodeByteArray(bytes,0,bytes.size,options)
        var sample=1
        while(options.outWidth/sample>2048 || options.outHeight/sample>2048) sample*=2
        options.inJustDecodeBounds=false; options.inSampleSize=sample
        BitmapFactory.decodeByteArray(bytes,0,bytes.size,options)
    }.getOrNull()} }
    Column(Modifier.fillMaxSize().padding(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
        Text(path,style=MaterialTheme.typography.titleMedium)
        if(bitmap!=null) Image(bitmap!!.asImageBitmap(),path,Modifier.weight(1f).fillMaxWidth()) else Text("Cette pièce jointe peut être ouverte dans une autre application.")
        Button(onClick={scope.launch {try {val bytes=withContext(Dispatchers.IO){model.repository.readBytes(path)};shareDocument(context,path,bytes)}catch(e:Exception){model.error=e.message}}}) {Text("Partager / ouvrir")}
    }
}

private suspend fun shareDocument(context:android.content.Context,path:String,bytes:ByteArray) {
    val file=withContext(Dispatchers.IO){File(context.cacheDir,"exports").apply {mkdirs()}.let {File(it,path.substringAfterLast('/')).apply {writeBytes(bytes)}}}
    val uri=FileProvider.getUriForFile(context,"fr.zaalis.opale.files",file)
    val intent=Intent(Intent.ACTION_SEND).apply {type=if(path.endsWith(".md")) "text/markdown" else if(path.endsWith(".canvas")) "application/json" else "application/octet-stream";putExtra(Intent.EXTRA_STREAM,uri);addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)}
    context.startActivity(Intent.createChooser(intent,"Partager avec…"))
}

@Composable
private fun AppGlyph(kind:Int) {
    val color=MaterialTheme.colorScheme.onSurface
    Canvas(Modifier.size(24.dp)) {
        val s=size.width/24f
        fun point(x:Float,y:Float)=Offset(x*s,y*s)
        fun line(x:Float,y:Float,x2:Float,y2:Float)=drawLine(color,point(x,y),point(x2,y2),2*s)
        when(kind) {
            0->{drawRoundRect(color,point(5f,3f),androidx.compose.ui.geometry.Size(14*s,18*s),androidx.compose.ui.geometry.CornerRadius(2*s),style=Stroke(2*s));line(8f,8f,16f,8f);line(8f,12f,16f,12f);line(8f,16f,13f,16f)}
            1->{drawCircle(color,7*s,point(10f,10f),style=Stroke(2*s));line(15f,15f,21f,21f)}
            2->{drawRect(color,point(3f,3f),androidx.compose.ui.geometry.Size(18*s,18*s),style=Stroke(2*s));line(11f,3f,11f,21f);line(11f,12f,21f,12f)}
            3->{line(6f,6f,18f,8f);line(6f,6f,12f,19f);line(18f,8f,12f,19f);drawCircle(color,3*s,point(6f,6f));drawCircle(color,3*s,point(18f,8f));drawCircle(color,3*s,point(12f,19f))}
            4->{drawCircle(color,8*s,point(12f,12f),style=Stroke(2*s));drawCircle(color,3*s,point(12f,12f),style=Stroke(2*s));for(i in 0..7) {val a=i*PI/4;line((12+8*cos(a)).toFloat(),(12+8*sin(a)).toFloat(),(12+11*cos(a)).toFloat(),(12+11*sin(a)).toFloat())}}
            6->{line(12f,5f,12f,19f);line(5f,12f,19f,12f)}
            7->{line(6f,9f,12f,15f);line(12f,15f,18f,9f)}
            8->{line(6f,6f,18f,18f);line(18f,6f,6f,18f)}
            10->{line(9f,6f,15f,12f);line(15f,12f,9f,18f)}
            9->{drawRoundRect(color,point(3f,4f),androidx.compose.ui.geometry.Size(18*s,16*s),androidx.compose.ui.geometry.CornerRadius(2*s),style=Stroke(2*s));drawCircle(color,3.5f*s,point(12f,12f),style=Stroke(2*s));line(12f,8.5f,12f,7f);line(12f,17f,12f,15.5f);line(15.5f,12f,17f,12f);line(7f,12f,8.5f,12f)}
            else->{drawRoundRect(color,point(2f,6f),androidx.compose.ui.geometry.Size(20*s,15*s),androidx.compose.ui.geometry.CornerRadius(2*s),style=Stroke(2*s));line(3f,6f,3f,3f);line(3f,3f,10f,3f);line(10f,3f,13f,6f)}
        }
    }
}

@Composable
private fun GraphView(texts:Map<String,String>,open:(String)->Unit) {
    val paths=texts.keys.take(100)
    val positions=remember(paths){paths.mapIndexed {index,path->path to Offset(cos(index*2*PI/max(1,paths.size)).toFloat(),sin(index*2*PI/max(1,paths.size)).toFloat())}.toMap()}
    val color=MaterialTheme.colorScheme.primary
    val ink=MaterialTheme.colorScheme.onSurface
    val edges=remember(texts){texts.flatMap {(from,body)->extractWikiLinks(body).mapNotNull {link->paths.firstOrNull {it.substringAfterLast('/').substringBeforeLast('.').equals(link.substringBefore('#').substringAfterLast('/').removeSuffix(".md"),true)}?.let {from to it}}}}
    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("Le graphe de vos notes",style=MaterialTheme.typography.titleLarge)
        Text(paths.size.toString()+" notes · "+edges.size+" liens",style=MaterialTheme.typography.bodySmall)
        BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
            val density=LocalDensity.current
            val width=with(density){maxWidth.toPx()};val height=with(density){maxHeight.toPx()}
            fun pixel(p:Offset)=Offset(width/2+p.x*width*.37f,height/2+p.y*min(height,width)*.37f)
            Canvas(Modifier.fillMaxSize().pointerInput(paths,width,height){detectTapGestures {tap->positions.entries.minByOrNull {(pixel(it.value)-tap).getDistance()}?.takeIf {(pixel(it.value)-tap).getDistance()<48*density.density}?.let {open(it.key)}}}) {
                edges.forEach {(from,to)->val a=positions[from];val b=positions[to];if(a!=null&&b!=null) drawLine(ink.copy(alpha=.25f),pixel(a),pixel(b),2f)}
                val paint=android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {textSize=12*density.density;this.color=android.graphics.Color.rgb((ink.red*255).toInt(),(ink.green*255).toInt(),(ink.blue*255).toInt())}
                positions.forEach {(path,p)->val at=pixel(p);drawCircle(color,7*density.density,at);drawContext.canvas.nativeCanvas.drawText(path.substringAfterLast('/').substringBeforeLast('.').take(18),at.x+10*density.density,at.y,paint)}
            }
        }
        LazyColumn(Modifier.heightIn(max=180.dp)) {items(paths,key={it}) {path->TextButton(onClick={open(path)}) {Text(path)}}}
    }
}
