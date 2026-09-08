import React from 'react';
import { Play, Pause, RotateCcw, Award, Zap } from 'lucide-react';

interface DemoControlBarProps {
  onRunFullDemo: () => void;
  onResetDemo: () => void;
  isDemoRunning: boolean;
  timerSpeed: number;
  onSetTimerSpeed: (speed: number) => void;
  isTimerPaused: boolean;
  onToggleTimerPause: () => void;
}

export const DemoControlBar: React.FC<DemoControlBarProps> = ({
  onRunFullDemo,
  onResetDemo,
  isDemoRunning,
  timerSpeed,
  onSetTimerSpeed,
  isTimerPaused,
  onToggleTimerPause
}) => {
  const speeds = [1, 2, 5, 10];

  return (
    <div className="demo-controller-bar">
      <div className="controller-info">
        <div className="controller-icon-box">
          <Award size={18} />
        </div>
        <div>
          <h4 style={{ fontSize: '0.8125rem' }}>Presentation Demo Controller</h4>
          <p style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
            Inject test trades, freeze time during pitch, and tune auction batch speed
          </p>
        </div>
      </div>

      <div className="controller-buttons" style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        {/* Pause / Resume Timer Button */}
        <button
          onClick={onToggleTimerPause}
          className="btn"
          style={{
            padding: '7px 12px',
            fontSize: '0.75rem',
            borderRadius: 'var(--radius-sm)',
            background: isTimerPaused ? 'rgba(251, 191, 36, 0.15)' : 'rgba(56, 189, 248, 0.12)',
            border: `1px solid ${isTimerPaused ? 'rgba(251, 191, 36, 0.4)' : 'rgba(56, 189, 248, 0.3)'}`,
            color: isTimerPaused ? '#fbbf24' : '#38bdf8',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
          title={isTimerPaused ? 'Resume countdown timer' : 'Pause countdown timer to explain to judges'}
        >
          {isTimerPaused ? <Play size={13} fill="currentColor" /> : <Pause size={13} />}
          <span>{isTimerPaused ? 'Resume Timer' : 'Pause Timer'}</span>
        </button>

        {/* Speed Multiplier Pill Group */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '2px',
            background: 'var(--bg-input)',
            padding: '3px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-subtle)'
          }}
          title="Adjust batch auction timer speed"
        >
          <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', padding: '0 6px', display: 'flex', alignItems: 'center', gap: '3px' }}>
            <Zap size={11} color="#fbbf24" /> Speed:
          </span>
          {speeds.map((s) => (
            <button
              key={s}
              onClick={() => onSetTimerSpeed(s)}
              className="btn"
              style={{
                padding: '3px 8px',
                fontSize: '0.6875rem',
                borderRadius: '4px',
                background: timerSpeed === s ? '#38bdf8' : 'transparent',
                color: timerSpeed === s ? '#0f172a' : 'var(--text-muted)',
                fontWeight: timerSpeed === s ? 700 : 500,
                border: 'none'
              }}
            >
              {s}x
            </button>
          ))}
        </div>

        {/* Inject Canonical Demo Orders */}
        <button
          onClick={onRunFullDemo}
          disabled={isDemoRunning}
          className="btn btn-demo"
          title="Inject canonical 6-order worked example from Spec 03 §17"
        >
          <Play size={14} fill="currentColor" />
          <span>{isDemoRunning ? 'Injecting Orders...' : 'Run 6-Order MEV Demo'}</span>
        </button>

        {/* Reset State */}
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
