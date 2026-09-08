import React from 'react';
import { Play, FastForward, RotateCcw, Award } from 'lucide-react';

interface DemoControlBarProps {
  onRunFullDemo: () => void;
  onCloseBatchNow: () => void;
  onResetDemo: () => void;
  isDemoRunning: boolean;
  currentBatchId: number;
}

export const DemoControlBar: React.FC<DemoControlBarProps> = ({
  onRunFullDemo,
  onCloseBatchNow,
  onResetDemo,
  isDemoRunning,
  currentBatchId
}) => {
  return (
    <div className="p-4 bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-indigo-500/30 rounded-2xl shadow-lg flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-300">
          <Award className="w-4 h-4" />
        </div>
        <div>
          <h4 className="text-xs font-bold text-white font-heading">Live Presentation Demo Controller</h4>
          <p className="text-[11px] text-slate-400">Executes the canonical Spec 03 §17 worked example with deterministic 3010 USDC clearing</p>
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        <button
          onClick={onRunFullDemo}
          disabled={isDemoRunning}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition shadow-md shadow-indigo-500/20 disabled:opacity-50"
        >
          <Play className="w-3.5 h-3.5" />
          <span>{isDemoRunning ? 'Injecting Orders...' : 'Run §17 Worked Example (6 Orders)'}</span>
        </button>

        <button
          onClick={onCloseBatchNow}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-bold transition shadow-md shadow-sky-500/20"
        >
          <FastForward className="w-3.5 h-3.5" />
          <span>Close Batch #{currentBatchId} & Clear</span>
        </button>

        <button
          onClick={onResetDemo}
          className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition"
          title="Reset to clean state"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
