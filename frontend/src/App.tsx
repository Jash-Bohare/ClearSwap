import React, { useState, useEffect, useRef } from 'react';
import { Header } from './components/Header';
import { OrderForm } from './components/OrderForm';
import { CurrentBatchPanel } from './components/CurrentBatchPanel';
import { ClearingResultPanel } from './components/ClearingResultPanel';
import { SandwichComparisonModal } from './components/SandwichComparisonModal';
import { GasComparisonModal } from './components/GasComparisonModal';
import { DemoControlBar } from './components/DemoControlBar';
import { computeDynamicClearing } from './clearingEngine';
import { OnChainClient, type OnChainReceipt } from './onchainClient';
import type { OrderItem, BatchState } from './types';

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<string[]>;
    };
  }
}

export const App: React.FC = () => {
  const [currentBatchId, setCurrentBatchId] = useState<number>(1);
  const [batchStatus, setBatchStatus] = useState<string>('OPEN');
  const [secondsRemaining, setSecondsRemaining] = useState<number>(45);
  const [timerSpeed, setTimerSpeed] = useState<number>(1);
  const [isTimerPaused, setIsTimerPaused] = useState<boolean>(false);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [lastClearedBatch, setLastClearedBatch] = useState<BatchState | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);

  const [isAnvilConnected, setIsAnvilConnected] = useState<boolean>(false);
  const [blockNumber, setBlockNumber] = useState<number>(1);
  const [wethBalance, setWethBalance] = useState<string>('100.0');
  const [usdcBalance, setUsdcBalance] = useState<string>('300000.0');
  const [latestReceipt, setLatestReceipt] = useState<OnChainReceipt | null>(null);

  const [isSandwichModalOpen, setIsSandwichModalOpen] = useState<boolean>(false);
  const [isGasModalOpen, setIsGasModalOpen] = useState<boolean>(false);
  const [isDemoRunning, setIsDemoRunning] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isClosingBatch, setIsClosingBatch] = useState<boolean>(false);
  const [isMinting, setIsMinting] = useState<boolean>(false);

  const client = new OnChainClient();

  // Ref to hold current orders and batch id for auto-closing without stale closures
  const ordersRef = useRef<OrderItem[]>(orders);
  ordersRef.current = orders;
  const currentBatchIdRef = useRef<number>(currentBatchId);
  currentBatchIdRef.current = currentBatchId;
  const isClosingBatchRef = useRef<boolean>(isClosingBatch);
  isClosingBatchRef.current = isClosingBatch;
  const isTimerPausedRef = useRef<boolean>(isTimerPaused);
  isTimerPausedRef.current = isTimerPaused;

  // Sync with local Anvil chain
  const syncChainState = async () => {
    const isUp = await client.isChainAlive();
    setIsAnvilConnected(isUp);
    if (isUp) {
      try {
        const bNum = await client.getBlockNumber();
        setBlockNumber(bNum);
        const activeTrader = walletAddress || '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
        const bals = await client.getBalances(activeTrader);
        if (parseFloat(bals.weth) > 0 || parseFloat(bals.usdc) > 0) {
          setWethBalance(bals.weth);
          setUsdcBalance(bals.usdc);
        }
      } catch {
        // ignore
      }
    }
  };

  useEffect(() => {
    syncChainState();
    const interval = setInterval(syncChainState, 4000);
    return () => clearInterval(interval);
  }, [walletAddress]);

  // Dynamic batch countdown timer with auto-close when time expires and pause support
  useEffect(() => {
    if (isTimerPaused) return;

    const intervalMs = Math.max(100, Math.floor(1000 / timerSpeed));
    const timer = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          // Auto-trigger batch close
          if (!isClosingBatchRef.current) {
            handleCloseBatchNow();
          }
          return 45;
        }
        return prev - 1;
      });
    }, intervalMs);

    return () => clearInterval(timer);
  }, [timerSpeed, currentBatchId, isTimerPaused]);

  // Web3 Wallet Connect (MetaMask / EIP-1193) with fallback
  const handleConnectWallet = async () => {
    if (walletAddress) {
      setWalletAddress(null);
      return;
    }

    if (window.ethereum) {
      try {
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        if (accounts && accounts.length > 0) {
          setWalletAddress(accounts[0]);
          await syncChainState();
          return;
        }
      } catch {
        // Fallback
      }
    }

    // Default funded Anvil test account
    setWalletAddress('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
    await syncChainState();
  };

  // Mint faucet tokens
  const handleMintTokens = async () => {
    setIsMinting(true);
    const activeTrader = walletAddress || '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

    // Local balance increment
    setWethBalance((prev) => (parseFloat(prev) + 100).toFixed(2));
    setUsdcBalance((prev) => (parseFloat(prev) + 300000).toFixed(2));

    if (isAnvilConnected) {
      try {
        const receipt = await client.mintAndApprove(activeTrader);
        setLatestReceipt(receipt);
        await syncChainState();
      } catch (err) {
        console.warn('Faucet mint error on chain:', err);
      }
    }

    setIsMinting(false);
  };

  // Submit order on chain + update local escrow balances
  const handleSubmitOrder = async (isBuy: boolean, amount: number, limitPrice: number) => {
    setIsSubmitting(true);
    const traderAddr = walletAddress || '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

    // Escrow balance deduction: lock tokens for order
    if (isBuy) {
      const lockQuote = amount * limitPrice;
      setUsdcBalance((prev) => Math.max(0, parseFloat(prev) - lockQuote).toFixed(2));
    } else {
      setWethBalance((prev) => Math.max(0, parseFloat(prev) - amount).toFixed(4));
    }

    let assignedId = orders.length > 0 ? Math.max(...orders.map((o) => o.id)) + 1 : 1;

    if (isAnvilConnected) {
      try {
        const { orderId, receipt } = await client.submitOrder(isBuy, amount, limitPrice);
        assignedId = orderId;
        setLatestReceipt(receipt);
        await syncChainState();
      } catch (err) {
        console.warn('On-chain submit failed, using client simulation:', err);
      }
    }

    const newOrder: OrderItem = {
      id: assignedId,
      trader: traderAddr,
      isBuy,
      amount,
      limitPrice,
      batchId: currentBatchId,
      status: 'PENDING'
    };

    setOrders((prev) => [...prev, newOrder]);
    setIsSubmitting(false);
  };

  // Cancel order + refund escrowed balance
  const handleCancelOrder = async (orderId: number) => {
    const targetOrder = orders.find((o) => o.id === orderId);
    if (targetOrder && targetOrder.status === 'PENDING') {
      const activeTrader = walletAddress || '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
      if (targetOrder.trader === activeTrader) {
        // Refund locked tokens
        if (targetOrder.isBuy) {
          setUsdcBalance((prev) => (parseFloat(prev) + targetOrder.amount * targetOrder.limitPrice).toFixed(2));
        } else {
          setWethBalance((prev) => (parseFloat(prev) + targetOrder.amount).toFixed(4));
        }
      }
    }

    if (isAnvilConnected) {
      try {
        const receipt = await client.cancelOrder(orderId);
        setLatestReceipt(receipt);
        await syncChainState();
      } catch (err) {
        console.warn('On-chain cancel failed:', err);
      }
    }

    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, status: 'CANCELLED' } : o))
    );
  };

  // Inject canonical Spec 03 §17 worked example
  const handleRunDemo = async () => {
    setIsDemoRunning(true);

    const baseId = orders.length > 0 ? Math.max(...orders.map((o) => o.id)) : 0;
    const demoOrders: OrderItem[] = [
      { id: baseId + 1, trader: '0x1111...1111', traderLabel: 'B1', isBuy: true, amount: 2.0, limitPrice: 3050, batchId: currentBatchId, status: 'PENDING' },
      { id: baseId + 2, trader: '0x2222...2222', traderLabel: 'B2', isBuy: true, amount: 1.0, limitPrice: 3020, batchId: currentBatchId, status: 'PENDING' },
      { id: baseId + 3, trader: '0x3333...3333', traderLabel: 'B3', isBuy: true, amount: 3.0, limitPrice: 2990, batchId: currentBatchId, status: 'PENDING' },
      { id: baseId + 4, trader: '0x4444...4444', traderLabel: 'S1', isBuy: false, amount: 1.5, limitPrice: 2980, batchId: currentBatchId, status: 'PENDING' },
      { id: baseId + 5, trader: '0x5555...5555', traderLabel: 'S2', isBuy: false, amount: 2.0, limitPrice: 3010, batchId: currentBatchId, status: 'PENDING' },
      { id: baseId + 6, trader: '0x6666...6666', traderLabel: 'S3', isBuy: false, amount: 1.0, limitPrice: 3040, batchId: currentBatchId, status: 'PENDING' }
    ];

    setOrders((prev) => [...prev, ...demoOrders]);
    setIsDemoRunning(false);
  };

  // Dynamic clearing execution with on-chain EVM closeBatch call
  const handleCloseBatchNow = async () => {
    setIsClosingBatch(true);
    const activeBatch = currentBatchIdRef.current;
    const currentOrdersList = ordersRef.current;

    if (isAnvilConnected) {
      try {
        const { receipt } = await client.forwardTimeAndCloseBatch();
        setLatestReceipt(receipt);
        await syncChainState();
      } catch (err) {
        console.warn('On-chain closeBatch warning:', err);
      }
    }

    // Compute exact clearing results
    const clearingResult = computeDynamicClearing(currentOrdersList, activeBatch);

    // Settle trader wallet balances for filled orders of active user
    const activeTrader = walletAddress || '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
    for (const fill of clearingResult.fills) {
      if (fill.trader === activeTrader) {
        if (fill.isBuy) {
          // Received bought WETH
          setWethBalance((prev) => (parseFloat(prev) + fill.filledAmount).toFixed(4));
          // Refund price discount (bid limit - clearingPrice)
          const matchedOrder = currentOrdersList.find((o) => o.id === fill.orderId);
          if (matchedOrder && matchedOrder.limitPrice > fill.clearingPrice) {
            const savings = (matchedOrder.limitPrice - fill.clearingPrice) * fill.filledAmount;
            setUsdcBalance((prev) => (parseFloat(prev) + savings).toFixed(2));
          }
        } else {
          // Received quote payout USDC
          setUsdcBalance((prev) => (parseFloat(prev) + fill.quoteAmount).toFixed(2));
        }
      }
    }

    setLastClearedBatch({
      id: activeBatch,
      status: 'SETTLED',
      startTime: Date.now() - 45000,
      endTime: Date.now(),
      orderCount: currentOrdersList.filter((o) => o.batchId === activeBatch && o.status !== 'CANCELLED').length,
      clearingPrice: clearingResult.clearingPrice,
      fills: clearingResult.fills,
      totalVolume: clearingResult.totalVolume
    });

    const nextBatch = activeBatch + 1;

    setOrders([...clearingResult.updatedBatchOrders, ...clearingResult.rolledOrders]);
    setCurrentBatchId(nextBatch);
    setBatchStatus('OPEN');
    setSecondsRemaining(45);
    setIsClosingBatch(false);
  };

  const handleReset = () => {
    setCurrentBatchId(1);
    setBatchStatus('OPEN');
    setSecondsRemaining(45);
    setIsTimerPaused(false);
    setOrders([]);
    setLastClearedBatch(null);
    setLatestReceipt(null);
  };

  return (
    <div className="app-container">
      {/* Navbar Header with Pitch Triggers, Live Node, Faucet & Balance */}
      <Header
        currentBatchId={currentBatchId}
        batchStatus={batchStatus}
        onOpenSandwichModal={() => setIsSandwichModalOpen(true)}
        onOpenGasModal={() => setIsGasModalOpen(true)}
        walletAddress={walletAddress}
        onConnectWallet={handleConnectWallet}
        isAnvilConnected={isAnvilConnected}
        blockNumber={blockNumber}
        wethBalance={wethBalance}
        usdcBalance={usdcBalance}
        onMintTokens={handleMintTokens}
        isMinting={isMinting}
      />

      {/* Main Dashboard */}
      <main className="main-content">
        {/* Latest On-chain Tx Notice */}
        {latestReceipt && (
          <div
            style={{
              padding: '12px 18px',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(16, 185, 129, 0.08)',
              border: '1px solid rgba(16, 185, 129, 0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '0.75rem',
              flexWrap: 'wrap',
              gap: '8px'
            }}
          >
            <span style={{ color: '#6ee7b7', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>⛓️</span>
              <span>
                <strong>On-Chain Transaction Confirmed</strong> on Anvil Localhost (Block #{latestReceipt.blockNumber})
              </span>
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontFamily: 'var(--font-mono)', fontSize: '0.6875rem' }}>
              <span style={{ color: '#fbbf24' }}>Gas Used: {parseInt(latestReceipt.gasUsed).toLocaleString()}</span>
              <span style={{ color: '#94a3b8' }}>
                Tx: {latestReceipt.txHash.slice(0, 10)}...{latestReceipt.txHash.slice(-8)}
              </span>
            </div>
          </div>
        )}

        {/* Centralized Presenter Demo Controller */}
        <DemoControlBar
          onRunFullDemo={handleRunDemo}
          onResetDemo={handleReset}
          isDemoRunning={isDemoRunning}
          timerSpeed={timerSpeed}
          onSetTimerSpeed={setTimerSpeed}
          isTimerPaused={isTimerPaused}
          onToggleTimerPause={() => setIsTimerPaused((prev) => !prev)}
        />

        {/* Top Grid: Order Form (Screen 1) & Current Batch Live Book (Screen 2) */}
        <div className="grid-2col">
          <OrderForm
            currentBatchId={currentBatchId}
            onSubmitOrder={handleSubmitOrder}
            isSubmitting={isSubmitting}
          />
          <CurrentBatchPanel
            batchId={currentBatchId}
            batchStatus={batchStatus}
            secondsRemaining={secondsRemaining}
            timerSpeed={timerSpeed}
            isTimerPaused={isTimerPaused}
            orders={orders}
            onCancelOrder={handleCancelOrder}
          />
        </div>

        {/* Bottom Panel: Clearing & Settlement View (Screen 3 & 4) */}
        <ClearingResultPanel
          lastClearedBatch={lastClearedBatch}
          onOpenSandwichModal={() => setIsSandwichModalOpen(true)}
        />
      </main>

      {/* Pitch Modals */}
      <SandwichComparisonModal
        isOpen={isSandwichModalOpen}
        onClose={() => setIsSandwichModalOpen(false)}
        clearingPrice={lastClearedBatch?.clearingPrice || 3010}
      />

      <GasComparisonModal
        isOpen={isGasModalOpen}
        onClose={() => setIsGasModalOpen(false)}
      />
    </div>
  );
};

export default App;
