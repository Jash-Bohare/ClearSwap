import React from 'react';
import { Clock, Users, ArrowUpRight, ArrowDownLeft, XCircle, Play } from 'lucide-react';
import type { OrderItem } from '../types';

interface CurrentBatchPanelProps {
  batchId: number;
  batchStatus: string;
  secondsRemaining: number;
  orders: OrderItem[];
  onCancelOrder: (orderId: number) => void;
  onCloseBatchNow: () => void;
  isClosingBatch: boolean;
}

export const CurrentBatchPanel: React.FC<CurrentBatchPanelProps> = ({
  batchId,
  batchStatus,
  secondsRemaining,
  orders,
  onCancelOrder,
  onCloseBatchNow,
  isClosingBatch
}) => {
  const currentOrders = orders.filter((o) => o.batchId === batchId && o.status !== 'CANCELLED');
  const buyOrders = currentOrders.filter((o) => o.isBuy);
  const sellOrders = currentOrders.filter((o) => !o.isBuy);

  const totalBuyQty = buyOrders.reduce((sum, o) => sum + o.amount, 0);
  const totalSellQty = sellOrders.reduce((sum, o) => sum + o.amount, 0);
  const totalQty = totalBuyQty + totalSellQty;
  const buyPercent = totalQty > 0 ? (totalBuyQty / totalQty) * 100 : 50;

  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Batch Header Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h2>Current Auction Batch #{batchId}</h2>
            <span className="badge badge-gold">{batchStatus}</span>
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
            Orders are collected until the batch closes and clears at a uniform price
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', background: 'var(--bg-input)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
            <Clock size={15} color="#38bdf8" />
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Closing in:</span>
            <span className="font-mono" style={{ fontWeight: 800, color: '#ffffff', fontSize: '0.875rem' }}>{secondsRemaining}s</span>
          </div>

          <button
            onClick={onCloseBatchNow}
            disabled={isClosingBatch}
            className="btn btn-ghost"
            style={{ borderColor: 'rgba(56, 189, 248, 0.3)', color: '#38bdf8' }}
            title="Trigger batch clearing immediately"
          >
            <Play size={14} />
            <span>{isClosingBatch ? 'Clearing...' : 'Close Batch Now'}</span>
          </button>
        </div>
      </div>

      {/* Aggregate Liquidity Meter */}
      <div className="liquidity-meter-card">
        <div className="liquidity-stats-row">
          <span style={{ color: '#34d399', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <ArrowUpRight size={14} />
            Buy Demand: {totalBuyQty.toFixed(2)} WETH ({buyOrders.length} orders)
          </span>
          <span style={{ color: '#fb7185', display: 'flex', alignItems: 'center', gap: '4px' }}>
            Sell Supply: {totalSellQty.toFixed(2)} WETH ({sellOrders.length} orders)
            <ArrowDownLeft size={14} />
          </span>
        </div>
        <div className="liquidity-bar-track">
          <div className="liquidity-bar-buy" style={{ width: `${buyPercent}%` }} />
          <div className="liquidity-bar-sell" style={{ width: `${100 - buyPercent}%` }} />
        </div>
      </div>

      {/* Live Orders Table */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Users size={16} color="#38bdf8" />
            <h4 style={{ fontSize: '0.875rem' }}>Orders in Open Batch ({currentOrders.length})</h4>
          </div>
          <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>Order of submission has zero effect on execution</span>
        </div>

        {currentOrders.length === 0 ? (
          <div style={{ padding: '36px 16px', textAlign: 'center', border: '1px dashed var(--border-subtle)', borderRadius: 'var(--radius-md)', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
            No orders submitted yet in Batch #{batchId}. Submit an order on the left or click "Run MEV Demo".
          </div>
        ) : (
          <div className="table-container">
            <table className="custom-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Trader</th>
                  <th>Side</th>
                  <th className="text-right">Quantity</th>
                  <th className="text-right">Limit Price</th>
                  <th className="text-center">Status</th>
                  <th className="text-right">Cancel</th>
                </tr>
              </thead>
              <tbody>
                {currentOrders.map((order) => (
                  <tr key={order.id}>
                    <td className="font-mono" style={{ fontWeight: 700, color: '#ffffff' }}>#{order.id}</td>
                    <td className="font-mono">
                      {order.traderLabel ? (
                        <span style={{ padding: '2px 6px', borderRadius: '4px', background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', fontWeight: 700 }}>
                          {order.traderLabel}
                        </span>
                      ) : (
                        `${order.trader.slice(0, 6)}...${order.trader.slice(-4)}`
                      )}
                    </td>
                    <td>
                      <span className={`badge ${order.isBuy ? 'badge-green' : 'badge-rose'}`}>
                        {order.isBuy ? 'BUY' : 'SELL'}
                      </span>
                    </td>
                    <td className="font-mono text-right" style={{ color: '#ffffff', fontWeight: 600 }}>
                      {order.amount.toFixed(4)} WETH
                    </td>
                    <td className="font-mono text-right">${order.limitPrice.toFixed(2)}</td>
                    <td className="text-center">
                      <span className="badge badge-gold">{order.status}</span>
                    </td>
                    <td className="text-right">
                      <button
                        onClick={() => onCancelOrder(order.id)}
                        style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}
                        title="Cancel Order"
                      >
                        <XCircle size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
