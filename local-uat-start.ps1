$ErrorActionPreference = 'Stop'
Get-ChildItem Env: | Where-Object { $_.Name -match '^(CLOUDFLARE_|CF_)' } | ForEach-Object {
    Remove-Item -Path ('Env:' + $_.Name) -ErrorAction SilentlyContinue
}

$repoRoot = $PSScriptRoot
$workerRoot = Join-Path $repoRoot 'worker-poc'
$uatDirectory = Join-Path $workerRoot '.local-uat'
$stateFile = Join-Path $uatDirectory 'processes.json'
$workerRunner = Join-Path $workerRoot 'scripts\local-uat-worker.ps1'
$frontendRunner = Join-Path $repoRoot 'scripts\local-uat-frontend.ps1'
$frontendUrl = 'http://localhost:5173'
$workerUrl = 'http://localhost:8787'

function Test-PortAvailable {
    param([int]$Port)
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
    try {
        $listener.Start()
        return $true
    }
    catch {
        return $false
    }
    finally {
        $listener.Stop()
    }
}

function Wait-ForHttp {
    param([string]$Url, [int]$TimeoutSeconds = 60)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $Url -TimeoutSec 2 -UseBasicParsing
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                return $true
            }
        }
        catch {
            Start-Sleep -Milliseconds 500
        }
    }
    return $false
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js is required. Install the current Node.js LTS release and rerun this script.'
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw 'npm is required. Install the current Node.js LTS release and rerun this script.'
}

if (Test-Path $stateFile) {
    & (Join-Path $repoRoot 'local-uat-stop.ps1') -Quiet
}

foreach ($port in @(5173, 8787)) {
    if (-not (Test-PortAvailable -Port $port)) {
        throw "Port $port is already in use. Stop that service and rerun the local UAT launcher."
    }
}

if (-not (Test-Path (Join-Path $repoRoot 'node_modules\vite\bin\vite.js'))) {
    Write-Host 'Installing frontend dependencies...'
    & npm ci --prefix $repoRoot
    if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' }
}
if (-not (Test-Path (Join-Path $workerRoot 'node_modules\wrangler\bin\wrangler.js'))) {
    Write-Host 'Installing Worker dependencies...'
    & npm ci --prefix $workerRoot
    if ($LASTEXITCODE -ne 0) { throw 'Worker dependency installation failed.' }
}

New-Item -ItemType Directory -Path $uatDirectory -Force | Out-Null
Write-Host 'Resetting the disposable local D1 and creating synthetic fixtures...'
Push-Location $workerRoot
try {
    & node scripts\local-uat.mjs reset
    if ($LASTEXITCODE -ne 0) { throw 'Local D1 reset and seed failed.' }
}
finally {
    Pop-Location
}

$workerProcess = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-File', ('"' + $workerRunner + '"')) -WorkingDirectory $workerRoot -PassThru
Start-Sleep -Milliseconds 700
if ($workerProcess.HasExited) {
    throw 'The local Worker process did not start. Inspect the Worker window for its error.'
}

$frontendProcess = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-File', ('"' + $frontendRunner + '"')) -WorkingDirectory $repoRoot -PassThru
Start-Sleep -Milliseconds 700
if ($frontendProcess.HasExited) {
    Stop-Process -Id $workerProcess.Id -Force -ErrorAction SilentlyContinue
    throw 'The local frontend process did not start. Inspect the frontend window for its error.'
}

$deviceSerial = $null
$adb = Get-Command adb -ErrorAction SilentlyContinue
if ($adb) {
    $deviceLines = @(& $adb.Source devices 2>$null | Select-Object -Skip 1 | Where-Object {
        $_ -match '^\S+\s+device$' -and ($_ -split '\s+')[0] -notmatch ':'
    })
    if ($deviceLines.Count -eq 1) {
        $deviceSerial = ($deviceLines[0] -split '\s+')[0]
        & $adb.Source -s $deviceSerial reverse tcp:5173 tcp:5173 | Out-Null
        $frontendReverse = $LASTEXITCODE -eq 0
        & $adb.Source -s $deviceSerial reverse tcp:8787 tcp:8787 | Out-Null
        $workerReverse = $LASTEXITCODE -eq 0
        if (-not ($frontendReverse -and $workerReverse)) {
            $deviceSerial = $null
            Write-Host 'ADB port forwarding failed. The PC URL is available; reconnect Android by USB and rerun this launcher.' -ForegroundColor Yellow
        }
    }
    elseif ($deviceLines.Count -gt 1) {
        Write-Host 'Connect one Android device at a time for USB testing. The PC URL is available.' -ForegroundColor Yellow
    }
}

$processState = [ordered]@{
    WorkerPid = $workerProcess.Id
    FrontendPid = $frontendProcess.Id
    WorkerRunner = [System.IO.Path]::GetFullPath($workerRunner)
    FrontendRunner = [System.IO.Path]::GetFullPath($frontendRunner)
    DeviceSerial = $deviceSerial
}
$processState | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8

if (-not (Wait-ForHttp -Url ($workerUrl + '/api/health'))) {
    & (Join-Path $repoRoot 'local-uat-stop.ps1') -Quiet
    throw 'Worker HTTP health endpoint did not become ready. Review the Worker window.'
}
if (-not (Wait-ForHttp -Url $frontendUrl)) {
    & (Join-Path $repoRoot 'local-uat-stop.ps1') -Quiet
    throw 'Frontend HTTP endpoint did not become ready. Review the frontend window.'
}

Write-Host ''
Write-Host 'Local isolated UAT is ready.' -ForegroundColor Green
Write-Host "Frontend URL: $frontendUrl"
Write-Host "Worker API:   $workerUrl"
Write-Host "Credentials:  $(Join-Path $uatDirectory 'credentials.txt')"
if ($deviceSerial) {
    Write-Host 'Android: the forwarded USB device can open http://localhost:5173 on the phone.'
}
else {
    Write-Host 'Android: use USB debugging; run adb reverse tcp:5173 tcp:5173 and adb reverse tcp:8787 tcp:8787, then open http://localhost:5173 on the phone.'
}
Write-Host 'Synthetic-only accounts; local Worker and D1 bind to loopback and do not use production credentials.'
Write-Host 'Run .\local-uat-stop.ps1 to stop the test services.'

Start-Process $frontendUrl
