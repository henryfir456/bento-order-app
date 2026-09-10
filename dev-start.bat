@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev-start.ps1"
if errorlevel 1 (
    echo.
    echo Startup failed.
    pause
)
