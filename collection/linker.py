import os
import sys
import subprocess

MODULE_MAP = {
    "1": ("Healthy State", "collect_healthy.py"),
    "2": ("Misalignment Fault (Broken Case 1)", "collect_misalignment.py"),
    "3": ("Imbalance Fault (Broken Case 2)", "collect_imbalance.py"),
}

# Resolve the absolute path of the directory containing this script
BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def display_menu():
    print("=" * 60)
    print(" 1D-CNN PREDICTIVE MAINTENANCE DATA COLLECTION LINKER ")
    print("=" * 60)
    print("Select the target class for this recording session:\n")

    for key, (name, script) in MODULE_MAP.items():
        print(f"  [{key}] {name} (Executes: {script})")

    print("  [Q] Quit Application\n")


def main():
    while True:
        display_menu()
        choice = input("Enter your choice: ").strip().upper()

        if choice == "Q":
            print("\nExiting data collection linker. Goodbye!")
            sys.exit(0)

        if choice in MODULE_MAP:
            class_name, script_name = MODULE_MAP[choice]
            # Construct absolute path to the target script
            script_path = os.path.join(BASE_DIR, script_name)

            if not os.path.exists(script_path):
                print(f"\n[!] Error: Script '{script_name}' not found at {script_path}")
                input("Press Enter to return to main menu...")
                continue

            print("\n" + "=" * 60)
            print(f"[➔] Redirecting to: {class_name} ({script_name})")
            print("=" * 60 + "\n")

            try:
                # Pass cwd=BASE_DIR so the subprocess runs inside the target directory
                subprocess.run([sys.executable, script_path], check=True, cwd=BASE_DIR)
            except subprocess.CalledProcessError:
                print(f"\n[!] Session in '{script_name}' ended with an error.")
            except KeyboardInterrupt:
                print(f"\n[!] Session interrupted by user.")

            input("\n[Session Complete] Press Enter to return to main menu...")
            print("\n")
        else:
            print("\n[!] Invalid selection. Please enter a valid option.\n")


if __name__ == "__main__":
    main()