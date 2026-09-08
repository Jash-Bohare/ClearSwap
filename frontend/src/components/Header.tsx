import React from 'react';
import { Layers, ShieldCheck, Flame, Wallet, Play } from 'lucide-react';

interface HeaderProps {
  currentBatchId: number;
  batchStatus: string;
  onOpenSandwichModal: () => void;
  onOpenGasModal: () => void;
  onRunDemo: () => void;
  isDemoRunning: boolean;
  walletAddress: string | null;
  onConnectWallet: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentBatchId,
  batchStatus,
  onOpenSandwichModal,
  onOpenGasModal,
  onRunDemo,
  isDemoRunning,
  walletAddress,
  onConnectWallet
}) => {
  return (
    <header className="border-b border-white/10 bg-slate-950/80 backdrop-blur-xl sticky top-0 z-40 px-6 py-4">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
        {/* Brand Logo & Tagline */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-400 via-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-sky-500/20">
            <Layers className="w-6 h-6 text-slate-950" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent font-heading">
                ClearSwap
              </h1>
              <span className="badge badge-blue text-[10px] py-0.5">
                Stylus Engine
              </span>
            </div>
            <p className="text-xs text-slate-400 font-medium">MEV-Resistant Batch Auction DEX</p>
          </div>
        </div>

        {/* Pitch Quick Triggers & Batch Status */}
        <div className="flex items-center gap-3">
          {/* Sandwich Comparison Button */}
          <button
            onClick={onOpenSandwichModal}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 hover:bg-rose-500/20 text-xs font-semibold transition"
          >
            <ShieldCheck className="w-4 h-4 text-rose-400" />
            <span>Sandwich Protection</span>
          </button>

          {/* Gas Comparison Button */}
          <button
            onClick={onOpenGasModal}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 hover:bg-amber-500/20 text-xs font-semibold transition"
          >
            <Flame className="w-4 h-4 text-amber-400" />
            <span>Gas Benchmark</span>
          </button>

          {/* Scripted Demo Button */}
          <button
            onClick={onRunDemo}
            disabled={isDemoRunning}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-slate-950 font-bold text-xs shadow-md shadow-sky-500/20 transition disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>{isDemoRunning ? 'Running Demo...' : 'Run MEV Demo'}</span>
          </button>

          {/* Batch Status Pill */}
          <div className="flex items-center gap-2 pl-3 border-l border-white/10 text-xs">
            <span className="text-slate-400">Batch #{currentBatchId}</span>
            <span className={`px-2 py-0.5 rounded-full font-bold uppercase text-[10px] ${
              batchStatus === 'OPEN'
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                : batchStatus === 'CLEARING'
                ? 'bg-sky-500/10 text-sky-400 border border-sky-500/30 animate-pulse'
                : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
            }`}>
              {batchStatus}
            </span>
          </div>

          {/* Connect Wallet */}
          <button
            onClick={onConnectWallet}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-xs font-medium text-slate-200 transition"
          >
            <Wallet className="w-3.5 h-3.5 text-sky-400" />
            <span>{walletAddress ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : 'Connect'}</span>
          </button>
        </div>
      </div>
    </header>
  );
};
