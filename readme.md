# 1D-CNN Predictive Maintenance & Emergency Brake System

An end-to-end TinyML application that utilizes a **1D Convolutional Neural Network (1D-CNN)** to analyze real-time multi-axis vibration signals (MPU6050) and detect mechanical anomalies (misalignment and imbalance) on rotating machinery. Upon fault detection, the embedded system automatically triggers a dynamic emergency braking routine via an ESP32.

---

## 📌 Features

* **Real-time Sensor Streaming:** Captures 3-axis acceleration data ($a_x, a_y, a_z$) via MPU6050 with Digital Low-Pass Filtering (DLPF).
* **Automated Data Logger:** Modular Python collection pipeline configured for structured dataset generation across multiple speed and voltage profiles.
* **Microcontroller-Optimized 1D-CNN:** Lightweight Keras CNN architecture designed specifically for low-latency temporal signal classification.
* **Post-Training INT8 Quantization:** Converts full-precision Keras models into fully quantized C arrays (`model_data.h`) for deployment on TFLite Micro.
* **Closed-Loop Hardware Safeguard:** On-device inference triggers relay/H-Bridge dynamic braking upon identifying non-healthy operational states.

---

## 📁 Repository Structure

```text
predictive-maintance-1dcnn/
│
├── collection/                      # Modular data logging pipeline
│   ├── config.py                    # Serial port, window size & profile settings
│   ├── linker.py                    # Interactive execution menu
│   ├── collect_healthy.py           # Healthy baseline recorder
│   ├── collect_misalignment.py      # Misalignment fault recorder
│   └── collect_imbalance.py          # Imbalance fault recorder
│
├── firmware/                        # Microcontroller source code
│   ├── esp32_data_collector/        # MPU6050 raw streaming code
│   └── esp32_tflite_brake/          # On-device TFLite Micro inference & brake routine
│
├── ml_pipeline/                     # Machine learning workflows
│   ├── dataset_loader.py            # CSV dataset parser & feature windowing
│   ├── train_1d_cnn.py              # Keras 1D-CNN model definition & training
│   └── quantize_model.py            # INT8 quantization & C-header exporter
│
├── datasets/                        # Generated dataset storage (Git ignored)
├── models/                          # Saved .h5 and .tflite artifacts
│
├── requirements.txt                 # Python dependencies
└── README.md                        # Documentation