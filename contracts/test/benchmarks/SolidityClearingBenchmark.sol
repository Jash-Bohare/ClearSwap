// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IClearingEngine} from "../../src/interfaces/IClearingEngine.sol";
import {Order, ClearingResult, Fill} from "../../src/types/DataTypes.sol";

/// @title SolidityClearingBenchmark
/// @notice Throwaway test-only pure Solidity implementation of Spec 03 §7–§10 clearing algorithm.
///         Used exclusively for gas benchmarking against Arbitrum Stylus (Spec 07 §6, Spec 04).
contract SolidityClearingBenchmark is IClearingEngine {
    function computeClearing(Order[] calldata orders) external pure override returns (ClearingResult memory) {
        if (orders.length == 0) {
            return ClearingResult({
                batchId: 0,
                clearingPrice: 0,
                fills: new Fill[](0)
            });
        }

        uint256 batchId = orders[0].batchId;

        // 1. Build sorted and deduplicated candidate prices
        uint256[] memory candidatePrices = _buildCandidatePrices(orders);

        // 2. Price sweep across candidate prices (Spec 03 §7, §8)
        (uint256 pStar, uint256 vStar) = _findOptimalPrice(orders, candidatePrices);

        if (vStar == 0) {
            return ClearingResult({
                batchId: batchId,
                clearingPrice: 0,
                fills: new Fill[](0)
            });
        }

        // 3. Allocate fills (Spec 03 §9, §10)
        Fill[] memory fills = _allocateFills(orders, pStar, vStar);

        return ClearingResult({
            batchId: batchId,
            clearingPrice: pStar,
            fills: fills
        });
    }

    function _buildCandidatePrices(Order[] calldata orders) internal pure returns (uint256[] memory) {
        uint256 len = orders.length;
        uint256[] memory rawPrices = new uint256[](len);
        for (uint256 i = 0; i < len; i++) {
            rawPrices[i] = orders[i].limitPrice;
        }

        // Insertion sort ascending
        for (uint256 i = 1; i < len; i++) {
            uint256 key = rawPrices[i];
            int256 j = int256(i) - 1;
            while (j >= 0 && rawPrices[uint256(j)] > key) {
                rawPrices[uint256(j + 1)] = rawPrices[uint256(j)];
                j--;
            }
            rawPrices[uint256(j + 1)] = key;
        }

        // Deduplicate
        uint256 uniqueCount = 1;
        for (uint256 i = 1; i < len; i++) {
            if (rawPrices[i] != rawPrices[i - 1]) {
                uniqueCount++;
            }
        }
        uint256[] memory candidatePrices = new uint256[](uniqueCount);
        candidatePrices[0] = rawPrices[0];
        uint256 idx = 1;
        for (uint256 i = 1; i < len; i++) {
            if (rawPrices[i] != rawPrices[i - 1]) {
                candidatePrices[idx++] = rawPrices[i];
            }
        }
        return candidatePrices;
    }

    function _findOptimalPrice(
        Order[] calldata orders,
        uint256[] memory candidatePrices
    ) internal pure returns (uint256 bestPrice, uint256 maxVolume) {
        uint256 minImbalance = type(uint256).max;
        uint256 numCandidates = candidatePrices.length;
        uint256 numOrders = orders.length;

        for (uint256 i = 0; i < numCandidates; i++) {
            uint256 p = candidatePrices[i];
            uint256 buyQty = 0;
            uint256 sellQty = 0;

            for (uint256 j = 0; j < numOrders; j++) {
                if (orders[j].isBuy) {
                    if (orders[j].limitPrice >= p) {
                        buyQty += orders[j].amount;
                    }
                } else {
                    if (orders[j].limitPrice <= p) {
                        sellQty += orders[j].amount;
                    }
                }
            }

            uint256 volume = buyQty < sellQty ? buyQty : sellQty;
            uint256 imbalance = buyQty >= sellQty ? buyQty - sellQty : sellQty - buyQty;

            if (volume == 0) continue;

            if (volume > maxVolume) {
                maxVolume = volume;
                minImbalance = imbalance;
                bestPrice = p;
            } else if (volume == maxVolume) {
                if (imbalance < minImbalance) {
                    minImbalance = imbalance;
                    bestPrice = p;
                } else if (imbalance == minImbalance && p < bestPrice) {
                    bestPrice = p;
                }
            }
        }
    }

    function _allocateFills(
        Order[] calldata orders,
        uint256 pStar,
        uint256 vStar
    ) internal pure returns (Fill[] memory) {
        uint256 numOrders = orders.length;
        uint256 eligibleBuyCount = 0;
        uint256 eligibleSellCount = 0;
        uint256 eligibleBuyQty = 0;
        uint256 eligibleSellQty = 0;

        for (uint256 i = 0; i < numOrders; i++) {
            if (orders[i].isBuy && orders[i].limitPrice >= pStar) {
                eligibleBuyCount++;
                eligibleBuyQty += orders[i].amount;
            } else if (!orders[i].isBuy && orders[i].limitPrice <= pStar) {
                eligibleSellCount++;
                eligibleSellQty += orders[i].amount;
            }
        }

        Fill[] memory fills = new Fill[](eligibleBuyCount + eligibleSellCount);
        uint256 fillIdx = 0;

        // Allocate buys
        if (eligibleBuyQty == vStar) {
            for (uint256 i = 0; i < numOrders; i++) {
                if (orders[i].isBuy && orders[i].limitPrice >= pStar) {
                    fills[fillIdx++] = Fill(orders[i].id, orders[i].trader, true, orders[i].amount, pStar);
                }
            }
        } else {
            uint256 sumRaw = 0;
            uint256[] memory rawFills = new uint256[](eligibleBuyCount);
            uint256[] memory bIndices = new uint256[](eligibleBuyCount);
            uint256 bIdx = 0;

            for (uint256 i = 0; i < numOrders; i++) {
                if (orders[i].isBuy && orders[i].limitPrice >= pStar) {
                    bIndices[bIdx] = i;
                    uint256 raw = (orders[i].amount * vStar) / eligibleBuyQty;
                    rawFills[bIdx] = raw;
                    sumRaw += raw;
                    bIdx++;
                }
            }

            uint256 remainder = vStar - sumRaw;
            for (uint256 i = 0; i < remainder && i < bIdx; i++) {
                rawFills[i] += 1;
            }

            for (uint256 i = 0; i < bIdx; i++) {
                Order memory o = orders[bIndices[i]];
                fills[fillIdx++] = Fill(o.id, o.trader, true, rawFills[i], pStar);
            }
        }

        // Allocate sells
        if (eligibleSellQty == vStar) {
            for (uint256 i = 0; i < numOrders; i++) {
                if (!orders[i].isBuy && orders[i].limitPrice <= pStar) {
                    fills[fillIdx++] = Fill(orders[i].id, orders[i].trader, false, orders[i].amount, pStar);
                }
            }
        } else {
            uint256 sumRaw = 0;
            uint256[] memory rawFills = new uint256[](eligibleSellCount);
            uint256[] memory sIndices = new uint256[](eligibleSellCount);
            uint256 sIdx = 0;

            for (uint256 i = 0; i < numOrders; i++) {
                if (!orders[i].isBuy && orders[i].limitPrice <= pStar) {
                    sIndices[sIdx] = i;
                    uint256 raw = (orders[i].amount * vStar) / eligibleSellQty;
                    rawFills[sIdx] = raw;
                    sumRaw += raw;
                    sIdx++;
                }
            }

            uint256 remainder = vStar - sumRaw;
            for (uint256 i = 0; i < remainder && i < sIdx; i++) {
                rawFills[i] += 1;
            }

            for (uint256 i = 0; i < sIdx; i++) {
                Order memory o = orders[sIndices[i]];
                fills[fillIdx++] = Fill(o.id, o.trader, false, rawFills[i], pStar);
            }
        }

        return fills;
    }
}
