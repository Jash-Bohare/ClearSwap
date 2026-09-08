// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IClearingEngine} from "../../src/interfaces/IClearingEngine.sol";
import {Order, ClearingResult, Fill} from "../../src/types/DataTypes.sol";

/// @title MockClearingEngine
/// @notice Mock Stylus clearing contract for unit and integration testing (Spec 07 §3)
contract MockClearingEngine is IClearingEngine {
    bool public shouldRevert;
    bytes internal presetResultBytes;
    bool public usePreset;

    function setShouldRevert(bool _shouldRevert) external {
        shouldRevert = _shouldRevert;
    }

    function setPresetResult(ClearingResult memory _preset) external {
        presetResultBytes = abi.encode(_preset);
        usePreset = true;
    }

    function clearPreset() external {
        usePreset = false;
    }

    function computeClearing(Order[] calldata orders) external view override returns (ClearingResult memory result) {
        if (shouldRevert) {
            revert("MockClearingEngine: simulated revert");
        }

        if (usePreset) {
            return abi.decode(presetResultBytes, (ClearingResult));
        }

        if (orders.length == 0) {
            return ClearingResult({
                batchId: 0,
                clearingPrice: 0,
                fills: new Fill[](0)
            });
        }

        uint256 batchId = orders[0].batchId;

        // Default mock behavior: perfect match if 1 buy and 1 sell of equal amount & price
        if (orders.length == 2 && orders[0].isBuy != orders[1].isBuy && orders[0].amount == orders[1].amount) {
            uint256 price = orders[0].limitPrice;
            Fill[] memory fills = new Fill[](2);
            fills[0] = Fill({
                orderId: orders[0].id,
                trader: orders[0].trader,
                isBuy: orders[0].isBuy,
                filledAmount: orders[0].amount,
                clearingPrice: price
            });
            fills[1] = Fill({
                orderId: orders[1].id,
                trader: orders[1].trader,
                isBuy: orders[1].isBuy,
                filledAmount: orders[1].amount,
                clearingPrice: price
            });
            return ClearingResult({
                batchId: batchId,
                clearingPrice: price,
                fills: fills
            });
        }

        // Return empty result by default
        return ClearingResult({
            batchId: batchId,
            clearingPrice: 0,
            fills: new Fill[](0)
        });
    }
}
