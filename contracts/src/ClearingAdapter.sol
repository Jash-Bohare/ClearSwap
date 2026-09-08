// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IClearingAdapter} from "./interfaces/IClearingAdapter.sol";
import {IOrderBook} from "./interfaces/IOrderBook.sol";
import {IClearingEngine} from "./interfaces/IClearingEngine.sol";
import {ISettlement} from "./interfaces/ISettlement.sol";
import {Order, ClearingResult, Fill, BatchStatus} from "./types/DataTypes.sol";

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
