// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// src/Constants.sol

/// @notice Global protocol constants (Spec 04 §3)
library Constants {
    uint256 public constant BASE_DECIMALS = 18;
    uint256 public constant QUOTE_DECIMALS = 6;
    uint256 public constant DEFAULT_BATCH_WINDOW_SECONDS = 45;
    uint256 public constant MIN_ORDER_SIZE = 1e15; // 0.001 WETH (Spec 03 §12)
}

// src/types/DataTypes.sol

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

// src/interfaces/IOrderBook.sol

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

// src/OrderBook.sol

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
