# Edge-AI Predictive Motor Guard — SCADA Dashboard & MQTT Terminal

An industrial-grade, real-time telemetry and diagnostics system built with **React 19**, **Vite**, **HTML5 Canvas**, and **Python MQTT/WebSocket Bridge** for the ESP32 1D-CNN Predictive Maintenance system.

---

## ⚡ Key Capabilities

1. **Terminal & PowerShell MQTT Live Telemetry (bridge.py):**
   - Displays **only live accelerometer values (X, Y, Z)** and machine status (**HEALTHY**, **MISALIGNMENT**, **IMBALANCE**) directly in PowerShell / terminal without file-writing overhead by default.
   - Interactive options directly in the terminal:
     - `[R]` : Reset / Clear Trip Latch & Re-arm Motor
     - `[-]` : Reduce Sampling Frequency Delay (down to 5 ms, ~200 Hz)
     - `[+]` : Increase Sampling Frequency Delay (+5 ms)
     - `[5]` : Instantly set minimum delay 5 ms (Max frequency)
     - `[S]` : Active Emergency Brake Stop
     - `[W]` : Toggle Record to CSV File (appends live readings directly to CSV when needed)
     - `[H]` : Help menu

2. **Full Active Braking Integration:**
   - Closed-loop regenerative emergency brake engages immediately upon on-device fault classification (Misalignment or Imbalance) or remote software trigger (`STOP`).
   - ESP32 drives H-Bridge IN3=HIGH and IN4=HIGH (shorting motor coils for dynamic EMF braking) and sets PWM to 0.
   - Remote Re-Arm (`'R'`) clears latch and smoothly ramps the motor back to operating speed.

3. **Live 3-Axis Accelerometer HUD:**
   - Direct numerical gauges for $A_x, A_y, A_z$ ($m/s^2$) updated with every transmission.
   - Dynamic sampling frequency calculation (`1000 / sample_delay_ms` Hz) — never hardcoded!

4. **Real-Time Classification Streams (60 FPS Canvas):**
   - Smooth Bézier probability curves for all 3 classes:
     - 🟢 **Healthy (Class 0)**
     - 🟡 **Misalignment (Class 1)**
     - 🔴 **Imbalance (Class 2)**
   - 50% Decision Threshold line, hover inspection, and freeze/resume controls.

5. **Flexible File Recording:**
   - Telemetry displays directly on terminal; pressing `[W]` in the terminal or clicking "Write to File" in the dashboard starts logging directly into a timestamped CSV file for offline ML analysis.

---

## 🚀 Quick Start

### Option 1: One-Click Launch (Windows)
Double-click `start.bat` (or run `./start.ps1`) in the `frontend/` folder. This automatically launches:
1. The Python MQTT-to-WebSocket bridge & terminal monitor (`bridge.py`)
2. The Vite React dashboard (`http://localhost:5173`)

### Option 2: Manual Start
From `frontend/`:

```powershell
# 1. Start Python MQTT-WebSocket Bridge and Live Monitor
..\venv\Scripts\python.exe bridge.py

# 2. In another terminal, start React dev server
npm run dev
```

Navigate to `http://localhost:5173`.

---

## 📡 MQTT Topic Specification

| Topic | Direction | Content Schema |
|---|---|---|
| `factory/motor1/status` | ESP32 ➔ Terminal / Browser | `{"device":"...","status":"HEALTHY","class":0,"ax":0.12,"ay":-0.05,"az":9.81,"conf_healthy":0.996,"conf_misaligned":0.000,"conf_imbalance":0.000,"infer_ms":118,"motor_tripped":false,"sample_delay_ms":10,"uptime":700927}` |
| `factory/motor1/alerts` | ESP32 ➔ Terminal / Browser | `{"event":"FAULT_ALERT","device":"...","fault":"IMBALANCE","class":2,"confidence":0.985,"ax":3.42,"ay":-2.15,"az":12.4,"timestamp":702000}` |
| `factory/motor1/commands` | Terminal / Browser ➔ ESP32 | `"R"` (re-arm), `"STOP"` (emergency brake), `"-"` (reduce delay down to 5ms), `"+"` (increase delay), `"DELAY:5"` |
