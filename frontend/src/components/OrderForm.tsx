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
      setError('Order quantity must be strictly greater than 0');
      return;
    }
    if (isNaN(numPrice) || numPrice <= 0) {
      setError('Limit price must be strictly greater than 0');
      return;
    }

    try {
      await onSubmitOrder(isBuy, numAmount, numPrice);
      setSuccessMsg(`Order successfully submitted to Batch #${currentBatchId}`);
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
    <div className="glass-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h3>Submit Batch Order</h3>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Non-prefunded • Protected from sandwich extraction</p>
        </div>
        <span className="badge badge-blue">Batch #{currentBatchId}</span>
      </div>

      {/* Side Selector (BUY vs SELL) */}
      <div className="side-toggle-group">
        <button
          type="button"
          onClick={() => setIsBuy(true)}
          className={`side-toggle-btn ${isBuy ? 'active-buy' : ''}`}
        >
          <ArrowDown size={15} />
          <span>Buy WETH</span>
        </button>
        <button
          type="button"
          onClick={() => setIsBuy(false)}
          className={`side-toggle-btn ${!isBuy ? 'active-sell' : ''}`}
        >
          <ArrowUp size={15} />
          <span>Sell WETH</span>
        </button>
      </div>

      <form onSubmit={handleSubmit}>
        {/* Quantity Field */}
        <div className="form-group">
          <div className="form-label-row">
            <span>Order Quantity</span>
            <span>Token: WETH</span>
          </div>
          <div className="input-container">
            <input
              type="number"
              step="any"
              min="0.0001"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.0"
              className="form-input"
              required
            />
            <span className="input-token-suffix">WETH</span>
          </div>
        </div>

        {/* Limit Price Field */}
        <div className="form-group">
          <div className="form-label-row">
            <span>Limit Price ({isBuy ? 'Maximum' : 'Minimum'})</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Info size={12} color="#38bdf8" />
              <span>USDC per WETH</span>
            </span>
          </div>
          <div className="input-container">
            <input
              type="number"
              step="any"
              min="0.01"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              placeholder="3000"
              className="form-input"
              required
            />
            <span className="input-token-suffix">USDC</span>
          </div>
        </div>

        {/* Price Presets */}
        <div className="preset-pills">
          {[2980, 3010, 3020, 3050].map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setLimitPrice(p.toString())}
              className="preset-pill-btn"
            >
              ${p}
            </button>
          ))}
        </div>

        {/* Receipt Box */}
        <div className="receipt-box">
          <div className="receipt-row">
            <span>Order Type</span>
            <span style={{ color: '#ffffff', fontWeight: 600 }}>{isBuy ? 'Limit Buy' : 'Limit Sell'}</span>
          </div>
          <div className="receipt-row">
            <span>Target Batch</span>
            <span className="font-mono" style={{ color: '#38bdf8', fontWeight: 700 }}>Batch #{currentBatchId}</span>
          </div>
          <div className="receipt-row total-row">
            <span>Estimated Total</span>
            <span className="font-mono" style={{ fontSize: '0.875rem' }}>${estimatedTotal} USDC</span>
          </div>
        </div>

        {/* Alerts */}
        {error && (
          <div className="alert-notice alert-danger">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="alert-notice alert-success">
            <CheckCircle2 size={16} />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Submit Action */}
        <button
          type="submit"
          disabled={isSubmitting}
          className={`btn ${isBuy ? 'btn-buy' : 'btn-sell'}`}
          style={{ width: '100%', padding: '14px', fontSize: '0.875rem' }}
        >
          {isSubmitting
            ? 'Submitting Order...'
            : isBuy
            ? `Buy ${amount || '0'} WETH`
            : `Sell ${amount || '0'} WETH`}
        </button>
      </form>
    </div>
  );
};
