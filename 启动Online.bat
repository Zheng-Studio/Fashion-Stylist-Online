@echo off
setlocal
cd /d "%~dp0"

if not exist "backend\.venv\Scripts\python.exe" (
    echo [ERROR] Backend virtual environment not found: backend\.venv
    echo Create it and install backend\requirements-dev.txt first.
    pause
    exit /b 1
)

if not exist "frontend\node_modules\vite\bin\vite.js" (
    echo [ERROR] Frontend dependencies not found: frontend\node_modules
    echo Run "npm install" in the frontend directory first.
    pause
    exit /b 1
)

if not exist "backend\.env" (
    echo [WARN] backend\.env not found. Copy backend\.env.example if needed.
)

set "LANIP="
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "$a=@(Get-NetIPAddress -AddressFamily IPv4).Where({$_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.InterfaceAlias -notlike '*vpn*' -and $_.InterfaceAlias -notlike '*Virtual*' -and $_.InterfaceAlias -notlike '*VMware*' -and $_.InterfaceAlias -notlike '*Loopback*'}); $ip=$a.Where({$_.IPAddress -like '192.168.*'})[0]; if(-not $ip){$ip=$a.Where({$_.IPAddress -like '172.*'})[0]}; if(-not $ip){$ip=$a.Where({$_.IPAddress -like '10.*'})[0]}; if(-not $ip){$ip=$a[0]}; if($ip){$ip.IPAddress}"`) do set "LANIP=%%i"
if not defined LANIP set "LANIP=<run ipconfig>"

echo.
echo PC     : http://127.0.0.1:5173
echo Phone  : http://%LANIP%:5173  (same Wi-Fi; allow firewall access if prompted)
echo API    : http://127.0.0.1:8000/docs
echo.
echo Frontend starts in a separate window. Close that window to stop it.
echo Backend runs in this window with hot reload ON (via dev.py).
echo Press Ctrl+C here to stop it.
echo.

start "Fashion Stylist Online Frontend" /D "%~dp0frontend" cmd /k "npm run dev -- --host 0.0.0.0"
cd /d "%~dp0backend"
set "DEV_HOST=0.0.0.0"
.venv\Scripts\python.exe dev.py

endlocal
