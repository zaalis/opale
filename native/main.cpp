// =====================================================================
//  Opale — native Windows shell (C++ + WebView2)
//  - One window per user: a second launch brings the first one forward.
//  - Attaches to an Opale server that is already running, or starts one
//    (opale-server.exe beside this exe, or Node on ..\server.js in a
//    development checkout) inside a Job Object so it stops with the window.
//  - The server picks its own port and publishes it in
//    %APPDATA%\Opale\instance.json; this shell reads it from there.
// =====================================================================
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <dwmapi.h>
#include <shellapi.h>
#include <shlobj.h>
#include <wrl.h>
#include "WebView2.h"
#include <string>

#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "dwmapi.lib")
#pragma comment(lib, "shell32.lib")

#ifndef DWMWA_USE_IMMERSIVE_DARK_MODE
#define DWMWA_USE_IMMERSIVE_DARK_MODE 20
#endif
#ifndef DWMWA_CAPTION_COLOR
#define DWMWA_CAPTION_COLOR 35
#endif
#ifndef DWMWA_TEXT_COLOR
#define DWMWA_TEXT_COLOR 36
#endif

using namespace Microsoft::WRL;

static const wchar_t* WINDOW_CLASS = L"OpaleWindow";
static const wchar_t* WINDOW_TITLE = L"Opale";
static const wchar_t* INSTANCE_MUTEX = L"Local\\OpaleDesktopShell";

static ComPtr<ICoreWebView2Controller> g_controller;
static ComPtr<ICoreWebView2>           g_webview;
static HANDLE                          g_job = nullptr;
static std::wstring                    g_origin;   // http://127.0.0.1:<port>
static DWORD                           g_serverPid = 0;   // the server this shell started, if any

static std::wstring ExePath() {
    wchar_t buf[MAX_PATH * 4];
    GetModuleFileNameW(nullptr, buf, (DWORD)(sizeof(buf) / sizeof(buf[0])));
    return buf;
}
static std::wstring DirOf(const std::wstring& p) {
    size_t pos = p.find_last_of(L"\\/");
    return pos == std::wstring::npos ? L"." : p.substr(0, pos);
}
static bool Exists(const std::wstring& p) {
    DWORD attrs = GetFileAttributesW(p.c_str());
    return attrs != INVALID_FILE_ATTRIBUTES && !(attrs & FILE_ATTRIBUTE_DIRECTORY);
}
static std::wstring EnvVar(const wchar_t* name) {
    wchar_t buf[MAX_PATH * 4] = {};
    DWORD n = GetEnvironmentVariableW(name, buf, (DWORD)(sizeof(buf) / sizeof(buf[0])));
    return n ? std::wstring(buf, n) : std::wstring();
}
static std::wstring KnownFolder(REFKNOWNFOLDERID id) {
    PWSTR raw = nullptr; std::wstring out;
    if (SUCCEEDED(SHGetKnownFolderPath(id, 0, nullptr, &raw))) { out = raw; CoTaskMemFree(raw); }
    return out;
}

// %APPDATA%\Opale (same rule as the server: OPALE_HOME wins).
static std::wstring OpaleHome() {
    std::wstring home = EnvVar(L"OPALE_HOME");
    if (home.empty()) home = KnownFolder(FOLDERID_RoamingAppData) + L"\\Opale";
    SHCreateDirectoryExW(nullptr, home.c_str(), nullptr);
    return home;
}
static std::wstring WebViewDataDir() {
    std::wstring dir = KnownFolder(FOLDERID_LocalAppData);
    if (dir.empty()) dir = DirOf(ExePath());
    dir += L"\\Opale\\WebView2";
    SHCreateDirectoryExW(nullptr, dir.c_str(), nullptr);
    return dir;
}

static std::string ReadSmallFile(const std::wstring& path) {
    HANDLE file = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING, 0, nullptr);
    if (file == INVALID_HANDLE_VALUE) return {};
    std::string out; char buf[4096]; DWORD read = 0;
    while (out.size() < 64 * 1024 && ReadFile(file, buf, sizeof(buf), &read, nullptr) && read) out.append(buf, read);
    CloseHandle(file);
    return out;
}
// The integer that follows "name": in a small JSON document (0 if absent).
static long JsonInt(const std::string& json, const char* name) {
    std::string key = std::string("\"") + name + "\"";
    size_t at = json.find(key);
    if (at == std::string::npos) return 0;
    at = json.find(':', at + key.size());
    if (at == std::string::npos) return 0;
    return strtol(json.c_str() + at + 1, nullptr, 10);
}

struct Instance { int port = 0; DWORD pid = 0; };
static Instance ReadInstance() {
    Instance inst;
    std::string json = ReadSmallFile(OpaleHome() + L"\\instance.json");
    long port = JsonInt(json, "port"), pid = JsonInt(json, "pid");
    if (port > 0 && port < 65536 && pid > 0) { inst.port = (int)port; inst.pid = (DWORD)pid; }
    return inst;
}
static bool ProcessAlive(DWORD pid) {
    HANDLE process = OpenProcess(SYNCHRONIZE, FALSE, pid);
    if (!process) return false;
    bool alive = WaitForSingleObject(process, 0) == WAIT_TIMEOUT;
    CloseHandle(process);
    return alive;
}
static bool PortOpen(int port) {
    SOCKET s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (s == INVALID_SOCKET) return false;
    sockaddr_in addr = {};
    addr.sin_family = AF_INET;
    addr.sin_port = htons((u_short)port);
    InetPtonW(AF_INET, L"127.0.0.1", &addr.sin_addr);
    bool open = connect(s, (sockaddr*)&addr, sizeof(addr)) == 0;
    closesocket(s);
    return open;
}

// Start the server as a child that dies with this process. Returns its pid.
static DWORD LaunchServer() {
    std::wstring self = ExePath(), dir = DirOf(self);
    std::wstring packaged = dir + L"\\opale-server.exe";
    std::wstring script = dir + L"\\..\\server.js";
    std::wstring exe, cmd;
    if (Exists(packaged)) { exe = packaged; cmd = L"\"" + packaged + L"\""; }
    else if (Exists(script)) {
        wchar_t node[MAX_PATH * 2] = {};
        if (!SearchPathW(nullptr, L"node.exe", nullptr, (DWORD)(sizeof(node) / sizeof(node[0])), node, nullptr)) return 0;
        exe = node; cmd = L"\"" + exe + L"\" \"" + script + L"\"";
    } else return 0;

    // Lets the server record this shell as the way to start Opale again.
    SetEnvironmentVariableW(L"OPALE_SHELL_EXE", self.c_str());

    g_job = CreateJobObjectW(nullptr, nullptr);
    if (g_job) {
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION info = {};
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK;
        SetInformationJobObject(g_job, JobObjectExtendedLimitInformation, &info, sizeof(info));
    }
    STARTUPINFOW si = { sizeof(si) };
    PROCESS_INFORMATION pi = {};
    // Suspended first, so the child is in the job before it runs any code.
    if (!CreateProcessW(exe.c_str(), &cmd[0], nullptr, nullptr, FALSE, CREATE_NO_WINDOW | CREATE_SUSPENDED, nullptr, dir.c_str(), &si, &pi)) return 0;
    if (g_job) AssignProcessToJobObject(g_job, pi.hProcess);
    ResumeThread(pi.hThread);
    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
    return pi.dwProcessId;
}

// Find the port to show: a live server, or the one we start now.
static int ResolveServer() {
    Instance running = ReadInstance();
    if (running.port && ProcessAlive(running.pid) && PortOpen(running.port)) return running.port;
    DWORD child = LaunchServer();
    if (!child) return 0;
    g_serverPid = child;
    for (int waited = 0; waited < 25000; waited += 150) {
        Instance inst = ReadInstance();
        // Only the file written by our own child counts: a stale one could
        // name a port that now belongs to another program.
        if (inst.pid == child && PortOpen(inst.port)) return inst.port;
        if (!ProcessAlive(child)) {
            // The server found another instance and left: use that one.
            if (inst.port && ProcessAlive(inst.pid) && PortOpen(inst.port)) return inst.port;
            return 0;
        }
        Sleep(150);
    }
    return 0;
}

static bool IsAppUri(const std::wstring& uri) {
    return uri == g_origin || uri.rfind(g_origin + L"/", 0) == 0;
}
static void OpenExternally(const std::wstring& uri) {
    if (uri.rfind(L"http://", 0) == 0 || uri.rfind(L"https://", 0) == 0 || uri.rfind(L"mailto:", 0) == 0)
        ShellExecuteW(nullptr, L"open", uri.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
}

static std::wstring PlacementFile() { return OpaleHome() + L"\\window.bin"; }
static void SavePlacement(HWND hwnd) {
    WINDOWPLACEMENT placement = { sizeof(placement) };
    if (!GetWindowPlacement(hwnd, &placement)) return;
    HANDLE file = CreateFileW(PlacementFile().c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) return;
    DWORD written = 0;
    WriteFile(file, &placement, sizeof(placement), &written, nullptr);
    CloseHandle(file);
}
static bool RestorePlacement(HWND hwnd) {
    std::string raw = ReadSmallFile(PlacementFile());
    if (raw.size() != sizeof(WINDOWPLACEMENT)) return false;
    WINDOWPLACEMENT placement;
    memcpy(&placement, raw.data(), sizeof(placement));
    if (placement.length != sizeof(placement)) return false;
    if (placement.showCmd == SW_SHOWMINIMIZED || placement.showCmd == SW_HIDE) placement.showCmd = SW_SHOWNORMAL;
    return SetWindowPlacement(hwnd, &placement) != 0;
}

static LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM w, LPARAM l) {
    switch (msg) {
    case WM_SIZE:
        if (g_controller) { RECT rc; GetClientRect(hwnd, &rc); g_controller->put_Bounds(rc); }
        return 0;
    case WM_SETFOCUS:
        if (g_controller) g_controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
        return 0;
    case WM_DPICHANGED: {
        RECT* prc = reinterpret_cast<RECT*>(l);
        SetWindowPos(hwnd, nullptr, prc->left, prc->top, prc->right - prc->left, prc->bottom - prc->top, SWP_NOZORDER | SWP_NOACTIVATE);
        return 0;
    }
    case WM_CLOSE:
        SavePlacement(hwnd);
        DestroyWindow(hwnd);
        return 0;
    case WM_DESTROY:
        if (g_controller) g_controller->Close();
        g_webview.Reset();
        g_controller.Reset();
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProcW(hwnd, msg, w, l);
}

int WINAPI wWinMain(HINSTANCE hInst, HINSTANCE, PWSTR, int) {
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

    // One window per user: hand over to the one already open.
    HANDLE mutex = CreateMutexW(nullptr, TRUE, INSTANCE_MUTEX);
    if (mutex && GetLastError() == ERROR_ALREADY_EXISTS) {
        HWND existing = FindWindowW(WINDOW_CLASS, nullptr);
        if (existing) {
            if (IsIconic(existing)) ShowWindow(existing, SW_RESTORE);
            SetForegroundWindow(existing);
        }
        return 0;
    }

    WSADATA wsa;
    WSAStartup(MAKEWORD(2, 2), &wsa);
    int port = ResolveServer();
    WSACleanup();
    if (!port) {
        MessageBoxW(nullptr,
            L"Le serveur d'Opale n'a pas démarré.\n\nVérifiez que opale-server.exe se trouve à côté de l'application (ou que Node.js est installé pour une version de développement).",
            WINDOW_TITLE, MB_ICONERROR | MB_OK);
        if (g_job) CloseHandle(g_job);
        return 1;
    }
    g_origin = L"http://127.0.0.1:" + std::to_wstring(port);

    HICON appIcon = LoadIconW(hInst, MAKEINTRESOURCEW(1));
    WNDCLASSW wc = {};
    wc.lpfnWndProc   = WndProc;
    wc.hInstance     = hInst;
    wc.lpszClassName = WINDOW_CLASS;
    wc.hCursor       = LoadCursor(nullptr, IDC_ARROW);
    wc.hIcon         = appIcon;
    wc.hbrBackground = CreateSolidBrush(RGB(0x13, 0x12, 0x18));
    RegisterClassW(&wc);

    HWND hwnd = CreateWindowExW(0, WINDOW_CLASS, WINDOW_TITLE, WS_OVERLAPPEDWINDOW,
        CW_USEDEFAULT, CW_USEDEFAULT, 1320, 860, nullptr, nullptr, hInst, nullptr);

    BOOL dark = TRUE;
    DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, &dark, sizeof(dark));
    COLORREF caption = RGB(0x13, 0x12, 0x18);
    COLORREF text = RGB(0xc6, 0xc3, 0xd3);
    DwmSetWindowAttribute(hwnd, DWMWA_CAPTION_COLOR, &caption, sizeof(caption));
    DwmSetWindowAttribute(hwnd, DWMWA_TEXT_COLOR, &text, sizeof(text));

    if (!RestorePlacement(hwnd)) ShowWindow(hwnd, SW_SHOWNORMAL);
    UpdateWindow(hwnd);

    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    std::wstring userData = WebViewDataDir();
    CreateCoreWebView2EnvironmentWithOptions(nullptr, userData.c_str(), nullptr,
        Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
            [hwnd](HRESULT, ICoreWebView2Environment* env) -> HRESULT {
                if (!env) {
                    MessageBoxW(hwnd, L"Microsoft Edge WebView2 est introuvable sur ce PC.\nInstallez le runtime WebView2 puis relancez Opale.", WINDOW_TITLE, MB_ICONERROR | MB_OK);
                    PostMessageW(hwnd, WM_CLOSE, 0, 0);
                    return S_OK;
                }
                env->CreateCoreWebView2Controller(hwnd,
                    Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                        [hwnd](HRESULT, ICoreWebView2Controller* controller) -> HRESULT {
                            if (!controller) return S_OK;
                            g_controller = controller;
                            g_controller->get_CoreWebView2(&g_webview);
                            RECT rc; GetClientRect(hwnd, &rc);
                            g_controller->put_Bounds(rc);

                            ComPtr<ICoreWebView2Controller2> controller2;
                            if (SUCCEEDED(g_controller.As(&controller2))) {
                                COREWEBVIEW2_COLOR background = { 255, 0x1e, 0x1d, 0x25 };
                                controller2->put_DefaultBackgroundColor(background);
                            }
                            // WebView2 blocks files dragged from Explorer unless this
                            // controller capability is explicitly enabled. The web UI
                            // validates and imports the dropped files itself.
                            ComPtr<ICoreWebView2Controller4> controller4;
                            if (SUCCEEDED(g_controller.As(&controller4))) controller4->put_AllowExternalDrop(TRUE);
                            ComPtr<ICoreWebView2Settings> settings;
                            if (SUCCEEDED(g_webview->get_Settings(&settings))) {
                                settings->put_IsStatusBarEnabled(FALSE);
                                // The interface draws its own menus.
                                settings->put_AreDefaultContextMenusEnabled(FALSE);
                                settings->put_AreDevToolsEnabled(EnvVar(L"OPALE_DEVTOOLS").empty() ? FALSE : TRUE);
                                // Ctrl+N, Ctrl+P, Ctrl+O… belong to Opale, not to the browser engine.
                                ComPtr<ICoreWebView2Settings3> settings3;
                                if (SUCCEEDED(settings.As(&settings3))) settings3->put_AreBrowserAcceleratorKeysEnabled(FALSE);
                            }

                            EventRegistrationToken token;
                            // Links to the web open in the default browser, never in this window.
                            g_webview->add_NewWindowRequested(
                                Callback<ICoreWebView2NewWindowRequestedEventHandler>(
                                    [](ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args) -> HRESULT {
                                        LPWSTR uri = nullptr;
                                        if (SUCCEEDED(args->get_Uri(&uri)) && uri) { OpenExternally(uri); CoTaskMemFree(uri); }
                                        args->put_Handled(TRUE);
                                        return S_OK;
                                    }).Get(), &token);
                            g_webview->add_NavigationStarting(
                                Callback<ICoreWebView2NavigationStartingEventHandler>(
                                    [](ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs* args) -> HRESULT {
                                        LPWSTR uri = nullptr;
                                        if (SUCCEEDED(args->get_Uri(&uri)) && uri) {
                                            std::wstring target(uri);
                                            CoTaskMemFree(uri);
                                            if (!IsAppUri(target)) { args->put_Cancel(TRUE); OpenExternally(target); }
                                        }
                                        return S_OK;
                                    }).Get(), &token);
                            g_webview->add_DocumentTitleChanged(
                                Callback<ICoreWebView2DocumentTitleChangedEventHandler>(
                                    [hwnd](ICoreWebView2* sender, IUnknown*) -> HRESULT {
                                        LPWSTR title = nullptr;
                                        if (SUCCEEDED(sender->get_DocumentTitle(&title)) && title) {
                                            SetWindowTextW(hwnd, *title ? title : WINDOW_TITLE);
                                            CoTaskMemFree(title);
                                        }
                                        return S_OK;
                                    }).Get(), &token);
                            // Pasting from Opale's own menu reads the clipboard: allowed for the
                            // application itself, refused for anything else.
                            g_webview->add_PermissionRequested(
                                Callback<ICoreWebView2PermissionRequestedEventHandler>(
                                    [](ICoreWebView2*, ICoreWebView2PermissionRequestedEventArgs* args) -> HRESULT {
                                        COREWEBVIEW2_PERMISSION_KIND kind = COREWEBVIEW2_PERMISSION_KIND_UNKNOWN_PERMISSION;
                                        LPWSTR uri = nullptr;
                                        args->get_PermissionKind(&kind);
                                        bool own = SUCCEEDED(args->get_Uri(&uri)) && uri && IsAppUri(uri);
                                        if (uri) CoTaskMemFree(uri);
                                        args->put_State(own && kind == COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ
                                            ? COREWEBVIEW2_PERMISSION_STATE_ALLOW : COREWEBVIEW2_PERMISSION_STATE_DENY);
                                        return S_OK;
                                    }).Get(), &token);
                            g_webview->add_WindowCloseRequested(
                                Callback<ICoreWebView2WindowCloseRequestedEventHandler>(
                                    [hwnd](ICoreWebView2*, IUnknown*) -> HRESULT { PostMessageW(hwnd, WM_CLOSE, 0, 0); return S_OK; }).Get(), &token);

                            g_webview->Navigate(g_origin.c_str());
                            g_controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
                            return S_OK;
                        }).Get());
                return S_OK;
            }).Get());

    MSG msg;
    while (GetMessageW(&msg, nullptr, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }

    // Closing the job stops the server we started (also on a crash). It gets
    // no chance to tidy up, so its instance file is removed here.
    if (g_job) CloseHandle(g_job);
    if (g_serverPid && ReadInstance().pid == g_serverPid) DeleteFileW((OpaleHome() + L"\\instance.json").c_str());
    if (mutex) { ReleaseMutex(mutex); CloseHandle(mutex); }
    CoUninitialize();
    return 0;
}
