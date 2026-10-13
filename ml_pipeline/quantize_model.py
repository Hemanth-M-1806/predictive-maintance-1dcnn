import os
import numpy as np
import tensorflow as tf
from dataset_loader import load_and_preprocess_data

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS_DIR = os.path.join(REPO_ROOT, "models")
FIRMWARE_DIR = os.path.join(REPO_ROOT, "firmware", "esp32_tflite_brake")
os.makedirs(MODELS_DIR, exist_ok=True)
os.makedirs(FIRMWARE_DIR, exist_ok=True)

H5_MODEL_PATH = os.path.join(MODELS_DIR, "cnn_vibration_model.h5")
TFLITE_MODEL_PATH = os.path.join(MODELS_DIR, "cnn_vibration_model.tflite")
HEADER_PATH = os.path.join(FIRMWARE_DIR, "model_data.h")

def convert_and_quantize():
    if not os.path.exists(H5_MODEL_PATH):
        from train_1d_cnn import train
        train()

    model = tf.keras.models.load_model(H5_MODEL_PATH)
    X_train, X_test, y_train, y_test = load_and_preprocess_data()

    # Representative Dataset Generator for INT8 Calibration
    def representative_dataset():
        for i in range(min(200, len(X_train))):
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
    print(f"\n[OK] Quantized INT8 TFLite model saved to: {TFLITE_MODEL_PATH} ({len(tflite_quant_model)} bytes)")

    # Verify INT8 quantized accuracy on test set
    interpreter = tf.lite.Interpreter(model_content=tflite_quant_model)
    interpreter.allocate_tensors()
    in_d = interpreter.get_input_details()[0]
    out_d = interpreter.get_output_details()[0]

    scale = in_d["quantization_parameters"]["scales"][0]
    zero_point = in_d["quantization_parameters"]["zero_points"][0]
    print(f"[OK] Input Quantization: Scale={scale:.8f}, ZeroPoint={zero_point}")

    correct = 0
    for i in range(len(X_test)):
        q = np.round(X_test[i] / scale) + zero_point
        q = np.clip(q, -128, 127).astype(np.int8)
        q = np.expand_dims(q, axis=0)
        interpreter.set_tensor(in_d["index"], q)
        interpreter.invoke()
        out = interpreter.get_tensor(out_d["index"])[0]
        pred = np.argmax(out)
        if pred == y_test[i]:
            correct += 1

    acc = correct / len(X_test) * 100.0
    print(f"[OK] Quantized INT8 Test Set Accuracy: {acc:.2f}% ({correct}/{len(X_test)})")

    # Generate model_data.h C array for Arduino / ESP32 firmware
    with open(HEADER_PATH, "w") as f:
        f.write("// Auto-generated INT8 TFLite Micro Model Byte Array\n")
        f.write(f"// Quantization: Input Scale = {scale:.8f}f, ZeroPoint = {zero_point}\n")
        f.write(f"// Verified Accuracy: {acc:.2f}%\n")
        f.write("#ifndef MODEL_DATA_H\n#define MODEL_DATA_H\n\n")
        f.write(f"const unsigned int g_model_len = {len(tflite_quant_model)};\n")
        f.write("const unsigned char g_model[] alignas(8) = {\n  ")

        hex_bytes = [f"0x{b:02x}" for b in tflite_quant_model]
        for i in range(0, len(hex_bytes), 12):
            f.write(", ".join(hex_bytes[i:i + 12]))
            if i + 12 < len(hex_bytes):
                f.write(",\n  ")
            else:
                f.write("\n")
        f.write("};\n\n#endif // MODEL_DATA_H\n")

    print(f"[OK] C Header generated at: {os.path.abspath(HEADER_PATH)}")

if __name__ == "__main__":
    convert_and_quantize()
