@echo off
setlocal
set ROOT=%~dp0

echo Starting backend (FastAPI/uvicorn)...
start "Backend" cmd /k "cd /d "%ROOT%backend" && call venv\Scripts\activate.bat && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"

echo Starting frontend (Next.js)...
start "Frontend" cmd /k "cd /d "%ROOT%frontend" && npm run dev"

echo Both servers are starting in separate windows.
