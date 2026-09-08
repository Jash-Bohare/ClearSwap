// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ClearingAdapter} from "../src/ClearingAdapter.sol";
import {IClearingAdapter} from "../src/interfaces/IClearingAdapter.sol";
import {OrderBook} from "../src/OrderBook.sol";
import {MockClearingEngine} from "./mocks/MockClearingEngine.sol";
import {Order, ClearingResult, Fill} from "../src/types/DataTypes.sol";

/// @title ClearingAdapter Test
/// @notice Implements Spec 04 §5 validation tests and defensive revert checks
contract ClearingAdapterTest is Test {
    ClearingAdapter internal adapter;
    MockClearingEngine internal engine;
    OrderBook internal orderBook;
    address internal settlement = address(0x5E);

    address internal trader1 = address(0x1111);
    address internal trader2 = address(0x2222);

    function setUp() public {
        orderBook = new OrderBook(45, 1e15);
        engine = new MockClearingEngine();
        adapter = new ClearingAdapter(address(orderBook), address(engine), settlement);
        orderBook.setClearingAdapter(address(adapter));
    }

    function makeOrder(uint256 id, address trader, bool isBuy, uint256 amount, uint256 limitPrice, uint256 batchId) internal pure returns (Order memory) {
        return Order({
            id: id,
            trader: trader,
            isBuy: isBuy,
            amount: amount,
            limitPrice: limitPrice,
            batchId: batchId,
            status: 0
        });
    }

    /// Check 1: Zero price with non-empty fills reverts (04 §5)
    function test_ValidationRejectsPriceZeroWithFills() public {
        Order[] memory orders = new Order[](2);
        orders[0] = makeOrder(1, trader1, true, 1e18, 3000_000000, 1);
        orders[1] = makeOrder(2, trader2, false, 1e18, 3000_000000, 1);

        Fill[] memory fills = new Fill[](1);
        fills[0] = Fill({
            orderId: 1,
            trader: trader1,
            isBuy: true,
            filledAmount: 1e18,
            clearingPrice: 0
        });

        ClearingResult memory res = ClearingResult({
            batchId: 1,
            clearingPrice: 0,
            fills: fills
        });

        vm.expectRevert(abi.encodeWithSelector(IClearingAdapter.InvalidClearingResult.selector, 1, "Price zero with non-empty fills"));
        adapter.validateResult(1, orders, res);
    }

    /// Check 1: Non-zero price with zero fills reverts (04 §5)
    function test_ValidationRejectsNonZeroPriceWithZeroFills() public {
        Order[] memory orders = new Order[](2);
        orders[0] = makeOrder(1, trader1, true, 1e18, 3000_000000, 1);
        orders[1] = makeOrder(2, trader2, false, 1e18, 3000_000000, 1);

        ClearingResult memory res = ClearingResult({
            batchId: 1,
            clearingPrice: 3000_000000,
            fills: new Fill[](0)
        });

        vm.expectRevert(abi.encodeWithSelector(IClearingAdapter.InvalidClearingResult.selector, 1, "Non-zero price with empty fills"));
        adapter.validateResult(1, orders, res);
    }

    /// Check 2: Fill price mismatch reverts (04 §5 Check 2, 03 §15 Invariant 3)
    function test_ValidationRejectsMismatchedFillPrice() public {
        Order[] memory orders = new Order[](2);
        orders[0] = makeOrder(1, trader1, true, 1e18, 3000_000000, 1);
        orders[1] = makeOrder(2, trader2, false, 1e18, 3000_000000, 1);

        Fill[] memory fills = new Fill[](2);
        fills[0] = Fill({
            orderId: 1,
            trader: trader1,
            isBuy: true,
            filledAmount: 1e18,
            clearingPrice: 3000_000000
        });
        fills[1] = Fill({
            orderId: 2,
            trader: trader2,
            isBuy: false,
            filledAmount: 1e18,
            clearingPrice: 2990_000000 // Mismatch!
        });

        ClearingResult memory res = ClearingResult({
            batchId: 1,
            clearingPrice: 3000_000000,
            fills: fills
        });

        vm.expectRevert(abi.encodeWithSelector(IClearingAdapter.InvalidClearingResult.selector, 1, "Fill price mismatch"));
        adapter.validateResult(1, orders, res);
    }

    /// Check 3: Buy over-allocation reverts (04 §5 Check 3)
    function test_ValidationRejectsBuyOverAllocation() public {
        Order[] memory orders = new Order[](2);
        orders[0] = makeOrder(1, trader1, true, 1e18, 3000_000000, 1);
        orders[1] = makeOrder(2, trader2, false, 2e18, 3000_000000, 1);

        Fill[] memory fills = new Fill[](2);
        fills[0] = Fill({
            orderId: 1,
            trader: trader1,
            isBuy: true,
            filledAmount: 2e18, // Over-allocated! (order amount is only 1e18)
            clearingPrice: 3000_000000
        });
        fills[1] = Fill({
            orderId: 2,
            trader: trader2,
            isBuy: false,
            filledAmount: 2e18,
            clearingPrice: 3000_000000
        });

        ClearingResult memory res = ClearingResult({
            batchId: 1,
            clearingPrice: 3000_000000,
            fills: fills
        });

        vm.expectRevert(abi.encodeWithSelector(IClearingAdapter.InvalidClearingResult.selector, 1, "Buy fill over-allocation"));
        adapter.validateResult(1, orders, res);
    }

    /// Check 4: Unrecognized order in fills reverts (04 §5 Check 4)
    function test_ValidationRejectsUnrecognizedOrderInFills() public {
        Order[] memory orders = new Order[](2);
        orders[0] = makeOrder(1, trader1, true, 1e18, 3000_000000, 1);
        orders[1] = makeOrder(2, trader2, false, 1e18, 3000_000000, 1);

        Fill[] memory fills = new Fill[](2);
        fills[0] = Fill({
            orderId: 1,
            trader: trader1,
            isBuy: true,
            filledAmount: 1e18,
            clearingPrice: 3000_000000
        });
        fills[1] = Fill({
            orderId: 999, // Unknown orderId!
            trader: trader2,
            isBuy: false,
            filledAmount: 1e18,
            clearingPrice: 3000_000000
        });

        ClearingResult memory res = ClearingResult({
            batchId: 1,
            clearingPrice: 3000_000000,
            fills: fills
        });

        vm.expectRevert(abi.encodeWithSelector(IClearingAdapter.InvalidClearingResult.selector, 1, "Unrecognized order in fills"));
        adapter.validateResult(1, orders, res);
    }

    /// Stylus call failure triggers StylusCallFailed revert (04 §5)
    function test_StylusCallFailureReverts() public {
        engine.setShouldRevert(true);
        Order[] memory orders = new Order[](1);
        orders[0] = makeOrder(1, trader1, true, 1e18, 3000_000000, 1);

        vm.prank(address(orderBook));
        vm.expectRevert(abi.encodeWithSelector(IClearingAdapter.StylusCallFailed.selector, 1));
        adapter.requestClearing(1, orders);
    }
}
