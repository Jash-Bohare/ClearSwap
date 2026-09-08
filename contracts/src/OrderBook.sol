// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IOrderBook} from "./interfaces/IOrderBook.sol";
import {Order, Batch, OrderStatus, BatchStatus} from "./types/DataTypes.sol";
import {Constants} from "./Constants.sol";

/// @title OrderBook
/// @notice Manages order submission, order storage, and batch lifecycle (Spec 04 §4)
contract OrderBook is IOrderBook {
    uint256 public batchWindowSeconds;
    uint256 public minOrderSize;
    uint256 public currentBatchId;
    uint256 public nextOrderId;
    address public owner;
    address public settlement;
    address public clearingAdapter;

    mapping(uint256 => Order) internal _orders;
    mapping(uint256 => Batch) internal _batches;

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized(msg.sender);
        _;
    }

    modifier onlySettlement() {
        if (msg.sender != settlement) revert Unauthorized(msg.sender);
        _;
    }

    modifier onlyAuthorized() {
        if (msg.sender != settlement && msg.sender != clearingAdapter && msg.sender != owner) {
            revert Unauthorized(msg.sender);
        }
        _;
    }

    constructor(uint256 _batchWindowSeconds, uint256 _minOrderSize) {
        owner = msg.sender;
        batchWindowSeconds = _batchWindowSeconds == 0 ? Constants.DEFAULT_BATCH_WINDOW_SECONDS : _batchWindowSeconds;
        minOrderSize = _minOrderSize == 0 ? Constants.MIN_ORDER_SIZE : _minOrderSize;
        nextOrderId = 1;
        currentBatchId = 1;

        uint256[] memory emptyOrderIds = new uint256[](0);
        _batches[1] = Batch({
            id: 1,
            status: uint8(BatchStatus.OPEN),
            startTime: block.timestamp,
            endTime: block.timestamp + batchWindowSeconds,
            orderIds: emptyOrderIds
        });
        emit BatchOpened(1, block.timestamp, block.timestamp + batchWindowSeconds);
    }

    function setSettlement(address _settlement) external onlyOwner {
        if (_settlement == address(0)) revert ZeroAddress();
        settlement = _settlement;
    }

    function setClearingAdapter(address _clearingAdapter) external onlyOwner {
        if (_clearingAdapter == address(0)) revert ZeroAddress();
        clearingAdapter = _clearingAdapter;
    }

    function setBatchWindowSeconds(uint256 _batchWindowSeconds) external onlyOwner {
        batchWindowSeconds = _batchWindowSeconds;
    }

    /// @inheritdoc IOrderBook
    function submitOrder(bool isBuy, uint256 amount, uint256 limitPrice) external override returns (uint256 orderId) {
        if (amount < minOrderSize) revert OrderTooSmall(amount, minOrderSize);
        if (limitPrice == 0) revert InvalidPrice();

        Batch storage batch = _batches[currentBatchId];
        if (batch.status != uint8(BatchStatus.OPEN)) revert BatchNotOpen(currentBatchId, batch.status);

        orderId = nextOrderId++;
        _orders[orderId] = Order({
            id: orderId,
            trader: msg.sender,
            isBuy: isBuy,
            amount: amount,
            limitPrice: limitPrice,
            batchId: currentBatchId,
            status: uint8(OrderStatus.PENDING)
        });

        batch.orderIds.push(orderId);
        emit OrderSubmitted(orderId, msg.sender, isBuy, amount, limitPrice, currentBatchId);
    }

    /// @inheritdoc IOrderBook
    function cancelOrder(uint256 orderId) external override {
        Order storage order = _orders[orderId];
        if (order.id == 0) revert OrderNotFound(orderId);
        if (order.trader != msg.sender && msg.sender != owner) revert Unauthorized(msg.sender);

        Batch storage batch = _batches[order.batchId];
        if (batch.status != uint8(BatchStatus.OPEN)) revert OrderNotCancellable(orderId, batch.status);
        if (order.status != uint8(OrderStatus.PENDING)) revert OrderNotCancellable(orderId, order.status);

        order.status = uint8(OrderStatus.CANCELLED);
        emit OrderCancelled(orderId);
    }

    /// @inheritdoc IOrderBook
    function getOrder(uint256 orderId) external view override returns (Order memory) {
        Order memory order = _orders[orderId];
        if (order.id == 0) revert OrderNotFound(orderId);
        return order;
    }

    /// @inheritdoc IOrderBook
    function getBatchOrderIds(uint256 batchId) external view override returns (uint256[] memory) {
        return _batches[batchId].orderIds;
    }

    /// @inheritdoc IOrderBook
    function getCurrentBatch() external view override returns (Batch memory) {
        return _batches[currentBatchId];
    }

    /// @inheritdoc IOrderBook
    function getBatch(uint256 batchId) external view override returns (Batch memory) {
        return _batches[batchId];
    }

    /// @inheritdoc IOrderBook
    function closeBatch() external override returns (uint256 closedBatchId) {
        Batch storage batch = _batches[currentBatchId];
        if (batch.status != uint8(BatchStatus.OPEN)) revert BatchNotOpen(currentBatchId, batch.status);
        if (block.timestamp < batch.endTime) revert BatchWindowNotElapsed(block.timestamp, batch.endTime);

        batch.status = uint8(BatchStatus.CLOSED);
        closedBatchId = currentBatchId;
        emit BatchClosed(closedBatchId, batch.orderIds.length);

        // Open next batch immediately (Spec 03 §6)
        currentBatchId++;
        uint256[] memory emptyOrderIds = new uint256[](0);
        _batches[currentBatchId] = Batch({
            id: currentBatchId,
            status: uint8(BatchStatus.OPEN),
            startTime: block.timestamp,
            endTime: block.timestamp + batchWindowSeconds,
            orderIds: emptyOrderIds
        });
        emit BatchOpened(currentBatchId, block.timestamp, block.timestamp + batchWindowSeconds);
    }

    /// @inheritdoc IOrderBook
    function rollOrder(uint256 orderId, uint256 newBatchId) external override onlyAuthorized {
        Order storage order = _orders[orderId];
        if (order.id == 0) revert OrderNotFound(orderId);

        uint256 oldBatchId = order.batchId;
        order.batchId = newBatchId;
        _batches[newBatchId].orderIds.push(orderId);

        emit OrderRolled(orderId, oldBatchId, newBatchId);
    }

    /// @inheritdoc IOrderBook
    function updateOrderStatus(uint256 orderId, uint8 newStatus) external override onlyAuthorized {
        Order storage order = _orders[orderId];
        if (order.id == 0) revert OrderNotFound(orderId);
        order.status = newStatus;
    }

    /// @inheritdoc IOrderBook
    function setBatchStatus(uint256 batchId, uint8 newStatus) external override onlyAuthorized {
        _batches[batchId].status = newStatus;
    }
}
