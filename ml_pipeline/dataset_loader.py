import os
import glob
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split

BASE_DATASET_DIR = os.path.join("..", "datasets")
WINDOW_SIZE = 256

def load_and_preprocess_data(test_size=0.2, random_state=42):
    X_list = []
    y_list = []

    # Iterate through class subfolders (0_Healthy, 1_Misalignment, 2_Imbalance)
    class_folders = glob.glob(os.path.join(BASE_DATASET_DIR, "*"))
    
    if not class_folders:
        raise FileNotFoundError(f"No class folders found in '{os.path.abspath(BASE_DATASET_DIR)}'.")

    print(f"[+] Loading dataset from: {os.path.abspath(BASE_DATASET_DIR)}")
    
    for folder in class_folders:
        if not os.path.isdir(folder):
            continue
            
        csv_files = glob.glob(os.path.join(folder, "*.csv"))
        for csv_file in csv_files:
            print(f"  └─ Parsing: {csv_file}")
            df = pd.read_csv(csv_file)
            
            if df.empty:
                continue

            # Separate features (X_0..X_255, Y_0..Y_255, Z_0..Z_255) and labels
            labels = df["Label"].values
            feature_cols = [col for col in df.columns if col != "Label"]
            features = df[feature_cols].values

            for i in range(len(features)):
                row = features[i]
                # Split flat 768-vector into X, Y, Z components
                x_axis = row[0:WINDOW_SIZE]
                y_axis = row[WINDOW_SIZE:2 * WINDOW_SIZE]
                z_axis = row[2 * WINDOW_SIZE:3 * WINDOW_SIZE]

                # Stack into 2D array: shape (256, 3)
                sample = np.column_stack((x_axis, y_axis, z_axis))
                X_list.append(sample)
                y_list.append(labels[i])

    X = np.array(X_list, dtype=np.float32)
    y = np.array(y_list, dtype=np.int32)

    print(f"[+] Total samples loaded: {X.shape[0]} | Sample Shape: {X.shape[1:]}")

    # Train / Test Split
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=test_size, random_state=random_state, stratify=y
    )

    return X_train, X_test, y_train, y_test

if __name__ == "__main__":
    X_tr, X_te, y_tr, y_te = load_and_preprocess_data()
    print(f"[✔] Train shape: {X_tr.shape}, Test shape: {X_te.shape}")