// Exercise the production transaction without opening a window or restarting Opale.
#define wWinMain OpaleInstallerEntry
#include "../native/installer.cpp"
#undef wWinMain
#include <filesystem>
#include <fstream>
#include <iostream>

int wmain() {
    wchar_t temp[MAX_PATH]; GetTempPathW(MAX_PATH, temp);
    auto root = std::filesystem::path(temp) / (L"opale-native-update-" + std::to_wstring(GetCurrentProcessId()));
    std::filesystem::create_directory(root);
    updateDestination = root.wstring();
    const std::string original = "original-test-binary";
    for (const auto& payload : payloads) { std::ofstream file(root / payload.name, std::ios::binary); file << original; }
    HANDLE lock = CreateFileW((root / L"opale-server.exe").c_str(), GENERIC_READ, 0, nullptr, OPEN_EXISTING, 0, nullptr);
    if (lock == INVALID_HANDLE_VALUE) return 2;
    bool rejected = !InstallUpdate(nullptr);
    CloseHandle(lock);
    bool restored = true;
    for (const auto& payload : payloads) {
        std::ifstream file(root / payload.name, std::ios::binary);
        std::string content((std::istreambuf_iterator<char>(file)), {});
        restored &= content == original;
    }
    if (!rejected || !restored) return 3;
    std::cout << "PASS locked destination fails and restores every previous binary\n";
    if (!InstallUpdate(nullptr)) return 4;
    for (const auto& payload : payloads) {
        auto resource = FindResourceW(nullptr, MAKEINTRESOURCEW(payload.id), RT_RCDATA);
        auto data = LoadResource(nullptr, resource); DWORD size = SizeofResource(nullptr, resource);
        std::ifstream file(root / payload.name, std::ios::binary);
        std::string content((std::istreambuf_iterator<char>(file)), {});
        if (content.size() != size || memcmp(content.data(), LockResource(data), size)) return 5;
    }
    if (updateProgress != 100) return 6;
    std::cout << "PASS all four embedded Windows binaries installed byte-for-byte; progress 100%\n";
    std::filesystem::remove_all(root);
    return 0;
}
