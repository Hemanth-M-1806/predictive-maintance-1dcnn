import asyncio
import csv
import datetime
import json
import logging
import os
import sys
import threading
import time
import websockets
import paho.mqtt.client as mqtt

# Ensure stdout handles UTF-8 gracefully on Windows PowerShell / CMD
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Configure logging: Keep only clean warnings/errors for loggers
logging.basicConfig(level=logging.WARNING, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("MQTT-WS-Bridge")

# Configuration (Supports CLI argument: python bridge.py [broker_ip] [broker_port])
MQTT_BROKER = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("-") else os.getenv("MQTT_BROKER", "127.0.0.1")
MQTT_PORT = int(sys.argv[2]) if len(sys.argv) > 2 else int(os.getenv("MQTT_PORT", 1883))
WS_PORT = int(os.getenv("WS_PORT", 8765))

CONNECTED_WEBSOCKETS = set()
MAIN_LOOP = None
RUNNING = True

# Topics
TOPIC_STATUS = "factory/motor1/status"
TOPIC_ALERTS = "factory/motor1/alerts"
TOPIC_COMMANDS = "factory/motor1/commands"

# File Recording State (By default OFF: show in terminal first, write to file when requested)
RECORDING_ACTIVE = False
RECORDING_FILE = None
RECORDING_WRITER = None
RECORDED_COUNT = 0
RECORDING_LOCK = threading.Lock()

# MQTT Client
mqtt_client = mqtt.Client(client_id="Python_Terminal_Bridge")

def print_banner():
    print("\n" + "=" * 78)
    print("  EDGE-AI PREDICTIVE MOTOR GUARD -- MQTT TERMINAL & BRIDGE")
    print("=" * 78)
    print(f" [*] MQTT Broker : {MQTT_BROKER}:{MQTT_PORT}")
    print(f" [*] WebSockets  : ws://localhost:{WS_PORT} (React Dashboard Bridge)")
    print(f" [*] Live Stream : Accelerometer (X, Y, Z) + Machine Status")
    print("-" * 78)
    print(" Interactive Terminal Controls (Type key and press Enter):")
    print("   [R]       : Reset / Clear Fault Latch & Re-arm Motor ('R')")
    print("   [-]       : Reduce Frequency Delay (Down to 5 ms, ~200 Hz)")
    print("   [+]       : Increase Frequency Delay (+5 ms)")
    print("   [5]       : Instantly set minimum delay 5 ms (Max frequency)")
    print("   [S]       : Active Emergency Brake Stop ('STOP')")
    print("   [W]       : Toggle Record to CSV File (Default: OFF, terminal only)")
    print("   [H]       : Show this Help Menu")
    print("   [Q]       : Quit Bridge")
    print("=" * 78 + "\n")

def toggle_recording():
    global RECORDING_ACTIVE, RECORDING_FILE, RECORDING_WRITER, RECORDED_COUNT
    with RECORDING_LOCK:
        if not RECORDING_ACTIVE:
            ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"telemetry_log_{ts}.csv"
            try:
                RECORDING_FILE = open(filename, mode="w", newline="", encoding="utf-8")
                RECORDING_WRITER = csv.writer(RECORDING_FILE)
                RECORDING_WRITER.writerow([
                    "timestamp", "device", "status", "class", 
                    "ax_ms2", "ay_ms2", "az_ms2", 
                    "conf_healthy", "conf_misaligned", "conf_imbalance", 
                    "infer_ms", "motor_tripped", "sample_delay_ms", "uptime_ms"
                ])
                RECORDING_FILE.flush()
                RECORDING_ACTIVE = True
                RECORDED_COUNT = 0
                print(f"\n[RECORDING STARTED] Saving live telemetry directly to: {filename}")
                broadcast_recording_state()
            except Exception as e:
                print(f"\n[!] Failed to open file for recording: {e}")
        else:
            RECORDING_ACTIVE = False
            filename = RECORDING_FILE.name if RECORDING_FILE else "telemetry.csv"
            if RECORDING_FILE:
                try:
                    RECORDING_FILE.close()
                except Exception:
                    pass
                RECORDING_FILE = None
                RECORDING_WRITER = None
            print(f"\n[RECORDING STOPPED] Successfully saved {RECORDED_COUNT} samples to: {filename}\n")
            broadcast_recording_state()

def broadcast_recording_state():
    if MAIN_LOOP and CONNECTED_WEBSOCKETS:
        msg = json.dumps({
            "type": "recording_state",
            "is_recording": RECORDING_ACTIVE,
            "recorded_count": RECORDED_COUNT,
            "filename": RECORDING_FILE.name if RECORDING_FILE else None
        })
        asyncio.run_coroutine_threadsafe(broadcast_ws(msg), MAIN_LOOP)

def on_mqtt_connect(client, userdata, flags, rc):
    if rc == 0:
        print(f"[OK] Successfully Connected to MQTT Broker at {MQTT_BROKER}:{MQTT_PORT}")
        client.subscribe("factory/motor1/#")
        print("[OK] Subscribed to topic hierarchy: factory/motor1/#\n")
    else:
        print(f"[!] MQTT connection failed with return code {rc}")

def on_mqtt_message(client, userdata, msg):
    global RECORDED_COUNT
    topic = msg.topic
    payload_str = msg.payload.decode("utf-8", errors="replace")

    # 1. Parse JSON payload
    try:
        data = json.loads(payload_str)
    except Exception:
        data = None

    now_str = datetime.datetime.now().strftime("%H:%M:%S")

    # 2. Format and display ONLY live accelerometer values and status in terminal
    if topic == TOPIC_STATUS and data:
        status = str(data.get("status", "UNKNOWN")).upper()
        ax = float(data.get("ax", 0.0))
        ay = float(data.get("ay", 0.0))
        az = float(data.get("az", 0.0))
        delay_ms = data.get("sample_delay_ms", 10)
        tripped = data.get("motor_tripped", False)
        freq_est = round(1000 / delay_ms) if delay_ms and delay_ms > 0 else 0

        # State color/indicator
        if tripped:
            motor_disp = "[TRIPPED / BRAKE LATCHED]"
        else:
            motor_disp = "[RUNNING NORMAL]"

        status_tag = f"[{status}]".ljust(15)

        # Clean terminal output: Only live accelerometer values and status
        rec_tag = f" [REC: {RECORDED_COUNT}]" if RECORDING_ACTIVE else ""
        print(f"[{now_str}] {status_tag} | Accel (m/s2): X:{ax:+6.2f}  Y:{ay:+6.2f}  Z:{az:+6.2f} | Delay: {delay_ms:>2}ms (~{freq_est}Hz) | {motor_disp}{rec_tag}")

        # If recording is active, write row to file
        if RECORDING_ACTIVE and RECORDING_WRITER and RECORDING_FILE:
            try:
                RECORDING_WRITER.writerow([
                    datetime.datetime.now().isoformat(),
                    data.get("device", ""),
                    status,
                    data.get("class", 0),
                    ax, ay, az,
                    data.get("conf_healthy", 0.0),
                    data.get("conf_misaligned", 0.0),
                    data.get("conf_imbalance", 0.0),
                    data.get("infer_ms", 0),
                    tripped,
                    delay_ms,
                    data.get("uptime", 0)
                ])
                RECORDING_FILE.flush()
                RECORDED_COUNT += 1
            except Exception as e:
                print(f"[!] File write error: {e}")

    elif topic == TOPIC_ALERTS and data:
        fault = data.get("fault", "CRITICAL_FAULT")
        conf = float(data.get("confidence", 1.0)) * 100.0
        ax = data.get("ax", 0.0)
        ay = data.get("ay", 0.0)
        az = data.get("az", 0.0)
        print(f"\n{'!' * 78}")
        print(f" >>> [ALERT / ACTIVE BRAKE ENGAGED] {fault} DETECTED! (Conf: {conf:.1f}%)")
        print(f"     Trip Vibration: X:{ax:+6.2f} Y:{ay:+6.2f} Z:{az:+6.2f} m/s2 | H-Bridge Shunted")
        print(f"     Send [R] to clear latch and re-arm motor.")
        print(f"{'!' * 78}\n")

    elif topic == TOPIC_COMMANDS:
        print(f"[{now_str}] [COMMAND LOG] Dispatched: \"{payload_str}\"")

    # 3. Broadcast to all connected WebSockets (React frontend dashboard)
    if MAIN_LOOP and CONNECTED_WEBSOCKETS:
        message = json.dumps({
            "type": "mqtt_message",
            "topic": topic,
            "payload": payload_str
        })
        asyncio.run_coroutine_threadsafe(broadcast_ws(message), MAIN_LOOP)

mqtt_client.on_connect = on_mqtt_connect
mqtt_client.on_message = on_mqtt_message

async def broadcast_ws(message):
    if not CONNECTED_WEBSOCKETS:
        return
    for ws in list(CONNECTED_WEBSOCKETS):
        try:
            await ws.send(message)
        except Exception:
            pass

async def ws_handler(websocket):
    CONNECTED_WEBSOCKETS.add(websocket)
    # Send welcome handshake with recording state
    await websocket.send(json.dumps({
        "type": "bridge_status",
        "status": "connected",
        "mqtt_broker": f"{MQTT_BROKER}:{MQTT_PORT}",
        "is_recording": RECORDING_ACTIVE,
        "recorded_count": RECORDED_COUNT
    }))

    try:
        async for message in websocket:
            try:
                data = json.loads(message)
                action = data.get("action")
                if action == "command":
                    cmd = data.get("payload", "R")
                    topic = data.get("topic", TOPIC_COMMANDS)
                    mqtt_client.publish(topic, cmd)
                    print(f"\n[-> BROWSER DISPATCH] Published command to [{topic}]: {cmd}")
                elif action == "toggle_record":
                    toggle_recording()
                elif action == "set_delay":
                    delay = data.get("delay", 10)
                    cmd = f"DELAY:{delay}"
                    mqtt_client.publish(TOPIC_COMMANDS, cmd)
                    print(f"\n[-> BROWSER DISPATCH] Set sampling delay to {delay} ms")
            except Exception as e:
                print(f"[!] Error processing WebSocket client message: {e}")
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        CONNECTED_WEBSOCKETS.discard(websocket)

def handle_user_input(raw_input):
    cmd = raw_input.strip()
    if not cmd:
        return

    lower_cmd = cmd.lower()

    if lower_cmd in ['r', 'reset']:
        mqtt_client.publish(TOPIC_COMMANDS, "R")
        print("\n[-> SENT] Dispatched Reset / Re-Arm command ('R') to ESP32.")
    elif lower_cmd in ['s', 'stop', 'brake']:
        mqtt_client.publish(TOPIC_COMMANDS, "STOP")
        print("\n[-> SENT] Dispatched Active Emergency Brake command ('STOP') to ESP32.")
    elif lower_cmd in ['-', 'reduce', 'dec']:
        mqtt_client.publish(TOPIC_COMMANDS, "-")
        print("\n[-> SENT] Dispatched Reduce Frequency Delay command ('-') [Min 5 ms].")
    elif lower_cmd in ['+', 'increase', 'inc']:
        mqtt_client.publish(TOPIC_COMMANDS, "+")
        print("\n[-> SENT] Dispatched Increase Frequency Delay command ('+').")
    elif lower_cmd in ['5', '5ms', 'min']:
        mqtt_client.publish(TOPIC_COMMANDS, "DELAY:5")
        print("\n[-> SENT] Set sampling delay to 5 ms (~200 Hz maximum rate).")
    elif lower_cmd.startswith("delay:"):
        mqtt_client.publish(TOPIC_COMMANDS, cmd.upper())
        print(f"\n[-> SENT] Dispatched {cmd.upper()} to ESP32.")
    elif lower_cmd in ['w', 'write', 'record']:
        toggle_recording()
    elif lower_cmd in ['h', 'help', '?']:
        print_banner()
    elif lower_cmd in ['q', 'quit', 'exit']:
        print("\nShutting down bridge...")
        os._exit(0)
    else:
        print(f"\n[?] Unknown command '{cmd}'. Available: R (reset), - (reduce delay to 5ms), + (increase), S (stop), W (toggle record), H (help), Q (quit).")

def terminal_input_thread():
    while RUNNING:
        try:
            line = sys.stdin.readline()
            if not line:
                break
            handle_user_input(line)
        except Exception:
            break

def start_mqtt_loop():
    try:
        mqtt_client.connect(MQTT_BROKER, MQTT_PORT, 60)
        mqtt_client.loop_forever()
    except Exception as e:
        print(f"[!] MQTT Broker ({MQTT_BROKER}:{MQTT_PORT}) not currently reachable. Will retry in background.")

async def main():
    global MAIN_LOOP
    MAIN_LOOP = asyncio.get_running_loop()

    print_banner()

    # Start MQTT client in background thread
    mqtt_thread = threading.Thread(target=start_mqtt_loop, daemon=True)
    mqtt_thread.start()

    # Start Interactive Terminal Input listener in background thread
    input_th = threading.Thread(target=terminal_input_thread, daemon=True)
    input_th.start()

    async with websockets.serve(ws_handler, "0.0.0.0", WS_PORT):
        print(f"[OK] WebSocket Server running on ws://localhost:{WS_PORT} for React Dashboard.\n")
        await asyncio.Future()  # run forever

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        if RECORDING_ACTIVE and RECORDING_FILE:
            RECORDING_FILE.close()
        print("\nBridge stopped by user.")
        sys.exit(0)
