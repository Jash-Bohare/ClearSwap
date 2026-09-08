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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
      <div className="glass-panel w-full max-w-2xl p-6 space-y-6 border-rose-500/40 shadow-2xl relative animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white font-heading">Sandwich Attack Comparison Panel</h2>
              <p className="text-xs text-slate-400">Replaying identical batch orders against a sequential AMM (Uniswap v2)</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Side-by-side comparison cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Traditional Sequential AMM Card */}
          <div className="p-5 rounded-xl bg-rose-950/30 border border-rose-500/30 space-y-3">
            <div className="flex items-center justify-between text-xs font-bold text-rose-400">
              <span className="flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-rose-400" />
                Standard Sequential DEX
              </span>
              <span className="badge badge-sell">Vulnerable</span>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Execution Mechanism</span>
                <span className="font-semibold text-rose-300">Serial Price-Time Priority</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Victim (B1) Execution Price</span>
                <span className="font-mono text-rose-400 font-bold">${sequentialPrice.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Bot Sandwich Slippage</span>
                <span className="font-mono text-rose-400 font-bold">+$75.40 / WETH</span>
              </div>
              <div className="pt-2 border-t border-rose-500/20 flex justify-between items-center">
                <span className="text-slate-300 font-semibold">Value Extracted by Bot</span>
                <span className="font-mono text-rose-400 font-extrabold text-sm">-${totalMevExtracted.toFixed(2)} USDC</span>
              </div>
            </div>
          </div>

          {/* ClearSwap Batch Auction Card */}
          <div className="p-5 rounded-xl bg-emerald-950/30 border border-emerald-500/30 space-y-3">
            <div className="flex items-center justify-between text-xs font-bold text-emerald-400">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ClearSwap Batch Auction
              </span>
              <span className="badge badge-buy">MEV-Immune</span>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Execution Mechanism</span>
                <span className="font-semibold text-emerald-300">Discrete Uniform Clearing</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Every Trader Execution Price</span>
                <span className="font-mono text-emerald-300 font-bold">${clearingPrice.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Frontrun Advantage</span>
                <span className="font-mono text-emerald-300 font-bold">Zero (0.00%)</span>
              </div>
              <div className="pt-2 border-t border-emerald-500/20 flex justify-between items-center">
                <span className="text-slate-300 font-semibold">MEV Losses Prevented</span>
                <span className="font-mono text-emerald-400 font-extrabold text-sm">+$150.80 USDC</span>
              </div>
            </div>
          </div>
        </div>

        {/* Explanatory Callout */}
        <div className="p-3.5 rounded-xl bg-slate-900/90 border border-white/10 text-xs text-slate-300 space-y-1">
          <p className="font-bold text-white flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-sky-400" />
            Why Batch Auctions Eliminate MEV by Construction
          </p>
          <p className="text-slate-400 leading-relaxed">
            In ClearSwap, all orders within the batch execute at the exact same uniform clearing price $P^* = 3010$. A sandwich attacker receives the exact same clearing price as the victim, making risk-free sandwich extraction mathematically impossible.
          </p>
        </div>

        <div className="flex justify-end">
          <button onClick={onClose} className="btn-primary text-xs py-2 px-5">
            Close Panel
          </button>
        </div>
      </div>
    </div>
  );
};
