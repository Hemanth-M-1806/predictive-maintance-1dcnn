#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>

#include <TensorFlowLite_ESP32.h>
#include <tensorflow/lite/micro/micro_mutable_op_resolver.h>
#include <tensorflow/lite/micro/micro_interpreter.h>
#include <tensorflow/lite/schema/schema_generated.h>
#include <tensorflow/lite/micro/micro_error_reporter.h>
#include "model_data.h"

// =========================================================================
// HARDWARE PIN DEFINITIONS (L298N Motor Driver + ESP32 Dev Module)
// =========================================================================
#define ENB_PIN 14  // Motor Speed / Enable (ENB / ENA)
#define IN3_PIN 27  // Direction Pin 1 (IN3 / IN1)
#define IN4_PIN 26  // Direction Pin 2 (IN4 / IN2)

#define SDA_PIN 21  // MPU6050 I2C SDA
#define SCL_PIN 22  // MPU6050 I2C SCL

// PWM Configuration (Compatible with ESP32 Core 2.x and Core 3.x)
#define PWM_CHANNEL 0
#define PWM_FREQ 5000       // 5 kHz PWM frequency
#define PWM_RESOLUTION 8    // 8-bit resolution (0 - 255)
#define MOTOR_SPEED 220     // Operating motor speed (~85% duty cycle)

// =========================================================================
// ML PIPELINE PARAMETERS
// =========================================================================
#define WINDOW_SIZE 256
#define NUM_CHANNELS 3

// Sampling Delay (ms): Matches dataset collection delay (delay(20) = 50 Hz).
// Adjustable at runtime via Serial ('+' / '-') or here directly.
int sample_delay_ms = 20;

// Anti-False-Trip Safety Interlocks
#define FAULT_CONFIRMATION_COUNT 2     // Require N consecutive fault windows to trip brake
#define STARTUP_GRACE_PERIOD_MS 3000  // 3s grace period for motor spin-up

// 40 KB Tensor Arena (activations require ~15 KB; weights reside in Flash)
#define TENSOR_ARENA_SIZE (40 * 1024)
alignas(16) uint8_t tensor_arena[TENSOR_ARENA_SIZE];

// TFLite Global Handles
const tflite::Model* model = nullptr;
tflite::MicroInterpreter* interpreter = nullptr;
TfLiteTensor* input = nullptr;
TfLiteTensor* output = nullptr;

static tflite::MicroErrorReporter micro_error_reporter;
tflite::ErrorReporter* error_reporter = &micro_error_reporter;

// MPU6050 Sensor Instance & System States
Adafruit_MPU6050 mpu;
bool motor_tripped = false;
unsigned long motor_start_time = 0;
int consecutive_fault_count = 0;
int last_fault_class = 0;
bool debug_raw_stream = false;

// =========================================================================
// MOTOR CONTROL HELPER FUNCTIONS
// =========================================================================
void set_motor_pwm(uint8_t speed) {
#if defined(ESP_ARDUINO_VERSION) && (ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0))
  ledcWrite(ENB_PIN, speed);
#else
  ledcWrite(PWM_CHANNEL, speed);
#endif
}

void emergency_stop() {
  // Active Brake: Drive both H-bridge directional inputs HIGH to short motor coils
  digitalWrite(IN3_PIN, HIGH);
  digitalWrite(IN4_PIN, HIGH);
  set_motor_pwm(0);
}

void motor_stop() {
  digitalWrite(IN3_PIN, LOW);
  digitalWrite(IN4_PIN, LOW);
  set_motor_pwm(0);
}

void start_motor(uint8_t speed) {
  digitalWrite(IN3_PIN, HIGH);
  digitalWrite(IN4_PIN, LOW);
  set_motor_pwm(speed);
  motor_start_time = millis();
}

void fault_halt(const char* reason) {
  emergency_stop();
  Serial.print("\n[CRITICAL ERROR] ");
  Serial.println(reason);
  Serial.flush();
  while (1) {
    delay(1000);
  }
}

// =========================================================================
// SETUP
// =========================================================================
void setup() {
  Serial.begin(115200);
  delay(1500);  // Allow Serial Monitor connection

  Serial.println("\n=======================================================");
  Serial.println(" ESP32 1D-CNN Predictive Maintenance Guard System");
  Serial.println("=======================================================");

  // 1. Initialize Motor Control Pins & PWM
  pinMode(IN3_PIN, OUTPUT);
  pinMode(IN4_PIN, OUTPUT);

#if defined(ESP_ARDUINO_VERSION) && (ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0))
  ledcAttach(ENB_PIN, PWM_FREQ, PWM_RESOLUTION);
#else
  ledcSetup(PWM_CHANNEL, PWM_FREQ, PWM_RESOLUTION);
  ledcAttachPin(ENB_PIN, PWM_CHANNEL);
#endif

  motor_stop();
  Serial.println("[OK] Motor GPIO & PWM (5 kHz) Initialized.");

  // 2. Initialize I2C & MPU6050 (100 kHz Standard I2C matching Data Collector)
  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setClock(100000);

  Serial.println("[*] Connecting to MPU6050 accelerometer...");
  bool sensor_found = false;
  for (int attempt = 1; attempt <= 5; attempt++) {
    if (mpu.begin()) {
      sensor_found = true;
      break;
    }
    Serial.printf("[!] Attempt %d: MPU6050 not responding. Retrying in 500ms...\n", attempt);
    delay(500);
  }

  if (!sensor_found) {
    fault_halt("MPU6050 NOT DETECTED on I2C (SDA=21, SCL=22)! Verify sensor VCC, GND, and wiring.");
  }

  Serial.println("[OK] MPU6050 Sensor Initialized successfully (8G range, 44Hz DLPF)!");
  mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
  mpu.setGyroRange(MPU6050_RANGE_500_DEG);
  mpu.setFilterBandwidth(MPU6050_BAND_44_HZ);
  delay(500);

  // 3. Load TFLite Model
  model = tflite::GetModel(g_model);
  if (model->version() != TFLITE_SCHEMA_VERSION) {
    fault_halt("Model schema version mismatch!");
  }
  Serial.printf("[OK] TFLite Model Loaded (%u bytes in Flash).\n", g_model_len);

  // 4. Register Required Operators for 1D-CNN
  static tflite::MicroMutableOpResolver<10> resolver;
  resolver.AddExpandDims();
  resolver.AddConv2D();
  resolver.AddReshape();
  resolver.AddMaxPool2D();
  resolver.AddFullyConnected();
  resolver.AddSoftmax();
  resolver.AddMean();
  Serial.println("[OK] Micro Op Resolver Configured.");

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

  // 6. Allocate Tensors in Arena
  if (interpreter->AllocateTensors() != kTfLiteOk) {
    fault_halt("Tensor Allocation Failed! Verify TENSOR_ARENA_SIZE.");
  }
  Serial.println("[OK] Tensors Allocated in Arena.");

  input = interpreter->input(0);
  output = interpreter->output(0);

  if (input->type != kTfLiteInt8) {
    fault_halt("ERROR: Model input tensor is not INT8.");
  }

  const int expected_bytes = WINDOW_SIZE * NUM_CHANNELS;
  if (input->bytes != (size_t)expected_bytes) {
    Serial.printf("[!] Shape mismatch: expected %d bytes, got %d bytes\n", expected_bytes, input->bytes);
    fault_halt("Model input tensor shape mismatch!");
  }

  Serial.printf("[OK] Model Quantization: Scale=%.8f, ZeroPoint=%d\n", input->params.scale, input->params.zero_point);
  Serial.printf("[OK] Sampling delay: %d ms (~%.1f Hz)\n", sample_delay_ms, 1000.0f / (sample_delay_ms + 2));

  // 7. Arm System: Start Motor
  start_motor(MOTOR_SPEED);
  Serial.printf("[OK] Guard Armed: Motor running at PWM %d. Monitoring vibration...\n", MOTOR_SPEED);
  Serial.println("=======================================================");
  Serial.println("Commands available in Serial Monitor:");
  Serial.println("  'r' : Reset / Re-arm motor after trip");
  Serial.println("  's' : Stop motor manually");
  Serial.println("  'm' : Start motor manually");
  Serial.println("  '+' : Increase sampling delay (+5ms)");
  Serial.println("  '-' : Decrease sampling delay (-5ms)");
  Serial.println("  'd' : Print single raw MPU6050 reading");
  Serial.println("-------------------------------------------------------\n");
}

// =========================================================================
// MAIN INFERENCE LOOP
// =========================================================================
void loop() {
  // Handle user Serial commands
  if (Serial.available()) {
    char cmd = Serial.read();
    if (cmd == 'r' || cmd == 'R') {
      motor_tripped = false;
      consecutive_fault_count = 0;
      last_fault_class = 0;
      start_motor(MOTOR_SPEED);
      Serial.println("\n>>> [RESET] Fault Latch Cleared. Motor Re-armed! <<<\n");
    } else if (cmd == 's' || cmd == 'S') {
      motor_stop();
      Serial.println("\n>>> [STOP] Motor stopped manually. <<<\n");
    } else if (cmd == 'm' || cmd == 'M') {
      motor_tripped = false;
      consecutive_fault_count = 0;
      start_motor(MOTOR_SPEED);
      Serial.println("\n>>> [START] Motor started manually. <<<\n");
    } else if (cmd == '+') {
      sample_delay_ms += 5;
      Serial.printf("[CFG] Sampling delay increased to %d ms (~%.1f Hz)\n", sample_delay_ms, 1000.0f / (sample_delay_ms + 2));
    } else if (cmd == '-') {
      if (sample_delay_ms > 5) sample_delay_ms -= 5;
      Serial.printf("[CFG] Sampling delay decreased to %d ms (~%.1f Hz)\n", sample_delay_ms, 1000.0f / (sample_delay_ms + 2));
    } else if (cmd == 'd' || cmd == 'D') {
      sensors_event_t a, g, temp;
      mpu.getEvent(&a, &g, &temp);
      Serial.printf("[RAW SENSOR] ax: %.4f, ay: %.4f, az: %.4f m/s^2\n", a.acceleration.x, a.acceleration.y, a.acceleration.z);
    }
  }

  const float scale = input->params.scale;
  const int32_t zero_point = input->params.zero_point;

  float last_ax = 0.0f, last_ay = 0.0f, last_az = 0.0f;
  unsigned long window_start = millis();

  // 1. Acquire 256-sample window of REAL RAW MPU6050 vibration data
  for (int i = 0; i < WINDOW_SIZE; i++) {
    sensors_event_t a, g, temp;
    mpu.getEvent(&a, &g, &temp);

    // Constrain to physical range [-15.0, 25.0] to filter spurious hardware/I2C glitches
    float ax = constrain(a.acceleration.x, -15.0f, 25.0f);
    float ay = constrain(a.acceleration.y, -15.0f, 25.0f);
    float az = constrain(a.acceleration.z, -15.0f, 25.0f);

    last_ax = ax;
    last_ay = ay;
    last_az = az;

    // Standard INT8 Quantization: q = round(val / scale) + zero_point
    int32_t qx = (int32_t)round(ax / scale) + zero_point;
    int32_t qy = (int32_t)round(ay / scale) + zero_point;
    int32_t qz = (int32_t)round(az / scale) + zero_point;

    // Clamp to int8 bounds [-128, 127]
    if (qx < -128) qx = -128; else if (qx > 127) qx = 127;
    if (qy < -128) qy = -128; else if (qy > 127) qy = 127;
    if (qz < -128) qz = -128; else if (qz > 127) qz = 127;

    const int idx = i * NUM_CHANNELS;
    input->data.int8[idx]     = (int8_t)qx;
    input->data.int8[idx + 1] = (int8_t)qy;
    input->data.int8[idx + 2] = (int8_t)qz;

    // Delay between samples matching data collection rate
    if (sample_delay_ms > 0) {
      delay(sample_delay_ms);
    }
  }

  unsigned long sample_time = millis() - window_start;

  // 2. Execute On-Device 1D-CNN Inference
  unsigned long t_start = millis();
  if (interpreter->Invoke() != kTfLiteOk) {
    Serial.println("[-] TFLite Inference Invocation Failed!");
    return;
  }
  unsigned long inference_time = millis() - t_start;

  // 3. Extract Predicted Output Scores & Probabilities
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

  // De-quantize int8 scores to probability percentages
  float p_healthy    = (s_healthy - output->params.zero_point) * output->params.scale;
  float p_misaligned = (s_misaligned - output->params.zero_point) * output->params.scale;
  float p_imbalance  = (s_imbalance - output->params.zero_point) * output->params.scale;

  // Real-time telemetry log
  Serial.printf("[Sampled %lums | Infer %lums] Raw: [ax:%.2f, ay:%.2f, az:%.2f] | Conf: [H:%5.1f%%, M:%5.1f%%, I:%5.1f%%] -> ",
                sample_time, inference_time, last_ax, last_ay, last_az,
                p_healthy * 100.0f, p_misaligned * 100.0f, p_imbalance * 100.0f);

  // 4. Fault Detection & Motor Safety Interlock Logic
  if (predicted_class == 0) {
    consecutive_fault_count = 0;
    last_fault_class = 0;
    if (!motor_tripped) {
      Serial.println("STATUS: HEALTHY (Normal Operation)");
    } else {
      Serial.println("STATUS: HEALTHY (Motor Tripped - Send 'R' to re-arm)");
    }
  } else {
    // Check if within motor startup grace period (suppress false trips during spinup)
    if (millis() - motor_start_time < STARTUP_GRACE_PERIOD_MS) {
      Serial.printf("STARTUP GRACE: Suppressing transient fault %d during motor ramp-up.\n", predicted_class);
      return;
    }

    if (predicted_class == last_fault_class) {
      consecutive_fault_count++;
    } else {
      consecutive_fault_count = 1;
      last_fault_class = predicted_class;
    }

    const char* fault_name = (predicted_class == 1) ? "MISALIGNMENT" : "IMBALANCE";
    Serial.printf("ALERT: %s DETECTED (%d/%d consecutive)\n", fault_name, consecutive_fault_count, FAULT_CONFIRMATION_COUNT);

    // Trip Emergency Brake only if confirmed across consecutive windows
    if (consecutive_fault_count >= FAULT_CONFIRMATION_COUNT && !motor_tripped) {
      emergency_stop();
      motor_tripped = true;
      Serial.printf("\n>>> [EMERGENCY BRAKE ENGAGED] ACTIVE BRAKE LATCHED: %s! <<<\n", fault_name);
      Serial.println(">>> Send 'R' to clear fault latch and restart motor. <<<\n");
    }
  }
}