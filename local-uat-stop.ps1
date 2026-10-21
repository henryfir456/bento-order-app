param([switch]$Quiet)

$ErrorActionPreference = 'Stop'
$repoRoot = $PSScriptRoot
$stateFile = Join-Path $repoRoot 'worker-poc\.local-uat\processes.json'

if (-not (Test-Path $stateFile)) {
    if (-not $Quiet) { Write-Host 'No local UAT launcher processes are recorded.' }
    exit 0
}

$processState = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
$targets = @(
    @{ Id = [int]$processState.WorkerPid; Runner = [string]$processState.WorkerRunner; Name = 'Worker' },
    @{ Id = [int]$processState.FrontendPid; Runner = [string]$processState.FrontendRunner; Name = 'frontend' }
)

foreach ($target in $targets) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($target.Id)" -ErrorAction SilentlyContinue
    if (-not $process) { continue }
    $commandLine = [string]$process.CommandLine
    if ($commandLine -and $commandLine.IndexOf($target.Runner, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
        & taskkill.exe /PID $target.Id /T /F | Out-Null
        if (-not $Quiet) { Write-Host "Stopped local UAT $($target.Name)." }
    }
    elseif (-not $Quiet) {
        Write-Host "Skipped PID $($target.Id) because it no longer matches the recorded local UAT runner."
    }
}

$deviceSerial = [string]$processState.DeviceSerial
$adb = Get-Command adb -ErrorAction SilentlyContinue
if ($deviceSerial -and $adb) {
    & $adb.Source -s $deviceSerial reverse --remove tcp:5173 2>$null | Out-Null
    & $adb.Source -s $deviceSerial reverse --remove tcp:8787 2>$null | Out-Null
}

Remove-Item -LiteralPath $stateFile -Force -ErrorAction SilentlyContinue
if (-not $Quiet) { Write-Host 'Local UAT services stopped.' }
