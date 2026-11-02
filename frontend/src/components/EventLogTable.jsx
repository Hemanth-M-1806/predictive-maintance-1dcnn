import React, { useState } from 'react';
import { Terminal, Download, Trash2 } from 'lucide-react';

export default function EventLogTable({ logs, onClear }) {
  const [filter, setFilter] = useState('ALL');
  const [search, setSearch] = useState('');

  const filteredLogs = logs.filter(item => {
    if (filter === 'ALERTS' && item.type !== 'ALERT') return false;
    if (filter === 'TELEMETRY' && item.type !== 'TELEMETRY') return false;
    if (filter === 'COMMANDS' && item.type !== 'COMMAND') return false;

    if (search.trim()) {
      const q = search.toLowerCase();
      const content = `${item.time} ${item.type} ${item.status || ''} ${item.message || ''}`.toLowerCase();
      return content.includes(q);
    }
    return true;
  });

  const exportJSON = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(logs, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute("href", dataStr);
    dlAnchor.setAttribute("download", `motor_guard_logs_${Date.now()}.json`);
    dlAnchor.click();
  };

  return (
    <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Header and Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(139, 92, 246, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b5cf6' }}>
            <Terminal size={18} />
          </div>
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: '800', color: '#f8fafc' }}>
              Motor Status & Telemetry Audit Log
            </h3>
            <p style={{ fontSize: '12px', color: '#64748b' }}>
              Chronological ledger of edge AI classifications and emergency trip events
            </p>
          </div>
        </div>

        {/* Filter Tabs & Export */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {['ALL', 'ALERTS', 'TELEMETRY', 'COMMANDS'].map(tab => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              style={{
                fontSize: '11px',
                fontWeight: '600',
                padding: '5px 10px',
                borderRadius: '6px',
                background: filter === tab ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.03)',
                color: filter === tab ? '#f8fafc' : '#64748b',
                border: '1px solid var(--border-subtle)'
              }}
            >
              {tab}
            </button>
          ))}

          <input
            type="text"
            placeholder="Search logs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              background: 'rgba(0, 0, 0, 0.3)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '6px',
              padding: '5px 10px',
              color: '#f8fafc',
              fontSize: '12px',
              outline: 'none',
              width: '130px'
            }}
          />

          <button
            onClick={exportJSON}
            title="Export JSON Log"
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              color: '#94a3b8',
              border: '1px solid var(--border-subtle)',
              borderRadius: '6px',
              padding: '6px 10px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '11px'
            }}
          >
            <Download size={13} />
            Export
          </button>

          <button
            onClick={onClear}
            title="Clear Logs"
            style={{
              background: 'rgba(239, 68, 68, 0.1)',
              color: '#ef4444',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              borderRadius: '6px',
              padding: '6px 10px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '11px'
            }}
          >
            <Trash2 size={13} />
            Clear
          </button>
        </div>
      </div>

      {/* Log Table Container */}
      <div style={{ maxHeight: '240px', overflowY: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border-subtle)', color: '#64748b' }}>
              <th style={{ padding: '8px 12px', fontWeight: '600' }}>Timestamp</th>
              <th style={{ padding: '8px 12px', fontWeight: '600' }}>Event Type</th>
              <th style={{ padding: '8px 12px', fontWeight: '600' }}>Machine State</th>
              <th style={{ padding: '8px 12px', fontWeight: '600' }}>Confidence</th>
              <th style={{ padding: '8px 12px', fontWeight: '600' }}>Inference Lag</th>
              <th style={{ padding: '8px 12px', fontWeight: '600' }}>Details</th>
            </tr>
          </thead>
          <tbody>
            {filteredLogs.length === 0 ? (
              <tr>
                <td colSpan="6" style={{ textAlign: 'center', padding: '24px', color: '#475569' }}>
                  No telemetry logs matching criteria
                </td>
              </tr>
            ) : (
              filteredLogs.slice(-50).reverse().map((item, idx) => {
                const isAlert = item.type === 'ALERT';
                const isHealthy = item.status === 'HEALTHY';
                return (
                  <tr
                    key={idx}
                    style={{
                      borderBottom: '1px solid rgba(255,255,255,0.03)',
                      background: isAlert ? 'rgba(239, 68, 68, 0.08)' : 'transparent',
                      transition: 'background 0.15s ease'
                    }}
                  >
                    <td className="mono-metric" style={{ padding: '7px 12px', color: '#94a3b8' }}>
                      {item.time}
                    </td>
                    <td style={{ padding: '7px 12px' }}>
                      <span style={{
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontSize: '10px',
                        fontWeight: '700',
                        background: isAlert ? 'rgba(239, 68, 68, 0.2)' : (item.type === 'COMMAND' ? 'rgba(6, 182, 212, 0.2)' : 'rgba(255,255,255,0.06)'),
                        color: isAlert ? '#ef4444' : (item.type === 'COMMAND' ? '#06b6d4' : '#94a3b8')
                      }}>
                        {item.type}
                      </span>
                    </td>
                    <td style={{ padding: '7px 12px', fontWeight: '600', color: isHealthy ? '#10b981' : (isAlert ? '#ef4444' : '#f59e0b') }}>
                      {item.status || '-'}
                    </td>
                    <td className="mono-metric" style={{ padding: '7px 12px', color: '#f8fafc' }}>
                      {item.confidence !== undefined ? `${(item.confidence * 100).toFixed(1)}%` : '-'}
                    </td>
                    <td className="mono-metric" style={{ padding: '7px 12px', color: '#06b6d4' }}>
                      {item.infer_ms ? `${item.infer_ms} ms` : '-'}
                    </td>
                    <td style={{ padding: '7px 12px', color: '#94a3b8', fontSize: '11px' }}>
                      {item.message || JSON.stringify(item.raw || {})}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
