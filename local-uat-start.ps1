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

function Find-FreePort {
    param([int]$First, [int]$Last)
    foreach ($candidate in $First..$Last) {
        # A dev server on localhost may listen only on IPv6 (::1); skip any port
        # that already has a listener on any address, not just IPv4 loopback.
        $listening = Get-NetTCPConnection -LocalPort $candidate -State Listen -ErrorAction SilentlyContinue
        if (-not $listening -and (Test-PortAvailable -Port $candidate)) { return $candidate }
    }
    return $null
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

# Prefer the default ports, but never take over a port another program already
# uses (for example a normal dev server on 5173): move to the next free one.
$frontendPort = Find-FreePort -First 5173 -Last 5199
if ($null -eq $frontendPort) {
    throw 'No free port found in 5173-5199 for the local UAT frontend. Stop an unused dev server and rerun the launcher.'
}
$workerPort = Find-FreePort -First 8787 -Last 8799
if ($null -eq $workerPort) {
    throw 'No free port found in 8787-8799 for the local UAT Worker. Stop an unused Worker and rerun the launcher.'
}
$frontendUrl = "http://localhost:$frontendPort"
$workerUrl = "http://localhost:$workerPort"
if ($frontendPort -ne 5173 -or $workerPort -ne 8787) {
    Write-Host "Default port in use; using frontend port $frontendPort and Worker port $workerPort." -ForegroundColor Yellow
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

$workerProcess = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-File', ('"' + $workerRunner + '"'), '-Port', $workerPort, '-FrontendPort', $frontendPort) -WorkingDirectory $workerRoot -PassThru
Start-Sleep -Milliseconds 700
if ($workerProcess.HasExited) {
    throw 'The local Worker process did not start. Inspect the Worker window for its error.'
}

$frontendProcess = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-File', ('"' + $frontendRunner + '"'), '-Port', $frontendPort, '-WorkerPort', $workerPort) -WorkingDirectory $repoRoot -PassThru
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
        & $adb.Source -s $deviceSerial reverse "tcp:$frontendPort" "tcp:$frontendPort" | Out-Null
        $frontendReverse = $LASTEXITCODE -eq 0
        & $adb.Source -s $deviceSerial reverse "tcp:$workerPort" "tcp:$workerPort" | Out-Null
        $workerReverse = $LASTEXITCODE -eq 0
        if (-not ($frontendReverse -and $workerReverse)) {
            & $adb.Source -s $deviceSerial reverse --remove "tcp:$frontendPort" 2>$null | Out-Null
            & $adb.Source -s $deviceSerial reverse --remove "tcp:$workerPort" 2>$null | Out-Null
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
    FrontendPort = $frontendPort
    WorkerPort = $workerPort
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
    Write-Host "Android: the forwarded USB device can open $frontendUrl on the phone."
}
else {
    Write-Host "Android: use USB debugging; run adb reverse tcp:$frontendPort tcp:$frontendPort and adb reverse tcp:$workerPort tcp:$workerPort, then open $frontendUrl on the phone."
}
Write-Host "API smoke:    node worker-poc\scripts\local-uat-smoke.mjs http://127.0.0.1:$workerPort"
Write-Host 'Synthetic-only accounts; local Worker and D1 bind to loopback and do not use production credentials.'
Write-Host 'Run .\local-uat-stop.ps1 to stop the test services.'

Start-Process $frontendUrl
