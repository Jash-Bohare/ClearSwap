// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ClearingResult} from "../types/DataTypes.sol";

/// @notice Interface for Settlement contract (Spec 04 §6)
interface ISettlement {
    // Events
    event BatchSettled(uint256 indexed batchId, uint256 clearingPrice, uint256 fillCount, uint256 totalVolume);
    event OrderFilled(uint256 indexed orderId, address indexed trader, bool isBuy, uint256 filledAmount, uint256 clearingPrice, uint256 quoteAmount);

    // Custom Errors
    error TokenTransferFailed(address token, address from, address to, uint256 amount);
    error BatchAlreadySettled(uint256 batchId);
    error Unauthorized(address caller);

    // Functions
    function settleBatch(uint256 batchId, ClearingResult calldata result) external;
}
