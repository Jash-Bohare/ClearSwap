// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Order, Batch} from "../types/DataTypes.sol";

/// @notice Interface for OrderBook contract (Spec 04 §4)
interface IOrderBook {
    // Events
    event OrderSubmitted(uint256 indexed orderId, address indexed trader, bool isBuy, uint256 amount, uint256 limitPrice, uint256 indexed batchId);
    event OrderCancelled(uint256 indexed orderId);
    event OrderRolled(uint256 indexed orderId, uint256 indexed fromBatchId, uint256 indexed toBatchId);
    event BatchOpened(uint256 indexed batchId, uint256 startTime, uint256 endTime);
    event BatchClosed(uint256 indexed batchId, uint256 orderCount);

    // Custom Errors
    error OrderTooSmall(uint256 amount, uint256 minSize);
    error InvalidPrice();
    error BatchNotOpen(uint256 batchId, uint8 currentStatus);
    error BatchNotClosed(uint256 batchId);
    error BatchWindowNotElapsed(uint256 currentTime, uint256 endTime);
    error OrderNotFound(uint256 orderId);
    error OrderNotCancellable(uint256 orderId, uint8 status);
    error Unauthorized(address caller);
    error ZeroAddress();

    // Functions
    function submitOrder(bool isBuy, uint256 amount, uint256 limitPrice) external returns (uint256 orderId);
    function cancelOrder(uint256 orderId) external;
    function getOrder(uint256 orderId) external view returns (Order memory);
    function getBatchOrderIds(uint256 batchId) external view returns (uint256[] memory);
    function getCurrentBatch() external view returns (Batch memory);
    function getBatch(uint256 batchId) external view returns (Batch memory);
    function closeBatch() external returns (uint256 closedBatchId);
    function rollOrder(uint256 orderId, uint256 newBatchId) external;
    function updateOrderStatus(uint256 orderId, uint8 newStatus) external;
    function setBatchStatus(uint256 batchId, uint8 newStatus) external;
}
