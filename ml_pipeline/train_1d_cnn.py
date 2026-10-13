import os
import tensorflow as tf
from tensorflow.keras import layers, models
from dataset_loader import load_and_preprocess_data

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS_DIR = os.path.join(REPO_ROOT, "models")
os.makedirs(MODELS_DIR, exist_ok=True)
H5_MODEL_PATH = os.path.join(MODELS_DIR, "cnn_vibration_model.h5")

def build_1d_cnn(input_shape=(256, 3), num_classes=3):
    """
    Lightweight 1D-CNN designed for temporal vibration signals
    and optimized for TFLite Micro on ESP32.
    """
    model = models.Sequential([
        layers.Conv1D(filters=16, kernel_size=5, activation="relu", input_shape=input_shape),
        layers.MaxPooling1D(pool_size=2),

        layers.Conv1D(filters=16, kernel_size=3, activation="relu"),
        layers.MaxPooling1D(pool_size=2),

        layers.Flatten(),
        layers.Dense(16, activation="relu"),
        layers.Dropout(0.2),
        layers.Dense(num_classes, activation="softmax")
    ])

    model.compile(
        optimizer="adam",
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"]
    )
    return model

def train():
    X_train, X_test, y_train, y_test = load_and_preprocess_data()

    model = build_1d_cnn(input_shape=(256, 3), num_classes=3)
    model.summary()

    print("\n[+] Starting 1D-CNN Training...")
    history = model.fit(
        X_train, y_train,
        epochs=15,
        batch_size=32,
        validation_data=(X_test, y_test),
        verbose=1
    )

    loss, acc = model.evaluate(X_test, y_test, verbose=0)
    print(f"\n[OK] Test Accuracy: {acc * 100:.2f}% | Test Loss: {loss:.4f}")

    model.save(H5_MODEL_PATH)
    print(f"[OK] Trained Keras model saved to: {os.path.abspath(H5_MODEL_PATH)}")
    return model

if __name__ == "__main__":
    train()
