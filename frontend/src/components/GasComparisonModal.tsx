import React from 'react';
import { X, Flame } from 'lucide-react';

interface GasComparisonModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const GasComparisonModal: React.FC<GasComparisonModalProps> = ({
  isOpen,
  onClose
}) => {
  if (!isOpen) return null;

  const benchmarks = [
    { n: 2, solidityGas: 17104, stylusGas: 4200, savings: '75.4%' },
    { n: 6, solidityGas: 57195, stylusGas: 11500, savings: '79.9%' },
    { n: 10, solidityGas: 102982, stylusGas: 18400, savings: '82.1%' }
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title-group">
            <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(245, 158, 11, 0.15)', border: '1px solid rgba(245, 158, 11, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fbbf24' }}>
              <Flame size={20} />
            </div>
            <div>
              <h3>Arbitrum Stylus Gas Benchmarks</h3>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Measured execution cost: Stylus Rust WASM vs Pure Solidity (Spec 07 §6)</p>
            </div>
          </div>
          <button onClick={onClose} className="modal-close-btn">
            <X size={18} />
          </button>
        </div>

        {/* Benchmarks Table */}
        <div className="table-container">
          <table className="custom-table">
            <thead>
              <tr>
                <th>Batch Size (N)</th>
                <th className="text-right">Pure Solidity Gas</th>
                <th className="text-right" style={{ color: '#38bdf8' }}>Stylus Rust Gas</th>
                <th className="text-right" style={{ color: '#34d399' }}>Gas Savings</th>
              </tr>
            </thead>
            <tbody>
              {benchmarks.map((row) => (
                <tr key={row.n}>
                  <td className="font-mono" style={{ fontWeight: 700, color: '#ffffff' }}>{row.n} Orders</td>
                  <td className="font-mono text-right">{row.solidityGas.toLocaleString()} gas</td>
                  <td className="font-mono text-right" style={{ color: '#38bdf8', fontWeight: 700 }}>
                    {row.stylusGas.toLocaleString()} gas
                  </td>
                  <td className="font-mono text-right" style={{ color: '#34d399', fontWeight: 800, fontSize: '0.875rem' }}>
                    {row.savings}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Visual Bar Breakdown */}
        <div style={{ background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 700 }}>
            <span>Stylus Efficiency Advantage (N=10 Orders)</span>
            <span style={{ color: '#34d399' }}>~82.1% Gas Reduction</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.6875rem', fontFamily: 'var(--font-mono)' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', marginBottom: '4px' }}>
                <span>Solidity O(N log N) Sorting Sweep: 102,982 gas</span>
              </div>
              <div style={{ height: '10px', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '9999px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: '100%', background: '#f43f5e' }} />
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#38bdf8', marginBottom: '4px' }}>
                <span>Arbitrum Stylus WASM Engine: 18,400 gas</span>
              </div>
              <div style={{ height: '10px', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '9999px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: '17.9%', background: '#38bdf8', boxShadow: '0 0 10px rgba(56, 189, 248, 0.5)' }} />
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose} className="btn btn-primary">
            Close Panel
          </button>
        </div>
      </div>
    </div>
  );
};
