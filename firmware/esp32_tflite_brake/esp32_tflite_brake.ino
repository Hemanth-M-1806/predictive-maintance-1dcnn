#include <WiFi.h>
#include <PubSubClient.h>
#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <atomic>

#include <TensorFlowLite_ESP32.h>
#include <tensorflow/lite/micro/micro_mutable_op_resolver.h>
#include <tensorflow/lite/micro/micro_interpreter.h>
#include <tensorflow/lite/schema/schema_generated.h>
#include <tensorflow/lite/micro/micro_error_reporter.h>
#include "model_data.h"

// =========================================================================
// NETWORK CONFIGURATION (Core 0)
// Modify these credentials to match your local Wi-Fi and MQTT broker
// =========================================================================
const char* WIFI_SSID       = "moto g85 5G_3429";
const char* WIFI_PASSWORD   = "anish2007";

const char* MQTT_BROKER     = "10.34.89.83";  // Broker IP or hostname
const int   MQTT_PORT       = 1883;
const char* MQTT_CLIENT_ID  = "ESP32_PredictiveGuard_Motor1";

// MQTT Topics
const char* TOPIC_COMMANDS  = "factory/motor1/commands";
const char* TOPIC_STATUS    = "factory/motor1/status";
const char* TOPIC_ALERTS    = "factory/motor1/alerts";

#define TELEMETRY_INTERVAL_MS 2000  // Publish telemetry every 2 seconds
#define NET_RETRY_INTERVAL_MS 5000  // Wi-Fi / MQTT non-blocking reconnect backoff

// =========================================================================
// HARDWARE PIN DEFINITIONS (L298N Motor Driver + ESP32 Dev Module)
// =========================================================================
#define ENB_PIN 14  // Motor PWM Speed Control (ENB / ENA)
#define IN3_PIN 27  // Direction Pin 1 (IN3 / IN1)
#define IN4_PIN 26  // Direction Pin 2 (IN4 / IN2)

#define SDA_PIN 21  // MPU6050 I2C SDA
#define SCL_PIN 22  // MPU6050 I2C SCL

// PWM Configuration for ESP32 Arduino Core 2.0.14
#define PWM_CHANNEL    0
#define PWM_FREQ       5000  // 5 kHz PWM frequency
#define PWM_RESOLUTION 8     // 8-bit resolution (0 - 255)
#define MOTOR_SPEED    180   // Nominal running duty cycle (~70%)

// =========================================================================
// ML PIPELINE PARAMETERS (Core 1)
// =========================================================================
#define WINDOW_SIZE        256
#define NUM_CHANNELS       3

// Dynamic Sampling Delay (Adjustable at runtime via MQTT or Serial, min 5 ms)
// Never hardcoded: allows flexible ML experimentation without firmware reflash
static std::atomic<int> g_sample_delay_ms(10); // Default 10 ms (~100 Hz), reducible to 5 ms (~200 Hz)

// 40 KB Tensor Arena (activations require ~26.4 KB; weights reside in Flash)
#define TENSOR_ARENA_SIZE (40 * 1024)
alignas(16) static uint8_t tensor_arena[TENSOR_ARENA_SIZE];

// TFLite Global Handles
static const tflite::Model* model = nullptr;
static tflite::MicroInterpreter* interpreter = nullptr;
static TfLiteTensor* input = nullptr;
static TfLiteTensor* output = nullptr;

static tflite::MicroErrorReporter micro_error_reporter;
static tflite::ErrorReporter* error_reporter = &micro_error_reporter;

// MPU6050 Sensor Instance & State
static Adafruit_MPU6050 mpu;
static bool synthetic_mode = false;
static bool motor_tripped  = false;

// =========================================================================
// FREERTOS INTER-CORE IPC DATA STRUCTURES
// =========================================================================
struct TelemetryPayload {
  int      predicted_class;
  int8_t   raw_scores[3];
  float    confidences[3];
  uint32_t inference_time_ms;
  bool     motor_tripped;
  uint32_t timestamp_ms;
  float    ax;
  float    ay;
  float    az;
  int      sample_delay_ms;
};

struct AlertPayload {
  int      fault_class;
  char     fault_name[16];
  float    confidence;
  uint32_t timestamp_ms;
  float    ax;
  float    ay;
  float    az;
};

// Thread-Safe Queues and Atomic Flags
static QueueHandle_t xQueueTelemetry = nullptr;
static QueueHandle_t xQueueAlerts    = nullptr;
static std::atomic<bool> g_rearm_requested(false);
static std::atomic<bool> g_stop_requested(false);

// Networking Clients (Pinned to Core 0)
static WiFiClient   wifiClient;
static PubSubClient mqttClient(wifiClient);

// =========================================================================
// MOTOR CONTROL PRIMITIVES (Core 1 Exclusive)
// =========================================================================
void emergency_stop() {
  // Active Brake: Drive both H-Bridge legs HIGH to short motor back-EMF, cut PWM
  digitalWrite(IN3_PIN, HIGH);
  digitalWrite(IN4_PIN, HIGH);
  ledcWrite(PWM_CHANNEL, 0);
}

void motor_stop() {
  digitalWrite(IN3_PIN, LOW);
  digitalWrite(IN4_PIN, LOW);
  ledcWrite(PWM_CHANNEL, 0);
}

void start_motor(uint8_t speed) {
  digitalWrite(IN3_PIN, HIGH);
  digitalWrite(IN4_PIN, LOW);
  ledcWrite(PWM_CHANNEL, speed);
}

void fault_halt(const char* reason) {
  emergency_stop();
  Serial.print("\n[CRITICAL ERROR] ");
  Serial.println(reason);
  Serial.flush();
  while (1) {
    vTaskDelay(pdMS_TO_TICKS(1000));
  }
}

// =========================================================================
// MQTT CALLBACK (Runs on Core 0)
// =========================================================================
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  if (strcmp(topic, TOPIC_COMMANDS) == 0 && length > 0) {
    char cmdBuf[32];
    unsigned int copyLen = (length < sizeof(cmdBuf) - 1) ? length : (sizeof(cmdBuf) - 1);
    memcpy(cmdBuf, payload, copyLen);
    cmdBuf[copyLen] = '\0';

    // 1. Reset / Re-arm command
    if (cmdBuf[0] == 'R' || cmdBuf[0] == 'r' || strcasecmp(cmdBuf, "RESET") == 0) {
      g_rearm_requested.store(true, std::memory_order_release);
      Serial.println("[Core 0] MQTT Command Received: Re-arm / Reset Request Latched.");
    }
    // 2. Active Brake / Emergency Stop command
    else if (strcasecmp(cmdBuf, "STOP") == 0 || cmdBuf[0] == 'S' || cmdBuf[0] == 's' || strcasecmp(cmdBuf, "BRAKE") == 0) {
      g_stop_requested.store(true, std::memory_order_release);
      Serial.println("[Core 0] MQTT Command Received: Emergency Active Brake Stop Latched.");
    }
    // 3. Frequency / Sampling Delay Adjustment (Can reduce down to 5 ms)
    else if (cmdBuf[0] == '-' || strcasecmp(cmdBuf, "FREQ_DOWN") == 0 || strcasecmp(cmdBuf, "DELAY_5MS") == 0) {
      int cur = g_sample_delay_ms.load(std::memory_order_relaxed);
      if (cur > 5) {
        cur -= 5;
        if (cur < 5) cur = 5;
      } else {
        cur = 5;
      }
      g_sample_delay_ms.store(cur, std::memory_order_release);
      Serial.printf("[Core 0] MQTT Command Received: Reduced sample delay to %d ms (~%.1f Hz)\n", cur, 1000.0f / cur);
    }
    else if (cmdBuf[0] == '+' || strcasecmp(cmdBuf, "FREQ_UP") == 0) {
      int cur = g_sample_delay_ms.load(std::memory_order_relaxed);
      cur += 5;
      g_sample_delay_ms.store(cur, std::memory_order_release);
      Serial.printf("[Core 0] MQTT Command Received: Increased sample delay to %d ms (~%.1f Hz)\n", cur, 1000.0f / cur);
    }
    else if (strncmp(cmdBuf, "DELAY:", 6) == 0) {
      int val = atoi(cmdBuf + 6);
      if (val >= 5) {
        g_sample_delay_ms.store(val, std::memory_order_release);
        Serial.printf("[Core 0] MQTT Command Received: Set sample delay to %d ms (~%.1f Hz)\n", val, 1000.0f / val);
      }
    }
  }
}

const char* getWiFiStatusStr(wl_status_t status) {
  switch (status) {
    case WL_NO_SHIELD:       return "NO_SHIELD";
    case WL_IDLE_STATUS:     return "IDLE_STATUS";
    case WL_NO_SSID_AVAIL:   return "NO_SSID_AVAIL (Check 2.4GHz / Hotspot Name)";
    case WL_SCAN_COMPLETED:  return "SCAN_COMPLETED";
    case WL_CONNECTED:       return "CONNECTED";
    case WL_CONNECT_FAILED:  return "CONNECT_FAILED (Check Password)";
    case WL_CONNECTION_LOST: return "CONNECTION_LOST";
    case WL_DISCONNECTED:    return "DISCONNECTED (Associating/DHCP...)";
    default:                 return "UNKNOWN";
  }
}

// =========================================================================
// CORE 0: NETWORKING TASK (Wi-Fi, MQTT Pub/Sub)
// =========================================================================
void mqttTask(void* pvParameters) {
  Serial.printf("[Core %d] MQTT Network Task Started.\n", xPortGetCoreID());

  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(512);

  uint32_t last_net_retry     = 0;
  uint32_t last_telemetry_pub = 0;
  bool     wifi_was_connected = false;

  // Optimize Wi-Fi for ESP32 & Mobile Hotspots
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);            // Disable modem sleep for reliable low-latency packets
  WiFi.setAutoReconnect(true);     // Allow ESP-IDF auto-reconnect in background
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("[Core 0] Connecting to Wi-Fi SSID: \"%s\"...\n", WIFI_SSID);

  char jsonBuffer[512];

  for (;;) {
    uint32_t now = millis();
    wl_status_t wifi_status = WiFi.status();

    // 1. Maintain Wi-Fi
    if (wifi_status != WL_CONNECTED) {
      if (wifi_was_connected) {
        wifi_was_connected = false;
        Serial.println("[Core 0] Wi-Fi Connection Lost!");
      }

      // Retry every 15 seconds to allow full DHCP lease without premature disconnect
      if (now - last_net_retry >= 15000) {
        last_net_retry = now;
        Serial.printf("[Core 0] Wi-Fi Status: %s. Retrying connection...\n", getWiFiStatusStr(wifi_status));
        WiFi.disconnect();
        WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
      }
    } else {
      if (!wifi_was_connected) {
        wifi_was_connected = true;
        Serial.printf("[Core 0] Wi-Fi Connected! IP: %s, RSSI: %d dBm\n",
                      WiFi.localIP().toString().c_str(), WiFi.RSSI());
      }

      // 2. Maintain MQTT (Non-blocking retry timer)
      if (!mqttClient.connected()) {
        if (now - last_net_retry >= NET_RETRY_INTERVAL_MS) {
          last_net_retry = now;
          Serial.printf("[Core 0] Connecting to MQTT broker (%s:%d)...\n", MQTT_BROKER, MQTT_PORT);
          if (mqttClient.connect(MQTT_CLIENT_ID)) {
            Serial.println("[Core 0] [OK] MQTT Broker Connected!");
            mqttClient.subscribe(TOPIC_COMMANDS);
            Serial.printf("[Core 0] Subscribed to command topic: %s\n", TOPIC_COMMANDS);
          } else {
            Serial.printf("[Core 0] MQTT connect failed (rc=%d). Retrying in 5s...\n", mqttClient.state());
          }
        }
      } else {
        // Run MQTT engine loop
        mqttClient.loop();
      }
    }

    // 3. Process High-Priority Fault Alerts (Immediate Dispatch)
    AlertPayload alert;
    if (xQueueReceive(xQueueAlerts, &alert, 0) == pdTRUE) {
      if (mqttClient.connected()) {
        snprintf(jsonBuffer, sizeof(jsonBuffer),
          "{\"event\":\"FAULT_ALERT\",\"device\":\"%s\",\"fault\":\"%s\",\"class\":%d,\"confidence\":%.3f,\"ax\":%.3f,\"ay\":%.3f,\"az\":%.3f,\"timestamp\":%u}",
          MQTT_CLIENT_ID, alert.fault_name, alert.fault_class, alert.confidence, alert.ax, alert.ay, alert.az, alert.timestamp_ms);

        // Publish Alert with retain flag set to true
        mqttClient.publish(TOPIC_ALERTS, jsonBuffer, true);
        Serial.printf("[Core 0] >>> MQTT ALERT DISPATCHED: %s <<<\n", jsonBuffer);
      } else {
        Serial.println("[Core 0] Alert dropped: MQTT disconnected.");
      }
    }

    // 4. Periodic Status Telemetry Publish (with live accelerometer values)
    if (now - last_telemetry_pub >= TELEMETRY_INTERVAL_MS) {
      last_telemetry_pub = now;

      TelemetryPayload telem;
      if (xQueueReceive(xQueueTelemetry, &telem, 0) == pdTRUE) {
        if (mqttClient.connected()) {
          const char* label = "HEALTHY";
          if (telem.predicted_class == 1) label = "MISALIGNMENT";
          else if (telem.predicted_class == 2) label = "IMBALANCE";

          snprintf(jsonBuffer, sizeof(jsonBuffer),
            "{\"device\":\"%s\",\"status\":\"%s\",\"class\":%d,\"ax\":%.3f,\"ay\":%.3f,\"az\":%.3f,\"conf_healthy\":%.3f,\"conf_misaligned\":%.3f,\"conf_imbalance\":%.3f,\"infer_ms\":%u,\"motor_tripped\":%s,\"sample_delay_ms\":%d,\"uptime\":%u}",
            MQTT_CLIENT_ID, label, telem.predicted_class,
            telem.ax, telem.ay, telem.az,
            telem.confidences[0], telem.confidences[1], telem.confidences[2],
            telem.inference_time_ms, telem.motor_tripped ? "true" : "false",
            telem.sample_delay_ms, telem.timestamp_ms);

          mqttClient.publish(TOPIC_STATUS, jsonBuffer, false);
        }
      }
    }

    // Small yield so the FreeRTOS scheduler and TCP/IP stack service background frames
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

// =========================================================================
// CORE 1: REAL-TIME EDGE AI & SENSING TASK
// =========================================================================
void inferenceTask(void* pvParameters) {
  Serial.printf("[Core %d] Real-time Inference & Safety Task Started.\n", xPortGetCoreID());

  const float   scale      = input->params.scale;
  const int32_t zero_point = input->params.zero_point;

  for (;;) {
    // 1. Process Re-arm & Stop Requests from MQTT (Atomic) or Serial
    if (g_rearm_requested.exchange(false, std::memory_order_acquire)) {
      motor_tripped = false;
      if (!synthetic_mode) {
        start_motor(MOTOR_SPEED);
      }
      Serial.println("\n>>> [RESET] Fault Latch Cleared via MQTT. Motor Re-armed! <<<\n");
    }

    if (g_stop_requested.exchange(false, std::memory_order_acquire)) {
      motor_tripped = true;
      emergency_stop();
      AlertPayload alert;
      alert.fault_class   = 3; // Emergency stop
      alert.confidence    = 1.0f;
      alert.timestamp_ms  = millis();
      alert.ax = 0.0f; alert.ay = 0.0f; alert.az = 0.0f;
      strncpy(alert.fault_name, "EMERGENCY_STOP", sizeof(alert.fault_name) - 1);
      xQueueSend(xQueueAlerts, &alert, 0);
      Serial.println("\n>>> [ACTIVE BRAKE ENGAGED] Emergency Stop Triggered! H-Bridge Coils Shorted. <<<\n");
    }

    if (Serial.available()) {
      char cmd = Serial.read();
      if (cmd == 'r' || cmd == 'R') {
        motor_tripped = false;
        if (!synthetic_mode) {
          start_motor(MOTOR_SPEED);
        }
        Serial.println("\n>>> [RESET] Fault Latch Cleared via Serial. Motor Re-armed! <<<\n");
      } else if (cmd == 's' || cmd == 'S') {
        motor_tripped = true;
        emergency_stop();
        AlertPayload alert;
        alert.fault_class   = 3;
        alert.confidence    = 1.0f;
        alert.timestamp_ms  = millis();
        alert.ax = 0.0f; alert.ay = 0.0f; alert.az = 0.0f;
        strncpy(alert.fault_name, "EMERGENCY_STOP", sizeof(alert.fault_name) - 1);
        xQueueSend(xQueueAlerts, &alert, 0);
        Serial.println("\n>>> [ACTIVE BRAKE ENGAGED] Emergency Stop Triggered via Serial! <<<\n");
      } else if (cmd == '-') {
        int cur = g_sample_delay_ms.load(std::memory_order_relaxed);
        if (cur > 5) {
          cur -= 5;
          if (cur < 5) cur = 5;
        } else {
          cur = 5;
        }
        g_sample_delay_ms.store(cur, std::memory_order_release);
        Serial.printf("[CFG] Sampling delay decreased to %d ms (~%.1f Hz)\n", cur, 1000.0f / cur);
      } else if (cmd == '+') {
        int cur = g_sample_delay_ms.load(std::memory_order_relaxed);
        cur += 5;
        g_sample_delay_ms.store(cur, std::memory_order_release);
        Serial.printf("[CFG] Sampling delay increased to %d ms (~%.1f Hz)\n", cur, 1000.0f / cur);
      }
    }

    // 2. High-Precision Dynamic Sampling Window (Configurable down to 5ms, Zero Drift)
    const int cur_delay = g_sample_delay_ms.load(std::memory_order_relaxed);
    const int64_t sample_interval_us = (int64_t)cur_delay * 1000;
    int64_t next_sample_us = esp_timer_get_time();
    float last_ax = 0.0f, last_ay = 0.0f, last_az = 0.0f;

    for (int i = 0; i < WINDOW_SIZE; i++) {
      float ax = 0.0f, ay = 0.0f, az = 0.0f;

      if (!synthetic_mode) {
        sensors_event_t a, g, temp;
        mpu.getEvent(&a, &g, &temp);
        ax = a.acceleration.x;
        ay = a.acceleration.y;
        az = a.acceleration.z;
      } else {
        // Fallback synthetic wave simulation (10 Hz oscillation + 9.8g Z)
        static float phase = 0.0f;
        phase += 0.1f;
        ax = 0.3f * sin(phase);
        ay = 0.3f * cos(phase);
        az = 9.8f + 0.2f * sin(phase * 1.5f);
      }

      last_ax = ax;
      last_ay = ay;
      last_az = az;

      // Fast Quantization to INT8: q = round(val / scale) + zero_point
      int32_t qx = (int32_t)round(ax / scale) + zero_point;
      int32_t qy = (int32_t)round(ay / scale) + zero_point;
      int32_t qz = (int32_t)round(az / scale) + zero_point;

      // Clamp bounds [-128, 127]
      if (qx < -128) qx = -128; else if (qx > 127) qx = 127;
      if (qy < -128) qy = -128; else if (qy > 127) qy = 127;
      if (qz < -128) qz = -128; else if (qz > 127) qz = 127;

      const int idx = i * NUM_CHANNELS;
      input->data.int8[idx]     = (int8_t)qx;
      input->data.int8[idx + 1] = (int8_t)qy;
      input->data.int8[idx + 2] = (int8_t)qz;

      // Microsecond drift compensation
      next_sample_us += sample_interval_us;
      int64_t sleep_us = next_sample_us - esp_timer_get_time();
      if (sleep_us > 0) {
        delayMicroseconds((uint32_t)sleep_us);
      }
    }

    // 3. Run On-Device TFLite Inference
    uint32_t t_start = millis();
    if (interpreter->Invoke() != kTfLiteOk) {
      Serial.println("[Core 1] ERROR: Inference Invocation Failed!");
      continue;
    }
    uint32_t inference_time = millis() - t_start;

    // 4. Extract Softmax Probabilities
    int8_t s_healthy    = output->data.int8[0];
    int8_t s_misaligned = output->data.int8[1];
    int8_t s_imbalance  = output->data.int8[2];

    int predicted_class = 0;
    int8_t max_score = s_healthy;

    if (s_misaligned > max_score) {
      max_score = s_misaligned;
      predicted_class = 1;
    }
    if (s_imbalance > max_score) {
      max_score = s_imbalance;
      predicted_class = 2;
    }

    float p_healthy    = (s_healthy - output->params.zero_point) * output->params.scale;
    float p_misaligned = (s_misaligned - output->params.zero_point) * output->params.scale;
    float p_imbalance  = (s_imbalance - output->params.zero_point) * output->params.scale;

    Serial.printf("[Core 1 | Delay %dms | Infer %lums] Raw Accel: [X:%.2f, Y:%.2f, Z:%.2f] | Conf: [H:%5.1f%%, M:%5.1f%%, I:%5.1f%%] -> ",
                  cur_delay, inference_time, last_ax, last_ay, last_az,
                  p_healthy * 100.0f, p_misaligned * 100.0f, p_imbalance * 100.0f);

    // 5. Closed-Loop Emergency Brake & Alert Generation
    if (predicted_class == 0) {
      if (!motor_tripped) {
        Serial.println("STATUS: HEALTHY (Motor Running Normal)");
      } else {
        Serial.println("STATUS: HEALTHY (Motor Latched - Waiting for Re-arm)");
      }
    } else {
      // Immediate Hardware Braking on Core 1
      emergency_stop();

      if (!motor_tripped) {
        motor_tripped = true;

        AlertPayload alert;
        alert.fault_class   = predicted_class;
        alert.confidence    = (predicted_class == 1) ? p_misaligned : p_imbalance;
        alert.timestamp_ms  = millis();
        alert.ax            = last_ax;
        alert.ay            = last_ay;
        alert.az            = last_az;
        strncpy(alert.fault_name, (predicted_class == 1) ? "MISALIGNMENT" : "IMBALANCE", sizeof(alert.fault_name) - 1);

        // Non-blocking alert queue post to Core 0 (timeout = 0 ensures no stall)
        xQueueSend(xQueueAlerts, &alert, 0);

        Serial.printf("FAULT DETECTED: %s! ACTIVE BRAKE ENGAGED!\n", alert.fault_name);
      } else {
        Serial.println("FAULT PERSISTS (Brake Engaged)");
      }
    }

    // 6. Push Telemetry to Core 0 (Non-blocking overwrite)
    TelemetryPayload telem;
    telem.predicted_class   = predicted_class;
    telem.raw_scores[0]     = s_healthy;
    telem.raw_scores[1]     = s_misaligned;
    telem.raw_scores[2]     = s_imbalance;
    telem.confidences[0]    = p_healthy;
    telem.confidences[1]    = p_misaligned;
    telem.confidences[2]    = p_imbalance;
    telem.inference_time_ms = inference_time;
    telem.motor_tripped     = motor_tripped;
    telem.timestamp_ms      = millis();
    telem.ax                = last_ax;
    telem.ay                = last_ay;
    telem.az                = last_az;
    telem.sample_delay_ms   = cur_delay;

    xQueueOverwrite(xQueueTelemetry, &telem);
  }
}

// =========================================================================
// SYSTEM INITIALIZATION
// =========================================================================
void setup() {
  Serial.begin(115200);
  delay(1500);

  Serial.println("\n========================================================");
  Serial.println(" ESP32 1D-CNN Predictive Maintenance Guard + MQTT/FreeRTOS");
  Serial.println("========================================================");

  // 1. Initialize Motor GPIO & LEDC PWM (ESP32 core 2.0.14)
  pinMode(IN3_PIN, OUTPUT);
  pinMode(IN4_PIN, OUTPUT);
  ledcSetup(PWM_CHANNEL, PWM_FREQ, PWM_RESOLUTION);
  ledcAttachPin(ENB_PIN, PWM_CHANNEL);
  motor_stop();
  Serial.println("[OK] Motor GPIO & PWM (LEDC ch0, 5kHz) Initialized.");

  // 2. Initialize I2C and MPU6050
  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setClock(400000);  // 400kHz Fast I2C

  if (!mpu.begin()) {
    Serial.println("[!] MPU6050 not detected on I2C. Operating in SYNTHETIC TEST MODE.");
    synthetic_mode = true;
  } else {
    Serial.println("[OK] MPU6050 Initialized (8G, 44Hz filter).");
    mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
    mpu.setFilterBandwidth(MPU6050_BAND_44_HZ);
    synthetic_mode = false;
  }

  // 3. Load TFLite Model
  model = tflite::GetModel(g_model);
  if (model->version() != TFLITE_SCHEMA_VERSION) {
    fault_halt("Model schema mismatch!");
  }
  Serial.printf("[OK] Model Loaded Successfully (%u bytes).\n", g_model_len);

  // 4. Register Exactly Required Operators (7 Ops from TFLite Model)
  static tflite::MicroMutableOpResolver<10> resolver;
  resolver.AddExpandDims();
  resolver.AddConv2D();
  resolver.AddReshape();
  resolver.AddMaxPool2D();
  resolver.AddMean();
  resolver.AddFullyConnected();
  resolver.AddSoftmax();
  Serial.println("[OK] Op Resolver Configured (7 Ops Registered).");

  // 5. Initialize MicroInterpreter
  static tflite::MicroInterpreter static_interpreter(
    model,
    resolver,
    tensor_arena,
    TENSOR_ARENA_SIZE,
    error_reporter,
    nullptr,
    nullptr
  );
  interpreter = &static_interpreter;

  // 6. Allocate Tensors
  if (interpreter->AllocateTensors() != kTfLiteOk) {
    fault_halt("Tensor Allocation Failed! Check Arena Size.");
  }
  Serial.println("[OK] TFLite Tensors Allocated Successfully!");

  input  = interpreter->input(0);
  output = interpreter->output(0);

  if (input->type != kTfLiteInt8) {
    fault_halt("ERROR: Model input tensor is not INT8.");
  }

  // 7. Arm Motor if Hardware Sensor is Ready
  if (!synthetic_mode) {
    start_motor(MOTOR_SPEED);
    Serial.printf("[OK] Guard Armed: Motor started at PWM %d.\n", MOTOR_SPEED);
  }

  // 8. Create Inter-Task Synchronization Primitives
  xQueueTelemetry = xQueueCreate(1, sizeof(TelemetryPayload));
  xQueueAlerts    = xQueueCreate(5, sizeof(AlertPayload));

  if (!xQueueTelemetry || !xQueueAlerts) {
    fault_halt("Failed to create FreeRTOS Queues!");
  }

  // 9. Launch Pinned FreeRTOS Tasks
  // Core 1 Task: High priority (5), 8 KB stack for Edge-AI & Safety
  xTaskCreatePinnedToCore(
    inferenceTask,
    "InferenceTask",
    8192,
    nullptr,
    5,
    nullptr,
    1
  );

  // Core 0 Task: Medium priority (2), 8 KB stack for Wi-Fi & MQTT
  xTaskCreatePinnedToCore(
    mqttTask,
    "MQTTTask",
    8192,
    nullptr,
    2,
    nullptr,
    0
  );

  Serial.println("[OK] FreeRTOS Tasks Pinned: Core 1 -> Edge-AI | Core 0 -> Network/MQTT.");
  Serial.println("--------------------------------------------------------\n");
}

void loop() {
  // FreeRTOS pinned tasks manage execution; delete loop task to reclaim memory
  vTaskDelete(nullptr);
}