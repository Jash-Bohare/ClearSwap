import React from 'react';
import { X, ShieldCheck, AlertTriangle, CheckCircle2, Layers } from 'lucide-react';

interface SandwichComparisonModalProps {
  isOpen: boolean;
  onClose: () => void;
  clearingPrice: number;
}

export const SandwichComparisonModal: React.FC<SandwichComparisonModalProps> = ({
  isOpen,
  onClose,
  clearingPrice
}) => {
  if (!isOpen) return null;

  const sequentialPrice = 3085.40;
  const sequentialLossPerWETH = sequentialPrice - clearingPrice;
  const victimAmount = 2.0;
  const totalMevExtracted = sequentialLossPerWETH * victimAmount;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title-group">
            <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(244, 63, 94, 0.15)', border: '1px solid rgba(244, 63, 94, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fb7185' }}>
              <ShieldCheck size={20} />
            </div>
            <div>
              <h3>Sandwich Attack Comparison</h3>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Replaying identical batch orders against a sequential AMM pool</p>
            </div>
          </div>
          <button onClick={onClose} className="modal-close-btn">
            <X size={18} />
          </button>
        </div>

        {/* Side-by-Side Cards */}
        <div className="comparison-grid">
          {/* Sequential AMM */}
          <div className="comparison-card card-vulnerable">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ color: '#fb7185', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8125rem' }}>
                <AlertTriangle size={15} />
                Standard Sequential DEX
              </strong>
              <span className="badge badge-rose">Vulnerable</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Execution Type</span>
                <span>Serial Priority</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Victim (B1) Price</span>
                <span className="font-mono" style={{ color: '#fb7185', fontWeight: 700 }}>${sequentialPrice.toFixed(2)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Sandwich Slippage</span>
                <span className="font-mono" style={{ color: '#fb7185', fontWeight: 700 }}>+$75.40 / WETH</span>
              </div>
              <div style={{ paddingTop: '8px', borderTop: '1px solid rgba(244, 63, 94, 0.2)', display: 'flex', justifyContent: 'space-between' }}>
                <strong style={{ color: '#ffffff' }}>Value Lost to Bot</strong>
                <span className="font-mono" style={{ color: '#fb7185', fontWeight: 800, fontSize: '0.875rem' }}>-${totalMevExtracted.toFixed(2)} USDC</span>
              </div>
            </div>
          </div>

          {/* ClearSwap */}
          <div className="comparison-card card-immune">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ color: '#34d399', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8125rem' }}>
                <CheckCircle2 size={15} />
                ClearSwap Batch Auction
              </strong>
              <span className="badge badge-green">MEV-Immune</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Execution Type</span>
                <span>Discrete Uniform</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Every Trader Price</span>
                <span className="font-mono" style={{ color: '#34d399', fontWeight: 700 }}>${clearingPrice.toFixed(2)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Frontrun Advantage</span>
                <span className="font-mono" style={{ color: '#34d399', fontWeight: 700 }}>Zero (0.00%)</span>
              </div>
              <div style={{ paddingTop: '8px', borderTop: '1px solid rgba(16, 185, 129, 0.2)', display: 'flex', justifyContent: 'space-between' }}>
                <strong style={{ color: '#ffffff' }}>User Value Protected</strong>
                <span className="font-mono" style={{ color: '#34d399', fontWeight: 800, fontSize: '0.875rem' }}>+$150.80 USDC</span>
              </div>
            </div>
          </div>
        </div>

        {/* Explanation */}
        <div className="callout-box">
          <Layers size={18} color="#38bdf8" style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            <strong style={{ color: '#ffffff' }}>Why Batch Auctions Eliminate MEV by Construction</strong>
            In ClearSwap, all orders within a batch execute at the exact same uniform clearing price $P^* = 3010$. An attacker receives the exact same clearing price as the victim, making risk-free sandwich extraction mathematically impossible.
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
