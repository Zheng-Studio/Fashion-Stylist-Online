@echo off
setlocal

cd /d "%~dp0backend"

rem Fixed port: frontend\vite.config.ts proxies /api and /files to 127.0.0.1:8000.
set "BACKEND_PORT=8000"

if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] Backend virtual environment not found.
    echo Run these commands first:
    echo   cd backend
    echo   python -m venv .venv
    echo   .venv\Scripts\python.exe -m pip install -r requirements-dev.txt
    goto :fail
)

if not exist ".env" (
    echo [WARN] backend\.env not found. Copy backend\.env.example to backend\.env if needed.
)

rem Refuse to start on a busy port, so the addresses printed below are the real ones.
call :check_port %BACKEND_PORT% Backend || goto :fail

echo Starting backend at http://127.0.0.1:%BACKEND_PORT%
echo API docs: http://127.0.0.1:%BACKEND_PORT%/docs
echo Hot reload is ON (via dev.py). Press Ctrl+C to stop.

set "DEV_HOST=127.0.0.1"
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
