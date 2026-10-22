param([int]$Port = 8787, [int]$FrontendPort = 5173)
$ErrorActionPreference = 'Stop'
$workerRoot = Split-Path -Parent $PSScriptRoot
$uatDirectory = Join-Path $workerRoot '.local-uat'
Set-Location -LiteralPath $workerRoot
$Host.UI.RawUI.WindowTitle = 'Bento Local UAT Worker'
Get-ChildItem Env: | Where-Object { $_.Name -match '^(CLOUDFLARE_|CF_)' } | ForEach-Object {
    Remove-Item -Path ('Env:' + $_.Name) -ErrorAction SilentlyContinue
}
$env:CI = '1'
$env:XDG_CONFIG_HOME = Join-Path $uatDirectory 'wrangler-config'
$env:WRANGLER_SEND_METRICS = 'false'

# The launcher may move the frontend off 5173 when that port is busy; allow
# exactly that local origin for CORS.
$frontendOrigins = "http://localhost:$FrontendPort,http://127.0.0.1:$FrontendPort"
$wrangler = Join-Path $workerRoot 'node_modules\wrangler\bin\wrangler.js'
& node $wrangler --config wrangler.local-uat.jsonc dev --local --ip 127.0.0.1 --port $Port --persist-to .local-uat\state --log-level warn --env-file .local-uat\secrets.env `
    --var "DEV_ALLOWED_ORIGINS:$frontendOrigins" --var "APP_ORIGIN:http://localhost:$FrontendPort"
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Local Worker exited. Check the output above, then close this window.' -ForegroundColor Red
}
