@echo off
REM ============================================================
REM  Builds the Opale desktop application into ..\dist\ :
REM    Opale.exe          native window (C++ + WebView2)
REM    pickfolder.exe     native folder dialog
REM    opale-server.exe   the Node server, packaged (--with-server)
REM    Opale-Setup.exe    optional self-contained Windows installer (--installer)
REM  Requires Visual Studio with the C++ workload (MSVC). The WebView2 SDK
REM  files it needs are in native\webview2 (version 1.0.3967.48).
REM  Without opale-server.exe, Opale.exe runs ..\server.js with Node.
REM ============================================================
setlocal
cd /d "%~dp0"

set "VSPATH="
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if exist "%VSWHERE%" for /f "usebackq delims=" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VSPATH=%%i"
if not defined VSPATH if exist "C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat" set "VSPATH=C:\Program Files\Microsoft Visual Studio\18\Community"
if not defined VSPATH if exist "C:\Program Files\Microsoft Visual Studio\17\Community\VC\Auxiliary\Build\vcvars64.bat" set "VSPATH=C:\Program Files\Microsoft Visual Studio\17\Community"
if not defined VSPATH goto :novs
set "VCVARS=%VSPATH%\VC\Auxiliary\Build\vcvars64.bat"
if not exist "%VCVARS%" goto :nocpp
call "%VCVARS%" >nul

if not exist ..\dist mkdir ..\dist

echo Compiling icon resource ...
rc /nologo /fo ..\dist\opale.res opale.rc
if errorlevel 1 goto :failed

echo Compiling main.cpp ...
cl /nologo /std:c++17 /utf-8 /EHsc /O2 /W3 /DUNICODE /D_UNICODE main.cpp /I "webview2\include" /Fe:..\dist\Opale.exe /Fo:..\dist\ /link /SUBSYSTEM:WINDOWS ..\dist\opale.res "webview2\x64\WebView2LoaderStatic.lib" ws2_32.lib ole32.lib oleaut32.lib version.lib advapi32.lib shell32.lib shlwapi.lib user32.lib gdi32.lib dwmapi.lib uuid.lib /MANIFEST:EMBED
if errorlevel 1 goto :failed

echo Compiling pickfolder.cpp ...
cl /nologo /std:c++17 /utf-8 /EHsc /O2 /DUNICODE /D_UNICODE pickfolder.cpp /Fe:..\dist\pickfolder.exe /Fo:..\dist\ /link /SUBSYSTEM:CONSOLE ole32.lib shell32.lib uuid.lib user32.lib
if errorlevel 1 goto :failed
del /Q ..\dist\*.obj ..\dist\opale.res >nul 2>&1

if /I "%~1"=="--with-server" (
    echo Packaging opale-server.exe ...
    pushd ..
    if not exist node_modules\@yao-pkg\pkg call npm install --no-audit --no-fund
    call npx --no-install pkg . --targets node22-win-x64 --no-bytecode --public --output dist\opale-server.exe
    if errorlevel 1 ( popd & goto :failed )
    popd
)

if /I "%~2"=="--installer" (
    echo Compiling uninstaller ...
    cl /nologo /std:c++17 /utf-8 /EHsc /O2 /W3 /DUNICODE /D_UNICODE uninstaller.cpp /Fe:"..\dist\Uninstall Opale.exe" /link /SUBSYSTEM:WINDOWS ole32.lib shell32.lib shlwapi.lib advapi32.lib user32.lib
    if errorlevel 1 goto :failed
    echo Packaging Opale installer ...
    rc /nologo /fo ..\dist\installer.res installer.rc
    if errorlevel 1 goto :failed
    cl /nologo /std:c++17 /utf-8 /EHsc /O2 /W3 /DUNICODE /D_UNICODE installer.cpp /Fe:"..\dist\Opale-Setup.exe" /link /SUBSYSTEM:WINDOWS ..\dist\installer.res ole32.lib shell32.lib shlwapi.lib advapi32.lib user32.lib gdi32.lib uuid.lib
    if errorlevel 1 goto :failed
    del /Q "..\dist\installer.res" >nul 2>&1
)

echo.
echo Done. The application is in dist\
goto :eof

:novs
echo ERROR: Visual Studio not found.
exit /b 1
:nocpp
echo ERROR: C++ workload (vcvars64.bat) not found.
exit /b 1
:failed
echo.
echo BUILD FAILED.
exit /b 1
