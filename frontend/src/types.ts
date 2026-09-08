export interface OrderItem {
  id: number;
  trader: string;
  traderLabel?: string;
  isBuy: boolean;
  amount: number; // in WETH
  limitPrice: number; // in USDC
  batchId: number;
  status: 'PENDING' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'ROLLED';
  filledAmount?: number;
  rolledFromBatchId?: number;
}

export interface FillItem {
  orderId: number;
  trader: string;
  traderLabel?: string;
  isBuy: boolean;
  filledAmount: number; // in WETH
  clearingPrice: number; // in USDC
  quoteAmount: number; // in USDC
}

export interface BatchState {
  id: number;
  status: 'OPEN' | 'CLOSED' | 'CLEARING' | 'SETTLED';
  startTime: number;
  endTime: number;
  orderCount: number;
  clearingPrice?: number;
  fills?: FillItem[];
  totalVolume?: number;
}
