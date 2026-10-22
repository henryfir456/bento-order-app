# Opens the app in local Mock mode signed in as the synthetic Vendor, so the
# Vendor screens can be viewed without a Worker, LINE, or any real account.
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot

function Test-PortFree {
    param([int]$Port)
    $netTcp = Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue
    if ($netTcp -and (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) {
        return $false
    }
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

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js is required. Install the current Node.js LTS release and run this again.'
}

$vite = [System.IO.Path]::Combine($repoRoot, 'node_modules', 'vite', 'bin', 'vite.js')
if (-not (Test-Path -LiteralPath $vite)) {
    Write-Host 'Installing frontend dependencies (first run only)...'
    & npm ci
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
}

$port = $null
foreach ($candidate in 5180..5199) {
    if (Test-PortFree -Port $candidate) { $port = $candidate; break }
}
if ($null -eq $port) { throw 'No free port found in 5180-5199.' }
$url = "http://127.0.0.1:$port/"

# Non-empty values override anything in .env, .env.local or .env.development.
$env:VITE_AUTH_MODE = 'mock'
$env:VITE_MOCK_USER = 'vendor'
$env:VITE_API_TRANSPORT = 'gas'
$env:VITE_GAS_API_URL = 'http://127.0.0.1/mock-only'
$env:VITE_WORKER_API_URL = 'http://127.0.0.1/mock-only'

# Open the browser once Vite answers, from a separate hidden process so the
# server keeps running in this window.
$opener = "`$deadline = (Get-Date).AddSeconds(90); while ((Get-Date) -lt `$deadline) { try { Invoke-WebRequest -Uri '$url' -UseBasicParsing -TimeoutSec 2 | Out-Null; Start-Process '$url'; break } catch { Start-Sleep -Milliseconds 500 } }"
$shell = if (Get-Command powershell.exe -ErrorAction SilentlyContinue) { 'powershell.exe' } else { 'pwsh' }
Start-Process -FilePath $shell -ArgumentList @('-NoProfile', '-WindowStyle', 'Hidden', '-Command', $opener) | Out-Null

Write-Host ''
Write-Host "Vendor preview (local Mock, synthetic data): $url" -ForegroundColor Green
Write-Host 'The browser opens automatically. If it does not, copy the URL above into the browser.'
Write-Host 'Close this window (or press Ctrl+C) to stop.'
Write-Host ''
& node $vite --host 127.0.0.1 --port $port --strictPort
