// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Order, ClearingResult} from "../types/DataTypes.sol";

/// @notice Interface for ClearingAdapter contract (Spec 04 §5)
interface IClearingAdapter {
    // Custom Errors (Spec 04 §5)
    error StylusCallFailed(uint256 batchId);
    error InvalidClearingResult(uint256 batchId, string reason);
    error BatchMismatch(uint256 expectedBatchId, uint256 returnedBatchId);
    error Unauthorized(address caller);

    // Functions
    function requestClearing(uint256 batchId, Order[] calldata orders) external returns (ClearingResult memory result);
    function executeClearing(uint256 batchId) external returns (ClearingResult memory result);
    function validateResult(uint256 batchId, Order[] calldata orders, ClearingResult calldata result) external pure returns (bool);
}
