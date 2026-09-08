import React, { useState } from 'react';
import { ArrowDown, ArrowUp, Info, AlertCircle, CheckCircle2 } from 'lucide-react';

interface OrderFormProps {
  currentBatchId: number;
  onSubmitOrder: (isBuy: boolean, amount: number, limitPrice: number) => Promise<void>;
  isSubmitting: boolean;
}

export const OrderForm: React.FC<OrderFormProps> = ({
  currentBatchId,
  onSubmitOrder,
  isSubmitting
}) => {
  const [isBuy, setIsBuy] = useState<boolean>(true);
  const [amount, setAmount] = useState<string>('1.0');
  const [limitPrice, setLimitPrice] = useState<string>('3000');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    const numAmount = parseFloat(amount);
    const numPrice = parseFloat(limitPrice);

    if (isNaN(numAmount) || numAmount <= 0) {
      setError('Order amount must be strictly positive (> 0)');
      return;
    }
    if (isNaN(numPrice) || numPrice <= 0) {
      setError('Limit price must be strictly positive (> 0)');
      return;
    }

    try {
      await onSubmitOrder(isBuy, numAmount, numPrice);
      setSuccessMsg(`Order submitted to Batch #${currentBatchId}`);
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to submit order');
    }
  };

  const estimatedTotal = (parseFloat(amount || '0') * parseFloat(limitPrice || '0')).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  return (
    <div className="glass-panel p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white font-heading">Submit Batch Order</h2>
          <p className="text-xs text-slate-400">Zero front-running & sandwich protection by design</p>
        </div>
        <span className="badge badge-blue">Batch #{currentBatchId}</span>
      </div>

      {/* Side Selector Tabs (Buy WETH vs Sell WETH) */}
      <div className="grid grid-cols-2 p-1 bg-slate-900/80 rounded-xl border border-white/5">
        <button
          type="button"
          onClick={() => setIsBuy(true)}
          className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold transition-all ${
            isBuy
              ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <ArrowDown className="w-3.5 h-3.5" />
          <span>Buy WETH</span>
        </button>
        <button
          type="button"
          onClick={() => setIsBuy(false)}
          className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-bold transition-all ${
            !isBuy
              ? 'bg-rose-500 text-slate-950 shadow-md shadow-rose-500/20'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <ArrowUp className="w-3.5 h-3.5" />
          <span>Sell WETH</span>
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Quantity Input (WETH) */}
        <div>
          <div className="flex justify-between text-xs mb-1.5 font-medium">
            <span className="text-slate-300">Order Quantity</span>
            <span className="text-slate-400">Token: WETH</span>
          </div>
          <div className="relative rounded-xl bg-slate-900/90 border border-white/10 focus-within:border-sky-400/60 transition">
            <input
              type="number"
              step="any"
              min="0.0001"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.0"
              className="w-full bg-transparent px-3.5 py-3 text-base font-mono text-white placeholder-slate-600 focus:outline-none"
              required
            />
            <span className="absolute right-3.5 top-3.5 text-xs font-bold text-slate-400">
              WETH
            </span>
          </div>
        </div>

        {/* Limit Price Input (USDC) */}
        <div>
          <div className="flex justify-between text-xs mb-1.5 font-medium">
            <span className="text-slate-300">Limit Price ({isBuy ? 'Maximum' : 'Minimum'})</span>
            <span className="text-slate-400 flex items-center gap-1">
              <Info className="w-3 h-3 text-sky-400" />
              <span>USDC per WETH</span>
            </span>
          </div>
          <div className="relative rounded-xl bg-slate-900/90 border border-white/10 focus-within:border-sky-400/60 transition">
            <input
              type="number"
              step="any"
              min="0.01"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              placeholder="3000"
              className="w-full bg-transparent px-3.5 py-3 text-base font-mono text-white placeholder-slate-600 focus:outline-none"
              required
            />
            <span className="absolute right-3.5 top-3.5 text-xs font-bold text-slate-400">
              USDC
            </span>
          </div>
        </div>

        {/* Quick price presets */}
        <div className="flex gap-2">
          {[2980, 3010, 3020, 3050].map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setLimitPrice(p.toString())}
              className="px-2.5 py-1 text-xs font-mono rounded-md bg-slate-800/80 border border-white/5 text-slate-300 hover:border-sky-400/50 hover:text-white transition"
            >
              ${p}
            </button>
          ))}
        </div>

        {/* Order Summary Box */}
        <div className="p-3.5 bg-slate-900/60 rounded-xl border border-white/5 space-y-1.5 text-xs">
          <div className="flex justify-between text-slate-400">
            <span>Order Type</span>
            <span className="text-white font-semibold">{isBuy ? 'Limit Buy' : 'Limit Sell'}</span>
          </div>
          <div className="flex justify-between text-slate-400">
            <span>Target Batch</span>
            <span className="font-mono text-sky-300 font-bold">Batch #{currentBatchId}</span>
          </div>
          <div className="flex justify-between text-slate-400 pt-1.5 border-t border-white/5">
            <span>Estimated Total</span>
            <span className="font-mono text-white font-bold text-sm">${estimatedTotal} USDC</span>
          </div>
        </div>

        {/* Error / Success Notices */}
        {error && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-center gap-2.5 text-xs text-rose-300">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-center gap-2.5 text-xs text-emerald-300">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isSubmitting}
          className={`w-full py-3.5 rounded-xl font-heading font-bold text-sm tracking-wide transition shadow-lg ${
            isBuy
              ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-emerald-500/20'
              : 'bg-rose-500 hover:bg-rose-400 text-slate-950 shadow-rose-500/20'
          } ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {isSubmitting
            ? 'Submitting to Batch...'
            : isBuy
            ? `Buy ${amount || '0'} WETH`
            : `Sell ${amount || '0'} WETH`}
        </button>
      </form>
    </div>
  );
};
