# Creates "Opale" shortcuts (Desktop and Start menu) pointing at dist\Opale.exe,
# and registers the application for zaalis IDE's one-click connection.
# Usage: powershell -ExecutionPolicy Bypass -File create-shortcut.ps1 [-Remove]
param([switch]$Remove)
$ErrorActionPreference = 'Stop'

$exe = Join-Path (Split-Path $PSScriptRoot -Parent) 'dist\Opale.exe'
$targets = @(
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Opale.lnk'),
    (Join-Path ([Environment]::GetFolderPath('Programs')) 'Opale.lnk')
)

if ($Remove) {
    foreach ($link in $targets) { if (Test-Path $link) { Remove-Item $link -Confirm:$false; Write-Output "Removed $link" } }
    return
}

if (-not (Test-Path $exe)) { throw "Opale.exe not found: build it first with native\build.bat ($exe)" }
$shell = New-Object -ComObject WScript.Shell
foreach ($link in $targets) {
    $shortcut = $shell.CreateShortcut($link)
    $shortcut.TargetPath = $exe
    $shortcut.WorkingDirectory = Split-Path $exe -Parent
    $shortcut.IconLocation = "$exe,0"
    $shortcut.Description = 'Opale - notes Markdown'
    $shortcut.Save()
    Write-Output "Created $link"
}

# Record where Opale lives, so zaalis IDE can detect it (and start it) before
# Opale has ever been launched. Opale rewrites this file on every start.
$appData = if ($env:OPALE_HOME) { $env:OPALE_HOME } else { Join-Path $env:APPDATA 'Opale' }
New-Item -ItemType Directory -Force -Path $appData | Out-Null
$install = @{ app = 'opale'; launch = @{ file = $exe; args = @(); cwd = (Split-Path $exe -Parent) }; updatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
[System.IO.File]::WriteAllText((Join-Path $appData 'install.json'), ($install | ConvertTo-Json -Depth 4), (New-Object System.Text.UTF8Encoding($false)))
Write-Output "Registered $exe in $appData\install.json"
