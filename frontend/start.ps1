# PowerShell Launch Script for Predictive Motor Guard Frontend
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host " PREDICTIVE MAINTENANCE 1D-CNN - EDGE AI TELEMETRY DASHBOARD" -ForegroundColor Cyan
Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host ""

$env:Path = "C:\Program Files\nodejs;$env:Path"

# Start Python Bridge in background process
Write-Host "[*] Launching MQTT Bridge (bridge.py)..." -ForegroundColor Yellow
Start-Process -FilePath "..\venv\Scripts\python.exe" -ArgumentList "bridge.py" -WorkingDirectory $ScriptDir

Start-Sleep -Seconds 2

# Start Vite React server
Write-Host "[*] Launching React Dashboard (Vite)..." -ForegroundColor Green
Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm run dev -- --open" -WorkingDirectory $ScriptDir

Write-Host ""
Write-Host "[✔] Services started!" -ForegroundColor Green
Write-Host "    - WebSocket Bridge: ws://localhost:8765" -ForegroundColor Gray
Write-Host "    - Web Dashboard:    http://localhost:5173" -ForegroundColor Gray
Write-Host ""
