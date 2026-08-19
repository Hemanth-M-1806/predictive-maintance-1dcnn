import os

# Hardware & Serial Settings
SERIAL_PORT = "COM7"
BAUD_RATE = 115200

# Directory and Data Windowing Hyperparameters
BASE_DATASET_DIR = os.path.join("..", "datasets")  # Saves datasets in root datasets/ directory
WINDOW_SIZE = 256  # 256 samples per frame (~2.5s @ 100Hz)
STEP_SIZE = 128  # 50% overlap step size
TARGET_SEGMENTS = 5  # Increase (e.g., 100-300) for full training dataset generation

# Speed / Voltage Profiles
CONDITION_MAP = {
    "1": "low_speed",
    "2": "mid_speed",
    "3": "high_speed",
    "4": "transient_speed",
    "5": "dynamic_load",
}


def prompt_condition_selection():
    """Prompts user for operating speed/voltage condition."""
    print("Select Operating Speed/Voltage Profile:")
    for key, name in CONDITION_MAP.items():
        print(f"  [{key}] : {name}")

    while True:
        choice = input("\nEnter choice (1 to 5): ").strip()
        if choice in CONDITION_MAP:
            return CONDITION_MAP[choice]
        print("Invalid choice. Enter a number between 1 and 5.")