//! Core Solidity ABI types for ClearSwap (Spec 04 §2, Spec 05 §2–§3)
use alloy_sol_types::sol;
use stylus_sdk::abi::{AbiType, ConstString};

sol! {
    /// Matches `Order` struct from `DataTypes.sol` (Spec 04 §2)
    struct Order {
        uint256 id;
        address trader;
        bool isBuy;
        uint256 amount;       // base-asset wei
        uint256 limitPrice;   // quote-smallest-units per whole base token
        uint256 batchId;
        uint8 status;         // 0=PENDING, 1=PARTIALLY_FILLED, 2=FILLED, 3=CANCELLED
    }

    /// Matches `Batch` struct from `DataTypes.sol` (Spec 04 §2)
    struct Batch {
        uint256 id;
        uint8 status;         // 0=OPEN, 1=CLOSED, 2=CLEARING, 3=SETTLED
        uint256 startTime;
        uint256 endTime;
        uint256[] orderIds;
    }

    /// Matches `Fill` struct from `DataTypes.sol` (Spec 04 §2)
    struct Fill {
        uint256 orderId;
        address trader;
        bool isBuy;
        uint256 filledAmount;  // base-asset wei
        uint256 clearingPrice; // single uniform P*
    }

    /// Matches `ClearingResult` struct from `DataTypes.sol` (Spec 04 §2)
    struct ClearingResult {
        uint256 batchId;
        uint256 clearingPrice; // single uniform P* (0 if no match)
        Fill[] fills;
    }
}

impl AbiType for Order {
    type SolType = Self;
    const ABI: ConstString = ConstString::new("(uint256,address,bool,uint256,uint256,uint256,uint8)");
}

impl AbiType for Batch {
    type SolType = Self;
    const ABI: ConstString = ConstString::new("(uint256,uint8,uint256,uint256,uint256[])");
}

impl AbiType for Fill {
    type SolType = Self;
    const ABI: ConstString = ConstString::new("(uint256,address,bool,uint256,uint256)");
}

impl AbiType for ClearingResult {
    type SolType = Self;
    const ABI: ConstString = ConstString::new("(uint256,uint256,(uint256,address,bool,uint256,uint256)[])");
}
