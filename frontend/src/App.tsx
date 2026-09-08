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
  
  // User wallet balances (base total and available calculated)
  const [baseWethBalance, setBaseWethBalance] = useState<number>(100.0);
  const [baseUsdcBalance, setBaseUsdcBalance] = useState<number>(300000.0);
  
  const [latestReceipt, setLatestReceipt] = useState<OnChainReceipt | null>(null);

  const [isSandwichModalOpen, setIsSandwichModalOpen] = useState<boolean>(false);
  const [isGasModalOpen, setIsGasModalOpen] = useState<boolean>(false);
  const [isDemoRunning, setIsDemoRunning] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isClosingBatch, setIsClosingBatch] = useState<boolean>(false);
  const [isMinting, setIsMinting] = useState<boolean>(false);

  const client = new OnChainClient();

  // Active trader address
  const activeTrader = walletAddress || '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

  // Calculate locked escrow across all active PENDING orders for the user
  const activePendingOrders = orders.filter(
    (o) => o.trader === activeTrader && o.status === 'PENDING'
  );
  const lockedWeth = activePendingOrders
    .filter((o) => !o.isBuy)
    .reduce((sum, o) => sum + o.amount, 0);
  const lockedUsdc = activePendingOrders
    .filter((o) => o.isBuy)
    .reduce((sum, o) => sum + o.amount * o.limitPrice, 0);

  const availableWeth = Math.max(0, baseWethBalance - lockedWeth);
  const availableUsdc = Math.max(0, baseUsdcBalance - lockedUsdc);

  // Refs for timer interval to avoid stale closures
  const ordersRef = useRef<OrderItem[]>(orders);
  ordersRef.current = orders;
  const currentBatchIdRef = useRef<number>(currentBatchId);
  currentBatchIdRef.current = currentBatchId;
  const isClosingBatchRef = useRef<boolean>(isClosingBatch);
  isClosingBatchRef.current = isClosingBatch;
  const isTimerPausedRef = useRef<boolean>(isTimerPaused);
  isTimerPausedRef.current = isTimerPaused;

  // Sync block number and chain health with Anvil
  const syncChainState = async () => {
    const isUp = await client.isChainAlive();
    setIsAnvilConnected(isUp);
    if (isUp) {
      try {
        const bNum = await client.getBlockNumber();
        setBlockNumber(bNum);
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

  // Initial balance load from chain on connect
  useEffect(() => {
    const fetchInitialBalances = async () => {
      if (isAnvilConnected) {
        try {
          const bals = await client.getBalances(activeTrader);
          const w = parseFloat(bals.weth);
          const u = parseFloat(bals.usdc);
          if (w > 0 || u > 0) {
            setBaseWethBalance(w);
            setBaseUsdcBalance(u);
          }
        } catch {
          // ignore
        }
      }
    };
    fetchInitialBalances();
  }, [isAnvilConnected, activeTrader]);

  // Dynamic batch countdown timer with auto-close when time expires and pause support
  useEffect(() => {
    if (isTimerPaused) return;

    const intervalMs = Math.max(100, Math.floor(1000 / timerSpeed));
    const timer = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
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

  // Mint faucet tokens (+100 WETH, +300,000 USDC)
  const handleMintTokens = async () => {
    setIsMinting(true);

    // Increment base balances immediately
    setBaseWethBalance((prev) => prev + 100);
    setBaseUsdcBalance((prev) => prev + 300000);

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

  // Submit order on chain + update escrow
  const handleSubmitOrder = async (isBuy: boolean, amount: number, limitPrice: number) => {
    setIsSubmitting(true);

    let assignedId = orders.length > 0 ? Math.max(...orders.map((o) => o.id)) + 1 : 1;

    if (isAnvilConnected) {
      try {
        const { orderId, receipt } = await client.submitOrder(isBuy, amount, limitPrice);
        assignedId = orderId;
        setLatestReceipt(receipt);
        await syncChainState();
      } catch (err) {
        console.warn('On-chain submit fallback to dynamic engine:', err);
      }
    }

    const newOrder: OrderItem = {
      id: assignedId,
      trader: activeTrader,
      isBuy,
      amount,
      limitPrice,
      batchId: currentBatchId,
      status: 'PENDING'
    };

    setOrders((prev) => [...prev, newOrder]);
    setIsSubmitting(false);
  };

  // Cancel order (escrow is automatically freed via activePendingOrders filter)
  const handleCancelOrder = async (orderId: number) => {
    if (isAnvilConnected) {
      try {
        const receipt = await client.cancelOrder(orderId);
        setLatestReceipt(receipt);
        await syncChainState();
      } catch (err) {
        console.warn('On-chain cancel fallback:', err);
      }
    }

    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, status: 'CANCELLED' } : o))
    );
  };

  // Inject canonical 6-order worked example
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

    // Apply settlement balance changes to base balances for active user fills
    let deltaWeth = 0;
    let deltaUsdc = 0;

    for (const fill of clearingResult.fills) {
      if (fill.trader === activeTrader) {
        if (fill.isBuy) {
          // Received bought WETH
          deltaWeth += fill.filledAmount;
          // Actual quote cost was fill.filledAmount * clearingPrice
          // (The locked amount was fill.filledAmount * limitPrice, which is released as order status changes from PENDING to FILLED)
          const actualCost = fill.filledAmount * fill.clearingPrice;
          deltaUsdc -= actualCost;
        } else {
          // Deduct sold WETH from base
          deltaWeth -= fill.filledAmount;
          // Receive quote USDC payout
          deltaUsdc += fill.quoteAmount;
        }
      }
    }

    if (deltaWeth !== 0 || deltaUsdc !== 0) {
      setBaseWethBalance((prev) => Math.max(0, prev + deltaWeth));
      setBaseUsdcBalance((prev) => Math.max(0, prev + deltaUsdc));
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
      {/* Navbar Header with Pitch Triggers, Live Node, Faucet & Available Balance */}
      <Header
        currentBatchId={currentBatchId}
        batchStatus={batchStatus}
        onOpenSandwichModal={() => setIsSandwichModalOpen(true)}
        onOpenGasModal={() => setIsGasModalOpen(true)}
        walletAddress={walletAddress}
        onConnectWallet={handleConnectWallet}
        isAnvilConnected={isAnvilConnected}
        blockNumber={blockNumber}
        wethBalance={availableWeth.toString()}
        usdcBalance={availableUsdc.toString()}
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
