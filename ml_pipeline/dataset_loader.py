import glob
import os
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split

WINDOW_SIZE = 256
NUM_CHANNELS = 3

# Default dataset path relative to repository root
DEFAULT_DATASET_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "collection", "datasets")

def load_and_preprocess_data(dataset_dir=DEFAULT_DATASET_DIR, test_size=0.2, random_state=42):
    """
    Loads raw segmented vibration data from CSV files across all classes and profiles.
    Performs physical bounds clipping [-15.0, 25.0] to remove sensor glitch spikes.
    Returns:
        X_train, X_test, y_train, y_test
    """
    X_list = []
    y_list = []

    class_configs = [
        ("0_Healthy", 0),
        ("1_Misalignment", 1),
        ("2_Imbalance", 2),
    ]

    feature_cols = (
        [f"X_{i}" for i in range(WINDOW_SIZE)]
        + [f"Y_{i}" for i in range(WINDOW_SIZE)]
        + [f"Z_{i}" for i in range(WINDOW_SIZE)]
    )

    for folder_name, class_id in class_configs:
        folder_path = os.path.join(dataset_dir, folder_name)
        if not os.path.isdir(folder_path):
            print(f"[!] Warning: Directory not found: {folder_path}")
            continue

        csv_files = glob.glob(os.path.join(folder_path, "*.csv"))
        for csv_file in csv_files:
            df = pd.read_csv(csv_file)
            if df.empty:
                continue

            for _, row in df.iterrows():
                features = row[feature_cols].values.astype(np.float32)

                # Clean sensor glitches by clipping to physical bounds
                features = np.clip(features, -15.0, 25.0)

                x_axis = features[0:WINDOW_SIZE]
                y_axis = features[WINDOW_SIZE : 2 * WINDOW_SIZE]
                z_axis = features[2 * WINDOW_SIZE : 3 * WINDOW_SIZE]

                # Shape per sample: (256, 3)
                sample = np.column_stack((x_axis, y_axis, z_axis))
                X_list.append(sample)
                y_list.append(class_id)

    X = np.array(X_list, dtype=np.float32)
    y = np.array(y_list, dtype=np.int32)

    print(f"[OK] Loaded {len(X)} total samples from '{dataset_dir}'.")
    return train_test_split(
        X, y, test_size=test_size, random_state=random_state, stratify=y
    )

if __name__ == "__main__":
    X_train, X_test, y_train, y_test = load_and_preprocess_data()
    print(f"X_train shape: {X_train.shape}, y_train shape: {y_train.shape}")
    print(f"X_test shape: {X_test.shape}, y_test shape: {y_test.shape}")
