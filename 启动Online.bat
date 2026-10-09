@echo off
setlocal
cd /d "%~dp0"

rem Fixed ports: frontend\vite.config.ts proxies /api and /files to 127.0.0.1:8000.
set "BACKEND_PORT=8000"
set "FRONTEND_PORT=5173"

if not exist "backend\.venv\Scripts\python.exe" (
    echo [ERROR] Backend virtual environment not found: backend\.venv
    echo Create it and install backend\requirements-dev.txt first.
    goto :fail
)

if not exist "frontend\node_modules\vite\bin\vite.js" (
    echo [ERROR] Frontend dependencies not found: frontend\node_modules
    echo Run "npm install" in the frontend directory first.
    goto :fail
)

if not exist "backend\.env" (
    echo [WARN] backend\.env not found. Copy backend\.env.example if needed.
)

rem Refuse to start on a busy port, so the addresses printed below are the real ones.
call :check_port %BACKEND_PORT% Backend || goto :fail
call :check_port %FRONTEND_PORT% Frontend || goto :fail

rem LAN IP = the connected physical adapter that has a default gateway (skips VPN / virtual adapters).
set "LANIP="
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "$c=@(Get-NetIPConfiguration).Where({$_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' -and $_.NetAdapter.HardwareInterface}); if($c){@($c)[0].IPv4Address[0].IPAddress}"`) do set "LANIP=%%i"

echo.
echo PC     : http://127.0.0.1:%FRONTEND_PORT%
if defined LANIP (
    echo Phone  : http://%LANIP%:%FRONTEND_PORT%  ^(same Wi-Fi; allow firewall access if prompted^)
) else (
    echo Phone  : no LAN connection found - run ipconfig to check your network
)
echo API    : http://127.0.0.1:%BACKEND_PORT%/docs
echo.
echo Frontend starts in a separate window. Close that window to stop it.
echo Backend runs in this window with hot reload ON (via dev.py).
echo Press Ctrl+C here to stop it.
echo.

start "Fashion Stylist Online Frontend" /D "%~dp0frontend" cmd /k "npm run dev -- --host 0.0.0.0 --port %FRONTEND_PORT% --strictPort"
cd /d "%~dp0backend"
set "DEV_HOST=0.0.0.0"
set "DEV_PORT=%BACKEND_PORT%"
.venv\Scripts\python.exe dev.py

endlocal
exit /b 0

:fail
pause
exit /b 1

rem Usage: call :check_port <port> <label>   - exits 1 if something is already listening.
:check_port
set "PORT_PID="
for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "@(Get-NetTCPConnection -LocalPort %1 -State Listen -ErrorAction SilentlyContinue)[0].OwningProcess"`) do set "PORT_PID=%%p"
if not defined PORT_PID exit /b 0
echo [ERROR] %2 port %1 is already in use by PID %PORT_PID%.
echo It is probably an earlier instance that is still running.
echo Close its window, or stop it with:  taskkill /PID %PORT_PID% /F
echo If taskkill says the process does not exist, see docs\pitfalls.md #5b.
exit /b 1
