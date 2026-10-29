@echo off
setlocal
cd /d "%~dp0worker-poc" || goto :fail

if not exist "node_modules\wrangler\bin\wrangler.js" (
    echo [info] worker-poc\node_modules not found, running npm install first...
    call npm install || goto :fail
)

echo [info] Opening browser for Cloudflare login...
if exist "node_modules\wrangler\bin\wrangler.js" (
    node ".\node_modules\wrangler\bin\wrangler.js" login
) else (
    call npx wrangler login
)
if errorlevel 1 goto :fail

echo.
echo [ok] wrangler login finished.
echo Go back to Claude and say "already logged in" so it can continue.
pause
exit /b 0

:fail
echo.
echo [error] wrangler login failed. Check the messages above, then retry.
pause
exit /b 1
