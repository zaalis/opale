param([Parameter(Mandatory=$true)][string]$InputPath, [Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference = 'Stop'
$opalePowerPoint = $null
$opalePresentation = $null
$opaleInitialCount = 0
try {
    $opalePowerPoint = New-Object -ComObject PowerPoint.Application
    $opaleInitialCount = $opalePowerPoint.Presentations.Count
    $opalePreviousSecurity = $opalePowerPoint.AutomationSecurity
    $opalePreviousAlerts = $opalePowerPoint.DisplayAlerts
    $opalePowerPoint.AutomationSecurity = 3
    $opalePowerPoint.DisplayAlerts = 1
    $opalePresentation = $opalePowerPoint.Presentations.Open($InputPath, -1, 0, 0)
    $opalePresentation.SaveAs($OutputPath, 32)
} catch {
    [Console]::Error.WriteLine('Conversion PowerPoint indisponible. PowerPoint doit être installé et activé sur cet ordinateur. Vous pouvez aussi déposer une version PDF. ' + $_.Exception.Message)
    exit 1
} finally {
    if ($null -ne $opalePresentation) { $opalePresentation.Close(); [System.Runtime.InteropServices.Marshal]::ReleaseComObject($opalePresentation) | Out-Null }
    if ($null -ne $opalePowerPoint) {
        try { $opalePowerPoint.AutomationSecurity = $opalePreviousSecurity; $opalePowerPoint.DisplayAlerts = $opalePreviousAlerts } catch {}
        # Do not close presentations that the user already had open.
        if ($opaleInitialCount -eq 0 -and $opalePowerPoint.Presentations.Count -eq 0) { $opalePowerPoint.Quit() }
        [System.Runtime.InteropServices.Marshal]::ReleaseComObject($opalePowerPoint) | Out-Null
    }
}
