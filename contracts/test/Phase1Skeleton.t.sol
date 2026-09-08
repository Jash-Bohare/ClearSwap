// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {MockWETH} from "../src/mocks/MockWETH.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {OrderBook} from "../src/OrderBook.sol";
import {ClearingAdapter} from "../src/ClearingAdapter.sol";
import {Settlement} from "../src/Settlement.sol";
import {IClearingEngine} from "../src/interfaces/IClearingEngine.sol";
import {Order, Batch, Fill, ClearingResult, BatchStatus, OrderStatus} from "../src/types/DataTypes.sol";
import {Constants} from "../src/Constants.sol";

contract MockClearingEngine is IClearingEngine {
    function computeClearing(Order[] calldata orders) external pure override returns (ClearingResult memory) {
        if (orders.length == 0) {
            return ClearingResult({batchId: 0, clearingPrice: 0, fills: new Fill[](0)});
        }
        return ClearingResult({batchId: orders[0].batchId, clearingPrice: 0, fills: new Fill[](0)});
    }
}

contract Phase1SkeletonTest is Test {
    MockWETH public weth;
    MockUSDC public usdc;
    MockClearingEngine public engine;
    OrderBook public orderBook;
    ClearingAdapter public adapter;
    Settlement public settlement;

    address public alice = address(0xA11CE);
    address public bob = address(0xB0B);

    function setUp() public {
        weth = new MockWETH();
        usdc = new MockUSDC();
        engine = new MockClearingEngine();

        orderBook = new OrderBook(Constants.DEFAULT_BATCH_WINDOW_SECONDS, Constants.MIN_ORDER_SIZE);
        adapter = new ClearingAdapter(address(orderBook), address(engine), address(0));
        settlement = new Settlement(address(weth), address(usdc), address(orderBook), address(adapter));

        orderBook.setSettlement(address(settlement));
        orderBook.setClearingAdapter(address(adapter));
        adapter.setSettlement(address(settlement));
    }

    function test_wiring_addresses_set_correctly() public view {
        assertEq(orderBook.settlement(), address(settlement));
        assertEq(orderBook.clearingAdapter(), address(adapter));
        assertEq(adapter.settlement(), address(settlement));
        assertEq(adapter.orderBook(), address(orderBook));
        assertEq(adapter.clearingEngine(), address(engine));
        assertEq(settlement.baseToken(), address(weth));
        assertEq(settlement.quoteToken(), address(usdc));
    }

    function test_order_submission_and_batch_lifecycle() public {
        vm.prank(alice);
        uint256 orderId = orderBook.submitOrder(true, 1 ether, 3000 * 1e6);
        assertEq(orderId, 1);

        Order memory order = orderBook.getOrder(1);
        assertEq(order.trader, alice);
        assertEq(order.amount, 1 ether);
        assertEq(order.limitPrice, 3000 * 1e6);
        assertTrue(order.isBuy);

        // Advance time to batch end
        vm.warp(block.timestamp + 46);
        uint256 closedId = orderBook.closeBatch();
        assertEq(closedId, 1);
        assertEq(orderBook.currentBatchId(), 2);
    }

    function test_adapter_clearing_dispatch() public {
        vm.prank(alice);
        orderBook.submitOrder(true, 1 ether, 3000 * 1e6);

        vm.warp(block.timestamp + 46);
        orderBook.closeBatch();

        ClearingResult memory res = adapter.executeClearing(1);
        assertEq(res.batchId, 1);
        assertEq(res.clearingPrice, 0);
    }

    function test_adapter_request_clearing_signature() public {
        vm.prank(alice);
        orderBook.submitOrder(true, 1 ether, 3000 * 1e6);

        Order[] memory batchOrders = new Order[](1);
        batchOrders[0] = orderBook.getOrder(1);

        vm.prank(address(orderBook));
        ClearingResult memory res = adapter.requestClearing(1, batchOrders);
        assertEq(res.batchId, 1);
        assertEq(res.clearingPrice, 0);
    }
}
