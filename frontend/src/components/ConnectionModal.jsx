import React, { useState } from 'react';
import { X, Server, CheckCircle2 } from 'lucide-react';

export default function ConnectionModal({ isOpen, onClose, config, onSaveConfig }) {
  const [endpoint, setEndpoint] = useState(config.wsUrl || 'ws://localhost:8765');
  const [mode, setMode] = useState(config.mode || 'bridge'); // 'bridge' | 'direct' | 'simulation'

  if (!isOpen) return null;

  const handleSave = () => {
    onSaveConfig({
      wsUrl: endpoint,
      mode: mode
    });
    onClose();
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.75)',
      backdropFilter: 'blur(8px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: '20px'
    }}>
      <div className="glass-panel" style={{
        background: '#0c111d',
        border: '1px solid rgba(255, 255, 255, 0.15)',
        borderRadius: 'var(--radius-lg)',
        width: '100%',
        maxWidth: '480px',
        padding: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        boxShadow: '0 20px 40px rgba(0,0,0,0.6)'
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Server size={18} color="#06b6d4" />
            <h3 style={{ fontSize: '18px', fontWeight: '800', color: '#f8fafc' }}>
              MQTT Ingestion Settings
            </h3>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#64748b' }}>
            <X size={20} />
          </button>
        </div>

        {/* Mode Selector */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label style={{ fontSize: '12px', fontWeight: '600', color: '#94a3b8' }}>
            Connection Mode
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <button
              onClick={() => {
                setMode('bridge');
                setEndpoint('ws://localhost:8765');
              }}
              style={{
                padding: '10px',
                borderRadius: '8px',
                border: `1px solid ${mode === 'bridge' ? '#06b6d4' : 'var(--border-subtle)'}`,
                background: mode === 'bridge' ? 'rgba(6, 182, 212, 0.12)' : 'rgba(255,255,255,0.02)',
                color: mode === 'bridge' ? '#06b6d4' : '#94a3b8',
                fontSize: '12px',
                fontWeight: '600',
                textAlign: 'left'
              }}
            >
              <div>Local Bridge (Port 1883)</div>
              <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px' }}>Runs via bridge.py</div>
            </button>

            <button
              onClick={() => {
                setMode('direct');
                setEndpoint('wss://broker.hivemq.com:8884/mqtt');
              }}
              style={{
                padding: '10px',
                borderRadius: '8px',
                border: `1px solid ${mode === 'direct' ? '#8b5cf6' : 'var(--border-subtle)'}`,
                background: mode === 'direct' ? 'rgba(139, 92, 246, 0.12)' : 'rgba(255,255,255,0.02)',
                color: mode === 'direct' ? '#8b5cf6' : '#94a3b8',
                fontSize: '12px',
                fontWeight: '600',
                textAlign: 'left'
              }}
            >
              <div>Cloud / Direct WS</div>
              <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px' }}>HiveMQ or Mosquitto 9001</div>
            </button>
          </div>
        </div>

        {/* WebSocket URL */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label style={{ fontSize: '12px', fontWeight: '600', color: '#94a3b8' }}>
            WebSocket Endpoint
          </label>
          <input
            type="text"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            style={{
              background: 'rgba(0, 0, 0, 0.4)',
              border: '1px solid var(--border-active)',
              borderRadius: '8px',
              padding: '10px 14px',
              color: '#f8fafc',
              fontSize: '13px',
              fontFamily: 'var(--font-mono)'
            }}
          />
          <span style={{ fontSize: '11px', color: '#64748b' }}>
            Default for Mosquitto: <code>ws://localhost:8765</code> (via Python bridge)
          </span>
        </div>

        {/* Subscribed Topics Readout */}
        <div style={{
          background: 'rgba(0, 0, 0, 0.3)',
          borderRadius: '8px',
          padding: '12px',
          border: '1px solid var(--border-subtle)',
          fontSize: '11px',
          fontFamily: 'var(--font-mono)',
          color: '#94a3b8',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px'
        }}>
          <div>Sub: <code>factory/motor1/status</code> (Telemetry JSON)</div>
          <div>Sub: <code>factory/motor1/alerts</code> (Immediate Fault Alert)</div>
          <div>Pub: <code>factory/motor1/commands</code> (Re-arm "R" / Stop)</div>
        </div>

        {/* Save Button */}
        <button
          onClick={handleSave}
          style={{
            background: 'linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)',
            color: '#ffffff',
            border: 'none',
            borderRadius: '8px',
            padding: '12px',
            fontWeight: '700',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px'
          }}
        >
          <CheckCircle2 size={16} />
          Apply & Reconnect
        </button>
      </div>
    </div>
  );
}
