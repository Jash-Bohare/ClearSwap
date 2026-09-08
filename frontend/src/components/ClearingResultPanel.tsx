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
      <div className="glass-panel p-6 text-center text-slate-500 py-12">
        <Sparkles className="w-8 h-8 mx-auto mb-2 text-slate-600" />
        <h3 className="text-sm font-bold text-slate-400 font-heading">No Clearing Results Yet</h3>
        <p className="text-xs text-slate-500 mt-1">
          When a batch closes, the Stylus clearing engine computes the uniform market clearing price here.
        </p>
      </div>
    );
  }

  const pStar = lastClearedBatch.clearingPrice;
  const fills = lastClearedBatch.fills || [];

  return (
    <div className="glass-panel p-6 space-y-6 border-sky-500/30">
      {/* 5-Second UX Rule Banner: Dominant Uniform Clearing Price */}
      <div className="p-6 rounded-2xl bg-gradient-to-b from-sky-950/60 via-slate-900/80 to-slate-950 border border-sky-400/40 text-center relative overflow-hidden shadow-xl">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-400/10 border border-sky-400/30 text-sky-300 text-xs font-bold uppercase tracking-wider mb-2">
          <Sparkles className="w-3.5 h-3.5 text-sky-400" />
          <span>Batch #{lastClearedBatch.id} Cleared</span>
        </div>

        {/* DOMINANT PRICE DISPLAY */}
        <div className="my-2">
          <span className="text-5xl sm:text-6xl font-black font-heading tracking-tight bg-gradient-to-r from-amber-200 via-amber-400 to-yellow-500 bg-clip-text text-transparent drop-shadow-md">
            ${pStar.toLocaleString()}
          </span>
          <span className="text-lg font-bold text-amber-300/80 ml-2">USDC / WETH</span>
        </div>

        {/* Mandatory Microcopy under 5-second rule (Spec 06 §3) */}
        <p className="text-sm font-semibold text-slate-200 mt-2 max-w-xl mx-auto">
          1 price for every trade in this batch — no one paid more or got more just by going first.
        </p>

        {/* Quick Pitch Trigger */}
        <div className="mt-4 flex justify-center">
          <button
            onClick={onOpenSandwichModal}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-300 text-xs font-bold transition shadow-lg"
          >
            <ShieldCheck className="w-4 h-4 text-rose-400" />
            <span>Compare to Sandwich AMM Loss</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Executed Fills Table (with repeated clearing price per row) */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-white font-heading">
            Settlement & Order Fill Results ({fills.length} fills executed)
          </h3>
          <span className="text-xs text-slate-400">Total Volume Cleared: {lastClearedBatch.totalVolume?.toFixed(2)} WETH</span>
        </div>

        {fills.length === 0 ? (
          <div className="p-6 bg-slate-900/60 rounded-xl text-center text-xs text-slate-400">
            Zero matching liquidity this round — all orders rolled forward into next batch intact.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-white/10 text-slate-400 font-semibold">
                  <th className="py-2.5 px-3">Order</th>
                  <th className="py-2.5 px-3">Trader</th>
                  <th className="py-2.5 px-3">Side</th>
                  <th className="py-2.5 px-3 text-right">Filled Quantity</th>
                  <th className="py-2.5 px-3 text-right text-amber-300">Clearing Price (P*)</th>
                  <th className="py-2.5 px-3 text-right">Amount Settled</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {fills.map((fill, idx) => (
                  <tr key={idx} className="hover:bg-white/[0.02] transition">
                    <td className="py-3 px-3 font-mono font-bold text-white">#{fill.orderId}</td>
                    <td className="py-3 px-3 font-mono text-slate-300">
                      {fill.traderLabel ? (
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 text-sky-300 font-bold">
                          {fill.traderLabel}
                        </span>
                      ) : (
                        `${fill.trader.slice(0, 6)}...${fill.trader.slice(-4)}`
                      )}
                    </td>
                    <td className="py-3 px-3">
                      <span className={`badge ${fill.isBuy ? 'badge-buy' : 'badge-sell'}`}>
                        {fill.isBuy ? 'BUY' : 'SELL'}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-mono text-right text-white font-bold">
                      {fill.filledAmount.toFixed(4)} WETH
                    </td>
                    <td className="py-3 px-3 font-mono text-right text-amber-300 font-extrabold text-sm">
                      ${fill.clearingPrice.toLocaleString()} USDC
                    </td>
                    <td className="py-3 px-3 font-mono text-right text-slate-200">
                      {fill.isBuy ? (
                        <span className="text-rose-300 font-medium">-${fill.quoteAmount.toFixed(2)} USDC</span>
                      ) : (
                        <span className="text-emerald-300 font-medium">+${fill.quoteAmount.toFixed(2)} USDC</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Rollover Reassurance Notice */}
      <div className="p-4 rounded-xl bg-slate-900/80 border border-white/10 flex items-start gap-3 text-xs text-slate-300">
        <RotateCcw className="w-4 h-4 text-sky-400 mt-0.5 shrink-0" />
        <div>
          <p className="font-semibold text-white">Non-prefunding Custody Guarantee</p>
          <p className="text-slate-400 mt-0.5">
            Unmatched or partially-filled orders automatically roll into Batch #{lastClearedBatch.id + 1}. No funds were pre-funded or put at risk, and rolled orders remain fully cancellable.
          </p>
        </div>
      </div>
    </div>
  );
};
