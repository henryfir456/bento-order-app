$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot
$Host.UI.RawUI.WindowTitle = 'Bento Local UAT Frontend'
$env:VITE_AUTH_MODE = 'local-uat'
$env:VITE_API_TRANSPORT = 'worker'
$env:VITE_WORKER_API_URL = 'http://localhost:8787'

& npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Local frontend exited. Check the output above, then close this window.' -ForegroundColor Red
}
