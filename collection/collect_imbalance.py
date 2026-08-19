import csv
import os
import time
import serial
import config


def record_dataset():
    class_id = 2
    folder_name = "2_Imbalance"
    label_name = "Imbalance Fault"

    condition_name = config.prompt_condition_selection()

    target_dir = os.path.join(config.BASE_DATASET_DIR, folder_name)
    os.makedirs(target_dir, exist_ok=True)
    segmented_filename = os.path.join(target_dir, f"{condition_name}.csv")

    try:
        ser = serial.Serial(config.SERIAL_PORT, config.BAUD_RATE, timeout=1)
        time.sleep(2)
        ser.reset_input_buffer()

        print("\n" + "-" * 65)
        print(f"[+] Class: {label_name} | Profile: {condition_name}")
        print(f"[+] Output: {os.path.abspath(segmented_filename)}")
        print("-" * 65)

        with open(segmented_filename, mode="a", newline="", encoding="utf-8") as win_file:
            win_writer = csv.writer(win_file)

            if win_file.tell() == 0:
                headers = [f"X_{i}" for i in range(config.WINDOW_SIZE)]
                headers += [f"Y_{i}" for i in range(config.WINDOW_SIZE)]
                headers += [f"Z_{i}" for i in range(config.WINDOW_SIZE)]
                headers.append("Label")
                win_writer.writerow(headers)

            buffer = []
            total_samples = 0
            windows_saved = 0

            while windows_saved < config.TARGET_SEGMENTS:
                line = ser.readline().decode("utf-8", errors="ignore").strip()
                if line:
                    parts = line.split(",")
                    if len(parts) == 3:
                        try:
                            accel_x, accel_y, accel_z = (
                                float(parts[0]),
                                float(parts[1]),
                                float(parts[2]),
                            )
                            buffer.append((accel_x, accel_y, accel_z))
                            total_samples += 1

                            if len(buffer) == config.WINDOW_SIZE:
                                xs = [b[0] for b in buffer]
                                ys = [b[1] for b in buffer]
                                zs = [b[2] for b in buffer]

                                win_writer.writerow(xs + ys + zs + [class_id])
                                win_file.flush()

                                windows_saved += 1
                                print(
                                    f"[{time.strftime('%H:%M:%S')}] Saved Segment "
                                    f"{windows_saved}/{config.TARGET_SEGMENTS}"
                                )
                                buffer = buffer[config.STEP_SIZE :]
                        except ValueError:
                            continue

            print(f"\n[✔] {config.TARGET_SEGMENTS} segments saved to '{segmented_filename}'.")

    except serial.SerialException as e:
        print(f"\n[!] Serial Error: {e}")
    finally:
        if "ser" in locals() and ser.is_open:
            ser.close()


if __name__ == "__main__":
    record_dataset()