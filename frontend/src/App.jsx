import React, { useState, useEffect, useRef, useCallback } from 'react';
import mqtt from 'mqtt';
import { 
  Settings, 
  Radio, 
  AlertTriangle, 
  RotateCw,
  Sparkles,
  CircleDot
} from 'lucide-react';

import RealTimeGraph from './components/RealTimeGraph';
import MotorStatusCard from './components/MotorStatusCard';
import StatusLagMonitor from './components/StatusLagMonitor';
import EventLogTable from './components/EventLogTable';
import ConnectionModal from './components/ConnectionModal';

export default function App() {
  // Connection State
  const [connectionStatus, setConnectionStatus] = useState('disconnected'); // 'connected' | 'connecting' | 'disconnected'
  const [config, setConfig] = useState({
    wsUrl: 'ws://localhost:8765',
    mode: 'bridge' // 'bridge' | 'direct'
  });
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSimulation, setIsSimulation] = useState(false);

  // File recording state (managed through bridge or frontend)
  const [isRecording, setIsRecording] = useState(false);
  const [recordedCount, setRecordedCount] = useState(0);

  // Telemetry & State (With live accelerometer & dynamic frequency)
  const [latestStatus, setLatestStatus] = useState({
    device: "ESP32_PredictiveGuard_Motor1",
    status: "HEALTHY",
    class: 0,
    ax: 0.0,
    ay: 0.0,
    az: 9.8,
    conf_healthy: 0.996,
    conf_misaligned: 0.000,
    conf_imbalance: 0.000,
    infer_ms: 118,
    motor_tripped: false,
    sample_delay_ms: 10,
    uptime: 0
  });

  const [history, setHistory] = useState([]);
  const [logs, setLogs] = useState([]);
  const [activeAlert, setActiveAlert] = useState(null);
  const [lastPacketTime, setLastPacketTime] = useState(() => Date.now());
  const [packetCount, setPacketCount] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [heartbeat, setHeartbeat] = useState(false);

  const wsRef = useRef(null);
  const mqttClientRef = useRef(null);
  const simIntervalRef = useRef(null);
  const isPausedRef = useRef(isPaused);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  // Ingest incoming JSON payloads
  const processIncomingMessage = useCallback((topic, payloadStr) => {
    try {
      const parsed = JSON.parse(payloadStr);
      const nowTime = new Date().toLocaleTimeString();

      // Trigger visual heartbeat blinker
      setHeartbeat(true);
      setTimeout(() => setHeartbeat(false), 300);

      setLastPacketTime(Date.now());
      setPacketCount(prev => prev + 1);

      if (topic === 'factory/motor1/status') {
        setLatestStatus(prev => ({
          ...prev,
          ...parsed,
          ax: parsed.ax !== undefined ? parsed.ax : prev.ax,
          ay: parsed.ay !== undefined ? parsed.ay : prev.ay,
          az: parsed.az !== undefined ? parsed.az : prev.az,
          sample_delay_ms: parsed.sample_delay_ms || prev.sample_delay_ms || 10
        }));

        // Add to graph history if not paused
        if (!isPausedRef.current) {
          setHistory(prev => {
            const next = [...prev, {
              time: nowTime,
              conf_healthy: parsed.conf_healthy ?? 0,
              conf_misaligned: parsed.conf_misaligned ?? 0,
              conf_imbalance: parsed.conf_imbalance ?? 0,
              infer_ms: parsed.infer_ms ?? 0
            }];
            return next.slice(-40); // keep last 40 frames
          });
        }

        // Add to audit log
        const axStr = parsed.ax !== undefined ? parsed.ax.toFixed(2) : '0.00';
        const ayStr = parsed.ay !== undefined ? parsed.ay.toFixed(2) : '0.00';
        const azStr = parsed.az !== undefined ? parsed.az.toFixed(2) : '9.80';

        setLogs(prev => [...prev, {
          time: nowTime,
          type: 'TELEMETRY',
          status: parsed.status,
          confidence: parsed.class === 0 ? parsed.conf_healthy : (parsed.class === 1 ? parsed.conf_misaligned : parsed.conf_imbalance),
          infer_ms: parsed.infer_ms,
          message: `Class ${parsed.class} (${parsed.status}) | Accel: [X:${axStr}, Y:${ayStr}, Z:${azStr}] | Tripped: ${parsed.motor_tripped}`
        }].slice(-200));

      } else if (topic === 'factory/motor1/alerts') {
        // High-priority Alert Received (Active Regenerative Brake engaged)
        setActiveAlert(parsed);

        setLatestStatus(prev => ({
          ...prev,
          status: parsed.fault || 'CRITICAL_FAULT',
          motor_tripped: true,
          ax: parsed.ax ?? prev.ax,
          ay: parsed.ay ?? prev.ay,
          az: parsed.az ?? prev.az
        }));

        setLogs(prev => [...prev, {
          time: nowTime,
          type: 'ALERT',
          status: parsed.fault,
          confidence: parsed.confidence,
          infer_ms: parsed.infer_ms || 118,
          message: `CRITICAL ACTIVE BRAKE ENGAGED: ${parsed.fault} detected! Motor power cut & H-Bridge shorted.`
        }].slice(-200));
      }
    } catch (err) {
      console.error('Error parsing MQTT message JSON:', err);
    }
  }, []);

  // Connection Handler (Bridge or Direct MQTT)
  useEffect(() => {
    if (isSimulation) return;

    const timer = setTimeout(() => {
      setConnectionStatus('connecting');
    }, 0);

    if (config.mode === 'bridge') {
      // Connect to Python WebSocket Bridge (ws://localhost:8765)
      try {
        const ws = new WebSocket(config.wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          setConnectionStatus('connected');
          setLogs(prev => [...prev, {
            time: new Date().toLocaleTimeString(),
            type: 'SYSTEM',
            message: `Connected to Local MQTT Bridge at ${config.wsUrl}`
          }]);
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'mqtt_message') {
              processIncomingMessage(data.topic, data.payload);
            } else if (data.type === 'bridge_status' || data.type === 'recording_state') {
              if (data.is_recording !== undefined) setIsRecording(data.is_recording);
              if (data.recorded_count !== undefined) setRecordedCount(data.recorded_count);
            }
          } catch (e) {
            console.error('WebSocket parse error:', e);
          }
        };

        ws.onclose = () => {
          setConnectionStatus('disconnected');
        };

        ws.onerror = () => {
          setConnectionStatus('disconnected');
        };

        return () => {
          clearTimeout(timer);
          ws.close();
        };
      } catch {
        const errTimer = setTimeout(() => setConnectionStatus('disconnected'), 0);
        return () => {
          clearTimeout(timer);
          clearTimeout(errTimer);
        };
      }

    } else {
      // Direct MQTT over WebSockets (e.g. wss://broker.hivemq.com:8884/mqtt)
      try {
        const client = mqtt.connect(config.wsUrl, {
          clean: true,
          connectTimeout: 5000,
          reconnectPeriod: 3000
        });
        mqttClientRef.current = client;

        client.on('connect', () => {
          setConnectionStatus('connected');
          client.subscribe('factory/motor1/#');
          setLogs(prev => [...prev, {
            time: new Date().toLocaleTimeString(),
            type: 'SYSTEM',
            message: `Connected directly to MQTT Broker (${config.wsUrl})`
          }]);
        });

        client.on('message', (topic, message) => {
          processIncomingMessage(topic, message.toString());
        });

        client.on('offline', () => setConnectionStatus('disconnected'));
        client.on('error', () => setConnectionStatus('disconnected'));

        return () => {
          clearTimeout(timer);
          client.end();
        };
      } catch {
        const errTimer = setTimeout(() => setConnectionStatus('disconnected'), 0);
        return () => {
          clearTimeout(timer);
          clearTimeout(errTimer);
        };
      }
    }
  }, [config, isSimulation, processIncomingMessage]);

  // Simulation Mode Generator
  useEffect(() => {
    if (!isSimulation) {
      if (simIntervalRef.current) clearInterval(simIntervalRef.current);
      return;
    }

    const timer = setTimeout(() => {
      setConnectionStatus('connected');
    }, 0);
    let uptime = 0;

    simIntervalRef.current = setInterval(() => {
      uptime += 2000;
      const noise = (Math.random() - 0.5) * 0.04;
      const confH = Math.max(0.85, Math.min(0.999, 0.98 + noise));
      const confM = Math.max(0, (1 - confH) * 0.6);
      const confI = Math.max(0, 1 - confH - confM);

      const simStatus = {
        device: "ESP32_PredictiveGuard_Sim",
        status: "HEALTHY",
        class: 0,
        ax: (Math.random() - 0.5) * 0.6,
        ay: (Math.random() - 0.5) * 0.6,
        az: 9.8 + (Math.random() - 0.5) * 0.4,
        conf_healthy: confH,
        conf_misaligned: confM,
        conf_imbalance: confI,
        infer_ms: Math.floor(115 + Math.random() * 8),
        motor_tripped: false,
        sample_delay_ms: 10,
        uptime: uptime
      };

      processIncomingMessage('factory/motor1/status', JSON.stringify(simStatus));
    }, 2000);

    return () => {
      clearTimeout(timer);
      clearInterval(simIntervalRef.current);
    };
  }, [isSimulation, processIncomingMessage]);

  // Dispatch Remote Commands to MQTT
  const sendCommand = (cmdStr) => {
    const nowTime = new Date().toLocaleTimeString();

    if (config.mode === 'bridge' && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        action: "command",
        topic: "factory/motor1/commands",
        payload: cmdStr
      }));
    } else if (mqttClientRef.current && mqttClientRef.current.connected) {
      mqttClientRef.current.publish('factory/motor1/commands', cmdStr);
    }

    if (cmdStr === 'R' || cmdStr === 'RESET') {
      setActiveAlert(null);
      setLatestStatus(prev => ({ ...prev, motor_tripped: false, status: 'HEALTHY' }));
    } else if (cmdStr === 'STOP' || cmdStr === 'S') {
      setLatestStatus(prev => ({ ...prev, motor_tripped: true, status: 'EMERGENCY_STOP' }));
    } else if (cmdStr === '-' || cmdStr === 'DELAY:5') {
      setLatestStatus(prev => ({
        ...prev,
        sample_delay_ms: cmdStr === 'DELAY:5' ? 5 : Math.max(5, (prev.sample_delay_ms || 10) - 5)
      }));
    } else if (cmdStr === '+') {
      setLatestStatus(prev => ({
        ...prev,
        sample_delay_ms: (prev.sample_delay_ms || 10) + 5
      }));
    }

    setLogs(prev => [...prev, {
      time: nowTime,
      type: 'COMMAND',
      message: `Dispatched remote command: "${cmdStr}" to factory/motor1/commands`
    }]);
  };

  const toggleRecording = () => {
    if (config.mode === 'bridge' && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        action: "toggle_record"
      }));
    } else {
      setIsRecording(prev => !prev);
    }
  };

  return (
    <div style={{ maxWidth: '1440px', margin: '0 auto', padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Top SCADA Navigation Header */}
      <header className="glass-panel" style={{
        padding: '16px 24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '16px'
      }}>
        {/* Brand & Subtitle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{
            width: '42px',
            height: '42px',
            borderRadius: '10px',
            background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.2) 0%, rgba(59, 130, 246, 0.3) 100%)',
            border: '1px solid rgba(6, 182, 212, 0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#06b6d4',
            boxShadow: '0 0 20px rgba(6, 182, 212, 0.2)'
          }}>
            <Radio size={22} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h1 style={{ fontSize: '18px', fontWeight: '800', letterSpacing: '-0.02em', color: '#f8fafc' }}>
                EDGE-AI PREDICTIVE MOTOR GUARD
              </h1>
              <span style={{
                fontSize: '10px',
                fontFamily: 'var(--font-mono)',
                padding: '2px 6px',
                borderRadius: '4px',
                background: 'rgba(255, 255, 255, 0.08)',
                color: '#94a3b8',
                fontWeight: '700'
              }}>
                ESP32 1D-CNN INT8
              </span>
            </div>
            <p style={{ fontSize: '12px', color: '#64748b' }}>
              Live MPU6050 accelerometer telemetry & closed-loop active braking
            </p>
          </div>
        </div>

        {/* Telemetry Status Badges & Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {/* File Recording Indicator & Toggle */}
          <button
            onClick={toggleRecording}
            style={{
              background: isRecording ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.04)',
              color: isRecording ? '#f87171' : '#94a3b8',
              border: `1px solid ${isRecording ? 'rgba(239, 68, 68, 0.5)' : 'var(--border-subtle)'}`,
              padding: '7px 12px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontWeight: '600'
            }}
            title={isRecording ? "Stop writing live telemetry to file" : "Start writing live telemetry to CSV file"}
          >
            <CircleDot size={14} color={isRecording ? '#ef4444' : '#64748b'} />
            {isRecording ? `Writing File (${recordedCount})` : 'Write to File'}
          </button>

          {/* Heartbeat Packet Blinker */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            borderRadius: 'var(--radius-sm)',
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid var(--border-subtle)',
            fontSize: '12px',
            fontFamily: 'var(--font-mono)'
          }}>
            <span style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: heartbeat ? '#06b6d4' : '#334155',
              boxShadow: heartbeat ? '0 0 10px #06b6d4' : 'none',
              transition: 'background 0.15s ease'
            }} />
            <span style={{ color: '#94a3b8' }}>Heartbeat</span>
          </div>

          {/* Connection Status Pill */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 14px',
            borderRadius: 'var(--radius-sm)',
            fontSize: '12px',
            fontWeight: '700',
            fontFamily: 'var(--font-mono)',
            background: connectionStatus === 'connected' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
            color: connectionStatus === 'connected' ? '#10b981' : '#ef4444',
            border: `1px solid ${connectionStatus === 'connected' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`
          }}>
            <span style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: connectionStatus === 'connected' ? '#10b981' : '#ef4444'
            }} className="pulse-led" />
            {isSimulation ? 'SIMULATION MODE' : (connectionStatus === 'connected' ? 'MQTT CONNECTED' : 'DISCONNECTED')}
          </div>

          {/* Simulation Toggle */}
          <button
            onClick={() => setIsSimulation(!isSimulation)}
            style={{
              background: isSimulation ? 'rgba(139, 92, 246, 0.2)' : 'rgba(255, 255, 255, 0.04)',
              color: isSimulation ? '#c084fc' : '#94a3b8',
              border: `1px solid ${isSimulation ? 'rgba(139, 92, 246, 0.4)' : 'var(--border-subtle)'}`,
              padding: '7px 12px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontWeight: '600'
            }}
          >
            <Sparkles size={14} />
            {isSimulation ? 'Sim Active' : 'Sim Demo'}
          </button>

          {/* Settings Modal Toggle */}
          <button
            onClick={() => setIsModalOpen(true)}
            style={{
              background: 'rgba(255, 255, 255, 0.04)',
              color: '#f8fafc',
              border: '1px solid var(--border-subtle)',
              padding: '7px 12px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontWeight: '600'
            }}
          >
            <Settings size={14} />
            Config
          </button>
        </div>
      </header>

      {/* Critical Active Alert Banner (If fault tripped or active brake engaged) */}
      {(activeAlert || latestStatus.motor_tripped) && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.2) 0%, rgba(185, 28, 28, 0.3) 100%)',
          border: '1px solid rgba(239, 68, 68, 0.5)',
          borderRadius: 'var(--radius-md)',
          padding: '16px 20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          boxShadow: '0 0 30px rgba(239, 68, 68, 0.25)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              background: 'rgba(239, 68, 68, 0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ef4444'
            }} className="flash-active-red">
              <AlertTriangle size={20} />
            </div>
            <div>
              <div style={{ fontSize: '15px', fontWeight: '800', color: '#fca5a5' }}>
                ACTIVE EMERGENCY BRAKE: {activeAlert?.fault || latestStatus.status || 'FAULT DETECTED'}
              </div>
              <div style={{ fontSize: '12px', color: '#fecaca' }}>
                H-Bridge back-EMF shunted (IN3=HIGH, IN4=HIGH, PWM=0). Accel: X={Number(latestStatus.ax).toFixed(2)}, Y={Number(latestStatus.ay).toFixed(2)}, Z={Number(latestStatus.az).toFixed(2)} m/s²
              </div>
            </div>
          </div>

          <button
            onClick={() => sendCommand('R')}
            style={{
              background: '#ef4444',
              color: '#ffffff',
              border: 'none',
              padding: '8px 16px',
              borderRadius: '6px',
              fontWeight: '700',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 4px 12px rgba(239, 68, 68, 0.4)'
            }}
          >
            <RotateCw size={14} />
            Clear Trip & Re-Arm ('R')
          </button>
        </div>
      )}

      {/* Top Vital Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '20px' }}>
        <MotorStatusCard
          statusData={latestStatus}
          onSendRearm={() => sendCommand('R')}
          onEmergencyStop={() => sendCommand('STOP')}
          onReduceFrequency={() => sendCommand('-')}
          onIncreaseFrequency={() => sendCommand('+')}
        />
        <StatusLagMonitor
          statusData={latestStatus}
          lastPacketTime={lastPacketTime}
          packetCount={packetCount}
        />
      </div>

      {/* Real-Time Live Graph */}
      <RealTimeGraph
        history={history}
        isPaused={isPaused}
        setIsPaused={setIsPaused}
        onClear={() => setHistory([])}
        sampleDelayMs={latestStatus.sample_delay_ms || 10}
      />

      {/* Historical Audit Event Log */}
      <EventLogTable
        logs={logs}
        onClear={() => setLogs([])}
      />

      {/* Settings Modal */}
      <ConnectionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        config={config}
        onSaveConfig={(newCfg) => setConfig(newCfg)}
      />
    </div>
  );
}
