//! ClearSwap Stylus Clearing Engine entry point (Spec 05)
#![cfg_attr(not(any(feature = "export-abi", test)), no_main)]
extern crate alloc;

pub mod types;

use alloc::vec::Vec;
use alloy_primitives::U256;
use stylus_sdk::prelude::*;
use crate::types::{Order, ClearingResult};

sol_storage! {
    #[entrypoint]
    pub struct ClearingEngine {}
}

/// Pure calculation function for clearing auction (Spec 05)
pub fn solve_clearing(orders: &[Order]) -> Result<ClearingResult, Vec<u8>> {
    if orders.is_empty() {
        return Ok(ClearingResult {
            batchId: U256::ZERO,
            clearingPrice: U256::ZERO,
            fills: Vec::new(),
        });
    }

    let batch_id = orders[0].batchId;
    // Defensive check: verify all orders share the same batch_id (Spec 05 §7)
    for o in orders {
        if o.batchId != batch_id {
            return Err(b"Mixed batch IDs in order set".to_vec());
        }
        if o.amount == U256::ZERO {
            return Err(b"Order amount cannot be zero".to_vec());
        }
    }

    // Stub implementation for Phase 0 scaffolding: returns empty fills
    Ok(ClearingResult {
        batchId: batch_id,
        clearingPrice: U256::ZERO,
        fills: Vec::new(),
    })
}

#[public]
impl ClearingEngine {
    /// Computes the uniform clearing price and fill allocations for a batch of orders.
    /// External entrypoint matching `04 §7` and `05 §10`.
    pub fn compute_clearing(&self, orders: Vec<Order>) -> Result<ClearingResult, Vec<u8>> {
        solve_clearing(&orders)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy_primitives::Address;

    #[test]
    fn test_empty_orders_returns_zero_result() {
        let res = solve_clearing(&[]).expect("should succeed");
        assert_eq!(res.batchId, U256::ZERO);
        assert_eq!(res.clearingPrice, U256::ZERO);
        assert!(res.fills.is_empty());
    }

    #[test]
    fn test_mixed_batches_revert() {
        let o1 = Order {
            id: U256::from(1),
            trader: Address::ZERO,
            isBuy: true,
            amount: U256::from(1_000_000),
            limitPrice: U256::from(3000),
            batchId: U256::from(1),
            status: 0,
        };
        let o2 = Order {
            id: U256::from(2),
            trader: Address::ZERO,
            isBuy: false,
            amount: U256::from(1_000_000),
            limitPrice: U256::from(3000),
            batchId: U256::from(2),
            status: 0,
        };
        let res = solve_clearing(&[o1, o2]);
        assert!(res.is_err());
    }
}
