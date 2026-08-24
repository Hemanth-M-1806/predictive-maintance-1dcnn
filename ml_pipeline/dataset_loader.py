import glob
import os
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split

BASE_DATASET_DIR = os.path.join("..", "datasets")
WINDOW_SIZE = 256


def load_and_preprocess_data(test_size=0.2, random_state=42):
    X_list = []
    y_list = []

    class_folders = glob.glob(os.path.join(BASE_DATASET_DIR, "*"))

    if not class_folders:
        raise FileNotFoundError(
            f"No class folders found in '{os.path.abspath(BASE_DATASET_DIR)}'."
        )

    # Build explicit feature column list to avoid alphabetical sort bugs
    feature_cols = (
        [f"X_{i}" for i in range(WINDOW_SIZE)]
        + [f"Y_{i}" for i in range(WINDOW_SIZE)]
        + [f"Z_{i}" for i in range(WINDOW_SIZE)]
    )

    for folder in class_folders:
        if not os.path.isdir(folder):
            continue

        for csv_file in glob.glob(os.path.join(folder, "*.csv")):
            df = pd.read_csv(csv_file)
            if df.empty:
                continue

            labels = df["Label"].values
            # Explicitly select features in defined order
            features = df[feature_cols].values

            for row, label in zip(features, labels):
                # Clean severe sensor glitches (clip to reasonable physical bounds)
                row = np.clip(row, -15.0, 25.0)

                x_axis = row[0:WINDOW_SIZE]
                y_axis = row[WINDOW_SIZE : 2 * WINDOW_SIZE]
                z_axis = row[2 * WINDOW_SIZE : 3 * WINDOW_SIZE]

                sample = np.column_stack((x_axis, y_axis, z_axis))
                X_list.append(sample)
                y_list.append(label)

    X = np.array(X_list, dtype=np.float32)
    y = np.array(y_list, dtype=np.int32)

    # Standardize input channels (Mean=0, Std=1 per channel across dataset)
    mean = np.mean(X, axis=(0, 1), keepdims=True)
    std = np.std(X, axis=(0, 1), keepdims=True)
    X = (X - mean) / (std + 1e-8)

    return train_test_split(
        X, y, test_size=test_size, random_state=random_state, stratify=y
    )