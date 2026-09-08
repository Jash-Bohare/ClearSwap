import React from 'react';
import { Sparkles, ShieldCheck, ArrowRight, RotateCcw, TrendingUp } from 'lucide-react';
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

  // Calculate aggregate trader surplus (total dollars saved or gained vs limit prices)
  const totalSurplus = fills.reduce((acc, fill) => {
    const limit = fill.limitPrice || fill.clearingPrice;
    if (fill.isBuy) {
      const diff = limit - fill.clearingPrice;
      return acc + (diff > 0 ? diff * fill.filledAmount : 0);
    } else {
      const diff = fill.clearingPrice - limit;
      return acc + (diff > 0 ? diff * fill.filledAmount : 0);
    }
  }, 0);

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

        {/* Mandatory Microcopy under 5-second rule */}
        <p className="clearing-microcopy">
          1 uniform price for every trade in this batch — no frontrunning, zero slippage exploitation.
        </p>

        {/* Surplus Highlight Badge */}
        {totalSurplus > 0 && (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 14px',
              borderRadius: '20px',
              background: 'rgba(16, 185, 129, 0.15)',
              border: '1px solid rgba(16, 185, 129, 0.4)',
              color: '#34d399',
              fontSize: '0.8125rem',
              fontWeight: 700,
              margin: '0 auto 8px auto'
            }}
          >
            <TrendingUp size={15} />
            <span>Total Trader Surplus Created: +${totalSurplus.toFixed(2)} USDC</span>
          </div>
        )}

        <button onClick={onOpenSandwichModal} className="btn btn-danger-outline" style={{ margin: '4px auto 0 auto' }}>
          <ShieldCheck size={16} />
          <span>Compare to Sandwich AMM Loss</span>
          <ArrowRight size={14} />
        </button>
      </div>

      {/* Settled Fills Table */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
          <h4>Settlement & Fill Execution ({fills.length} fills settled)</h4>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Total Volume: <strong style={{ color: '#ffffff' }}>{lastClearedBatch.totalVolume?.toFixed(2)} WETH</strong>
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
                  <th className="text-right">Qty</th>
                  <th className="text-right">Trader Limit</th>
                  <th className="text-right" style={{ color: '#fbbf24' }}>Uniform Price (P*)</th>
                  <th className="text-center" style={{ color: '#34d399' }}>Price Advantage (Surplus)</th>
                  <th className="text-right">Settled Total</th>
                </tr>
              </thead>
              <tbody>
                {fills.map((fill, idx) => {
                  const limit = fill.limitPrice || fill.clearingPrice;
                  let perEthDiff = 0;
                  let totalDollarDiff = 0;
                  let isAdvantage = false;

                  if (fill.isBuy) {
                    perEthDiff = limit - fill.clearingPrice;
                    totalDollarDiff = perEthDiff * fill.filledAmount;
                    isAdvantage = perEthDiff > 0.001;
                  } else {
                    perEthDiff = fill.clearingPrice - limit;
                    totalDollarDiff = perEthDiff * fill.filledAmount;
                    isAdvantage = perEthDiff > 0.001;
                  }

                  return (
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
                      <td className="font-mono text-right" style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
                        ${limit.toFixed(2)}
                      </td>
                      <td className="font-mono text-right" style={{ color: '#fbbf24', fontWeight: 800 }}>
                        ${fill.clearingPrice.toLocaleString()}
                      </td>
                      <td className="text-center">
                        {isAdvantage ? (
                          <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
                            <span
                              style={{
                                padding: '2px 8px',
                                borderRadius: '12px',
                                background: 'rgba(16, 185, 129, 0.15)',
                                border: '1px solid rgba(16, 185, 129, 0.3)',
                                color: '#34d399',
                                fontSize: '0.75rem',
                                fontWeight: 700
                              }}
                            >
                              +{fill.isBuy ? `Saved $${perEthDiff.toFixed(2)}/ETH` : `Extra +$${perEthDiff.toFixed(2)}/ETH`}
                            </span>
                            <span style={{ fontSize: '0.65rem', color: '#6ee7b7', marginTop: '2px' }}>
                              ({fill.isBuy ? 'Saved' : 'Profit'}: +${totalDollarDiff.toFixed(2)})
                            </span>
                          </div>
                        ) : (
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            Exact Limit Match ($0.00)
                          </span>
                        )}
                      </td>
                      <td className="font-mono text-right" style={{ fontWeight: 600 }}>
                        {fill.isBuy ? (
                          <span style={{ color: '#fda4af' }}>-${fill.quoteAmount.toFixed(2)} USDC</span>
                        ) : (
                          <span style={{ color: '#6ee7b7' }}>+${fill.quoteAmount.toFixed(2)} USDC</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
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
