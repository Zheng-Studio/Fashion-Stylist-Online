@echo off
setlocal
cd /d "%~dp0"

rem Ports are picked at startup: we walk up from these values until one is free.
rem The backend port is handed to frontend\vite.config.ts as VITE_API_PORT, which is
rem what the dev server proxies /api and /files to, so both sides always agree.
set "BACKEND_PORT_START=8000"
set "FRONTEND_PORT_START=5173"

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

call :find_port %BACKEND_PORT_START% BACKEND_PORT || goto :fail
call :find_port %FRONTEND_PORT_START% FRONTEND_PORT || goto :fail
if not "%BACKEND_PORT%"=="%BACKEND_PORT_START%" echo [INFO] Backend port %BACKEND_PORT_START% is busy, using %BACKEND_PORT%.
if not "%FRONTEND_PORT%"=="%FRONTEND_PORT_START%" echo [INFO] Frontend port %FRONTEND_PORT_START% is busy, using %FRONTEND_PORT%.

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

rem Read by frontend\vite.config.ts to pick the proxy target; `start` passes the environment on.
set "VITE_API_PORT=%BACKEND_PORT%"
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

rem Usage: call :find_port <start> <varname>
rem   Writes the first free port at or after <start> (20 tries) into <varname>;
rem   exits 1 if all of them are taken.
rem   Busy = somebody is listening on it. A bind test would not work here: on Windows
rem   two processes can hold the same port at once (SO_REUSEADDR semantics), which is
rem   exactly why frontend\vite.config.ts probes with a connect instead.
:find_port
set "%~2="
for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "$s=%1; for($p=$s; $p -lt $s+20; $p++){ if(-not @(Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue).Count){ $p; break } }"`) do set "%~2=%%p"
if not defined %~2 (
    echo [ERROR] No free port: 20 ports starting at %1 are all in use.
    echo Stop whatever is holding them and try again.
    exit /b 1
)
exit /b 0
