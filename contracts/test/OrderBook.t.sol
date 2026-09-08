// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {OrderBook} from "../src/OrderBook.sol";
import {IOrderBook} from "../src/interfaces/IOrderBook.sol";
import {Order, Batch, OrderStatus, BatchStatus} from "../src/types/DataTypes.sol";
import {Constants} from "../src/Constants.sol";

/// @title OrderBook Test
/// @notice Implements Spec 07 §1 Unit Tests for Order Validation & Batch Lifecycle
contract OrderBookTest is Test {
    OrderBook internal orderBook;
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal settlement = address(0x5E771E);
    address internal clearingAdapter = address(0xCA);

    uint256 internal constant DEFAULT_WINDOW = 45;
    uint256 internal constant MIN_SIZE = 1e15; // 0.001 WETH

    function setUp() public {
        orderBook = new OrderBook(DEFAULT_WINDOW, MIN_SIZE);
        orderBook.setSettlement(settlement);
        orderBook.setClearingAdapter(clearingAdapter);
    }

    /// 1. Zero amount rejected (07 §1)
    function test_ZeroAmountRejected() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IOrderBook.OrderTooSmall.selector, 0, MIN_SIZE));
        orderBook.submitOrder(true, 0, 3000_000000);
    }

    /// 2. Amount below MIN_ORDER_SIZE (1e15 wei / 0.001 WETH) rejected (07 §1, 03 §12)
    function test_AmountBelowMinSizeRejected() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IOrderBook.OrderTooSmall.selector, 5e14, MIN_SIZE));
        orderBook.submitOrder(true, 5e14, 3000_000000);
    }

    /// 3. Invalid price rejected (07 §1)
    function test_InvalidPriceRejected() public {
        vm.prank(alice);
        vm.expectRevert(IOrderBook.InvalidPrice.selector);
        orderBook.submitOrder(true, 1e18, 0);
    }

    /// 4. Successful order submission into OPEN batch
    function test_SubmitOrderSuccess() public {
        vm.prank(alice);
        uint256 orderId = orderBook.submitOrder(true, 1e18, 3000_000000);
        assertEq(orderId, 1);

        Order memory order = orderBook.getOrder(1);
        assertEq(order.id, 1);
        assertEq(order.trader, alice);
        assertTrue(order.isBuy);
        assertEq(order.amount, 1e18);
        assertEq(order.limitPrice, 3000_000000);
        assertEq(order.batchId, 1);
        assertEq(order.status, uint8(OrderStatus.PENDING));

        uint256[] memory batchOrders = orderBook.getBatchOrderIds(1);
        assertEq(batchOrders.length, 1);
        assertEq(batchOrders[0], 1);
    }

    /// 5. Cancellation only while OPEN (07 §1, 03 §14)
    function test_CancelSucceedsWhileOpen_RevertsAfterClose() public {
        vm.prank(alice);
        uint256 orderId = orderBook.submitOrder(true, 1e18, 3000_000000);

        // Cancel while OPEN succeeds
        vm.prank(alice);
        orderBook.cancelOrder(orderId);
        Order memory order = orderBook.getOrder(orderId);
        assertEq(order.status, uint8(OrderStatus.CANCELLED));

        // Submit new order and advance time past window
        vm.prank(bob);
        uint256 orderId2 = orderBook.submitOrder(false, 1e18, 3000_000000);

        vm.warp(block.timestamp + DEFAULT_WINDOW);
        orderBook.closeBatch();

        // Cancel after close reverts with OrderNotCancellable
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IOrderBook.OrderNotCancellable.selector, orderId2, uint8(BatchStatus.CLOSED)));
        orderBook.cancelOrder(orderId2);
    }

    /// 6. Close batch reverts before window elapsed (04 §4, 03 §6)
    function test_CloseBatchRevertsBeforeWindowElapsed() public {
        vm.warp(block.timestamp + DEFAULT_WINDOW - 1);
        vm.expectRevert(abi.encodeWithSelector(IOrderBook.BatchWindowNotElapsed.selector, block.timestamp, block.timestamp + 1));
        orderBook.closeBatch();
    }

    /// 7. Close batch opens next batch immediately (04 §4, 03 §6)
    function test_CloseBatchOpensNextBatchImmediately() public {
        vm.warp(block.timestamp + DEFAULT_WINDOW);
        uint256 closedId = orderBook.closeBatch();
        assertEq(closedId, 1);

        Batch memory closedBatch = orderBook.getBatch(1);
        assertEq(closedBatch.status, uint8(BatchStatus.CLOSED));

        Batch memory currentBatch = orderBook.getCurrentBatch();
        assertEq(currentBatch.id, 2);
        assertEq(currentBatch.status, uint8(BatchStatus.OPEN));
        assertEq(currentBatch.startTime, block.timestamp);
        assertEq(currentBatch.endTime, block.timestamp + DEFAULT_WINDOW);
    }

    /// 8. Permissionless closeBatch from non-owner address (04 §8, 07 §5)
    function test_PermissionlessCloseBatch() public {
        vm.warp(block.timestamp + DEFAULT_WINDOW);
        vm.prank(address(0x9999));
        uint256 closedId = orderBook.closeBatch();
        assertEq(closedId, 1);
    }

    /// 9. Restricted functions enforce access control (04 §8)
    function test_AccessControlRestrictedFunctions() public {
        vm.prank(address(0x9999));
        vm.expectRevert(abi.encodeWithSelector(IOrderBook.Unauthorized.selector, address(0x9999)));
        orderBook.rollOrder(1, 2);

        vm.prank(settlement);
        vm.expectRevert(abi.encodeWithSelector(IOrderBook.OrderNotFound.selector, 999));
        orderBook.rollOrder(999, 2);
    }
}
