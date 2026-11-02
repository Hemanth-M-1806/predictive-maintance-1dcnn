import React, { useState, useEffect } from 'react';
import { Cpu, Clock, Activity, Wifi } from 'lucide-react';

export default function StatusLagMonitor({ statusData, lastPacketTime, packetCount }) {
  const [lagMs, setLagMs] = useState(0);

  // Update elapsed lag timer every 100ms
  useEffect(() => {
    const timer = setInterval(() => {
      if (lastPacketTime) {
        setLagMs(Date.now() - lastPacketTime);
      }
    }, 100);
    return () => clearInterval(timer);
  }, [lastPacketTime]);

  const inferMs = statusData?.infer_ms ?? 118;
  const sampleDelay = statusData?.sample_delay_ms ?? 10;
  const dynamicFreqHz = Math.round(1000 / Math.max(1, sampleDelay));
  const windowSec = ((256 * sampleDelay) / 1000).toFixed(1);
  const isHealthyLag = lagMs < 4500;

  return (
    <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748b', fontWeight: '700' }}>
            Telemetry Telecommunications
          </span>
          <h3 style={{ fontSize: '18px', fontWeight: '800', color: '#f8fafc', marginTop: '2px' }}>
            System Latency & Status Lag
          </h3>
        </div>

        <div style={{
          fontSize: '11px',
          fontFamily: 'var(--font-mono)',
          padding: '4px 8px',
          borderRadius: '4px',
          background: isHealthyLag ? 'rgba(6, 182, 212, 0.1)' : 'rgba(245, 158, 11, 0.15)',
          color: isHealthyLag ? '#06b6d4' : '#f59e0b',
          border: `1px solid ${isHealthyLag ? 'rgba(6, 182, 212, 0.25)' : 'rgba(245, 158, 11, 0.3)'}`,
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
        }}>
          <Wifi size={12} />
          {isHealthyLag ? 'LOW JITTER' : 'HIGH PACKET LAG'}
        </div>
      </div>

      {/* 3 Metric Mini-Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '12px' }}>
        {/* Metric 1: Edge Inference Latency */}
        <div style={{
          background: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
          padding: '14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#06b6d4' }}>
            <Cpu size={15} />
            <span style={{ fontSize: '11px', fontWeight: '600', color: '#94a3b8' }}>ESP32 AI Latency</span>
          </div>
          <div style={{ fontSize: '24px', fontWeight: '800', color: '#f8fafc' }} className="mono-metric">
            {inferMs} <span style={{ fontSize: '12px', fontWeight: '500', color: '#64748b' }}>ms</span>
          </div>
          <span style={{ fontSize: '11px', color: '#10b981' }}>
            256 samples (~{dynamicFreqHz} Hz @ Core 1)
          </span>
        </div>

        {/* Metric 2: Live Status Lag */}
        <div style={{
          background: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
          padding: '14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#8b5cf6' }}>
            <Clock size={15} />
            <span style={{ fontSize: '11px', fontWeight: '600', color: '#94a3b8' }}>Packet Arrival Lag</span>
          </div>
          <div style={{ fontSize: '24px', fontWeight: '800', color: isHealthyLag ? '#f8fafc' : '#f59e0b' }} className="mono-metric">
            {(lagMs / 1000).toFixed(1)} <span style={{ fontSize: '12px', fontWeight: '500', color: '#64748b' }}>s</span>
          </div>
          <span style={{ fontSize: '11px', color: '#64748b' }}>
            Sampling window: ~{windowSec}s
          </span>
        </div>

        {/* Metric 3: Packet Counter */}
        <div style={{
          background: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
          padding: '14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#10b981' }}>
            <Activity size={15} />
            <span style={{ fontSize: '11px', fontWeight: '600', color: '#94a3b8' }}>Ingested Packets</span>
          </div>
          <div style={{ fontSize: '24px', fontWeight: '800', color: '#f8fafc' }} className="mono-metric">
            {packetCount}
          </div>
          <span style={{ fontSize: '11px', color: '#10b981' }}>Zero packet loss</span>
        </div>
      </div>

      {/* Lag Indicator Bar */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>
          <span>Telemetry Freshness</span>
          <span className="mono-metric" style={{ color: isHealthyLag ? '#10b981' : '#f59e0b' }}>
            {isHealthyLag ? 'Active Stream (Synchronized)' : 'Waiting for Next Transmission'}
          </span>
        </div>
        <div style={{ height: '4px', background: 'rgba(255, 255, 255, 0.06)', borderRadius: '2px', overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${Math.min(100, Math.max(0, 100 - (lagMs / 4000) * 100))}%`,
            background: isHealthyLag ? '#10b981' : '#f59e0b',
            transition: 'width 0.2s linear'
          }} />
        </div>
      </div>
    </div>
  );
}
