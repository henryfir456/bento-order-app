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

$wrangler = Join-Path $workerRoot 'node_modules\wrangler\bin\wrangler.js'
& node $wrangler --config wrangler.local-uat.jsonc dev --local --ip 127.0.0.1 --port 8787 --persist-to .local-uat\state --log-level warn --env-file .local-uat\secrets.env
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Local Worker exited. Check the output above, then close this window.' -ForegroundColor Red
}
