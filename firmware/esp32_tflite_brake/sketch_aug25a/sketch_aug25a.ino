#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include "TensorFlowLite.h"
#include "tensorflow/lite/micro/all_ops_resolver.h"
#include "tensorflow/lite/micro/micro_interpreter.h"
#include "tensorflow/lite/schema/schema_generated.h"
#include "model_data.h"

// Hardware Pin Definitions
#define ENA_PIN 14  // PWM Speed Control
#define IN1_PIN 27  // Direction pin 1
#define IN2_PIN 26  // Direction pin 2

// ML Pipeline Parameters
#define WINDOW_SIZE 256
#define NUM_CHANNELS 3
#define ARENA_SIZE 16 * 1024

// L298N Motor Control Helper Functions
void start_motor(uint8_t speed) {
  digitalWrite(IN1_PIN, HIGH);
  digitalWrite(IN2_PIN, LOW);
  ledcWrite(0, speed); // Set PWM speed on channel 0
}

void emergency_stop() {
  // Active Brake: Drive both direction pins HIGH to short motor leads
  digitalWrite(IN1_PIN, HIGH);
  digitalWrite(IN2_PIN, HIGH);
  ledcWrite(0, 0);
}

// TFLite Global References
const tflite::Model* model = nullptr;
tflite::MicroInterpreter* interpreter = nullptr;
TfLiteTensor* input = nullptr;
TfLiteTensor* output = nullptr;
uint8_t tensor_arena[ARENA_SIZE];

Adafruit_MPU6050 mpu;

void setup() {
  Serial.begin(115200);

  // Configure Motor Control Pins
  pinMode(IN1_PIN, OUTPUT);
  pinMode(IN2_PIN, OUTPUT);
  
  // Setup PWM on ESP32 (LEDC channel 0, 5kHz frequency, 8-bit resolution)
  ledcSetup(0, 5000, 8);
  ledcAttachPin(ENA_PIN, 0);

  // Initialize Motor state to running
  start_motor(200); // Set motor speed to ~80% power

  // Initialize MPU6050 Sensor
  if (!mpu.begin()) {
    Serial.println("[-] MPU6050 Sensor Initialization Failed!");
    while (1);
  }
  mpu.setAccelerometerRange(MPU6050_RANGE_4_G);
  mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);

  // Initialize TFLite Micro Model Engine
  model = tflite::GetModel(g_model);
  if (model->version() != TFLITE_SCHEMA_VERSION) {
    Serial.println("[-] Model schema mismatch!");
    while (1);
  }

  static tflite::AllOpsResolver resolver;
  static tflite::MicroInterpreter static_interpreter(model, resolver, tensor_arena, ARENA_SIZE);
  interpreter = &static_interpreter;

  if (interpreter->AllocateTensors() != kTfLiteOk) {
    Serial.println("[-] Tensor arena allocation failed!");
    while (1);
  }

  input = interpreter->input(0);
  output = interpreter->output(0);
  Serial.println("[✔] TFLite Micro Guard System Initialized. Monitoring Vibration...");
}

void loop() {
  sensors_event_t a, g, temp;
  
  // 1. Collect a 256-sample window across 3 accelerometer axes
  for (int i = 0; i < WINDOW_SIZE; i++) {
    mpu.getEvent(&a, &g, &temp);

    // Apply basic value clipping matching training pipeline
    float ax = constrain(a.acceleration.x, -15.0f, 25.0f);
    float ay = constrain(a.acceleration.y, -15.0f, 25.0f);
    float az = constrain(a.acceleration.z, -15.0f, 25.0f);

    // Quantize input floats to INT8 using model tensor quantization scale & zero point
    int idx = i * NUM_CHANNELS;
    input->data.int8[idx]     = (int8_t)((ax) * input->params.scale + input->params.zero_point);
    input->data.int8[idx + 1] = (int8_t)((ay) * input->params.scale + input->params.zero_point);
    input->data.int8[idx + 2] = (int8_t)((az) * input->params.scale + input->params.zero_point);

    delay(10); // ~100Hz sampling interval
  }

  // 2. Perform Real-time On-device Inference
  if (interpreter->Invoke() != kTfLiteOk) {
    Serial.println("[-] Inference Invocation Failed!");
    return;
  }

  // 3. Extract Predicted Output Class
  int8_t healthy_score = output->data.int8[0];
  int8_t misaligned_score = output->data.int8[1];
  int8_t imbalance_score = output->data.int8[2];

  int predicted_class = 0;
  int8_t max_score = healthy_score;

  if (misaligned_score > max_score) {
    max_score = misaligned_score;
    predicted_class = 1;
  }
  if (imbalance_score > max_score) {
    max_score = imbalance_score;
    predicted_class = 2;
  }

  // 4. Closed-loop Hardware Safety Trigger
  if (predicted_class == 0) {
    Serial.println("[+] STATE: HEALTHY | System Running Safely.");
  } else if (predicted_class == 1) {
    Serial.println("[!] FAULT DETECTED: MISALIGNMENT | Executing Emergency Stop!");
    emergency_stop();
    while (1); // Halt motor operation indefinitely until manual reset
  } else if (predicted_class == 2) {
    Serial.println("[!] FAULT DETECTED: IMBALANCE | Executing Emergency Stop!");
    emergency_stop();
    while (1); // Halt motor operation indefinitely until manual reset
  }
}