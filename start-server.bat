@echo off
setlocal
cd /d "%~dp0"

set "GAMEPLAY_PORT=12345"
set "HOST=127.0.0.1"
set "MP_LOCAL_SERVER=1"
set "MP_SERVER_LOG_COLOR=1"

if not exist "dist\src\main.js" (
    echo Building the server for first use...
    call npm run build
    if errorlevel 1 goto :failed
)

echo Starting Experimental Multiplayer on 127.0.0.1:12345
echo Keep this window open while playing. Press Ctrl+C to stop the server.
node "dist\src\main.js"
if errorlevel 1 goto :failed
goto :eof

:failed
echo.
echo The server could not start. Review the error above.
pause
exit /b 1
