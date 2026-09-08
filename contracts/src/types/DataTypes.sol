// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Core data structures for ClearSwap protocol (Spec 04 §2)

enum OrderStatus {
    PENDING,
    PARTIALLY_FILLED,
    FILLED,
    CANCELLED
}

enum BatchStatus {
    OPEN,
    CLOSED,
    CLEARING,
    SETTLED
}

struct Order {
    uint256 id;
    address trader;
    bool isBuy;
    uint256 amount;       // base-asset wei (Spec 03 §2, §3)
    uint256 limitPrice;   // quote-smallest-units per whole base token (Spec 03 §11)
    uint256 batchId;
    uint8 status;         // 0=PENDING, 1=PARTIALLY_FILLED, 2=FILLED, 3=CANCELLED
}

struct Batch {
    uint256 id;
    uint8 status;         // 0=OPEN, 1=CLOSED, 2=CLEARING, 3=SETTLED
    uint256 startTime;
    uint256 endTime;       // startTime + BATCH_WINDOW_SECONDS (Spec 03 §6)
    uint256[] orderIds;
}

struct Fill {
    uint256 orderId;
    address trader;
    bool isBuy;
    uint256 filledAmount;  // base-asset wei
    uint256 clearingPrice; // == batch's single P* for every fill in the batch (Spec 03 §9)
}

struct ClearingResult {
    uint256 batchId;
    uint256 clearingPrice; // P* (Spec 03 §8). If no trade occurred, 0 and fills.length == 0
    Fill[] fills;
}
