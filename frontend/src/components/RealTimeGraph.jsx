import React, { useRef, useEffect, useState } from 'react';
import { Play, Pause, RotateCcw, Activity } from 'lucide-react';

export default function RealTimeGraph({ history, isPaused, setIsPaused, onClear, sampleDelayMs = 10 }) {
  const canvasRef = useRef(null);
  const [hoverIndex, setHoverIndex] = useState(null);

  const sampleDelay = sampleDelayMs || 10;
  const dynamicFreqHz = Math.round(1000 / Math.max(1, sampleDelay));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;

    // Padding
    const padLeft = 45;
    const padRight = 20;
    const padTop = 20;
    const padBottom = 30;

    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    // Clear
    ctx.clearRect(0, 0, width, height);

    // Draw Background Grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;

    // Horizontal grid lines (0%, 25%, 50%, 75%, 100%)
    for (let i = 0; i <= 4; i++) {
      const y = padTop + (plotH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(width - padRight, y);
      ctx.stroke();

      // Label
      const val = 100 - i * 25;
      ctx.fillStyle = '#64748b';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${val}%`, padLeft - 8, y + 3);
    }

    // Decision Threshold Line (50%)
    const y50 = padTop + plotH * 0.5;
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.35)';
    ctx.beginPath();
    ctx.moveTo(padLeft, y50);
    ctx.lineTo(width - padRight, y50);
    ctx.stroke();
    ctx.restore();

    if (!history || history.length < 2) {
      ctx.fillStyle = '#475569';
      ctx.font = '13px "Inter", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Awaiting live telemetry packets...', width / 2, height / 2);
      return;
    }

    const maxPoints = Math.max(30, history.length);
    const getX = (idx) => padLeft + (idx / (maxPoints - 1)) * plotW;
    const getY = (val) => padTop + (1 - Math.max(0, Math.min(1, val))) * plotH;

    // Helper to draw a smooth curve
    const drawLine = (dataKey, strokeColor, fillColor) => {
      ctx.beginPath();
      history.forEach((pt, idx) => {
        const x = getX(idx);
        const y = getY(pt[dataKey]);
        if (idx === 0) ctx.moveTo(x, y);
        else {
          const prevX = getX(idx - 1);
          const prevY = getY(history[idx - 1][dataKey]);
          const cpX1 = (prevX + x) / 2;
          ctx.bezierCurveTo(cpX1, prevY, cpX1, y, x, y);
        }
      });

      // Fill gradient under curve
      ctx.save();
      const lastX = getX(history.length - 1);
      const firstX = getX(0);
      ctx.lineTo(lastX, padTop + plotH);
      ctx.lineTo(firstX, padTop + plotH);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
      grad.addColorStop(0, fillColor);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.restore();

      // Stroke line
      ctx.beginPath();
      history.forEach((pt, idx) => {
        const x = getX(idx);
        const y = getY(pt[dataKey]);
        if (idx === 0) ctx.moveTo(x, y);
        else {
          const prevX = getX(idx - 1);
          const prevY = getY(history[idx - 1][dataKey]);
          const cpX1 = (prevX + x) / 2;
          ctx.bezierCurveTo(cpX1, prevY, cpX1, y, x, y);
        }
      });
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Draw point on current latest
      const latest = history[history.length - 1];
      ctx.beginPath();
      ctx.arc(getX(history.length - 1), getY(latest[dataKey]), 4, 0, Math.PI * 2);
      ctx.fillStyle = strokeColor;
      ctx.fill();
      ctx.strokeStyle = '#07090e';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    };

    // Draw 3 Streams
    drawLine('conf_healthy', '#10b981', 'rgba(16, 185, 129, 0.15)');
    drawLine('conf_misaligned', '#f59e0b', 'rgba(245, 158, 11, 0.12)');
    drawLine('conf_imbalance', '#ef4444', 'rgba(239, 68, 68, 0.20)');

    // Hover Crosshair
    if (hoverIndex !== null && hoverIndex >= 0 && hoverIndex < history.length) {
      const hX = getX(hoverIndex);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(hX, padTop);
      ctx.lineTo(hX, padTop + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Time Axis Labels (Dynamically scaled)
    const windowSeconds = Math.round((256 * sampleDelay) / 1000);
    const totalSpanSeconds = Math.round((history.length * windowSeconds) || 60);

    ctx.fillStyle = '#64748b';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`-${totalSpanSeconds}s`, padLeft, height - 10);
    ctx.textAlign = 'center';
    ctx.fillText(`-${Math.round(totalSpanSeconds / 2)}s`, padLeft + plotW / 2, height - 10);
    ctx.textAlign = 'right';
    ctx.fillText('LIVE NOW', width - padRight, height - 10);

  }, [history, hoverIndex, sampleDelay]);

  const handleMouseMove = (e) => {
    const canvas = canvasRef.current;
    if (!canvas || !history.length) return;
    const rect = canvas.getBoundingClientRect();
    const padLeft = 45;
    const plotW = rect.width - padLeft - 20;
    const mouseX = e.clientX - rect.left - padLeft;
    const maxPoints = Math.max(30, history.length);
    const ratio = Math.max(0, Math.min(1, mouseX / plotW));
    const idx = Math.round(ratio * (maxPoints - 1));
    if (idx < history.length) {
      setHoverIndex(idx);
    } else {
      setHoverIndex(null);
    }
  };

  const handleMouseLeave = () => setHoverIndex(null);

  const hoveredData = hoverIndex !== null && history[hoverIndex] ? history[hoverIndex] : (history[history.length - 1] || null);

  return (
    <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(6, 182, 212, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#06b6d4' }}>
            <Activity size={18} />
          </div>
          <div>
            <h2 style={{ fontSize: '16px', fontWeight: '700', letterSpacing: '-0.02em', color: '#f8fafc' }}>
              Real-Time Vibration Probability Dynamics
            </h2>
            <p style={{ fontSize: '12px', color: '#64748b' }}>
              Rolling 256-sample window continuous inference stream (~{dynamicFreqHz} Hz, {sampleDelay}ms dynamic delay)
            </p>
          </div>
        </div>

        {/* Legend & Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '14px', alignItems: 'center', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#10b981' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981' }} />
              Healthy {hoveredData ? `(${(hoveredData.conf_healthy * 100).toFixed(1)}%)` : ''}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#f59e0b' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f59e0b' }} />
              Misalignment {hoveredData ? `(${(hoveredData.conf_misaligned * 100).toFixed(1)}%)` : ''}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#ef4444' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444' }} />
              Imbalance {hoveredData ? `(${(hoveredData.conf_imbalance * 100).toFixed(1)}%)` : ''}
            </span>
          </div>

          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              onClick={() => setIsPaused(!isPaused)}
              title={isPaused ? "Resume Live Graph" : "Pause Graph"}
              style={{
                background: isPaused ? 'rgba(245, 158, 11, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                color: isPaused ? '#f59e0b' : '#94a3b8',
                border: '1px solid var(--border-subtle)',
                borderRadius: '6px',
                padding: '6px 10px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px'
              }}
            >
              {isPaused ? <Play size={13} /> : <Pause size={13} />}
              {isPaused ? 'Resume' : 'Pause'}
            </button>

            <button
              onClick={onClear}
              title="Clear Chart Buffer"
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                color: '#94a3b8',
                border: '1px solid var(--border-subtle)',
                borderRadius: '6px',
                padding: '6px 10px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px'
              }}
            >
              <RotateCcw size={13} />
              Clear
            </button>
          </div>
        </div>
      </div>

      {/* HTML5 Canvas */}
      <div style={{ height: '260px', width: '100%', position: 'relative' }}>
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          style={{ width: '100%', height: '100%', display: 'block' }}
        />
      </div>
    </div>
  );
}
