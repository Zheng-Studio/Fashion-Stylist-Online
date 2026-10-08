@echo off
setlocal

cd /d "%~dp0backend"

if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] Backend virtual environment not found.
    echo Run these commands first:
    echo   cd backend
    echo   python -m venv .venv
    echo   .venv\Scripts\python.exe -m pip install -r requirements-dev.txt
    pause
    exit /b 1
)

if not exist ".env" (
    echo [WARN] backend\.env not found. Copy backend\.env.example to backend\.env if needed.
)

echo Starting backend at http://127.0.0.1:8000
 echo API docs: http://127.0.0.1:8000/docs
 echo Hot reload is ON (via dev.py). Press Ctrl+C to stop.

.venv\Scripts\python.exe dev.py

endlocal
