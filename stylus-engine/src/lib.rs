#![cfg_attr(not(any(feature = "export-abi", test)), no_main)]
extern crate alloc;

use alloc::vec;
use alloc::vec::Vec;
use alloy_primitives::U256;
use stylus_sdk::prelude::*;

pub mod types;
use types::{ClearingResult, Fill, Order};

#[storage]
#[entrypoint]
pub struct ClearingEngine;

#[public]
impl ClearingEngine {
    /// Computes the uniform clearing price P* and executed fills for a closed batch.
    /// Pure computation with no storage reads or writes.
    pub fn compute_clearing(&self, orders: Vec<Order>) -> Result<ClearingResult, Vec<u8>> {
        solve_clearing(&orders)
    }
}

/// Core discrete clearing engine algorithm (Spec 03 Section 7-10, Spec 05 Section 4-7).
///
/// Implements:
/// 1. Validation and Defensive Reverts (Spec 05 Section 7)
/// 2. Candidate Price Set Construction via sorted, deduplicated Vec (Spec 05 Section 4 step 3, Section 5)
/// 3. Price Sweep: BuyQty, SellQty, Volume, Imbalance (Spec 05 Section 4 step 4)
/// 4. P* Selection: argmax Volume -> min Imbalance -> min Price (Spec 05 Section 4 step 5, Spec 03 Section 8)
/// 5. Fill Allocation: Exact match or Pro-rata rationing with ascending-orderId remainder distribution (Spec 05 Section 4 steps 6-7, Spec 03 Section 10)
pub fn solve_clearing(orders: &[Order]) -> Result<ClearingResult, Vec<u8>> {
    // Empty batch returns zero clearing price and empty fills (Spec 05 Section 7, Spec 03 Section 13)
    if orders.is_empty() {
        return Ok(ClearingResult {
            batchId: U256::ZERO,
            clearingPrice: U256::ZERO,
            fills: Vec::new(),
        });
    }

    let batch_id = orders[0].batchId;

    // Step 1: Validation & Defensive checks (Spec 05 Section 7)
    for order in orders {
        if order.batchId != batch_id {
            return Err(b"Mixed batch IDs in clearing request".to_vec());
        }
        if order.amount.is_zero() {
            return Err(b"Order amount cannot be zero".to_vec());
        }
    }

    // Step 2: Build candidate price set (Spec 05 Section 4 step 3, Section 5)
    // Hard rule: sorted Vec, deduplicated, never HashMap or HashSet.
    let mut candidate_prices: Vec<U256> = orders.iter().map(|o| o.limitPrice).collect();
    candidate_prices.sort_unstable();
    candidate_prices.dedup();

    // Step 3: Price sweep across candidate prices (Spec 05 Section 4 step 4)
    struct CandidateEvaluation {
        price: U256,
        volume: U256,
        imbalance: U256,
    }

    let mut evaluations: Vec<CandidateEvaluation> = Vec::with_capacity(candidate_prices.len());

    for &p in &candidate_prices {
        let mut buy_qty = U256::ZERO;
        let mut sell_qty = U256::ZERO;

        for o in orders {
            if o.isBuy {
                if o.limitPrice >= p {
                    buy_qty = buy_qty
                        .checked_add(o.amount)
                        .ok_or_else(|| b"Arithmetic overflow in buy quantity sum".to_vec())?;
                }
            } else {
                if o.limitPrice <= p {
                    sell_qty = sell_qty
                        .checked_add(o.amount)
                        .ok_or_else(|| b"Arithmetic overflow in sell quantity sum".to_vec())?;
                }
            }
        }

        let volume = if buy_qty < sell_qty { buy_qty } else { sell_qty };
        let imbalance = if buy_qty >= sell_qty {
            buy_qty - sell_qty
        } else {
            sell_qty - buy_qty
        };

        evaluations.push(CandidateEvaluation {
            price: p,
            volume,
            imbalance,
        });
    }

    // Step 4: Optimal price P* selection (Spec 05 Section 4 step 5, Spec 03 Section 8)
    // Rules:
    // 1. Maximize Volume
    // 2. Tie-break 1: Minimize Imbalance
    // 3. Tie-break 2: Lowest Price
    let mut best_eval: Option<&CandidateEvaluation> = None;

    for candidate in &evaluations {
        if candidate.volume.is_zero() {
            continue;
        }

        match best_eval {
            None => {
                best_eval = Some(candidate);
            }
            Some(current_best) => {
                if candidate.volume > current_best.volume {
                    best_eval = Some(candidate);
                } else if candidate.volume == current_best.volume {
                    if candidate.imbalance < current_best.imbalance {
                        best_eval = Some(candidate);
                    } else if candidate.imbalance == current_best.imbalance {
                        if candidate.price < current_best.price {
                            best_eval = Some(candidate);
                        }
                    }
                }
            }
        }
    }

    let optimal_eval = match best_eval {
        Some(ev) => ev,
        None => {
            // No price with Volume > 0 (Spec 03 Section 13)
            return Ok(ClearingResult {
                batchId: batch_id,
                clearingPrice: U256::ZERO,
                fills: Vec::new(),
            });
        }
    };

    let p_star = optimal_eval.price;
    let v_star = optimal_eval.volume;

    // Step 5: Eligibility determination (Spec 05 Section 4 step 6, Spec 03 Section 9)
    let eligible_buys: Vec<&Order> = orders
        .iter()
        .filter(|o| o.isBuy && o.limitPrice >= p_star)
        .collect();

    let eligible_sells: Vec<&Order> = orders
        .iter()
        .filter(|o| !o.isBuy && o.limitPrice <= p_star)
        .collect();

    let mut eligible_buy_qty = U256::ZERO;
    for b in &eligible_buys {
        eligible_buy_qty = eligible_buy_qty
            .checked_add(b.amount)
            .ok_or_else(|| b"Arithmetic overflow in eligible buy sum".to_vec())?;
    }

    let mut eligible_sell_qty = U256::ZERO;
    for s in &eligible_sells {
        eligible_sell_qty = eligible_sell_qty
            .checked_add(s.amount)
            .ok_or_else(|| b"Arithmetic overflow in eligible sell sum".to_vec())?;
    }

    // Step 6: Fill Allocation & Pro-Rata Rationing (Spec 05 Section 4 step 7, Spec 03 Section 10)
    let mut fills: Vec<Fill> = Vec::new();

    // Helper structure for pro-rata rationing allocation
    struct AllocationEntry<'a> {
        order: &'a Order,
        final_fill: U256,
    }

    // Allocate Buys
    let buy_allocations: Vec<AllocationEntry> = if eligible_buy_qty == v_star {
        // Exact match: 100% fill
        eligible_buys
            .into_iter()
            .map(|o| AllocationEntry {
                order: o,
                final_fill: o.amount,
            })
            .collect()
    } else {
        // Excess side: Pro-rata allocation
        let mut entries: Vec<AllocationEntry> = Vec::with_capacity(eligible_buys.len());
        let mut sum_raw_fills = U256::ZERO;

        for &o in &eligible_buys {
            // rawFill_i = amount_i * V / EligibleQty (multiplication before division)
            let numerator = o
                .amount
                .checked_mul(v_star)
                .ok_or_else(|| b"Arithmetic overflow in buy pro-rata numerator".to_vec())?;
            let raw_fill = numerator / eligible_buy_qty;
            sum_raw_fills = sum_raw_fills
                .checked_add(raw_fill)
                .ok_or_else(|| b"Arithmetic overflow in raw buy fill sum".to_vec())?;

            entries.push(AllocationEntry {
                order: o,
                final_fill: raw_fill,
            });
        }

        let remainder = v_star
            .checked_sub(sum_raw_fills)
            .ok_or_else(|| b"Raw fill sum exceeds cleared volume".to_vec())?;

        // Sort ascending by order.id for deterministic remainder distribution
        entries.sort_by(|a, b| a.order.id.cmp(&b.order.id));

        let r_u64: u64 = remainder.try_into().map_err(|_| {
            b"Remainder allocation exceeds u64 bounds".to_vec()
        })?;

        for i in 0..(r_u64 as usize) {
            if i < entries.len() {
                entries[i].final_fill = entries[i]
                    .final_fill
                    .checked_add(U256::from(1))
                    .ok_or_else(|| b"Arithmetic overflow in remainder distribution".to_vec())?;
            }
        }

        entries
    };

    // Allocate Sells
    let sell_allocations: Vec<AllocationEntry> = if eligible_sell_qty == v_star {
        // Exact match: 100% fill
        eligible_sells
            .into_iter()
            .map(|o| AllocationEntry {
                order: o,
                final_fill: o.amount,
            })
            .collect()
    } else {
        // Excess side: Pro-rata allocation
        let mut entries: Vec<AllocationEntry> = Vec::with_capacity(eligible_sells.len());
        let mut sum_raw_fills = U256::ZERO;

        for &o in &eligible_sells {
            // rawFill_i = amount_i * V / EligibleQty (multiplication before division)
            let numerator = o
                .amount
                .checked_mul(v_star)
                .ok_or_else(|| b"Arithmetic overflow in sell pro-rata numerator".to_vec())?;
            let raw_fill = numerator / eligible_sell_qty;
            sum_raw_fills = sum_raw_fills
                .checked_add(raw_fill)
                .ok_or_else(|| b"Arithmetic overflow in raw sell fill sum".to_vec())?;

            entries.push(AllocationEntry {
                order: o,
                final_fill: raw_fill,
            });
        }

        let remainder = v_star
            .checked_sub(sum_raw_fills)
            .ok_or_else(|| b"Raw fill sum exceeds cleared volume".to_vec())?;

        // Sort ascending by order.id for deterministic remainder distribution
        entries.sort_by(|a, b| a.order.id.cmp(&b.order.id));

        let r_u64: u64 = remainder.try_into().map_err(|_| {
            b"Remainder allocation exceeds u64 bounds".to_vec()
        })?;

        for i in 0..(r_u64 as usize) {
            if i < entries.len() {
                entries[i].final_fill = entries[i]
                    .final_fill
                    .checked_add(U256::from(1))
                    .ok_or_else(|| b"Arithmetic overflow in remainder distribution".to_vec())?;
            }
        }

        entries
    };

    // Collect all fills with filledAmount > 0
    for alloc in buy_allocations {
        if !alloc.final_fill.is_zero() {
            fills.push(Fill {
                orderId: alloc.order.id,
                trader: alloc.order.trader,
                isBuy: true,
                filledAmount: alloc.final_fill,
                clearingPrice: p_star,
            });
        }
    }

    for alloc in sell_allocations {
        if !alloc.final_fill.is_zero() {
            fills.push(Fill {
                orderId: alloc.order.id,
                trader: alloc.order.trader,
                isBuy: false,
                filledAmount: alloc.final_fill,
                clearingPrice: p_star,
            });
        }
    }

    Ok(ClearingResult {
        batchId: batch_id,
        clearingPrice: p_star,
        fills,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy_primitives::{address, Address, U256};

    fn make_order(
        id: u64,
        trader: Address,
        is_buy: bool,
        amount: U256,
        limit_price: U256,
        batch_id: u64,
    ) -> Order {
        Order {
            id: U256::from(id),
            trader,
            isBuy: is_buy,
            amount,
            limitPrice: limit_price,
            batchId: U256::from(batch_id),
            status: 0,
        }
    }

    fn to_weth(amount_f64: f64) -> U256 {
        let wei = (amount_f64 * 1e18) as u128;
        U256::from(wei)
    }

    /// 1. test_worked_example_matches_spec() (Case 2 / Spec 03 Section 17, Spec 07 Section 2 Case 2)
    /// Ground-truth test fixture that must pass exactly before anything else.
    #[test]
    fn test_worked_example_matches_spec() {
        let t1 = address!("1111111111111111111111111111111111111111");
        let t2 = address!("2222222222222222222222222222222222222222");
        let t3 = address!("3333333333333333333333333333333333333333");
        let t4 = address!("4444444444444444444444444444444444444444");
        let t5 = address!("5555555555555555555555555555555555555555");
        let t6 = address!("6666666666666666666666666666666666666666");

        // Batch:
        // B1: Buy 2.0 WETH @ 3050, id=1
        // B2: Buy 1.0 WETH @ 3020, id=2
        // B3: Buy 3.0 WETH @ 2990, id=3
        // S1: Sell 1.5 WETH @ 2980, id=4
        // S2: Sell 2.0 WETH @ 3010, id=5
        // S3: Sell 1.0 WETH @ 3040, id=6
        let orders = vec![
            make_order(1, t1, true, to_weth(2.0), U256::from(3050), 1),
            make_order(2, t2, true, to_weth(1.0), U256::from(3020), 1),
            make_order(3, t3, true, to_weth(3.0), U256::from(2990), 1),
            make_order(4, t4, false, to_weth(1.5), U256::from(2980), 1),
            make_order(5, t5, false, to_weth(2.0), U256::from(3010), 1),
            make_order(6, t6, false, to_weth(1.0), U256::from(3040), 1),
        ];

        let res = solve_clearing(&orders).expect("Clearing should succeed");

        // P* = 3010
        assert_eq!(res.clearingPrice, U256::from(3010), "P* must be 3010");
        assert_eq!(res.batchId, U256::from(1));

        // Exact expected fills:
        // B1 fills 2.0 WETH (2000000000000000000)
        // B2 fills 1.0 WETH (1000000000000000000)
        // S1 fills 1.285714285714285715 WETH (1285714285714285715)
        // S2 fills 1.714285714285714285 WETH (1714285714285714285)
        // B3 and S3 do not appear in fills.
        assert_eq!(res.fills.len(), 4, "Only 4 eligible orders should fill");

        let fill_b1 = res.fills.iter().find(|f| f.orderId == U256::from(1)).expect("B1 must fill");
        assert_eq!(fill_b1.filledAmount, to_weth(2.0));
        assert_eq!(fill_b1.clearingPrice, U256::from(3010));
        assert!(fill_b1.isBuy);

        let fill_b2 = res.fills.iter().find(|f| f.orderId == U256::from(2)).expect("B2 must fill");
        assert_eq!(fill_b2.filledAmount, to_weth(1.0));
        assert_eq!(fill_b2.clearingPrice, U256::from(3010));
        assert!(fill_b2.isBuy);

        let fill_s1 = res.fills.iter().find(|f| f.orderId == U256::from(4)).expect("S1 must fill");
        assert_eq!(
            fill_s1.filledAmount,
            U256::from(1285714285714285715u128),
            "S1 gets pro-rata + 1 wei remainder"
        );
        assert_eq!(fill_s1.clearingPrice, U256::from(3010));
        assert!(!fill_s1.isBuy);

        let fill_s2 = res.fills.iter().find(|f| f.orderId == U256::from(5)).expect("S2 must fill");
        assert_eq!(
            fill_s2.filledAmount,
            U256::from(1714285714285714285u128),
            "S2 gets pro-rata"
        );
        assert_eq!(fill_s2.clearingPrice, U256::from(3010));
        assert!(!fill_s2.isBuy);

        assert!(res.fills.iter().find(|f| f.orderId == U256::from(3)).is_none(), "B3 must not fill");
        assert!(res.fills.iter().find(|f| f.orderId == U256::from(6)).is_none(), "S3 must not fill");
    }

    /// 2. test_empty_batch_returns_zero_result()
    #[test]
    fn test_empty_batch_returns_zero_result() {
        let orders: Vec<Order> = Vec::new();
        let res = solve_clearing(&orders).expect("Empty batch is valid");
        assert_eq!(res.clearingPrice, U256::ZERO);
        assert!(res.fills.is_empty());
    }

    /// 3. test_one_sided_batch_returns_zero_result() (Case 3 & Case 4)
    #[test]
    fn test_one_sided_batch_returns_zero_result() {
        let t1 = address!("1111111111111111111111111111111111111111");
        let t2 = address!("2222222222222222222222222222222222222222");

        // Case 3: Only Buys
        let buy_only = vec![
            make_order(1, t1, true, to_weth(1.0), U256::from(3000), 1),
            make_order(2, t2, true, to_weth(2.0), U256::from(3050), 1),
        ];
        let res_buys = solve_clearing(&buy_only).expect("Buy-only batch is valid");
        assert_eq!(res_buys.clearingPrice, U256::ZERO);
        assert!(res_buys.fills.is_empty());

        // Case 4: Only Sells
        let sell_only = vec![
            make_order(1, t1, false, to_weth(1.0), U256::from(3000), 1),
            make_order(2, t2, false, to_weth(2.0), U256::from(2950), 1),
        ];
        let res_sells = solve_clearing(&sell_only).expect("Sell-only batch is valid");
        assert_eq!(res_sells.clearingPrice, U256::ZERO);
        assert!(res_sells.fills.is_empty());
    }

    /// 4. test_exact_match_no_rationing() (Case 1)
    #[test]
    fn test_exact_match_no_rationing() {
        let t1 = address!("1111111111111111111111111111111111111111");
        let t2 = address!("2222222222222222222222222222222222222222");

        // B1: Buy 2.0 @ 3000
        // S1: Sell 2.0 @ 3000
        let orders = vec![
            make_order(1, t1, true, to_weth(2.0), U256::from(3000), 1),
            make_order(2, t2, false, to_weth(2.0), U256::from(3000), 1),
        ];

        let res = solve_clearing(&orders).expect("Exact match should succeed");
        assert_eq!(res.clearingPrice, U256::from(3000));
        assert_eq!(res.fills.len(), 2);

        let fill_b1 = res.fills.iter().find(|f| f.orderId == U256::from(1)).unwrap();
        assert_eq!(fill_b1.filledAmount, to_weth(2.0));
        assert_eq!(fill_b1.clearingPrice, U256::from(3000));

        let fill_s1 = res.fills.iter().find(|f| f.orderId == U256::from(2)).unwrap();
        assert_eq!(fill_s1.filledAmount, to_weth(2.0));
        assert_eq!(fill_s1.clearingPrice, U256::from(3000));
    }

    /// 5. test_tie_break_minimizes_imbalance_then_lowest_price() (Case 5)
    #[test]
    fn test_tie_break_minimizes_imbalance_then_lowest_price() {
        let t1 = address!("1111111111111111111111111111111111111111");
        let t2 = address!("2222222222222222222222222222222222222222");
        let t3 = address!("3333333333333333333333333333333333333333");
        let t4 = address!("4444444444444444444444444444444444444444");

        // B1: BUY 1.0 @ 3050, id=1
        // B2: BUY 1.0 @ 3000, id=2
        // S1: SELL 1.0 @ 2990, id=3
        // S2: SELL 1.0 @ 3010, id=4
        // All candidates (2990, 3000, 3010, 3050) have Volume=1.0, Imbalance=1.0.
        // Lowest price 2990 wins.
        let orders = vec![
            make_order(1, t1, true, to_weth(1.0), U256::from(3050), 1),
            make_order(2, t2, true, to_weth(1.0), U256::from(3000), 1),
            make_order(3, t3, false, to_weth(1.0), U256::from(2990), 1),
            make_order(4, t4, false, to_weth(1.0), U256::from(3010), 1),
        ];

        let res = solve_clearing(&orders).expect("Tie break should solve");
        assert_eq!(res.clearingPrice, U256::from(2990), "Tie-break 2: lowest price wins");

        // At P*=2990:
        // Eligible buys: B1 (3050), B2 (3000) -> total 2.0
        // Eligible sells: S1 (2990) -> total 1.0
        // V = 1.0
        // S1 fully fills 1.0
        // B1 fills 0.5, B2 fills 0.5 (even split, no remainder)
        assert_eq!(res.fills.len(), 3);

        let fill_s1 = res.fills.iter().find(|f| f.orderId == U256::from(3)).unwrap();
        assert_eq!(fill_s1.filledAmount, to_weth(1.0));

        let fill_b1 = res.fills.iter().find(|f| f.orderId == U256::from(1)).unwrap();
        assert_eq!(fill_b1.filledAmount, to_weth(0.5));

        let fill_b2 = res.fills.iter().find(|f| f.orderId == U256::from(2)).unwrap();
        assert_eq!(fill_b2.filledAmount, to_weth(0.5));
    }

    /// 6. test_determinism_repeated_calls()
    #[test]
    fn test_determinism_repeated_calls() {
        let t1 = address!("1111111111111111111111111111111111111111");
        let t2 = address!("2222222222222222222222222222222222222222");
        let t3 = address!("3333333333333333333333333333333333333333");
        let t4 = address!("4444444444444444444444444444444444444444");

        let orders = vec![
            make_order(1, t1, true, to_weth(2.5), U256::from(3050), 10),
            make_order(2, t2, true, to_weth(1.5), U256::from(3020), 10),
            make_order(3, t3, false, to_weth(2.0), U256::from(2980), 10),
            make_order(4, t4, false, to_weth(3.0), U256::from(3010), 10),
        ];

        let res1 = solve_clearing(&orders).expect("Call 1 should succeed");
        let res2 = solve_clearing(&orders).expect("Call 2 should succeed");

        assert_eq!(res1.clearingPrice, res2.clearingPrice);
        assert_eq!(res1.batchId, res2.batchId);
        assert_eq!(res1.fills.len(), res2.fills.len());

        for (f1, f2) in res1.fills.iter().zip(res2.fills.iter()) {
            assert_eq!(f1.orderId, f2.orderId);
            assert_eq!(f1.trader, f2.trader);
            assert_eq!(f1.isBuy, f2.isBuy);
            assert_eq!(f1.filledAmount, f2.filledAmount);
            assert_eq!(f1.clearingPrice, f2.clearingPrice);
        }
    }

    /// 7. test_rejects_mixed_batch_ids()
    #[test]
    fn test_rejects_mixed_batch_ids() {
        let t1 = address!("1111111111111111111111111111111111111111");
        let t2 = address!("2222222222222222222222222222222222222222");

        let orders = vec![
            make_order(1, t1, true, to_weth(1.0), U256::from(3000), 1),
            make_order(2, t2, false, to_weth(1.0), U256::from(3000), 2), // Mixed batchId=2
        ];

        let res = solve_clearing(&orders);
        assert!(res.is_err(), "Must revert on mixed batch IDs");
    }

    /// 8. test_overflow_reverts_not_wraps()
    #[test]
    fn test_overflow_reverts_not_wraps() {
        let t1 = address!("1111111111111111111111111111111111111111");
        let t2 = address!("2222222222222222222222222222222222222222");

        // Construct orders with amounts near U256::MAX to trigger overflow in arithmetic
        let orders = vec![
            make_order(1, t1, true, U256::MAX, U256::from(3000), 1),
            make_order(2, t2, true, U256::MAX, U256::from(3000), 1),
            make_order(3, t1, false, to_weth(1.0), U256::from(2900), 1),
        ];

        let res = solve_clearing(&orders);
        assert!(res.is_err(), "Must revert on U256 overflow during buy sum");
    }
}
