@echo off
REM Double-click to view the Vendor screens in local Mock mode (synthetic data only).
REM Output is also saved to vendor-preview.log next to this file.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "& { try { & '%~dp0scripts\vendor-preview.ps1' } catch { Write-Host ('ERROR: ' + $_) -ForegroundColor Red } } *>&1 | Tee-Object -FilePath '%~dp0vendor-preview.log'"
echo.
echo Log saved to %~dp0vendor-preview.log
pause
