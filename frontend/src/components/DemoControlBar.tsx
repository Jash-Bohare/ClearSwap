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
    <div className="demo-controller-bar">
      <div className="controller-info">
        <div className="controller-icon-box">
          <Award size={18} />
        </div>
        <div>
          <h4 style={{ fontSize: '0.8125rem' }}>Presentation Demo Controller</h4>
          <p style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
            Executes the canonical Spec 03 §17 worked example with deterministic $3,010 USDC clearing
          </p>
        </div>
      </div>

      <div className="controller-buttons">
        <button
          onClick={onRunFullDemo}
          disabled={isDemoRunning}
          className="btn btn-demo"
        >
          <Play size={14} fill="currentColor" />
          <span>{isDemoRunning ? 'Injecting Orders...' : 'Run §17 Worked Example'}</span>
        </button>

        <button
          onClick={onCloseBatchNow}
          className="btn btn-primary"
        >
          <FastForward size={14} />
          <span>Close Batch #{currentBatchId} & Clear</span>
        </button>

        <button
          onClick={onResetDemo}
          className="btn btn-ghost"
          style={{ padding: '8px 10px' }}
          title="Reset to clean state"
        >
          <RotateCcw size={15} />
        </button>
      </div>
    </div>
  );
};
