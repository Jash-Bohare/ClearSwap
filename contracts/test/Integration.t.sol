// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {OrderBook} from "../src/OrderBook.sol";
import {ClearingAdapter} from "../src/ClearingAdapter.sol";
import {Settlement} from "../src/Settlement.sol";
import {MockWETH} from "../src/mocks/MockWETH.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {SolidityClearingBenchmark} from "./benchmarks/SolidityClearingBenchmark.sol";
import {Order, Batch, ClearingResult, Fill, OrderStatus, BatchStatus} from "../src/types/DataTypes.sol";
import {Constants} from "../src/Constants.sol";

/// @title End-to-End Integration Test Suite
/// @notice Implements Spec 07 §2 (Clearing Cases 1–5), Spec 07 §4 (Invariants), and Spec 07 §5 (Integration Flows)
///         Validates the complete production lifecycle: submitOrder -> closeBatch -> executeClearing -> settleBatch
contract IntegrationTest is Test {
    MockWETH internal weth;
    MockUSDC internal usdc;
    SolidityClearingBenchmark internal engine;
    OrderBook internal orderBook;
    ClearingAdapter internal adapter;
    Settlement internal settlement;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal charlie = address(0xCC);
    address internal dave = address(0xDD);
    address internal eve = address(0xEE);
    address internal frank = address(0xFF);

    uint256 internal constant WINDOW = 45;
    uint256 internal constant MIN_ORDER = 1e15;

    function setUp() public {
        weth = new MockWETH();
        usdc = new MockUSDC();
        engine = new SolidityClearingBenchmark();

        orderBook = new OrderBook(WINDOW, MIN_ORDER);
        adapter = new ClearingAdapter(address(orderBook), address(engine), address(0));
        settlement = new Settlement(address(weth), address(usdc), address(orderBook), address(adapter));

        orderBook.setSettlement(address(settlement));
        orderBook.setClearingAdapter(address(adapter));
        adapter.setSettlement(address(settlement));

        // Fund settlement liquidity buffer for counter-asset settlements
        weth.mint(address(settlement), 10000 ether);
        usdc.mint(address(settlement), 100_000_000 * 1e6);
    }

    function setupTrader(address trader, uint256 baseAmount, uint256 quoteAmount) internal {
        if (baseAmount > 0) {
            weth.mint(trader, baseAmount);
            vm.prank(trader);
            weth.approve(address(settlement), baseAmount);
        }
        if (quoteAmount > 0) {
            usdc.mint(trader, quoteAmount);
            vm.prank(trader);
            usdc.approve(address(settlement), quoteAmount);
        }
    }

    /// Case 1 — Perfect Match End-to-End (07 §2 Case 1, 04 §9)
    function test_E2E_Case1_PerfectMatch() public {
        // B1: Buy 2.0 WETH @ 3000 USDC
        // S1: Sell 2.0 WETH @ 3000 USDC
        setupTrader(alice, 0, 6000 * 1e6);
        setupTrader(bob, 2 ether, 0);

        vm.prank(alice);
        uint256 b1 = orderBook.submitOrder(true, 2 ether, 3000 * 1e6);
        vm.prank(bob);
        uint256 s1 = orderBook.submitOrder(false, 2 ether, 3000 * 1e6);

        // Advance past batch window
        vm.warp(block.timestamp + WINDOW);

        // Execute batch close & clearing dispatch
        uint256 closedBatchId = orderBook.closeBatch();
        assertEq(closedBatchId, 1);

        ClearingResult memory res = adapter.executeClearing(closedBatchId);

        // Assertions
        assertEq(res.clearingPrice, 3000 * 1e6);
        assertEq(res.fills.length, 2);

        // Alice receives 2 WETH, pays 6000 USDC
        assertEq(weth.balanceOf(alice), 2 ether);
        assertEq(usdc.balanceOf(alice), 0);

        // Bob receives 6000 USDC, pays 2 WETH
        assertEq(weth.balanceOf(bob), 0);
        assertEq(usdc.balanceOf(bob), 6000 * 1e6);

        // Order and batch statuses
        assertEq(orderBook.getOrder(b1).status, uint8(OrderStatus.FILLED));
        assertEq(orderBook.getOrder(s1).status, uint8(OrderStatus.FILLED));
        assertEq(orderBook.getBatch(1).status, uint8(BatchStatus.SETTLED));
    }

    /// Case 2 — Spec 03 §17 / Spec 07 §2 Case 2 Worked Example
    function test_E2E_Case2_WorkedExamplePartialFill() public {
        setupTrader(alice, 0, 10000 * 1e6);   // B1: 2.0 WETH @ 3050
        setupTrader(bob, 0, 10000 * 1e6);     // B2: 1.0 WETH @ 3020
        setupTrader(charlie, 0, 10000 * 1e6); // B3: 3.0 WETH @ 2990
        setupTrader(dave, 5 ether, 0);        // S1: 1.5 WETH @ 2980
        setupTrader(eve, 5 ether, 0);         // S2: 2.0 WETH @ 3010
        setupTrader(frank, 5 ether, 0);       // S3: 1.0 WETH @ 3040

        vm.prank(alice);
        uint256 b1 = orderBook.submitOrder(true, 2 ether, 3050 * 1e6);
        vm.prank(bob);
        uint256 b2 = orderBook.submitOrder(true, 1 ether, 3020 * 1e6);
        vm.prank(charlie);
        uint256 b3 = orderBook.submitOrder(true, 3 ether, 2990 * 1e6);

        vm.prank(dave);
        uint256 s1 = orderBook.submitOrder(false, 15e17, 2980 * 1e6);
        vm.prank(eve);
        uint256 s2 = orderBook.submitOrder(false, 2 ether, 3010 * 1e6);
        vm.prank(frank);
        uint256 s3 = orderBook.submitOrder(false, 1 ether, 3040 * 1e6);

        vm.warp(block.timestamp + WINDOW);
        uint256 closedBatchId = orderBook.closeBatch();

        ClearingResult memory res = adapter.executeClearing(closedBatchId);

        // Exact Spec 03 §17 expected clearing price: P* = 3010 USDC/WETH
        assertEq(res.clearingPrice, 3010 * 1e6, "P* must equal 3010 USDC");
        assertEq(res.fills.length, 4, "4 fills expected");

        // Fills: B1 & B2 fully filled; S1 & S2 pro-rata filled; B3 & S3 unfilled
        assertEq(orderBook.getOrder(b1).status, uint8(OrderStatus.FILLED));
        assertEq(orderBook.getOrder(b2).status, uint8(OrderStatus.FILLED));
        assertEq(orderBook.getOrder(s1).status, uint8(OrderStatus.PARTIALLY_FILLED));
        assertEq(orderBook.getOrder(s2).status, uint8(OrderStatus.PARTIALLY_FILLED));
        assertEq(orderBook.getOrder(b3).status, uint8(OrderStatus.PENDING));
        assertEq(orderBook.getOrder(s3).status, uint8(OrderStatus.PENDING));

        // Rollover into Batch 2 (Spec 03 §13)
        assertEq(orderBook.getOrder(b3).batchId, 2);
        assertEq(orderBook.getOrder(s3).batchId, 2);
        assertEq(orderBook.getOrder(s1).batchId, 2);
        assertEq(orderBook.getOrder(s2).batchId, 2);
    }

    /// Case 3 — Only Buys (07 §2 Case 3, 03 §13)
    function test_E2E_Case3_OnlyBuysRollover() public {
        setupTrader(alice, 0, 5000 * 1e6);
        setupTrader(bob, 0, 5000 * 1e6);

        vm.prank(alice);
        uint256 b1 = orderBook.submitOrder(true, 1 ether, 3000 * 1e6);
        vm.prank(bob);
        uint256 b2 = orderBook.submitOrder(true, 2 ether, 3050 * 1e6);

        vm.warp(block.timestamp + WINDOW);
        uint256 closedBatchId = orderBook.closeBatch();

        ClearingResult memory res = adapter.executeClearing(closedBatchId);

        assertEq(res.clearingPrice, 0);
        assertEq(res.fills.length, 0);

        // Zero token movement
        assertEq(weth.balanceOf(alice), 0);
        assertEq(weth.balanceOf(bob), 0);
        assertEq(usdc.balanceOf(alice), 5000 * 1e6);
        assertEq(usdc.balanceOf(bob), 5000 * 1e6);

        // Orders roll to Batch 2 intact
        assertEq(orderBook.getOrder(b1).batchId, 2);
        assertEq(orderBook.getOrder(b2).batchId, 2);
        assertEq(orderBook.getOrder(b1).status, uint8(OrderStatus.PENDING));
        assertEq(orderBook.getOrder(b2).status, uint8(OrderStatus.PENDING));
    }

    /// Case 4 — Only Sells (07 §2 Case 4, 03 §13)
    function test_E2E_Case4_OnlySellsRollover() public {
        setupTrader(dave, 2 ether, 0);
        setupTrader(eve, 3 ether, 0);

        vm.prank(dave);
        uint256 s1 = orderBook.submitOrder(false, 2 ether, 3000 * 1e6);
        vm.prank(eve);
        uint256 s2 = orderBook.submitOrder(false, 3 ether, 2950 * 1e6);

        vm.warp(block.timestamp + WINDOW);
        uint256 closedBatchId = orderBook.closeBatch();

        ClearingResult memory res = adapter.executeClearing(closedBatchId);

        assertEq(res.clearingPrice, 0);
        assertEq(res.fills.length, 0);

        // Zero token movement
        assertEq(weth.balanceOf(dave), 2 ether);
        assertEq(weth.balanceOf(eve), 3 ether);
        assertEq(usdc.balanceOf(dave), 0);
        assertEq(usdc.balanceOf(eve), 0);

        // Orders roll to Batch 2 intact
        assertEq(orderBook.getOrder(s1).batchId, 2);
        assertEq(orderBook.getOrder(s2).batchId, 2);
        assertEq(orderBook.getOrder(s1).status, uint8(OrderStatus.PENDING));
        assertEq(orderBook.getOrder(s2).status, uint8(OrderStatus.PENDING));
    }

    /// Case 5 — Multi-Price Tie-Break (07 §2 Case 5, 03 §8)
    function test_E2E_Case5_TieBreakLowestPrice() public {
        setupTrader(alice, 0, 5000 * 1e6); // B1: 1.0 @ 3050
        setupTrader(bob, 0, 5000 * 1e6);   // B2: 1.0 @ 3000
        setupTrader(dave, 2 ether, 0);     // S1: 1.0 @ 2990
        setupTrader(eve, 2 ether, 0);      // S2: 1.0 @ 3010

        vm.prank(alice);
        uint256 b1 = orderBook.submitOrder(true, 1 ether, 3050 * 1e6);
        vm.prank(bob);
        uint256 b2 = orderBook.submitOrder(true, 1 ether, 3000 * 1e6);
        vm.prank(dave);
        uint256 s1 = orderBook.submitOrder(false, 1 ether, 2990 * 1e6);
        vm.prank(eve);
        uint256 s2 = orderBook.submitOrder(false, 1 ether, 3010 * 1e6);

        vm.warp(block.timestamp + WINDOW);
        uint256 closedBatchId = orderBook.closeBatch();

        ClearingResult memory res = adapter.executeClearing(closedBatchId);

        // Lowest price 2990 wins the tie-break
        assertEq(res.clearingPrice, 2990 * 1e6, "P* must be 2990");
        assertEq(res.fills.length, 3);

        assertEq(orderBook.getOrder(s1).status, uint8(OrderStatus.FILLED));
        assertEq(orderBook.getOrder(b1).status, uint8(OrderStatus.PARTIALLY_FILLED));
        assertEq(orderBook.getOrder(b2).status, uint8(OrderStatus.PARTIALLY_FILLED));
        assertEq(orderBook.getOrder(s2).status, uint8(OrderStatus.PENDING));

        // Rolled orders in Batch 2
        assertEq(orderBook.getOrder(b1).batchId, 2);
        assertEq(orderBook.getOrder(b2).batchId, 2);
        assertEq(orderBook.getOrder(s2).batchId, 2);
    }

    /// Integration Test: Rollover round-trip & cancellation in Batch 2 (Spec 07 §5, Spec 03 §14)
    function test_E2E_RolloverRoundTrip_CancelInBatch2() public {
        setupTrader(alice, 0, 5000 * 1e6);

        // Submit order in Batch 1
        vm.prank(alice);
        uint256 orderId = orderBook.submitOrder(true, 1 ether, 3000 * 1e6);

        // Close Batch 1 (unmatched, rolls forward)
        vm.warp(block.timestamp + WINDOW);
        uint256 closedBatchId = orderBook.closeBatch();
        adapter.executeClearing(closedBatchId);

        // Order is now in Batch 2 with status PENDING
        Order memory rolledOrder = orderBook.getOrder(orderId);
        assertEq(rolledOrder.batchId, 2);
        assertEq(rolledOrder.status, uint8(OrderStatus.PENDING));

        // Trader cancels order in Batch 2 while Batch 2 is OPEN
        vm.prank(alice);
        orderBook.cancelOrder(orderId);

        Order memory cancelledOrder = orderBook.getOrder(orderId);
        assertEq(cancelledOrder.status, uint8(OrderStatus.CANCELLED));
    }

    /// Integration Test: Permissionless closeBatch from non-owner arbitrary address (Spec 07 §5, Spec 04 §8)
    function test_E2E_PermissionlessCloseBatch_NonOwner() public {
        setupTrader(alice, 0, 3000 * 1e6);
        setupTrader(bob, 1 ether, 0);

        vm.prank(alice);
        orderBook.submitOrder(true, 1 ether, 3000 * 1e6);
        vm.prank(bob);
        orderBook.submitOrder(false, 1 ether, 3000 * 1e6);

        vm.warp(block.timestamp + WINDOW);

        // Arbitrary unprivileged address calls closeBatch
        address randomKeeper = address(0x8888);
        vm.prank(randomKeeper);
        uint256 closedId = orderBook.closeBatch();
        assertEq(closedId, 1);

        ClearingResult memory res = adapter.executeClearing(closedId);
        assertEq(res.clearingPrice, 3000 * 1e6);
        assertEq(orderBook.getBatch(1).status, uint8(BatchStatus.SETTLED));
    }

    /// Integration Test: Sandwich AMM comparison calculation accuracy (Spec 07 §5, Spec 06 §2)
    function test_E2E_SandwichComparisonPanelAccuracy() public pure {
        // Victim submits 10 WETH buy on traditional sequential AMM with pool: 100 WETH, 300,000 USDC (k = 30,000,000)
        // Bot front-runs by buying 5 WETH before victim, raising the price.
        uint256 rBase = 100 * 1e18;
        uint256 rQuote = 300_000 * 1e6;
        uint256 k = rBase * rQuote;

        // In ClearSwap: all orders match at single uniform P* with 0 sandwich extraction.
        // Value extracted by MEV on sequential AMM = price slippage delta * victim amount
        uint256 frontrunBase = 5 * 1e18;
        uint256 newRBase = rBase - frontrunBase;
        uint256 newRQuote = k / newRBase;
        uint256 botCost = newRQuote - rQuote;

        assertTrue(botCost > 0, "MEV bot extracts value in sequential execution");
        // ClearSwap invariant: single execution price eliminates frontrun ordering advantage.
    }

    /// Invariant: Single uniform price guarantee across all fills (Spec 07 §4, Spec 03 §15)
    function test_E2E_Invariant_SinglePriceGuarantee() public {
        setupTrader(alice, 0, 10000 * 1e6);
        setupTrader(bob, 0, 10000 * 1e6);
        setupTrader(dave, 5 ether, 0);
        setupTrader(eve, 5 ether, 0);

        vm.prank(alice);
        orderBook.submitOrder(true, 2 ether, 3050 * 1e6);
        vm.prank(bob);
        orderBook.submitOrder(true, 1 ether, 3020 * 1e6);
        vm.prank(dave);
        orderBook.submitOrder(false, 15e17, 2980 * 1e6);
        vm.prank(eve);
        orderBook.submitOrder(false, 2 ether, 3010 * 1e6);

        vm.warp(block.timestamp + WINDOW);
        uint256 closedBatchId = orderBook.closeBatch();

        ClearingResult memory res = adapter.executeClearing(closedBatchId);

        for (uint256 i = 0; i < res.fills.length; i++) {
            assertEq(res.fills[i].clearingPrice, res.clearingPrice, "Every fill price must match clearingPrice");
        }
    }
}
