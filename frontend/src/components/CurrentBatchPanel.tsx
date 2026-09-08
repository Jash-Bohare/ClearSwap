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
    <div className="glass-panel p-6 space-y-6">
      {/* Batch Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-extrabold text-white font-heading">
              Current Auction Batch #{batchId}
            </h2>
            <span className="badge badge-gold animate-pulse">
              {batchStatus}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Orders are collected privately until the batch closes and clears uniformly
          </p>
        </div>

        {/* Countdown Timer & Presenter Close Button */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-900/90 rounded-xl border border-white/10">
            <Clock className="w-4 h-4 text-sky-400" />
            <span className="text-xs text-slate-400">Closing in:</span>
            <span className="font-mono font-bold text-white text-sm">
              {secondsRemaining}s
            </span>
          </div>

          <button
            onClick={onCloseBatchNow}
            disabled={isClosingBatch}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-500/10 hover:bg-sky-500/20 border border-sky-400/30 text-sky-300 font-semibold text-xs transition"
            title="Presenter control: trigger batch close & clearing immediately"
          >
            <Play className="w-3.5 h-3.5 text-sky-400" />
            <span>{isClosingBatch ? 'Closing...' : 'Close Batch Now'}</span>
          </button>
        </div>
      </div>

      {/* Aggregate Liquidity Bar */}
      <div className="p-4 bg-slate-900/70 rounded-xl border border-white/5 space-y-2">
        <div className="flex justify-between text-xs font-semibold">
          <div className="flex items-center gap-1.5 text-emerald-400">
            <ArrowUpRight className="w-3.5 h-3.5" />
            <span>Buy Demand: {totalBuyQty.toFixed(2)} WETH ({buyOrders.length} orders)</span>
          </div>
          <div className="flex items-center gap-1.5 text-rose-400">
            <span>Sell Supply: {totalSellQty.toFixed(2)} WETH ({sellOrders.length} orders)</span>
            <ArrowDownLeft className="w-3.5 h-3.5" />
          </div>
        </div>
        <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden flex">
          <div
            className="h-full bg-emerald-500 transition-all duration-500"
            style={{ width: `${buyPercent}%` }}
          />
          <div
            className="h-full bg-rose-500 transition-all duration-500"
            style={{ width: `${100 - buyPercent}%` }}
          />
        </div>
      </div>

      {/* Live Order Book in Current Batch */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-slate-200 font-heading flex items-center gap-2">
            <Users className="w-4 h-4 text-sky-400" />
            <span>Orders in Open Batch ({currentOrders.length})</span>
          </h3>
          <span className="text-[11px] text-slate-400">Submission order has zero impact on fill price</span>
        </div>

        {currentOrders.length === 0 ? (
          <div className="p-8 text-center text-slate-500 border border-dashed border-white/10 rounded-xl text-xs">
            No orders submitted yet in Batch #{batchId}. Place an order above or click "Run MEV Demo" in the header.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-white/10 text-slate-400 font-semibold">
                  <th className="py-2.5 px-3">Order ID</th>
                  <th className="py-2.5 px-3">Trader</th>
                  <th className="py-2.5 px-3">Side</th>
                  <th className="py-2.5 px-3 text-right">Amount</th>
                  <th className="py-2.5 px-3 text-right">Limit Price</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {currentOrders.map((order) => (
                  <tr key={order.id} className="hover:bg-white/[0.02] transition">
                    <td className="py-3 px-3 font-mono font-bold text-white">#{order.id}</td>
                    <td className="py-3 px-3 font-mono text-slate-300">
                      {order.traderLabel ? (
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 text-sky-300 font-bold">
                          {order.traderLabel}
                        </span>
                      ) : (
                        `${order.trader.slice(0, 6)}...${order.trader.slice(-4)}`
                      )}
                    </td>
                    <td className="py-3 px-3">
                      <span className={`badge ${order.isBuy ? 'badge-buy' : 'badge-sell'}`}>
                        {order.isBuy ? 'BUY' : 'SELL'}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-mono text-right text-white font-semibold">
                      {order.amount.toFixed(4)} WETH
                    </td>
                    <td className="py-3 px-3 font-mono text-right text-slate-300">
                      ${order.limitPrice.toFixed(2)}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span className="badge badge-gold">
                        {order.status}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right">
                      <button
                        onClick={() => onCancelOrder(order.id)}
                        className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition"
                        title="Cancel Order"
                      >
                        <XCircle className="w-4 h-4" />
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
