import React from 'react';
import { Layers, ShieldCheck, Flame, Wallet, Server, Coins } from 'lucide-react';

interface HeaderProps {
  currentBatchId: number;
  batchStatus: string;
  onOpenSandwichModal: () => void;
  onOpenGasModal: () => void;
  walletAddress: string | null;
  onConnectWallet: () => void;
  isAnvilConnected: boolean;
  blockNumber: number;
  wethBalance: string;
  usdcBalance: string;
  onMintTokens: () => void;
  isMinting: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  currentBatchId,
  batchStatus,
  onOpenSandwichModal,
  onOpenGasModal,
  walletAddress,
  onConnectWallet,
  isAnvilConnected,
  blockNumber,
  wethBalance,
  usdcBalance,
  onMintTokens,
  isMinting
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

        {/* Pitch Triggers, Live On-Chain Node Pill, Faucet, and Wallet */}
        <div className="header-actions">
          {/* Node Status Pill */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '5px 10px',
              borderRadius: 'var(--radius-sm)',
              background: isAnvilConnected ? 'rgba(16, 185, 129, 0.12)' : 'rgba(56, 189, 248, 0.1)',
              border: `1px solid ${isAnvilConnected ? 'rgba(16, 185, 129, 0.3)' : 'rgba(56, 189, 248, 0.2)'}`,
              fontSize: '0.6875rem',
              fontWeight: 600,
              color: isAnvilConnected ? '#34d399' : '#38bdf8'
            }}
            title={isAnvilConnected ? 'Connected to local Anvil EVM (Chain ID 31337)' : 'Running in browser Stylus simulation mode'}
          >
            <Server size={13} />
            <span>{isAnvilConnected ? `Arbitrum Sepolia (#${blockNumber})` : 'Stylus Sim Mode'}</span>
          </div>

          {/* Trader Wallet Balance & Dev Faucet */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '5px 10px',
                background: 'var(--bg-input)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.6875rem',
                fontFamily: 'var(--font-mono)'
              }}
              title="Your testing wallet balance"
            >
              <span style={{ color: '#38bdf8', fontWeight: 600 }}>{parseFloat(wethBalance).toFixed(2)} WETH</span>
              <span style={{ color: 'var(--text-muted)' }}>|</span>
              <span style={{ color: '#34d399', fontWeight: 600 }}>${parseFloat(usdcBalance).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} USDC</span>
            </div>

            <button
              onClick={onMintTokens}
              disabled={isMinting}
              className="btn btn-ghost"
              style={{ padding: '5px 8px', fontSize: '0.6875rem', gap: '4px' }}
              title="Mint +100 WETH & +300k USDC to your testing wallet"
            >
              <Coins size={13} color="#fbbf24" />
              <span>{isMinting ? 'Minting...' : 'Faucet'}</span>
            </button>
          </div>

          {/* Value Proposition Presentation Modals */}
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
