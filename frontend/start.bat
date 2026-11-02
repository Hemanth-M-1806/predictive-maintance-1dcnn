@echo off
title Predictive Motor Guard - Frontend & MQTT Bridge
cd /d "%~dp0"

echo =====================================================================
echo  PREDICTIVE MAINTENANCE 1D-CNN - EDGE AI TELEMETRY DASHBOARD
echo =====================================================================
echo.

set "PATH=C:\Program Files\nodejs;%PATH%"

echo [*] Starting Python MQTT-to-WebSocket Bridge on ws://localhost:8765...
start "MQTT Bridge" cmd /k "..\venv\Scripts\python.exe bridge.py"

timeout /t 2 /nobreak >nul

echo [*] Starting React SCADA Dashboard on Vite...
start "Vite Dev Server" cmd /k "npm run dev -- --open"

echo.
echo [✔] Both services launched successfully!
echo   - Local Bridge: ws://localhost:8765
echo   - Dashboard:    http://localhost:5173
echo.
pause
