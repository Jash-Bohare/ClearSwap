// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Global protocol constants (Spec 04 §3)
library Constants {
    uint256 public constant BASE_DECIMALS = 18;
    uint256 public constant QUOTE_DECIMALS = 6;
    uint256 public constant DEFAULT_BATCH_WINDOW_SECONDS = 45;
    uint256 public constant MIN_ORDER_SIZE = 1e15; // 0.001 WETH (Spec 03 §12)
}
