#include <windows.h>
#include <shlobj.h>
#include <shlwapi.h>
#include <string>

#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "shlwapi.lib")
#pragma comment(lib, "advapi32.lib")

static std::wstring KnownFolder(REFKNOWNFOLDERID id) {
    PWSTR path = nullptr;
    std::wstring result;
    if (SUCCEEDED(SHGetKnownFolderPath(id, 0, nullptr, &path))) {
        result = path;
        CoTaskMemFree(path);
    }
    return result;
}

static void RemoveShortcut(const std::wstring& folder) {
    if (!folder.empty()) DeleteFileW((folder + L"\\Opale.lnk").c_str());
}

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
    wchar_t module[MAX_PATH]{};
    GetModuleFileNameW(nullptr, module, MAX_PATH);
    PathRemoveFileSpecW(module);
    const std::wstring installDir = module;

    const int choice = MessageBoxW(nullptr,
        L"Désinstaller Opale ?\n\nVos coffres de notes et vos réglages ne seront pas supprimés.",
        L"Opale — Désinstallation", MB_ICONQUESTION | MB_YESNO | MB_DEFBUTTON2);
    if (choice != IDYES) return 0;

    RemoveShortcut(KnownFolder(FOLDERID_Desktop));
    RemoveShortcut(KnownFolder(FOLDERID_Programs));
    RegDeleteTreeW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Opale");

    const std::wstring appData = KnownFolder(FOLDERID_RoamingAppData);
    if (!appData.empty()) DeleteFileW((appData + L"\\Opale\\install.json").c_str());

    std::wstring command = L"/c timeout /t 1 /nobreak >nul & rmdir /s /q \"" + installDir + L"\"";
    ShellExecuteW(nullptr, L"open", L"cmd.exe", command.c_str(), nullptr, SW_HIDE);
    return 0;
}
