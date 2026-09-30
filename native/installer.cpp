#include <windows.h>
#include <windowsx.h>
#include <dwmapi.h>
#include <objidl.h>
#include <gdiplus.h>
#include <shlobj.h>
#include <shobjidl.h>
#include <shlwapi.h>
#include <string>
#include <vector>

#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "shlwapi.lib")
#pragma comment(lib, "advapi32.lib")
#pragma comment(lib, "gdiplus.lib")
#pragma comment(lib, "dwmapi.lib")

#ifndef DWMWA_USE_IMMERSIVE_DARK_MODE
#define DWMWA_USE_IMMERSIVE_DARK_MODE 20
#endif
#ifndef DWMWA_CAPTION_COLOR
#define DWMWA_CAPTION_COLOR 35
#endif
#ifndef DWMWA_TEXT_COLOR
#define DWMWA_TEXT_COLOR 36
#endif

using namespace Gdiplus;

// ------------------------------------------------------------------ palette
// Quiet dark surface (same as the app window) with a single amber accent,
// the colour of the Opale gem.
const Color BG(255, 0x13, 0x12, 0x18);
const Color LINE(255, 0x28, 0x26, 0x2e);
const Color INK(255, 0xf2, 0xf0, 0xec);
const Color MUTED(255, 0x9b, 0x97, 0xa3);
const Color FAINT(255, 0x6a, 0x67, 0x73);
const Color AMBER(255, 0xe0, 0xa2, 0x4a);
const Color AMBER_HOT(255, 0xea, 0xb2, 0x62);
const Color AMBER_DOWN(255, 0xc9, 0x8c, 0x38);
const Color ON_AMBER(255, 0x1c, 0x14, 0x08);
const Color GHOST_HOT(255, 0x20, 0x1f, 0x26);
const Color TRACK_OFF(255, 0x33, 0x31, 0x3a);
const Color ERROR_INK(255, 0xef, 0x8f, 0x86);

// Logical (96 dpi) client size; everything is laid out in these units.
constexpr REAL WIDTH = 560, HEIGHT = 368;

struct Payload { int id; const wchar_t* name; };
const Payload payloads[] = {
    {101, L"Opale.exe"}, {102, L"opale-server.exe"}, {103, L"pickfolder.exe"}, {104, L"Uninstall Opale.exe"}
};

enum class Stage { Ready, Installing, Done, Failed };
enum Target { NONE, PRIMARY, SECONDARY, DESKTOP, LAUNCH };

static Stage stage = Stage::Ready;
static bool desktopShortcut = true, launchAfter = true;
static int hot = NONE, pressed = NONE;
static REAL scale = 1;
static FontFamily* uiFamily;
static FontFamily* strongFamily;

// ------------------------------------------------------------------ install
static std::wstring KnownFolder(REFKNOWNFOLDERID id) {
    PWSTR path = nullptr; std::wstring result;
    if (SUCCEEDED(SHGetKnownFolderPath(id, 0, nullptr, &path))) { result = path; CoTaskMemFree(path); }
    return result;
}

static bool WriteResource(int id, const std::wstring& file) {
    HRSRC resource = FindResourceW(nullptr, MAKEINTRESOURCEW(id), RT_RCDATA);
    if (!resource) return false;
    HGLOBAL data = LoadResource(nullptr, resource);
    const DWORD size = SizeofResource(nullptr, resource);
    if (!data || !size) return false;
    HANDLE handle = CreateFileW(file.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (handle == INVALID_HANDLE_VALUE) return false;
    DWORD written = 0;
    const bool ok = WriteFile(handle, LockResource(data), size, &written, nullptr) && written == size;
    CloseHandle(handle);
    return ok;
}

static bool CreateShortcut(const std::wstring& target, const std::wstring& shortcut) {
    if (shortcut.empty()) return false;
    IShellLinkW* link = nullptr;
    if (FAILED(CoCreateInstance(CLSID_ShellLink, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&link)))) return false;
    const size_t separator = target.find_last_of(L"\\");
    const std::wstring workingDirectory = separator == std::wstring::npos ? L"" : target.substr(0, separator);
    link->SetPath(target.c_str());
    link->SetWorkingDirectory(workingDirectory.c_str());
    link->SetDescription(L"Opale — notes Markdown");
    link->SetIconLocation(target.c_str(), 0);
    IPersistFile* persist = nullptr;
    const bool ok = SUCCEEDED(link->QueryInterface(IID_PPV_ARGS(&persist))) && SUCCEEDED(persist->Save(shortcut.c_str(), TRUE));
    if (persist) persist->Release();
    link->Release();
    return ok;
}

static void RegisterUninstaller(const std::wstring& destination) {
    HKEY key = nullptr;
    if (RegCreateKeyExW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Opale", 0, nullptr, 0, KEY_SET_VALUE, nullptr, &key, nullptr) != ERROR_SUCCESS) return;
    const auto set = [&](const wchar_t* name, const std::wstring& value) { RegSetValueExW(key, name, 0, REG_SZ, reinterpret_cast<const BYTE*>(value.c_str()), DWORD((value.size() + 1) * sizeof(wchar_t))); };
    set(L"DisplayName", L"Opale"); set(L"DisplayVersion", L"0.1.0"); set(L"Publisher", L"zaalis");
    set(L"InstallLocation", destination); set(L"DisplayIcon", destination + L"\\Opale.exe");
    set(L"UninstallString", L"\"" + destination + L"\\Uninstall Opale.exe\"");
    DWORD noModify = 1; RegSetValueExW(key, L"NoModify", 0, REG_DWORD, reinterpret_cast<const BYTE*>(&noModify), sizeof(noModify));
    RegCloseKey(key);
}

static bool Install(HWND window) {
    const std::wstring base = KnownFolder(FOLDERID_LocalAppData);
    if (base.empty()) return false;
    const std::wstring destination = base + L"\\Programs\\Opale";
    const int directoryResult = SHCreateDirectoryExW(window, destination.c_str(), nullptr);
    if (directoryResult != ERROR_SUCCESS && directoryResult != ERROR_ALREADY_EXISTS && directoryResult != ERROR_FILE_EXISTS) return false;
    for (const auto& payload : payloads) if (!WriteResource(payload.id, destination + L"\\" + payload.name)) return false;

    const std::wstring exe = destination + L"\\Opale.exe";
    const std::wstring programs = KnownFolder(FOLDERID_Programs);
    if (!programs.empty()) CreateShortcut(exe, programs + L"\\Opale.lnk");
    const std::wstring desktop = KnownFolder(FOLDERID_Desktop);
    if (desktopShortcut && !desktop.empty()) CreateShortcut(exe, desktop + L"\\Opale.lnk");
    RegisterUninstaller(destination);
    // Shortcuts keep the old icon until the shell drops its cached copy.
    SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, nullptr, nullptr);
    if (launchAfter) ShellExecuteW(window, L"open", exe.c_str(), nullptr, destination.c_str(), SW_SHOWNORMAL);
    return true;
}

// ------------------------------------------------------------------ layout
static RectF PrimaryRect() { return stage == Stage::Done ? RectF(420, 308, 100, 34) : RectF(404, 308, 116, 34); }
static RectF SecondaryRect() { return RectF(296, 308, 96, 34); }
static RectF RowRect(int row) { return RectF(40, REAL(212 + row * 40), 480, 32); }
static bool ShowsOptions() { return stage == Stage::Ready || stage == Stage::Installing; }
static bool ShowsSecondary() { return stage != Stage::Done && stage != Stage::Installing; }

static int HitTest(REAL x, REAL y) {
    if (stage == Stage::Installing) return NONE;
    if (PrimaryRect().Contains(x, y)) return PRIMARY;
    if (ShowsSecondary() && SecondaryRect().Contains(x, y)) return SECONDARY;
    if (ShowsOptions() && RowRect(0).Contains(x, y)) return DESKTOP;
    if (ShowsOptions() && RowRect(1).Contains(x, y)) return LAUNCH;
    return NONE;
}

// ------------------------------------------------------------------ drawing
static void RoundedRect(GraphicsPath& path, const RectF& r, REAL radius) {
    const REAL d = radius * 2;
    path.AddArc(r.X, r.Y, d, d, 180, 90);
    path.AddArc(r.GetRight() - d, r.Y, d, d, 270, 90);
    path.AddArc(r.GetRight() - d, r.GetBottom() - d, d, d, 0, 90);
    path.AddArc(r.X, r.GetBottom() - d, d, d, 90, 90);
    path.CloseFigure();
}

static void DrawGem(Graphics& g, REAL x, REAL y, REAL size) {
    const REAL s = size / 64;
    const auto p = [&](REAL px, REAL py) { return PointF(x + px * s, y + py * s); };
    const PointF outline[] = { p(32, 4), p(54, 20), p(46, 52), p(18, 52), p(10, 20) };
    LinearGradientBrush fill(p(10, 4), p(54, 52), Color(255, 0xfd, 0xe6, 0x8a), Color(255, 0xc2, 0x41, 0x0c));
    const Color stops[] = { Color(255, 0xfd, 0xe6, 0x8a), Color(255, 0xf5, 0x9e, 0x0b), Color(255, 0xc2, 0x41, 0x0c) };
    const REAL positions[] = { 0, .5f, 1 };
    fill.SetInterpolationColors(stops, positions, 3);
    g.FillPolygon(&fill, outline, 5);
    Pen facet(Color(130, 255, 255, 255), 1.3f * s);
    facet.SetLineJoin(LineJoinRound);
    const PointF a[] = { p(32, 4), p(38, 24), p(54, 20) };
    const PointF b[] = { p(38, 24), p(24, 30), p(10, 20) };
    g.DrawLines(&facet, a, 3);
    g.DrawLines(&facet, b, 3);
    g.DrawLine(&facet, p(38, 24), p(46, 52));
    g.DrawLine(&facet, p(24, 30), p(18, 52));
    g.DrawLine(&facet, p(24, 30), p(32, 4));
}

static void Text(Graphics& g, const wchar_t* text, const RectF& box, REAL size, const Color& color, bool strong = false, StringAlignment align = StringAlignmentNear, StringAlignment valign = StringAlignmentNear) {
    Font font(strong ? strongFamily : uiFamily, size, FontStyleRegular, UnitPixel);
    SolidBrush brush(color);
    StringFormat format;
    format.SetAlignment(align);
    format.SetLineAlignment(valign);
    g.DrawString(text, -1, &font, box, &format, &brush);
}

static void DrawButton(Graphics& g, const RectF& r, const wchar_t* label, int id, bool primary, bool disabled) {
    GraphicsPath path; RoundedRect(path, r, 8);
    const bool isHot = hot == id, isDown = isHot && pressed == id;
    if (primary) {
        SolidBrush fill(disabled ? Color(255, 0x5a, 0x4a, 0x33) : isDown ? AMBER_DOWN : isHot ? AMBER_HOT : AMBER);
        g.FillPath(&fill, &path);
        Text(g, label, r, 13.5f, disabled ? Color(255, 0xc9, 0xbc, 0xa6) : ON_AMBER, true, StringAlignmentCenter, StringAlignmentCenter);
    } else {
        if (isHot) { SolidBrush fill(isDown ? LINE : GHOST_HOT); g.FillPath(&fill, &path); }
        Pen border(LINE, 1); g.DrawPath(&border, &path);
        Text(g, label, r, 13.5f, INK, false, StringAlignmentCenter, StringAlignmentCenter);
    }
}

static void DrawSwitch(Graphics& g, const RectF& row, const wchar_t* label, bool on, int id) {
    const bool enabled = stage == Stage::Ready;
    Text(g, label, RectF(row.X, row.Y, row.Width - 60, row.Height), 13.5f, enabled ? INK : MUTED, false, StringAlignmentNear, StringAlignmentCenter);
    const RectF track(row.GetRight() - 38, row.Y + (row.Height - 22) / 2, 38, 22);
    GraphicsPath path; RoundedRect(path, track, 11);
    Color trackColor = on ? (hot == id ? AMBER_HOT : AMBER) : (hot == id ? Color(255, 0x3d, 0x3b, 0x45) : TRACK_OFF);
    if (!enabled) trackColor = Color(140, trackColor.GetR(), trackColor.GetG(), trackColor.GetB());
    SolidBrush trackBrush(trackColor); g.FillPath(&trackBrush, &path);
    const REAL knob = 18, knobX = on ? track.GetRight() - knob - 2 : track.X + 2;
    SolidBrush shadow(Color(50, 0, 0, 0)); g.FillEllipse(&shadow, knobX, track.Y + 2.6f, knob, knob);
    SolidBrush knobBrush(Color(255, 0xfb, 0xfa, 0xf8)); g.FillEllipse(&knobBrush, knobX, track.Y + 2, knob, knob);
}

static void Paint(Graphics& g) {
    g.SetSmoothingMode(SmoothingModeAntiAlias);
    g.SetPixelOffsetMode(PixelOffsetModeHalf);
    g.SetTextRenderingHint(TextRenderingHintClearTypeGridFit);
    g.ScaleTransform(scale, scale);
    g.Clear(BG);

    // A faint amber glow behind the gem — the only ornament.
    GraphicsPath glowPath; glowPath.AddEllipse(-140.f, -190.f, 460.f, 400.f);
    PathGradientBrush glow(&glowPath);
    glow.SetCenterColor(Color(26, 0xe0, 0xa2, 0x4a));
    Color edge(0, 0xe0, 0xa2, 0x4a); int count = 1; glow.SetSurroundColors(&edge, &count);
    g.FillPath(&glow, &glowPath);

    DrawGem(g, 40, 40, 52);
    Text(g, L"Opale", RectF(108, 42, 400, 32), 24, INK, true);
    Text(g, L"Carnet de notes Markdown, local et relié.", RectF(109, 74, 400, 22), 13.5f, MUTED);

    const wchar_t* body =
        stage == Stage::Done ? L"Opale est installé. Vous le retrouverez dans le menu Démarrer, et sur le Bureau si vous l'avez demandé." :
        stage == Stage::Failed ? L"L'installation n'a pas pu écrire tous les fichiers. Fermez Opale s'il est ouvert, puis réessayez." :
        L"Opale s'installe pour vous seul, sans compte ni cloud. Vos notes restent de simples fichiers sur votre PC.";
    Text(g, body, RectF(40, 128, 480, 48), 13.5f, stage == Stage::Failed ? ERROR_INK : MUTED);

    Pen divider(LINE, 1); g.DrawLine(&divider, 40.f, 196.f, 520.f, 196.f);

    if (ShowsOptions()) {
        DrawSwitch(g, RowRect(0), L"Raccourci sur le Bureau", desktopShortcut, DESKTOP);
        DrawSwitch(g, RowRect(1), L"Ouvrir Opale après l'installation", launchAfter, LAUNCH);
    } else if (stage == Stage::Done) {
        SolidBrush dot(AMBER); g.FillEllipse(&dot, 40.f, 222.f, 8.f, 8.f);
        Text(g, L"Installé dans AppData\\Local\\Programs\\Opale", RectF(58, 212, 460, 28), 13.5f, INK, false, StringAlignmentNear, StringAlignmentCenter);
    }

    Text(g, stage == Stage::Done ? L"" : L"Sans droits administrateur", RectF(40, 308, 240, 34), 12, FAINT, false, StringAlignmentNear, StringAlignmentCenter);
    if (ShowsSecondary()) DrawButton(g, SecondaryRect(), stage == Stage::Failed ? L"Fermer" : L"Plus tard", SECONDARY, false, false);
    const wchar_t* primary = stage == Stage::Installing ? L"Installation…" : stage == Stage::Done ? L"Terminer" : stage == Stage::Failed ? L"Réessayer" : L"Installer";
    DrawButton(g, PrimaryRect(), primary, PRIMARY, true, stage == Stage::Installing);
}

// ------------------------------------------------------------------ window
static void Activate(HWND window, int target) {
    switch (target) {
    case DESKTOP: desktopShortcut = !desktopShortcut; break;
    case LAUNCH: launchAfter = !launchAfter; break;
    case SECONDARY: DestroyWindow(window); return;
    case PRIMARY:
        if (stage == Stage::Done) { DestroyWindow(window); return; }
        stage = Stage::Installing; hot = NONE;
        InvalidateRect(window, nullptr, FALSE); UpdateWindow(window);
        stage = Install(window) ? Stage::Done : Stage::Failed;
        break;
    default: return;
    }
    InvalidateRect(window, nullptr, FALSE);
}

static void Resize(HWND window, UINT dpi) {
    scale = dpi / 96.f;
    RECT r{ 0, 0, LONG(WIDTH * scale + .5f), LONG(HEIGHT * scale + .5f) };
    AdjustWindowRectExForDpi(&r, WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX, FALSE, 0, dpi);
    MONITORINFO info{ sizeof(info) }; GetMonitorInfoW(MonitorFromWindow(window, MONITOR_DEFAULTTOPRIMARY), &info);
    const int w = r.right - r.left, h = r.bottom - r.top;
    const RECT& area = info.rcWork;
    SetWindowPos(window, nullptr, area.left + (area.right - area.left - w) / 2, area.top + (area.bottom - area.top - h) / 2, w, h, SWP_NOZORDER | SWP_NOACTIVATE);
}

static LRESULT CALLBACK WindowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
    switch (message) {
    case WM_ERASEBKGND: return 1;
    case WM_PAINT: {
        PAINTSTRUCT ps{}; HDC dc = BeginPaint(window, &ps);
        RECT client{}; GetClientRect(window, &client);
        Bitmap buffer(client.right, client.bottom, PixelFormat32bppPARGB);
        { Graphics g(&buffer); Paint(g); }
        Graphics screen(dc); screen.SetCompositingMode(CompositingModeSourceCopy); screen.DrawImage(&buffer, 0, 0);
        EndPaint(window, &ps); return 0;
    }
    case WM_MOUSEMOVE: {
        const int target = HitTest(GET_X_LPARAM(lParam) / scale, GET_Y_LPARAM(lParam) / scale);
        if (target != hot) { hot = target; InvalidateRect(window, nullptr, FALSE); }
        TRACKMOUSEEVENT track{ sizeof(track), TME_LEAVE, window, 0 }; TrackMouseEvent(&track);
        return 0;
    }
    case WM_MOUSELEAVE: if (hot != NONE) { hot = NONE; InvalidateRect(window, nullptr, FALSE); } return 0;
    case WM_SETCURSOR:
        if (LOWORD(lParam) == HTCLIENT) { SetCursor(LoadCursorW(nullptr, hot != NONE ? IDC_HAND : IDC_ARROW)); return TRUE; }
        break;
    case WM_LBUTTONDOWN: pressed = hot; SetCapture(window); InvalidateRect(window, nullptr, FALSE); return 0;
    case WM_LBUTTONUP: {
        ReleaseCapture();
        const int target = pressed; pressed = NONE;
        if (target != NONE && target == HitTest(GET_X_LPARAM(lParam) / scale, GET_Y_LPARAM(lParam) / scale)) Activate(window, target);
        else InvalidateRect(window, nullptr, FALSE);
        return 0;
    }
    case WM_KEYDOWN:
        if (wParam == VK_RETURN && stage != Stage::Installing) Activate(window, PRIMARY);
        else if (wParam == VK_ESCAPE && stage != Stage::Installing) DestroyWindow(window);
        return 0;
    case WM_DPICHANGED: {
        scale = HIWORD(wParam) / 96.f;
        const RECT* suggested = reinterpret_cast<RECT*>(lParam);
        SetWindowPos(window, nullptr, suggested->left, suggested->top, suggested->right - suggested->left, suggested->bottom - suggested->top, SWP_NOZORDER | SWP_NOACTIVATE);
        return 0;
    }
    case WM_CLOSE: if (stage == Stage::Installing) return 0; break;
    case WM_DESTROY: PostQuitMessage(0); return 0;
    }
    return DefWindowProcW(window, message, wParam, lParam);
}

static FontFamily* PickFamily(std::initializer_list<const wchar_t*> names) {
    for (const wchar_t* name : names) {
        auto* family = new FontFamily(name);
        if (family->IsAvailable()) return family;
        delete family;
    }
    return FontFamily::GenericSansSerif()->Clone();
}

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int) {
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    GdiplusStartupInput gdiplusInput; ULONG_PTR gdiplusToken = 0;
    GdiplusStartup(&gdiplusToken, &gdiplusInput, nullptr);
    uiFamily = PickFamily({ L"Segoe UI Variable Text", L"Segoe UI" });
    strongFamily = PickFamily({ L"Segoe UI Semibold", L"Segoe UI Variable Text", L"Segoe UI" });

    WNDCLASSW wc{}; wc.hInstance = instance; wc.lpszClassName = L"OpaleInstaller"; wc.lpfnWndProc = WindowProc;
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW); wc.hIcon = LoadIconW(instance, MAKEINTRESOURCEW(1));
    RegisterClassW(&wc);
    HWND window = CreateWindowExW(0, wc.lpszClassName, L"Installer Opale", WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX, CW_USEDEFAULT, CW_USEDEFAULT, 600, 400, nullptr, nullptr, instance, nullptr);

    BOOL dark = TRUE; DwmSetWindowAttribute(window, DWMWA_USE_IMMERSIVE_DARK_MODE, &dark, sizeof(dark));
    COLORREF caption = RGB(0x13, 0x12, 0x18), captionText = RGB(0xc6, 0xc3, 0xd3);
    DwmSetWindowAttribute(window, DWMWA_CAPTION_COLOR, &caption, sizeof(caption));
    DwmSetWindowAttribute(window, DWMWA_TEXT_COLOR, &captionText, sizeof(captionText));
    Resize(window, GetDpiForWindow(window));

    ShowWindow(window, SW_SHOW); UpdateWindow(window);
    MSG msg{}; while (GetMessageW(&msg, nullptr, 0, 0)) { TranslateMessage(&msg); DispatchMessageW(&msg); }
    delete uiFamily; delete strongFamily;
    GdiplusShutdown(gdiplusToken); CoUninitialize(); return 0;
}

