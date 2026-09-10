// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

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

// src/interfaces/IClearingAdapter.sol

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

// src/interfaces/IClearingEngine.sol

/// @notice Interface for Stylus Clearing Engine (Spec 04 §7, Spec 05)
interface IClearingEngine {
    function computeClearing(Order[] calldata orders) external view returns (ClearingResult memory);
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

// src/interfaces/ISettlement.sol

/// @notice Interface for Settlement contract (Spec 04 §6)
interface ISettlement {
    // Events (Spec 04 §6)
    event BatchSettled(uint256 indexed batchId, uint256 clearingPrice, uint256 fillCount, uint256 totalVolume);
    event OrderFilled(uint256 indexed orderId, address indexed trader, bool isBuy, uint256 filledAmount, uint256 clearingPrice, uint256 quoteAmount);

    // Custom Errors (Spec 04 §6)
    error BatchNotInClearingState(uint256 batchId, uint8 status);
    error TransferFailed(address token, address from, address to, uint256 amount);
    error UnrecognizedOrderInResult(uint256 orderId, uint256 batchId);
    error BatchAlreadySettled(uint256 batchId);
    error Unauthorized(address caller);

    // Functions
    function settleBatch(uint256 batchId, ClearingResult calldata result) external;
}

// src/ClearingAdapter.sol

/// @title ClearingAdapter
/// @notice Encodes order batches, invokes Stylus clearing contract, and validates results (Spec 04 §5)
contract ClearingAdapter is IClearingAdapter {
    address public owner;
    address public orderBook;
    address public clearingEngine;
    address public settlement;

    event ClearingRequested(uint256 indexed batchId, uint256 orderCount);
    event ClearingReceived(uint256 indexed batchId, uint256 clearingPrice, uint256 fillCount);

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized(msg.sender);
        _;
    }

    modifier onlyAuthorized() {
        if (msg.sender != orderBook && msg.sender != owner) {
            revert Unauthorized(msg.sender);
        }
        _;
    }

    constructor(address _orderBook, address _clearingEngine, address _settlement) {
        owner = msg.sender;
        orderBook = _orderBook;
        clearingEngine = _clearingEngine;
        settlement = _settlement;
    }

    function setSettlement(address _settlement) external onlyOwner {
        settlement = _settlement;
    }

    function setClearingEngine(address _clearingEngine) external onlyOwner {
        clearingEngine = _clearingEngine;
    }

    function setOrderBook(address _orderBook) external onlyOwner {
        orderBook = _orderBook;
    }

    /// @inheritdoc IClearingAdapter
    function requestClearing(uint256 batchId, Order[] calldata orders) external override onlyAuthorized returns (ClearingResult memory result) {
        return _performClearing(batchId, orders);
    }

    /// @inheritdoc IClearingAdapter
    function executeClearing(uint256 batchId) external override returns (ClearingResult memory result) {
        IOrderBook ob = IOrderBook(orderBook);
        uint256[] memory orderIds = ob.getBatchOrderIds(batchId);

        Order[] memory batchOrders = new Order[](orderIds.length);
        for (uint256 i = 0; i < orderIds.length; i++) {
            batchOrders[i] = ob.getOrder(orderIds[i]);
        }

        return _performClearing(batchId, batchOrders);
    }

    function _performClearing(uint256 batchId, Order[] memory batchOrders) internal returns (ClearingResult memory result) {
        emit ClearingRequested(batchId, batchOrders.length);

        if (orderBook != address(0) && orderBook.code.length > 0) {
            IOrderBook(orderBook).setBatchStatus(batchId, uint8(BatchStatus.CLEARING));
        }

        // Call Stylus clearing engine (Spec 04 §7)
        try IClearingEngine(clearingEngine).computeClearing(batchOrders) returns (ClearingResult memory res) {
            result = res;
        } catch {
            revert StylusCallFailed(batchId);
        }

        // Sanity-validate result before triggering settlement (Spec 04 §5)
        validateResult(batchId, batchOrders, result);

        emit ClearingReceived(batchId, result.clearingPrice, result.fills.length);

        if (settlement != address(0) && settlement.code.length > 0) {
            ISettlement(settlement).settleBatch(batchId, result);
        }
    }

    /// @inheritdoc IClearingAdapter
    function validateResult(
        uint256 batchId,
        Order[] memory orders,
        ClearingResult memory result
    ) public pure override returns (bool) {
        // Defensive check: Batch ID match
        if (orders.length > 0 && result.batchId != batchId) {
            revert BatchMismatch(batchId, result.batchId);
        }

        // Check 1: Zero price / fills consistency (Spec 04 §5 Check 1)
        if (result.clearingPrice == 0) {
            if (result.fills.length != 0) {
                revert InvalidClearingResult(batchId, "Price zero with non-empty fills");
            }
        } else {
            if (result.fills.length == 0) {
                revert InvalidClearingResult(batchId, "Non-zero price with empty fills");
            }
        }

        if (orders.length == 0) {
            if (result.clearingPrice != 0 || result.fills.length != 0) {
                revert InvalidClearingResult(batchId, "Non-zero result for empty batch");
            }
            return true;
        }

        // Check 2: Uniform single price across all fills (Spec 04 §5 Check 2, Spec 03 §15)
        for (uint256 i = 0; i < result.fills.length; i++) {
            if (result.fills[i].clearingPrice != result.clearingPrice) {
                revert InvalidClearingResult(batchId, "Fill price mismatch");
            }
        }

        // Check 3: Over-allocation check (Spec 04 §5 Check 3, Spec 03 §15 Invariant 1)
        uint256 totalBuyOrders = 0;
        uint256 totalSellOrders = 0;
        for (uint256 i = 0; i < orders.length; i++) {
            if (orders[i].isBuy) {
                totalBuyOrders += orders[i].amount;
            } else {
                totalSellOrders += orders[i].amount;
            }
        }

        uint256 totalBuyFills = 0;
        uint256 totalSellFills = 0;
        for (uint256 i = 0; i < result.fills.length; i++) {
            if (result.fills[i].isBuy) {
                totalBuyFills += result.fills[i].filledAmount;
            } else {
                totalSellFills += result.fills[i].filledAmount;
            }
        }

        if (totalBuyFills > totalBuyOrders) {
            revert InvalidClearingResult(batchId, "Buy fill over-allocation");
        }
        if (totalSellFills > totalSellOrders) {
            revert InvalidClearingResult(batchId, "Sell fill over-allocation");
        }
        if (totalBuyFills != totalSellFills) {
            revert InvalidClearingResult(batchId, "Volume imbalance between buy and sell fills");
        }

        // Check 4: Order membership and individual order limits (Spec 04 §5 Check 4)
        for (uint256 i = 0; i < result.fills.length; i++) {
            Fill memory fill = result.fills[i];
            bool found = false;
            for (uint256 j = 0; j < orders.length; j++) {
                if (orders[j].id == fill.orderId) {
                    found = true;
                    if (orders[j].trader != fill.trader) {
                        revert InvalidClearingResult(batchId, "Trader mismatch in fill");
                    }
                    if (orders[j].isBuy != fill.isBuy) {
                        revert InvalidClearingResult(batchId, "Side mismatch in fill");
                    }
                    if (fill.filledAmount > orders[j].amount) {
                        revert InvalidClearingResult(batchId, "Fill amount exceeds order amount");
                    }
                    break;
                }
            }
            if (!found) {
                revert InvalidClearingResult(batchId, "Unrecognized order in fills");
            }
        }

        return true;
    }
}
