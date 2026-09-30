import Cocoa
import WebKit

@main
final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
  private var window: NSWindow!
  private var webView: WKWebView!
  private var server: Process?
  private var retryTimer: Timer?

  func applicationDidFinishLaunching(_ notification: Notification) {
    let config = WKWebViewConfiguration()
    config.preferences.setValue(true, forKey: "developerExtrasEnabled")
    webView = WKWebView(frame: .zero, configuration: config)
    webView.navigationDelegate = self
    window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1320, height: 860), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
    window.title = "Opale"
    window.center(); window.contentView = webView; window.makeKeyAndOrderFront(nil)
    startServer()
  }

  private var appData: URL {
    if let override = ProcessInfo.processInfo.environment["OPALE_HOME"], !override.isEmpty { return URL(fileURLWithPath: override) }
    return FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Opale", isDirectory: true)
  }

  private func startServer() {
    let resources = Bundle.main.resourceURL!
    let binary = resources.appendingPathComponent("opale-server")
    let process = Process(); process.executableURL = binary
    process.arguments = ["--port", "0"]
    var environment = ProcessInfo.processInfo.environment
    environment["OPALE_SHELL_EXE"] = Bundle.main.executableURL?.path
    process.environment = environment
    do { try process.run(); server = process; pollForServer() }
    catch { presentError(error) }
  }

  private func pollForServer() {
    retryTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] timer in
      guard let self else { timer.invalidate(); return }
      let instance = self.appData.appendingPathComponent("instance.json")
      guard let data = try? Data(contentsOf: instance),
        let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let address = payload["url"] as? String, let url = URL(string: address) else { return }
      timer.invalidate(); self.webView.load(URLRequest(url: url))
    }
  }

  func applicationWillTerminate(_ notification: Notification) { retryTimer?.invalidate(); server?.terminate() }
  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
