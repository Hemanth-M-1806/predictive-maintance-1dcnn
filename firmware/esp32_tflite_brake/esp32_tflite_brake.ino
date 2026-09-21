#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>

#include <TensorFlowLite_ESP32.h>
#include <tensorflow/lite/micro/all_ops_resolver.h>
#include <tensorflow/lite/micro/micro_interpreter.h>
#include <tensorflow/lite/schema/schema_generated.h>
#include <tensorflow/lite/micro/micro_error_reporter.h>
#include "model_data.h"

#define WINDOW_SIZE 256
#define NUM_CHANNELS 3

// 40KB Arena with strict 16-byte alignment
#define TENSOR_ARENA_SIZE (40 * 1024)
alignas(16) uint8_t tensor_arena[TENSOR_ARENA_SIZE];

const tflite::Model* model = nullptr;
tflite::MicroInterpreter* interpreter = nullptr;
TfLiteTensor* input = nullptr;
TfLiteTensor* output = nullptr;

static tflite::MicroErrorReporter micro_error_reporter;
tflite::ErrorReporter* error_reporter = &micro_error_reporter;

Adafruit_MPU6050 mpu;

void fault_halt(const char* reason) {
  Serial.println(reason);
  Serial.flush();
  while (1) {
    delay(1000);
  }
}

void setup() {
  Serial.begin(115200);
  while (!Serial) { delay(10); } 
  delay(1000); 

  Serial.println("\n--- Starting Setup ---");

  // 1. Initialize MPU6050
  if (!mpu.begin()) {
    fault_halt("Failed to find MPU6050 chip. Check I2C wiring (SDA/SCL).");
  }
  mpu.setAccelerometerRange(MPU6050_RANGE_2_G);
  mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
  Serial.println("MPU6050 Initialized!");

  // 2. Initialize TFLite Model
  model = tflite::GetModel(g_model);
  if (model->version() != TFLITE_SCHEMA_VERSION) {
    fault_halt("Model Schema Mismatch");
  }
  Serial.println("Model Loaded Successfully.");

  static tflite::AllOpsResolver resolver;

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

  if (interpreter->AllocateTensors() != kTfLiteOk) {
    fault_halt("Tensor Allocation Failed!");
  }
  Serial.println("Tensors Allocated Successfully!");

  input = interpreter->input(0);
  output = interpreter->output(0);

  if (input->type != kTfLiteInt8) {
    fault_halt("ERROR: Model input is not INT8.");
  }

  const int expected_len = WINDOW_SIZE * NUM_CHANNELS;
  if (input->bytes != (size_t)expected_len) {
    Serial.print("Input size mismatch. Expected ");
    Serial.print(expected_len);
    Serial.print(" bytes, but model requires ");
    Serial.println(input->bytes);
    fault_halt("Model/Firmware Shape Mismatch");
  }

  Serial.println("System Ready. Beginning Data Collection...");
}

void loop() {
  float scale = input->params.scale;
  int32_t zero_point = input->params.zero_point;
  
  // Collect WINDOW_SIZE samples from the MPU6050
  for (int i = 0; i < WINDOW_SIZE; i++) {
    sensors_event_t a, g, temp;
    mpu.getEvent(&a, &g, &temp);

    // Adafruit returns acceleration in m/s^2 (e.g., 9.8 for gravity)
    float ax = a.acceleration.x;
    float ay = a.acceleration.y;
    float az = a.acceleration.z;

    // IMPORTANT: If you normalized your data in Python (e.g. StandardScaler),
    // you must apply the exact same math here before quantization.
    // Example:
    // ax = (ax - mean_x) / std_x;
    // ay = (ay - mean_y) / std_y;
    // az = (az - mean_z) / std_z;

    int idx = i * NUM_CHANNELS;
    
    // Quantize floating point values to INT8
    input->data.int8[idx]     = (int8_t)(round(ax / scale) + zero_point);
    input->data.int8[idx + 1] = (int8_t)(round(ay / scale) + zero_point);
    input->data.int8[idx + 2] = (int8_t)(round(az / scale) + zero_point);

    // Wait roughly 10ms to achieve ~100Hz sampling rate
    // Adjust this delay to match the sampling frequency you used during Python training!
    delay(10); 
  }

  // Run Inference
  if (interpreter->Invoke() != kTfLiteOk) {
    Serial.println("Inference Failed");
    return;
  }

  // Extract Scores
  int8_t healthy_score    = output->data.int8[0];
  int8_t misaligned_score = output->data.int8[1];
  int8_t imbalance_score  = output->data.int8[2];

  int predicted_class = 0;
  int8_t max_score = healthy_score;
  if (misaligned_score > max_score) { max_score = misaligned_score; predicted_class = 1; }
  if (imbalance_score > max_score)  { max_score = imbalance_score;  predicted_class = 2; }

  // Print Results
  Serial.print("Scores -> Healthy: "); Serial.print(healthy_score);
  Serial.print(", Misaligned: "); Serial.print(misaligned_score);
  Serial.print(", Imbalance: "); Serial.println(imbalance_score);

  switch (predicted_class) {
    case 0: Serial.println("Predicted: HEALTHY\n"); break;
    case 1: Serial.println("Predicted: MISALIGNMENT\n"); break;
    case 2: Serial.println("Predicted: IMBALANCE\n"); break;
  }
}