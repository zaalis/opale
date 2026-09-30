// =====================================================================
//  Opale — native macOS shell (AppKit + WKWebView)
//  - One instance per user: a second launch brings the first one forward.
//  - Attaches to an Opale server that is already running, or starts one
//    (opale-server beside this executable, or Node on ../server.js in a
//    development checkout) and stops it again when the app quits.
//  - The server picks its own port and publishes it in
//    ~/Library/Application Support/Opale/instance.json; the shell reads it there.
//  - A real menu bar with the standard ⌘ shortcuts. Commands that live in the
//    web interface (new note, tabs, graph…) are run through window.opaleRun.
//  Build: native/build.sh    Requires: Xcode command line tools (swiftc).
// =====================================================================
import Cocoa
import WebKit
import Darwin

// ------------------------------------------------------------------ helpers
let windowBackground = NSColor(srgbRed: 0x13 / 255.0, green: 0x12 / 255.0, blue: 0x18 / 255.0, alpha: 1)
let pageBackground = NSColor(srgbRed: 0x1e / 255.0, green: 0x1d / 255.0, blue: 0x25 / 255.0, alpha: 1)
let lightBackground = NSColor(srgbRed: 0xfa / 255.0, green: 0xf9 / 255.0, blue: 0xf7 / 255.0, alpha: 1)

func environment(_ name: String) -> String? {
    if let value = ProcessInfo.processInfo.environment[name], !value.isEmpty { return value }
    return nil
}

/// ~/Library/Application Support/Opale (OPALE_HOME wins). Same rule as the server.
func opaleHome() -> URL {
    if let custom = environment("OPALE_HOME") { return URL(fileURLWithPath: custom, isDirectory: true) }
    let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    return support.appendingPathComponent("Opale", isDirectory: true)
}

struct Instance {
    var port: Int
    var pid: Int32
}

/// The server advertised in instance.json, if the file is readable and complete.
func readInstance() -> Instance? {
    let file = opaleHome().appendingPathComponent("instance.json")
    guard let data = try? Data(contentsOf: file),
          let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
          let port = (json["port"] as? NSNumber)?.intValue,
          let pid = (json["pid"] as? NSNumber)?.int32Value,
          port > 0, port < 65536, pid > 0 else { return nil }
    return Instance(port: port, pid: pid)
}

func processAlive(_ pid: Int32) -> Bool {
    if kill(pid, 0) == 0 { return true }
    return errno == EPERM
}

func portOpen(_ port: Int) -> Bool {
    let descriptor = socket(AF_INET, SOCK_STREAM, 0)
    if descriptor < 0 { return false }
    defer { close(descriptor) }
    var address = sockaddr_in()
    address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    address.sin_family = sa_family_t(AF_INET)
    address.sin_port = in_port_t(UInt16(port).bigEndian)
    address.sin_addr.s_addr = inet_addr("127.0.0.1")
    let result = withUnsafePointer(to: &address) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
            connect(descriptor, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
        }
    }
    return result == 0
}

func isExecutable(_ url: URL) -> Bool {
    var directory: ObjCBool = false
    return FileManager.default.fileExists(atPath: url.path, isDirectory: &directory) && !directory.boolValue && FileManager.default.isExecutableFile(atPath: url.path)
}

func javaScriptString(_ text: String) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: [text]), let json = String(data: data, encoding: .utf8) else { return "\"\"" }
    return String(json.dropFirst().dropLast())   // ["x"] -> "x"
}

// ------------------------------------------------------------- server child
final class ServerProcess {
    private(set) var process: Process?

    /// The executable that runs the server, and its arguments.
    private func command() -> (URL, [String])? {
        let folder = (Bundle.main.executableURL ?? URL(fileURLWithPath: CommandLine.arguments[0])).deletingLastPathComponent()
        #if arch(arm64)
        let architecture = "arm64"
        #else
        let architecture = "x64"
        #endif
        for name in ["opale-server-\(architecture)", "opale-server"] {
            let packaged = folder.appendingPathComponent(name)
            if isExecutable(packaged) { return (packaged, []) }
        }
        // A development checkout: dist/Opale.app/Contents/MacOS -> project root, or the project root itself.
        var probe = folder
        for _ in 0..<6 {
            let script = probe.appendingPathComponent("server.js")
            if FileManager.default.fileExists(atPath: script.path) {
                let searchPath = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] + (environment("PATH")?.split(separator: ":").map(String.init) ?? [])
                for directory in searchPath {
                    let node = URL(fileURLWithPath: directory).appendingPathComponent("node")
                    if isExecutable(node) { return (node, [script.path]) }
                }
                return nil
            }
            probe = probe.deletingLastPathComponent()
        }
        return nil
    }

    /// Starts the server. Returns its pid, or nil when it cannot be started.
    func start() -> Int32? {
        guard let (executable, arguments) = command() else { return nil }
        let child = Process()
        child.executableURL = executable
        child.arguments = arguments
        child.currentDirectoryURL = executable.deletingLastPathComponent()
        var env = ProcessInfo.processInfo.environment
        // Lets the server record this shell as the way to start Opale again, and stop with it.
        env["OPALE_SHELL_EXE"] = Bundle.main.executablePath ?? CommandLine.arguments[0]
        env["OPALE_PARENT_PID"] = String(getpid())
        child.environment = env
        child.standardInput = FileHandle.nullDevice
        child.standardOutput = FileHandle.nullDevice
        child.standardError = FileHandle.nullDevice
        do { try child.run() } catch { return nil }
        process = child
        return child.processIdentifier
    }

    func stop() {
        guard let child = process, child.isRunning else { return }
        child.terminate()                       // SIGTERM: the server closes cleanly and removes instance.json
        let deadline = Date().addingTimeInterval(2)
        while child.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.05) }
        if child.isRunning { kill(child.processIdentifier, SIGKILL) }
        if let instance = readInstance(), instance.pid == child.processIdentifier {
            try? FileManager.default.removeItem(at: opaleHome().appendingPathComponent("instance.json"))
        }
    }

    /// Port of a live server: the one already running, or the one started here. Blocks; call off the main thread.
    func resolvePort() -> Int? {
        if let running = readInstance(), processAlive(running.pid), portOpen(running.port) { return running.port }
        guard let child = start() else { return nil }
        var waited = 0.0
        while waited < 25 {
            if let instance = readInstance() {
                // Only the file written by our own child counts: a stale one could name a port that now belongs to another program.
                if instance.pid == child, portOpen(instance.port) { return instance.port }
                // The server found another instance and left: use that one.
                if !(process?.isRunning ?? false), processAlive(instance.pid), portOpen(instance.port) { return instance.port }
            }
            if !(process?.isRunning ?? false) { return nil }
            Thread.sleep(forTimeInterval: 0.15)
            waited += 0.15
        }
        return nil
    }
}

// --------------------------------------------------------------- downloads
/// Files the vault serves as attachments are saved through the usual save panel.
final class Downloader: NSObject, WKDownloadDelegate {
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedFilename
        panel.canCreateDirectories = true
        panel.begin { result in completionHandler(result == .OK ? panel.url : nil) }
    }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        NSSound.beep()
    }
}

// ------------------------------------------------------------- app delegate
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    let server = ServerProcess()
    let downloader = Downloader()
    var window: NSWindow!
    var webView: WKWebView!
    var origin = ""

    // -------------------------------------------------------------- launch
    func applicationDidFinishLaunching(_ notification: Notification) {
        // One instance per user: hand over to the one already open.
        if let bundleId = Bundle.main.bundleIdentifier {
            let others = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).filter { $0.processIdentifier != getpid() }
            if let existing = others.first {
                existing.activate(options: [.activateIgnoringOtherApps])
                NSApp.terminate(nil)
                return
            }
        }

        NSApp.appearance = NSAppearance(named: .darkAqua)
        buildMenus()
        buildWindow()
        NSApp.activate(ignoringOtherApps: true)

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let port = self?.server.resolvePort()
            DispatchQueue.main.async { self?.serverReady(port) }
        }
    }

    func serverReady(_ port: Int?) {
        guard let port = port else {
            let alert = NSAlert()
            alert.alertStyle = .critical
            alert.messageText = "Le serveur d’Opale n’a pas démarré."
            alert.informativeText = "Vérifiez que opale-server se trouve à côté de l’application (ou que Node.js est installé pour une version de développement)."
            alert.runModal()
            NSApp.terminate(nil)
            return
        }
        origin = "http://127.0.0.1:\(port)"
        if let url = URL(string: origin) { webView.load(URLRequest(url: url)) }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationWillTerminate(_ notification: Notification) { server.stop() }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { window.makeKeyAndOrderFront(nil) }
        return true
    }

    // -------------------------------------------------------------- window
    func buildWindow() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = WKWebsiteDataStore.default()
        if environment("OPALE_DEVTOOLS") != nil { configuration.preferences.setValue(true, forKey: "developerExtrasEnabled") }
        configuration.userContentController.add(self, name: "opale")

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        webView.underPageBackgroundColor = pageBackground
        // Invisible until the first page has loaded, so the window never flashes white.
        webView.alphaValue = 0
        webView.autoresizingMask = [.width, .height]

        let container = NSView(frame: NSRect(x: 0, y: 0, width: 1320, height: 860))
        container.wantsLayer = true
        container.layer?.backgroundColor = pageBackground.cgColor
        webView.frame = container.bounds
        container.addSubview(webView)

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1320, height: 860),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "Opale"
        window.minSize = NSSize(width: 720, height: 480)
        window.titlebarAppearsTransparent = true
        window.backgroundColor = windowBackground
        window.collectionBehavior = [.fullScreenPrimary]
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.contentView = container
        // AppKit remembers size, position and full-screen state under this name.
        if !window.setFrameUsingName("OpaleMainWindow") { window.center() }
        window.setFrameAutosaveName("OpaleMainWindow")
        window.makeKeyAndOrderFront(nil)
    }

    // The window follows the theme chosen in Opale (light or dark).
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let theme = body["theme"] as? String else { return }
        let light = theme == "light"
        NSApp.appearance = NSAppearance(named: light ? .aqua : .darkAqua)
        window.backgroundColor = light ? lightBackground : windowBackground
        webView.underPageBackgroundColor = light ? lightBackground : pageBackground
    }

    // --------------------------------------------------------- navigation
    private func isApp(_ url: URL?) -> Bool {
        guard let url = url, !origin.isEmpty else { return false }
        return url.absoluteString == origin || url.absoluteString.hasPrefix(origin + "/")
    }

    private func openExternally(_ url: URL?) {
        guard let url = url, let scheme = url.scheme?.lowercased(), ["http", "https", "mailto"].contains(scheme) else { return }
        NSWorkspace.shared.open(url)
    }

    // Links to the web open in the default browser, never in this window.
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let url = navigationAction.request.url
        if isApp(url) || url?.scheme == "about" || url?.scheme == "blob" || url?.scheme == "data" {
            decisionHandler(.allow)
        } else {
            decisionHandler(.cancel)
            openExternally(url)
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if !isApp(navigationAction.request.url) { openExternally(navigationAction.request.url) }
        return nil
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if let http = navigationResponse.response as? HTTPURLResponse,
           let disposition = http.value(forHTTPHeaderField: "Content-Disposition"), disposition.lowercased().hasPrefix("attachment") {
            decisionHandler(.download)
        } else {
            decisionHandler(.allow)
        }
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = downloader }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = downloader }

    // The page's own dialogs (window.confirm, window.alert) as native sheets.
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Annuler")
        alert.beginSheetModal(for: window) { response in completionHandler(response == .alertFirstButtonReturn) }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { webView.alphaValue = 1 }

    // A vault that cannot be reached any more: say so instead of leaving a blank window.
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code == NSURLErrorCancelled { return }
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "Opale ne répond plus."
        alert.informativeText = "Le serveur local s’est arrêté. Relancez Opale."
        alert.beginSheetModal(for: window) { _ in NSApp.terminate(nil) }
    }

    // ---------------------------------------------------------------- menus
    /// Runs one of Opale's commands by id, as the keyboard shortcut would.
    @objc func runCommand(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String else { return }
        webView.evaluateJavaScript("window.opaleRun && window.opaleRun(\(javaScriptString(id)))", completionHandler: nil)
    }

    @objc func showAbout(_ sender: Any?) {
        NSApp.orderFrontStandardAboutPanel(options: [
            .applicationName: "Opale",
            .credits: NSAttributedString(string: "Carnet de notes Markdown, local et relié.\nzaalis"),
        ])
    }

    private func item(_ title: String, _ key: String = "", _ modifiers: NSEvent.ModifierFlags = [.command], command: String) -> NSMenuItem {
        let entry = NSMenuItem(title: title, action: #selector(runCommand(_:)), keyEquivalent: key)
        entry.keyEquivalentModifierMask = key.isEmpty ? [] : modifiers
        entry.representedObject = command
        entry.target = self
        return entry
    }

    private func standard(_ title: String, _ action: Selector, _ key: String = "", _ modifiers: NSEvent.ModifierFlags = [.command]) -> NSMenuItem {
        let entry = NSMenuItem(title: title, action: action, keyEquivalent: key)
        entry.keyEquivalentModifierMask = key.isEmpty ? [] : modifiers
        return entry
    }

    private func submenu(_ title: String, _ items: [NSMenuItem]) -> NSMenuItem {
        let menu = NSMenu(title: title)
        for entry in items { menu.addItem(entry) }
        let holder = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        holder.submenu = menu
        return holder
    }

    private func arrow(_ code: Int) -> String {
        guard let scalar = UnicodeScalar(code) else { return "" }
        return String(Character(scalar))
    }

    func buildMenus() {
        let main = NSMenu()
        let separator = { NSMenuItem.separator() }

        let servicesMenu = NSMenu(title: "Services")
        let servicesHolder = NSMenuItem(title: "Services", action: nil, keyEquivalent: "")
        servicesHolder.submenu = servicesMenu
        NSApp.servicesMenu = servicesMenu

        let about = NSMenuItem(title: "À propos d’Opale", action: #selector(showAbout(_:)), keyEquivalent: "")
        about.target = self

        main.addItem(submenu("Opale", [
            about,
            separator(),
            item("Réglages…", ",", command: "settings:open"),
            separator(),
            servicesHolder,
            separator(),
            standard("Masquer Opale", #selector(NSApplication.hide(_:)), "h"),
            standard("Masquer les autres", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
            standard("Tout afficher", #selector(NSApplication.unhideAllApplications(_:))),
            separator(),
            standard("Quitter Opale", #selector(NSApplication.terminate(_:)), "q"),
        ]))

        main.addItem(submenu("Fichier", [
            item("Nouvelle note", "n", command: "note:new"),
            item("Ouvrir une note…", "o", command: "switcher:open"),
            item("Note du jour", command: "daily:open"),
            separator(),
            item("Nouvel onglet", "t", command: "tab:new"),
            item("Fermer l’onglet", "w", command: "tab:close"),
            separator(),
            item("Enregistrer", "s", command: "note:save"),
            separator(),
            item("Changer de coffre…", command: "vault:switch"),
            item("Afficher le coffre dans le Finder", command: "vault:reveal"),
        ]))

        // Undo and redo are handled by the editor itself (⌘Z, ⇧⌘Z); the standard
        // clipboard items are what makes ⌘X ⌘C ⌘V ⌘A work inside a web view.
        main.addItem(submenu("Édition", [
            standard("Couper", #selector(NSText.cut(_:)), "x"),
            standard("Copier", #selector(NSText.copy(_:)), "c"),
            standard("Coller", #selector(NSText.paste(_:)), "v"),
            standard("Tout sélectionner", #selector(NSText.selectAll(_:)), "a"),
            separator(),
            item("Rechercher dans les notes…", "f", [.command, .shift], command: "search:open"),
        ]))

        main.addItem(submenu("Présentation", [
            item("Basculer lecture / édition", "e", command: "view:reading"),
            item("Graphe", "g", command: "graph:open"),
            item("Palette de commandes", "p", command: "palette:open"),
            separator(),
            item("Panneau gauche", command: "sidebar:left"),
            item("Panneau droit", command: "sidebar:right"),
            item("Thème clair / sombre", command: "theme:toggle"),
            separator(),
            standard("Plein écran", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]),
        ]))

        let tab = "\t"
        main.addItem(submenu("Aller", [
            item("Précédent", arrow(NSLeftArrowFunctionKey), [.command, .option], command: "nav:back"),
            item("Suivant", arrow(NSRightArrowFunctionKey), [.command, .option], command: "nav:forward"),
            separator(),
            item("Onglet suivant", tab, [.control], command: "tab:next"),
            item("Onglet précédent", tab, [.control, .shift], command: "tab:previous"),
        ]))

        let windowMenu = submenu("Fenêtre", [
            standard("Réduire", #selector(NSWindow.performMiniaturize(_:)), "m"),
            standard("Zoom", #selector(NSWindow.performZoom(_:))),
            separator(),
            standard("Tout ramener au premier plan", #selector(NSApplication.arrangeInFront(_:))),
        ])
        main.addItem(windowMenu)
        NSApp.windowsMenu = windowMenu.submenu

        let helpMenu = submenu("Aide", [
            item("Connexion à zaalis IDE", command: "settings:connection"),
        ])
        main.addItem(helpMenu)
        NSApp.helpMenu = helpMenu.submenu

        NSApp.mainMenu = main
    }
}

// --------------------------------------------------------------------- main
let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.setActivationPolicy(.regular)
application.run()
