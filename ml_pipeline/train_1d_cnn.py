import os
import tensorflow as tf
from tensorflow.keras import layers, models
from dataset_loader import load_and_preprocess_data

MODEL_DIR = os.path.join("..", "models")
os.makedirs(MODEL_DIR, exist_ok=True)
H5_MODEL_PATH = os.path.join(MODEL_DIR, "cnn_vibration_model.h5")

def build_1d_cnn(input_shape=(256, 3), num_classes=3):
    model = models.Sequential([
        # Layer 1: Conv1D + ReLU + MaxPool
        layers.Conv1D(filters=16, kernel_size=5, activation='relu', input_shape=input_shape),
        layers.MaxPooling1D(pool_size=2),

        # Layer 2: Conv1D + ReLU + MaxPool
        layers.Conv1D(filters=32, kernel_size=3, activation='relu'),
        layers.MaxPooling1D(pool_size=2),

        # Flatten & Dense Output
        layers.Flatten(),
        layers.Dense(32, activation='relu'),
        layers.Dropout(0.3),
        layers.Dense(num_classes, activation='softmax')
    ])
    
    model.compile(
        optimizer='adam',
        loss='sparse_categorical_crossentropy',
        metrics=['accuracy']
    )
    return model

def train():
    X_train, X_test, y_train, y_test = load_and_preprocess_data()

    model = build_1d_cnn(input_shape=(256, 3), num_classes=3)
    model.summary()

    print("\n[+] Starting 1D-CNN Training...")
    history = model.fit(
        X_train, y_train,
        epochs=30,
        batch_size=16,
        validation_data=(X_test, y_test)
    )

    loss, acc = model.evaluate(X_test, y_test, verbose=0)
    print(f"\n[✔] Test Accuracy: {acc * 100:.2f}% | Test Loss: {loss:.4f}")

    model.save(H5_MODEL_PATH)
    print(f"[✔] Trained Keras model saved to: {os.path.abspath(H5_MODEL_PATH)}")

if __name__ == "__main__":
    train()