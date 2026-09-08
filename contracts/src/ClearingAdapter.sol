// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IClearingAdapter} from "./interfaces/IClearingAdapter.sol";
import {IOrderBook} from "./interfaces/IOrderBook.sol";
import {IClearingEngine} from "./interfaces/IClearingEngine.sol";
import {ISettlement} from "./interfaces/ISettlement.sol";
import {Order, ClearingResult, Fill} from "./types/DataTypes.sol";

/// @title ClearingAdapter Skeleton
/// @notice Encodes order batches, invokes Stylus clearing contract, and validates results (Spec 04 §5)
contract ClearingAdapter is IClearingAdapter {
    address public owner;
    address public orderBook;
    address public clearingEngine;
    address public settlement;

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
        // Call Stylus clearing engine (Spec 04 §7)
        try IClearingEngine(clearingEngine).computeClearing(batchOrders) returns (ClearingResult memory res) {
            result = res;
        } catch {
            revert StylusCallFailed(batchId);
        }

        if (batchOrders.length > 0 && result.batchId != batchId) {
            revert BatchMismatch(batchId, result.batchId);
        }

        // Sanity-validate result before triggering settlement (Spec 04 §5)
        validateResult(batchId, batchOrders, result);

        if (settlement != address(0)) {
            ISettlement(settlement).settleBatch(batchId, result);
        }
    }

    /// @inheritdoc IClearingAdapter
    function validateResult(
        uint256 batchId,
        Order[] memory orders,
        ClearingResult memory result
    ) public pure override returns (bool) {
        if (orders.length == 0) {
            if (result.clearingPrice != 0 || result.fills.length != 0) {
                revert InvalidClearingResult(batchId, "Non-zero result for empty batch");
            }
            return true;
        }

        if (result.batchId != batchId) {
            revert BatchMismatch(batchId, result.batchId);
        }

        // Validate uniform single price invariant across all fills (Spec 03 §15)
        for (uint256 i = 0; i < result.fills.length; i++) {
            if (result.fills[i].clearingPrice != result.clearingPrice) {
                revert InvalidClearingResult(batchId, "Fill price mismatch");
            }
        }

        return true;
    }
}
