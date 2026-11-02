import React from 'react';
import { RotateCw, Power, Gauge, Zap, Minus, Plus } from 'lucide-react';

export default function MotorStatusCard({ statusData, onSendRearm, onEmergencyStop, onReduceFrequency, onIncreaseFrequency }) {
  const isHealthy = statusData?.status === 'HEALTHY' && !statusData?.motor_tripped;

  const healthyPct = ((statusData?.conf_healthy ?? 1) * 100).toFixed(1);
  const misalignedPct = ((statusData?.conf_misaligned ?? 0) * 100).toFixed(1);
  const imbalancePct = ((statusData?.conf_imbalance ?? 0) * 100).toFixed(1);

  // Live Accelerometer Values (m/s²)
  const ax = Number(statusData?.ax ?? 0.0);
  const ay = Number(statusData?.ay ?? 0.0);
  const az = Number(statusData?.az ?? 9.8);

  // Dynamic Sampling Frequency (Not hardcoded)
  const sampleDelay = statusData?.sample_delay_ms ?? 10;
  const dynamicFreqHz = Math.round(1000 / Math.max(1, sampleDelay));

  return (
    <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Section */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748b', fontWeight: '700' }}>
            Drive Mechanism Health
          </span>
          <h3 style={{ fontSize: '20px', fontWeight: '800', color: '#f8fafc', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            L298N DC Motor Guard
          </h3>
        </div>

        {/* Live Status Pill */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 14px',
          borderRadius: '999px',
          fontSize: '13px',
          fontWeight: '700',
          letterSpacing: '0.02em',
          background: isHealthy ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.15)',
          color: isHealthy ? '#10b981' : '#ef4444',
          border: `1px solid ${isHealthy ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.4)'}`,
          boxShadow: isHealthy ? '0 0 20px rgba(16, 185, 129, 0.15)' : '0 0 25px rgba(239, 68, 68, 0.25)'
        }}>
          <span style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: isHealthy ? '#10b981' : '#ef4444'
          }} className={isHealthy ? 'pulse-led' : 'flash-active-red'} />
          {isHealthy ? 'NORMAL OPERATION' : (statusData?.status ? `FAULT: ${statusData.status}` : 'ACTIVE BRAKE TRIPPED')}
        </div>
      </div>

      {/* Main Motor Diagram & Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '24px', alignItems: 'center' }}>
        {/* Animated Rotor Visual */}
        <div style={{
          width: '110px',
          height: '110px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(15, 23, 42, 0.9) 0%, rgba(7, 9, 14, 0.9) 100%)',
          border: `2px solid ${isHealthy ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.5)'}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          boxShadow: isHealthy ? '0 0 25px rgba(16, 185, 129, 0.1)' : '0 0 30px rgba(239, 68, 68, 0.2)'
        }}>
          <svg
            viewBox="0 0 100 100"
            style={{
              width: '80px',
              height: '80px',
              transformOrigin: 'center',
              animation: isHealthy ? 'spin 1.8s linear infinite' : 'none'
            }}
          >
            <style>
              {`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}
            </style>
            <circle cx="50" cy="50" r="38" stroke="rgba(255, 255, 255, 0.1)" strokeWidth="4" fill="none" />
            <line x1="50" y1="12" x2="50" y2="88" stroke={isHealthy ? '#10b981' : '#ef4444'} strokeWidth="5" strokeLinecap="round" />
            <line x1="12" y1="50" x2="88" y2="50" stroke={isHealthy ? '#10b981' : '#ef4444'} strokeWidth="5" strokeLinecap="round" />
            <circle cx="50" cy="50" r="14" fill="#0f172a" stroke={isHealthy ? '#10b981' : '#ef4444'} strokeWidth="3" />
            <circle cx="50" cy="50" r="6" fill={isHealthy ? '#10b981' : '#ef4444'} />
          </svg>
          <span style={{
            position: 'absolute',
            bottom: '-10px',
            fontSize: '10px',
            fontFamily: 'var(--font-mono)',
            fontWeight: '700',
            background: '#07090e',
            padding: '2px 8px',
            borderRadius: '4px',
            border: '1px solid var(--border-subtle)',
            color: isHealthy ? '#10b981' : '#ef4444'
          }}>
            {isHealthy ? 'PWM 180' : '0 RPM (SHORTED)'}
          </span>
        </div>

        {/* Probability Bars */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
              <span style={{ color: '#94a3b8' }}>Healthy (Class 0)</span>
              <span className="mono-metric" style={{ color: '#10b981', fontWeight: '700' }}>{healthyPct}%</span>
            </div>
            <div style={{ height: '6px', background: 'rgba(255,255,255,0.06)', borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{ width: `${healthyPct}%`, height: '100%', background: '#10b981', transition: 'width 0.4s ease' }} />
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
              <span style={{ color: '#94a3b8' }}>Misalignment (Class 1)</span>
              <span className="mono-metric" style={{ color: '#f59e0b', fontWeight: '700' }}>{misalignedPct}%</span>
            </div>
            <div style={{ height: '6px', background: 'rgba(255,255,255,0.06)', borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{ width: `${misalignedPct}%`, height: '100%', background: '#f59e0b', transition: 'width 0.4s ease' }} />
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
              <span style={{ color: '#94a3b8' }}>Imbalance (Class 2)</span>
              <span className="mono-metric" style={{ color: '#ef4444', fontWeight: '700' }}>{imbalancePct}%</span>
            </div>
            <div style={{ height: '6px', background: 'rgba(255,255,255,0.06)', borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{ width: `${imbalancePct}%`, height: '100%', background: '#ef4444', transition: 'width 0.4s ease' }} />
            </div>
          </div>
        </div>
      </div>

      {/* Live Accelerometer HUD Section */}
      <div style={{
        background: 'rgba(255, 255, 255, 0.02)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
        padding: '12px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Gauge size={13} color="#06b6d4" />
            Live MPU6050 Accelerometer
          </span>
          <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: '#06b6d4' }}>
            m/s²
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
          {/* Axis X */}
          <div style={{ background: 'rgba(0,0,0,0.25)', padding: '8px 10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.04)' }}>
            <div style={{ fontSize: '10px', color: '#64748b', fontWeight: '600' }}>AXIS X</div>
            <div style={{ fontSize: '16px', fontWeight: '800', color: '#38bdf8', fontFamily: 'var(--font-mono)' }}>
              {ax >= 0 ? `+${ax.toFixed(2)}` : ax.toFixed(2)}
            </div>
          </div>

          {/* Axis Y */}
          <div style={{ background: 'rgba(0,0,0,0.25)', padding: '8px 10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.04)' }}>
            <div style={{ fontSize: '10px', color: '#64748b', fontWeight: '600' }}>AXIS Y</div>
            <div style={{ fontSize: '16px', fontWeight: '800', color: '#a78bfa', fontFamily: 'var(--font-mono)' }}>
              {ay >= 0 ? `+${ay.toFixed(2)}` : ay.toFixed(2)}
            </div>
          </div>

          {/* Axis Z */}
          <div style={{ background: 'rgba(0,0,0,0.25)', padding: '8px 10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.04)' }}>
            <div style={{ fontSize: '10px', color: '#64748b', fontWeight: '600' }}>AXIS Z</div>
            <div style={{ fontSize: '16px', fontWeight: '800', color: '#4ade80', fontFamily: 'var(--font-mono)' }}>
              {az >= 0 ? `+${az.toFixed(2)}` : az.toFixed(2)}
            </div>
          </div>
        </div>
      </div>

      {/* Dynamic Frequency & Sampling Delay Controls */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'rgba(0, 0, 0, 0.2)',
        padding: '10px 14px',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-subtle)',
        flexWrap: 'wrap',
        gap: '8px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Zap size={14} color="#f59e0b" />
          <span style={{ fontSize: '12px', color: '#94a3b8' }}>Dynamic Sampling Rate:</span>
          <span style={{ fontSize: '13px', fontWeight: '700', fontFamily: 'var(--font-mono)', color: '#f8fafc' }}>
            ~{dynamicFreqHz} Hz ({sampleDelay} ms delay)
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            onClick={onReduceFrequency}
            title="Reduce sampling delay (down to 5 ms, ~200 Hz)"
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              color: '#f8fafc',
              border: '1px solid var(--border-subtle)',
              padding: '4px 8px',
              borderRadius: '4px',
              fontSize: '11px',
              fontWeight: '600',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <Minus size={12} /> -5ms (Min 5ms)
          </button>

          <button
            onClick={onIncreaseFrequency}
            title="Increase sampling delay (+5 ms)"
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              color: '#f8fafc',
              border: '1px solid var(--border-subtle)',
              padding: '4px 8px',
              borderRadius: '4px',
              fontSize: '11px',
              fontWeight: '600',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <Plus size={12} /> +5ms
          </button>
        </div>
      </div>

      {/* Control Buttons */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '2px' }}>
        <button
          onClick={onSendRearm}
          style={{
            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(5, 150, 105, 0.3) 100%)',
            color: '#10b981',
            border: '1px solid rgba(16, 185, 129, 0.4)',
            padding: '12px 16px',
            borderRadius: 'var(--radius-md)',
            fontWeight: '700',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            boxShadow: '0 4px 14px rgba(16, 185, 129, 0.15)'
          }}
        >
          <RotateCw size={15} />
          Clear Trip & Re-Arm ('R')
        </button>

        <button
          onClick={onEmergencyStop}
          style={{
            background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.15) 0%, rgba(185, 28, 28, 0.25) 100%)',
            color: '#f87171',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            padding: '12px 16px',
            borderRadius: 'var(--radius-md)',
            fontWeight: '700',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            boxShadow: '0 4px 14px rgba(239, 68, 68, 0.15)'
          }}
        >
          <Power size={15} />
          Emergency Brake Stop
        </button>
      </div>
    </div>
  );
}
