import React from 'react';
import { Sparkles, ShieldCheck, ArrowRight, RotateCcw } from 'lucide-react';
import type { BatchState } from '../types';

interface ClearingResultPanelProps {
  lastClearedBatch: BatchState | null;
  onOpenSandwichModal: () => void;
}

export const ClearingResultPanel: React.FC<ClearingResultPanelProps> = ({
  lastClearedBatch,
  onOpenSandwichModal
}) => {
  if (!lastClearedBatch || !lastClearedBatch.clearingPrice) {
    return (
      <div className="glass-panel" style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-muted)' }}>
        <Sparkles size={32} style={{ margin: '0 auto 12px auto', color: '#475569' }} />
        <h3 style={{ color: 'var(--text-secondary)', fontSize: '1rem', marginBottom: '4px' }}>No Clearing Results Yet</h3>
        <p style={{ fontSize: '0.75rem' }}>
          When an auction batch closes, the Stylus WASM clearing engine executes here and calculates the uniform clearing price.
        </p>
      </div>
    );
  }

  const pStar = lastClearedBatch.clearingPrice;
  const fills = lastClearedBatch.fills || [];

  return (
    <div className="glass-panel glass-panel-highlight" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* 5-SECOND UX RULE HERO */}
      <div className="clearing-hero-card">
        <span className="badge badge-blue" style={{ marginBottom: '8px' }}>
          <Sparkles size={13} />
          <span>Batch #{lastClearedBatch.id} Cleared</span>
        </span>

        {/* Dominant Price Display */}
        <div className="clearing-price-hero">
          ${pStar.toLocaleString()}
          <span className="clearing-currency-suffix">USDC / WETH</span>
        </div>

        {/* Mandatory Microcopy under 5-second rule (Spec 06 §3) */}
        <p className="clearing-microcopy">
          1 price for every trade in this batch — no one paid more or got more just by going first.
        </p>

        <button onClick={onOpenSandwichModal} className="btn btn-danger-outline" style={{ margin: '0 auto' }}>
          <ShieldCheck size={16} />
          <span>Compare to Sandwich AMM Loss</span>
          <ArrowRight size={14} />
        </button>
      </div>

      {/* Settled Fills Table */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <h4>Settlement & Fill Execution ({fills.length} fills settled)</h4>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Total Cleared Volume: <strong style={{ color: '#ffffff' }}>{lastClearedBatch.totalVolume?.toFixed(2)} WETH</strong>
          </span>
        </div>

        {fills.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', background: 'var(--bg-input)', borderRadius: 'var(--radius-md)', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
            Zero overlapping volume — all orders rolled forward to next batch with zero token movement.
          </div>
        ) : (
          <div className="table-container">
            <table className="custom-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Trader</th>
                  <th>Side</th>
                  <th className="text-right">Filled Qty</th>
                  <th className="text-right" style={{ color: '#fbbf24' }}>Uniform Clearing Price (P*)</th>
                  <th className="text-right">Settled Amount</th>
                </tr>
              </thead>
              <tbody>
                {fills.map((fill, idx) => (
                  <tr key={idx}>
                    <td className="font-mono" style={{ fontWeight: 700, color: '#ffffff' }}>#{fill.orderId}</td>
                    <td className="font-mono">
                      {fill.traderLabel ? (
                        <span style={{ padding: '2px 6px', borderRadius: '4px', background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', fontWeight: 700 }}>
                          {fill.traderLabel}
                        </span>
                      ) : (
                        `${fill.trader.slice(0, 6)}...${fill.trader.slice(-4)}`
                      )}
                    </td>
                    <td>
                      <span className={`badge ${fill.isBuy ? 'badge-green' : 'badge-rose'}`}>
                        {fill.isBuy ? 'BUY' : 'SELL'}
                      </span>
                    </td>
                    <td className="font-mono text-right" style={{ color: '#ffffff', fontWeight: 700 }}>
                      {fill.filledAmount.toFixed(4)} WETH
                    </td>
                    <td className="font-mono text-right" style={{ color: '#fbbf24', fontWeight: 800, fontSize: '0.875rem' }}>
                      ${fill.clearingPrice.toLocaleString()} USDC
                    </td>
                    <td className="font-mono text-right" style={{ fontWeight: 600 }}>
                      {fill.isBuy ? (
                        <span style={{ color: '#fda4af' }}>-${fill.quoteAmount.toFixed(2)} USDC</span>
                      ) : (
                        <span style={{ color: '#6ee7b7' }}>+${fill.quoteAmount.toFixed(2)} USDC</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Custody Guarantee Callout */}
      <div className="callout-box">
        <RotateCcw size={18} color="#38bdf8" style={{ flexShrink: 0, marginTop: '2px' }} />
        <div>
          <strong style={{ color: '#ffffff', display: 'block', marginBottom: '2px' }}>Non-prefunding Custody & Rollover Guarantee</strong>
          Unmatched or partially filled orders automatically roll into Batch #{lastClearedBatch.id + 1}. No user funds were locked or transferred, and rolled orders remain fully cancellable.
        </div>
      </div>
    </div>
  );
};
