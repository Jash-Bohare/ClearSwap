import type { OrderItem, FillItem } from './types';

export interface DynamicClearingResult {
  clearingPrice: number;
  fills: FillItem[];
  totalVolume: number;
  updatedBatchOrders: OrderItem[];
  rolledOrders: OrderItem[];
}

export function computeDynamicClearing(
  orders: OrderItem[],
  currentBatchId: number
): DynamicClearingResult {
  const activeOrders = orders.filter(
    (o) => o.batchId === currentBatchId && o.status !== 'CANCELLED' && o.amount > 0
  );

  const buyOrders = activeOrders.filter((o) => o.isBuy);
  const sellOrders = activeOrders.filter((o) => !o.isBuy);

  // If one-sided or empty, return 0 clearing
  if (buyOrders.length === 0 || sellOrders.length === 0) {
    const rolledOrders: OrderItem[] = activeOrders.map((o, idx) => ({
      ...o,
      id: orders.length + idx + 1,
      batchId: currentBatchId + 1,
      status: 'PENDING',
      rolledFromBatchId: currentBatchId
    }));

    return {
      clearingPrice: 0,
      fills: [],
      totalVolume: 0,
      updatedBatchOrders: orders,
      rolledOrders
    };
  }

  // 1. Build sorted, deduplicated candidate price set
  const rawPrices = activeOrders.map((o) => Math.round(o.limitPrice * 100) / 100);
  const candidatePrices = Array.from(new Set(rawPrices)).sort((a, b) => a - b);

  // 2. Price sweep: compute BuyQty, SellQty, Volume, Imbalance per candidate price
  interface PriceMetrics {
    price: number;
    buyQty: number;
    sellQty: number;
    volume: number;
    imbalance: number;
  }

  const metrics: PriceMetrics[] = candidatePrices.map((price) => {
    // Buyers willing to pay >= price
    const buyQty = buyOrders
      .filter((b) => b.limitPrice >= price)
      .reduce((sum, b) => sum + b.amount, 0);

    // Sellers willing to accept <= price
    const sellQty = sellOrders
      .filter((s) => s.limitPrice <= price)
      .reduce((sum, s) => sum + s.amount, 0);

    const volume = Math.min(buyQty, sellQty);
    const imbalance = Math.abs(buyQty - sellQty);

    return { price, buyQty, sellQty, volume, imbalance };
  });

  // 3. Find max volume
  const maxVolume = Math.max(...metrics.map((m) => m.volume));

  if (maxVolume <= 0) {
    const rolledOrders: OrderItem[] = activeOrders.map((o, idx) => ({
      ...o,
      id: orders.length + idx + 1,
      batchId: currentBatchId + 1,
      status: 'PENDING',
      rolledFromBatchId: currentBatchId
    }));

    return {
      clearingPrice: 0,
      fills: [],
      totalVolume: 0,
      updatedBatchOrders: orders,
      rolledOrders
    };
  }

  // 4. Two-stage tie-breaker:
  // Step A: Filter by max volume
  const maxVolCandidates = metrics.filter((m) => Math.abs(m.volume - maxVolume) < 1e-9);

  // Step B: Filter by min imbalance
  const minImbalance = Math.min(...maxVolCandidates.map((m) => m.imbalance));
  const minImbalanceCandidates = maxVolCandidates.filter(
    (m) => Math.abs(m.imbalance - minImbalance) < 1e-9
  );

  // Step C: Lowest price
  const optimalMetric = minImbalanceCandidates.sort((a, b) => a.price - b.price)[0];
  const pStar = optimalMetric.price;

  // 5. Eligible orders at P*
  const eligibleBuys = buyOrders.filter((b) => b.limitPrice >= pStar);
  const eligibleSells = sellOrders.filter((s) => s.limitPrice <= pStar);

  const totalEligibleBuy = eligibleBuys.reduce((sum, b) => sum + b.amount, 0);
  const totalEligibleSell = eligibleSells.reduce((sum, s) => sum + s.amount, 0);

  const fills: FillItem[] = [];
  const updatedOrdersMap = new Map<number, OrderItem>();
  const nextRolled: OrderItem[] = [];
  let nextIdCounter = Math.max(...orders.map((o) => o.id), 0) + 1;

  // 6. Allocate Buy Fills
  if (totalEligibleBuy <= maxVolume + 1e-9) {
    // 100% filled
    for (const b of eligibleBuys) {
      const fillAmount = b.amount;
      fills.push({
        orderId: b.id,
        trader: b.trader,
        traderLabel: b.traderLabel,
        isBuy: true,
        filledAmount: fillAmount,
        clearingPrice: pStar,
        quoteAmount: Math.round(fillAmount * pStar * 100) / 100,
        limitPrice: b.limitPrice
      });
      updatedOrdersMap.set(b.id, { ...b, status: 'FILLED', filledAmount: fillAmount });
    }
  } else {
    // Pro-rata rationing on buy side
    for (const b of eligibleBuys) {
      const fillAmount = Math.floor(((b.amount * maxVolume) / totalEligibleBuy) * 1e6) / 1e6;
      const leftover = Math.round((b.amount - fillAmount) * 1e6) / 1e6;

      if (fillAmount > 0) {
        fills.push({
          orderId: b.id,
          trader: b.trader,
          traderLabel: b.traderLabel,
          isBuy: true,
          filledAmount: fillAmount,
          clearingPrice: pStar,
          quoteAmount: Math.round(fillAmount * pStar * 100) / 100,
          limitPrice: b.limitPrice
        });
        updatedOrdersMap.set(b.id, {
          ...b,
          status: leftover > 0 ? 'PARTIALLY_FILLED' : 'FILLED',
          filledAmount: fillAmount
        });
      }

      if (leftover > 0) {
        nextRolled.push({
          id: nextIdCounter++,
          trader: b.trader,
          traderLabel: b.traderLabel,
          isBuy: true,
          amount: leftover,
          limitPrice: b.limitPrice,
          batchId: currentBatchId + 1,
          status: 'PENDING',
          rolledFromBatchId: currentBatchId
        });
      }
    }
  }

  // 7. Allocate Sell Fills
  if (totalEligibleSell <= maxVolume + 1e-9) {
    // 100% filled
    for (const s of eligibleSells) {
      const fillAmount = s.amount;
      fills.push({
        orderId: s.id,
        trader: s.trader,
        traderLabel: s.traderLabel,
        isBuy: false,
        filledAmount: fillAmount,
        clearingPrice: pStar,
        quoteAmount: Math.round(fillAmount * pStar * 100) / 100,
        limitPrice: s.limitPrice
      });
      updatedOrdersMap.set(s.id, { ...s, status: 'FILLED', filledAmount: fillAmount });
    }
  } else {
    // Pro-rata rationing on sell side
    for (const s of eligibleSells) {
      const fillAmount = Math.floor(((s.amount * maxVolume) / totalEligibleSell) * 1e6) / 1e6;
      const leftover = Math.round((s.amount - fillAmount) * 1e6) / 1e6;

      if (fillAmount > 0) {
        fills.push({
          orderId: s.id,
          trader: s.trader,
          traderLabel: s.traderLabel,
          isBuy: false,
          filledAmount: fillAmount,
          clearingPrice: pStar,
          quoteAmount: Math.round(fillAmount * pStar * 100) / 100,
          limitPrice: s.limitPrice
        });
        updatedOrdersMap.set(s.id, {
          ...s,
          status: leftover > 0 ? 'PARTIALLY_FILLED' : 'FILLED',
          filledAmount: fillAmount
        });
      }

      if (leftover > 0) {
        nextRolled.push({
          id: nextIdCounter++,
          trader: s.trader,
          traderLabel: s.traderLabel,
          isBuy: false,
          amount: leftover,
          limitPrice: s.limitPrice,
          batchId: currentBatchId + 1,
          status: 'PENDING',
          rolledFromBatchId: currentBatchId
        });
      }
    }
  }

  // 8. Unmatched Orders (Buys with limit < P*, Sells with limit > P*) roll 100%
  const unmatchedBuys = buyOrders.filter((b) => b.limitPrice < pStar);
  for (const b of unmatchedBuys) {
    updatedOrdersMap.set(b.id, { ...b, status: 'PENDING', filledAmount: 0 });
    nextRolled.push({
      id: nextIdCounter++,
      trader: b.trader,
      traderLabel: b.traderLabel,
      isBuy: true,
      amount: b.amount,
      limitPrice: b.limitPrice,
      batchId: currentBatchId + 1,
      status: 'PENDING',
      rolledFromBatchId: currentBatchId
    });
  }

  const unmatchedSells = sellOrders.filter((s) => s.limitPrice > pStar);
  for (const s of unmatchedSells) {
    updatedOrdersMap.set(s.id, { ...s, status: 'PENDING', filledAmount: 0 });
    nextRolled.push({
      id: nextIdCounter++,
      trader: s.trader,
      traderLabel: s.traderLabel,
      isBuy: false,
      amount: s.amount,
      limitPrice: s.limitPrice,
      batchId: currentBatchId + 1,
      status: 'PENDING',
      rolledFromBatchId: currentBatchId
    });
  }

  // Update existing orders array
  const finalUpdatedBatchOrders = orders.map((o) => {
    if (updatedOrdersMap.has(o.id)) {
      return updatedOrdersMap.get(o.id)!;
    }
    return o;
  });

  return {
    clearingPrice: pStar,
    fills,
    totalVolume: maxVolume,
    updatedBatchOrders: finalUpdatedBatchOrders,
    rolledOrders: nextRolled
  };
}
