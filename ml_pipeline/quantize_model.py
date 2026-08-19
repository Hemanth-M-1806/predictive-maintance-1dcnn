import os
import numpy as np
import tensorflow as tf
from dataset_loader import load_and_preprocess_data

MODEL_DIR = os.path.join("..", "models")
FIRMWARE_DIR = os.path.join("..", "firmware", "esp32_tflite_brake")
os.makedirs(FIRMWARE_DIR, exist_ok=True)

H5_MODEL_PATH = os.path.join(MODEL_DIR, "cnn_vibration_model.h5")
TFLITE_MODEL_PATH = os.path.join(MODEL_DIR, "cnn_vibration_model.tflite")
HEADER_PATH = os.path.join(FIRMWARE_DIR, "model_data.h")

def convert_and_quantize():
    model = tf.keras.models.load_model(H5_MODEL_PATH)
    X_train, _, _, _ = load_and_preprocess_data()

    # Representative Dataset Generator for INT8 Calibration
    def representative_dataset():
        for i in range(min(100, len(X_train))):
            yield [np.expand_dims(X_train[i], axis=0).astype(np.float32)]

    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    converter.representative_dataset = representative_dataset
    converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
    converter.inference_input_type = tf.int8
    converter.inference_output_type = tf.int8

    tflite_quant_model = converter.convert()

    with open(TFLITE_MODEL_PATH, "wb") as f:
        f.write(tflite_quant_model)
    print(f"[✔] Quantized INT8 TFLite model saved to: {TFLITE_MODEL_PATH}")

    # Generate model_data.h C array for Arduino/ESP32 firmware
    with open(HEADER_PATH, "w") as f:
        f.write("// Auto-generated INT8 TFLite Model Byte Array\n")
        f.write("#ifndef MODEL_DATA_H\n#define MODEL_DATA_H\n\n")
        f.write(f"const unsigned int g_model_len = {len(tflite_quant_model)};\n")
        f.write("const unsigned char g_model[] alignas(8) = {\n  ")
        
        hex_bytes = [f"0x{b:02x}" for b in tflite_quant_model]
        for i in range(0, len(hex_bytes), 12):
            f.write(", ".join(hex_bytes[i:i+12]))
            if i + 12 < len(hex_bytes):
                f.write(",\n  ")
            else:
                f.write("\n")
        f.write("};\n\n#endif // MODEL_DATA_H\n")

    print(f"[✔] C Header generated at: {os.path.abspath(HEADER_PATH)}")

if __name__ == "__main__":
    convert_and_quantize()