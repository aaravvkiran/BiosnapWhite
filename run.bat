@echo off
title BioSnap - Shrewsbury Species Spotter
cd /d "%~dp0"

echo ===================================================
echo   Starting Shrewsbury Species Spotter (BioSnap)...
echo ===================================================
echo.

set "ADMIN_API_KEY=dev-secret-key-12345"
set "HF_HUB_DISABLE_XET=1"

if not exist ".venv\Scripts\python.exe" (
    echo Error: Virtual environment .venv was not found!
    echo Please make sure the project is installed.
    pause
    exit /b 1
)

echo Opening browser at http://127.0.0.1:8000/ ...
start "" powershell -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:8000/'"

echo Server is starting. Press Ctrl+C in this window to stop.
echo.

".venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8000

pause
