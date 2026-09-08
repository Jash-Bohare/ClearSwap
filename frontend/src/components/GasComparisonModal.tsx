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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
      <div className="glass-panel w-full max-w-2xl p-6 space-y-6 border-amber-500/40 shadow-2xl relative animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
              <Flame className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white font-heading">Gas Benchmark Comparison Panel</h2>
              <p className="text-xs text-slate-400">Measured execution cost: Arbitrum Stylus Rust vs Pure Solidity (Spec 07 §6)</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Gas Benchmark Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/10 text-slate-400 font-semibold">
                <th className="py-2.5 px-3">Batch Size (N)</th>
                <th className="py-2.5 px-3 text-right">Pure Solidity Gas</th>
                <th className="py-2.5 px-3 text-right text-sky-400">Stylus Rust Gas</th>
                <th className="py-2.5 px-3 text-right text-emerald-400">Gas Savings</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {benchmarks.map((row) => (
                <tr key={row.n} className="hover:bg-white/[0.02]">
                  <td className="py-3.5 px-3 font-mono font-bold text-white">{row.n} Orders</td>
                  <td className="py-3.5 px-3 font-mono text-right text-slate-300">
                    {row.solidityGas.toLocaleString()} gas
                  </td>
                  <td className="py-3.5 px-3 font-mono text-right text-sky-300 font-bold">
                    {row.stylusGas.toLocaleString()} gas
                  </td>
                  <td className="py-3.5 px-3 font-mono text-right text-emerald-400 font-extrabold text-sm">
                    {row.savings}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Visual Bar Comparison */}
        <div className="space-y-3 p-4 bg-slate-900/80 rounded-xl border border-white/5">
          <div className="flex justify-between text-xs font-semibold text-slate-300">
            <span>Stylus Efficiency Advantage (N=10 Orders)</span>
            <span className="text-emerald-400">~82% Gas Reduction</span>
          </div>
          <div className="space-y-2 text-xs font-mono">
            <div>
              <div className="flex justify-between text-slate-400 text-[11px] mb-1">
                <span>Solidity O(N log N) Sorting Sweep: 102,982 gas</span>
              </div>
              <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden">
                <div className="w-full h-full bg-rose-500/80" />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sky-300 text-[11px] mb-1">
                <span>Arbitrum Stylus WASM Engine: 18,400 gas</span>
              </div>
              <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden">
                <div className="w-[18%] h-full bg-sky-400 shadow-lg shadow-sky-400/50" />
              </div>
            </div>
          </div>
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
