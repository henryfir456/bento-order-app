$ErrorActionPreference = "Stop"

$repoRoot = $PSScriptRoot

Write-Host "Starting Vite..."

Start-Process powershell.exe -ArgumentList @(
    "-NoExit",
    "-Command",
    "Set-Location '$repoRoot'; npm run dev"
)

Start-Sleep -Seconds 2

Write-Host "Starting Pinggy..."

Start-Process powershell.exe -ArgumentList @(
    "-NoExit",
    "-Command",
    "ssh -p 443 -R0:localhost:5173 free.pinggy.io"
)

Write-Host ""
Write-Host "Vite and Pinggy started."
Write-Host "Check the Pinggy terminal for the public URL."

