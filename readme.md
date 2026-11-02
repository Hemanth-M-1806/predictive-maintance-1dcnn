# 1D-CNN Predictive Maintenance & Emergency Brake System

An industrial-grade Edge-AI predictive maintenance system utilizing a **1D Convolutional Neural Network (1D-CNN)** on an ESP32 to detect mechanical anomalies (misalignment and imbalance) on rotating machinery from real-time MPU6050 vibration signals, featuring closed-loop active regenerative braking and an interactive SCADA telemetry dashboard.

---

> [!IMPORTANT]
> ### 🚀 When Pulling `main`: `frontend/` is the Application!
> When you pull `main`, **`frontend/` is the primary application you run for daily monitoring and operation.**
> All other directories (`firmware/`, `collection/`, `ml_pipeline/`, `models/`) are **setup and development artifacts** only needed during initial hardware assembly, firmware flashing, or offline model retraining:
> - **`frontend/`** ➔ **Active Application**: Launch the SCADA Web Dashboard and the Python MQTT Bridge/Terminal Monitor.
> - **`firmware/`** ➔ **Setup Only**: Flash to the ESP32 once via Arduino IDE / ESP-IDF.
> - **`collection/`** ➔ **Setup Only**: Used only if recording new raw vibration CSV datasets from physical hardware.
> - **`ml_pipeline/`** ➔ **Setup Only**: Used only if retraining the 1D-CNN model or generating new quantized INT8 headers.
> - **`models/`** ➔ **Pre-trained Artifacts**: Pre-compiled TFLite and Keras model weights already integrated into firmware.

---

## ⚡ Quick Start: Running the Application

### 1. Daily One-Click Launch (Windows)
Navigate to the `frontend/` directory and run the launcher:
```powershell
cd frontend
.\start.bat      # or .\start.ps1 in PowerShell
```
This automatically starts:
1. **The Python MQTT Bridge & Terminal Monitor** (`bridge.py`) on `ws://localhost:8765`.
2. **The React SCADA Web Dashboard** on `http://localhost:5173`.

### 2. Manual Startup
```powershell
# In terminal 1: Start Python MQTT Bridge
cd frontend
..\venv\Scripts\python.exe bridge.py

# In terminal 2: Start Vite Dev Server
cd frontend
npm install    # (first time only)
npm run dev
```

---

## 💻 Interactive Terminal Controls (`bridge.py`)

The Python MQTT bridge displays **only live accelerometer readings** ($A_x, A_y, A_z$ in $\text{m/s}^2$) and machine status directly in PowerShell / terminal without file-writing overhead by default:

```text
[16:10:05] [HEALTHY       ] | Accel (m/s2): X: +0.12  Y: -0.05  Z: +9.81 | Delay: 10ms (~100Hz) | [RUNNING NORMAL]
```

You can type commands directly into the terminal window running `bridge.py` and press `Enter`:

| Key / Command | Action |
|---|---|
| `[R]` or `reset` | Clear fault trip latch and re-arm the motor (`'R'`) |
| `[-]` or `reduce` | Reduce sampling frequency delay (down to **5 ms**, $\approx 200\text{ Hz}$) |
| `[+]` or `increase` | Increase sampling frequency delay ($+5\text{ ms}$) |
| `[5]` or `5ms` | Instantly set minimum sampling delay to **5 ms** |
| `[S]` or `stop` | Trigger **Active Emergency Brake Stop** (`'STOP'`) |
| `[W]` or `write` | Toggle **Record to CSV File** (appends live readings to CSV when requested) |
| `[H]` or `help` | Display interactive help menu |
| `[Q]` or `quit` | Gracefully shut down the bridge |

---

## 🛑 Closed-Loop Hardware Active Braking

The system features dynamic regenerative emergency braking on the L298N H-Bridge:
- **Automatic Trigger**: Core 1 on the ESP32 performs INT8 1D-CNN inference on 256-sample rolling windows. If consecutive windows detect `MISALIGNMENT` (Class 1) or `IMBALANCE` (Class 2), the ESP32 immediately shunts the motor back-EMF by driving `IN3=HIGH` and `IN4=HIGH` with `PWM=0`.
- **Manual Remote Trigger**: Pressing `[S]` in the terminal or clicking **Emergency Brake Stop** in the web dashboard sends `'STOP'` over MQTT topic `factory/motor1/commands` to latch the active brake.
- **Trip Reset**: Pressing `[R]` in terminal or clicking **Clear Trip & Re-Arm** clears the hardware latch and resumes motor drive.

---

## 📁 Repository Directory Roles

```text
predictive-maintance-1dcnn/
│
├── frontend/                        # [MAIN APPLICATION] Telemetry Dashboard & MQTT Bridge
│   ├── bridge.py                    # Python MQTT-WebSocket bridge & live terminal CLI
│   ├── start.bat / start.ps1        # One-click startup scripts
│   ├── src/                         # React 19 + HTML5 Canvas SCADA interface
│   │   ├── App.jsx                  # Main dashboard layout, telemetry ingestion & state
│   │   └── components/              # Live Accel HUD, Rotor status, Latency & Logs
│   └── README.md                    # Detailed frontend documentation
│
├── firmware/                        # [SETUP ONLY] Microcontroller Source Code
│   ├── esp32_tflite_brake/          # Dual-core FreeRTOS firmware (Core 0: MQTT | Core 1: Edge-AI)
│   │   ├── esp32_tflite_brake.ino   # Main sketch (flash once to ESP32)
│   │   └── model_data.h             # Quantized INT8 model weights in Flash
│   └── esp32_data_collector/        # Raw MPU6050 calibration streaming sketch
│
├── collection/                      # [SETUP ONLY] Raw Dataset Recording Pipeline
│   ├── config.py                    # Serial port & window parameters
│   ├── linker.py                    # Interactive collection CLI menu
│   ├── collect_healthy.py           # Baseline dataset recorder
│   ├── collect_misalignment.py      # Misalignment fault recorder
│   └── collect_imbalance.py         # Imbalance fault recorder
│
├── ml_pipeline/                     # [SETUP / RETRAINING ONLY] Machine Learning Workflow
│   ├── dataset_loader.py            # Dataset windowing & normalization
│   ├── train_1d_cnn.py              # Keras 1D-CNN model architecture & training
│   └── quantize_model.py            # INT8 quantization & C-header generation
│
├── models/                          # Pre-trained .h5 and .tflite model weights
├── requirements.txt                 # Python dependencies categorized by role
└── readme.md                        # Project documentation
```

---

## 🛠️ Requirements & Setup

### Python Environment
Install dependencies based on your needs:

```powershell
# For running the Main App (Frontend & Bridge):
pip install paho-mqtt websockets

# Or install all dependencies (including offline training & serial logging):
pip install -r requirements.txt
```

### Hardware Setup (One-time)
1. Connect ESP32 to MPU6050: `SDA -> GPIO 21`, `SCL -> GPIO 22`.
2. Connect ESP32 to L298N Motor Driver: `IN3 -> GPIO 27`, `IN4 -> GPIO 26`, `ENB -> GPIO 14`.
3. Open `firmware/esp32_tflite_brake/esp32_tflite_brake.ino` in Arduino IDE, update your Wi-Fi SSID and MQTT broker IP, and flash to your ESP32.
