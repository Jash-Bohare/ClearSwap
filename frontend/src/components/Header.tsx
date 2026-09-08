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
    <header className="app-header">
      <div className="header-inner">
        {/* Brand Logo & Tagline */}
        <div className="brand-section">
          <div className="brand-logo-badge">
            <Layers size={24} />
          </div>
          <div className="brand-title-group">
            <div className="brand-title-row">
              <span className="brand-name">ClearSwap</span>
              <span className="badge badge-blue">Stylus Engine</span>
            </div>
            <span className="brand-tagline">MEV-Resistant Batch Auction DEX</span>
          </div>
        </div>

        {/* Pitch Triggers, Live Batch Pill, and Wallet */}
        <div className="header-actions">
          <button
            onClick={onOpenSandwichModal}
            className="btn btn-danger-outline"
            title="Open Sandwich Attack Simulation & Comparison"
          >
            <ShieldCheck size={16} />
            <span>Sandwich Protection</span>
          </button>

          <button
            onClick={onOpenGasModal}
            className="btn btn-warning-outline"
            title="Open Stylus vs Solidity Gas Benchmark"
          >
            <Flame size={16} />
            <span>Gas Benchmark</span>
          </button>

          <button
            onClick={onRunDemo}
            disabled={isDemoRunning}
            className="btn btn-primary"
            title="Inject canonical 6-order worked example from Spec 03 §17"
          >
            <Play size={15} fill="currentColor" />
            <span>{isDemoRunning ? 'Injecting Orders...' : 'Run MEV Demo'}</span>
          </button>

          {/* Batch Status Pill */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingLeft: '8px', borderLeft: '1px solid var(--border-subtle)' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Batch #{currentBatchId}</span>
            <span className={`badge ${batchStatus === 'OPEN' ? 'badge-green' : batchStatus === 'CLEARING' ? 'badge-blue' : 'badge-gold'}`}>
              {batchStatus}
            </span>
          </div>

          {/* Connect Wallet */}
          <button onClick={onConnectWallet} className="btn btn-ghost">
            <Wallet size={15} color="#38bdf8" />
            <span className="font-mono">{walletAddress ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : 'Connect'}</span>
          </button>
        </div>
      </div>
    </header>
  );
};
