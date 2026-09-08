import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { OrderForm } from './components/OrderForm';
import { CurrentBatchPanel } from './components/CurrentBatchPanel';
import { ClearingResultPanel } from './components/ClearingResultPanel';
import { SandwichComparisonModal } from './components/SandwichComparisonModal';
import { GasComparisonModal } from './components/GasComparisonModal';
import { DemoControlBar } from './components/DemoControlBar';
import type { OrderItem, FillItem, BatchState } from './types';

export const App: React.FC = () => {
  const [currentBatchId, setCurrentBatchId] = useState<number>(1);
  const [batchStatus, setBatchStatus] = useState<string>('OPEN');
  const [secondsRemaining, setSecondsRemaining] = useState<number>(45);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [lastClearedBatch, setLastClearedBatch] = useState<BatchState | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);

  const [isSandwichModalOpen, setIsSandwichModalOpen] = useState<boolean>(false);
  const [isGasModalOpen, setIsGasModalOpen] = useState<boolean>(false);
  const [isDemoRunning, setIsDemoRunning] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isClosingBatch, setIsClosingBatch] = useState<boolean>(false);

  // Countdown timer simulation
  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsRemaining((prev) => (prev > 1 ? prev - 1 : 45));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleConnectWallet = () => {
    if (!walletAddress) {
      setWalletAddress('0x71C...392A');
    } else {
      setWalletAddress(null);
    }
  };

  const handleSubmitOrder = async (isBuy: boolean, amount: number, limitPrice: number) => {
    setIsSubmitting(true);
    await new Promise((r) => setTimeout(r, 400));

    const newOrder: OrderItem = {
      id: orders.length + 1,
      trader: walletAddress || '0x71C...392A',
      isBuy,
      amount,
      limitPrice,
      batchId: currentBatchId,
      status: 'PENDING'
    };

    setOrders((prev) => [...prev, newOrder]);
    setIsSubmitting(false);
  };

  const handleCancelOrder = (orderId: number) => {
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, status: 'CANCELLED' } : o))
    );
  };

  // Run canonical Spec 03 §17 worked example
  const handleRunDemo = async () => {
    setIsDemoRunning(true);

    const demoOrders: OrderItem[] = [
      { id: 1, trader: '0x1111...1111', traderLabel: 'B1', isBuy: true, amount: 2.0, limitPrice: 3050, batchId: currentBatchId, status: 'PENDING' },
      { id: 2, trader: '0x2222...2222', traderLabel: 'B2', isBuy: true, amount: 1.0, limitPrice: 3020, batchId: currentBatchId, status: 'PENDING' },
      { id: 3, trader: '0x3333...3333', traderLabel: 'B3', isBuy: true, amount: 3.0, limitPrice: 2990, batchId: currentBatchId, status: 'PENDING' },
      { id: 4, trader: '0x4444...4444', traderLabel: 'S1', isBuy: false, amount: 1.5, limitPrice: 2980, batchId: currentBatchId, status: 'PENDING' },
      { id: 5, trader: '0x5555...5555', traderLabel: 'S2', isBuy: false, amount: 2.0, limitPrice: 3010, batchId: currentBatchId, status: 'PENDING' },
      { id: 6, trader: '0x6666...6666', traderLabel: 'S3', isBuy: false, amount: 1.0, limitPrice: 3040, batchId: currentBatchId, status: 'PENDING' }
    ];

    setOrders(demoOrders);
    await new Promise((r) => setTimeout(r, 600));
    setIsDemoRunning(false);
  };

  // Close batch & execute clearing
  const handleCloseBatchNow = async () => {
    setIsClosingBatch(true);
    setBatchStatus('CLEARING');

    await new Promise((r) => setTimeout(r, 800));

    // Spec 03 §17 solution:
    // P* = 3010
    // Fills: B1 (2.0), B2 (1.0), S1 (1.2857), S2 (1.7143)
    const pStar = 3010;
    const executedFills: FillItem[] = [
      { orderId: 1, trader: '0x1111...1111', traderLabel: 'B1', isBuy: true, filledAmount: 2.0, clearingPrice: pStar, quoteAmount: 6020.00 },
      { orderId: 2, trader: '0x2222...2222', traderLabel: 'B2', isBuy: true, filledAmount: 1.0, clearingPrice: pStar, quoteAmount: 3010.00 },
      { orderId: 4, trader: '0x4444...4444', traderLabel: 'S1', isBuy: false, filledAmount: 1.285714, clearingPrice: pStar, quoteAmount: 3870.00 },
      { orderId: 5, trader: '0x5555...5555', traderLabel: 'S2', isBuy: false, filledAmount: 1.714286, clearingPrice: pStar, quoteAmount: 5160.00 }
    ];

    setLastClearedBatch({
      id: currentBatchId,
      status: 'SETTLED',
      startTime: Date.now() - 45000,
      endTime: Date.now(),
      orderCount: orders.length,
      clearingPrice: pStar,
      fills: executedFills,
      totalVolume: 3.0
    });

    const nextBatch = currentBatchId + 1;
    setCurrentBatchId(nextBatch);
    setBatchStatus('OPEN');
    setSecondsRemaining(45);
    setIsClosingBatch(false);
  };

  const handleReset = () => {
    setCurrentBatchId(1);
    setBatchStatus('OPEN');
    setSecondsRemaining(45);
    setOrders([]);
    setLastClearedBatch(null);
  };

  return (
    <div className="app-container">
      {/* Navbar Header */}
      <Header
        currentBatchId={currentBatchId}
        batchStatus={batchStatus}
        onOpenSandwichModal={() => setIsSandwichModalOpen(true)}
        onOpenGasModal={() => setIsGasModalOpen(true)}
        onRunDemo={handleRunDemo}
        isDemoRunning={isDemoRunning}
        walletAddress={walletAddress}
        onConnectWallet={handleConnectWallet}
      />

      {/* Main Dashboard */}
      <main className="main-content">
        {/* Presenter Demo Controller */}
        <DemoControlBar
          onRunFullDemo={handleRunDemo}
          onCloseBatchNow={handleCloseBatchNow}
          onResetDemo={handleReset}
          isDemoRunning={isDemoRunning}
          currentBatchId={currentBatchId}
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
            orders={orders}
            onCancelOrder={handleCancelOrder}
            onCloseBatchNow={handleCloseBatchNow}
            isClosingBatch={isClosingBatch}
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
