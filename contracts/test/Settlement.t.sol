// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Settlement} from "../src/Settlement.sol";
import {ISettlement} from "../src/interfaces/ISettlement.sol";
import {OrderBook} from "../src/OrderBook.sol";
import {MockWETH} from "../src/mocks/MockWETH.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {Order, Batch, ClearingResult, Fill, OrderStatus, BatchStatus} from "../src/types/DataTypes.sol";
import {Constants} from "../src/Constants.sol";

/// @title Settlement Test
/// @notice Implements Spec 07 §3 Settlement Tests and Spec 07 §4 Invariant Tests
contract SettlementTest is Test {
    MockWETH internal baseToken;
    MockUSDC internal quoteToken;
    OrderBook internal orderBook;
    Settlement internal settlement;

    address internal adapter = address(0xCA);
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal charlie = address(0xCC);
    address internal dave = address(0xDD);
    address internal eve = address(0xEE);
    address internal frank = address(0xFF);

    uint256 internal constant BASE_SCALE = 1e18;

    function setUp() public {
        baseToken = new MockWETH();
        quoteToken = new MockUSDC();
        orderBook = new OrderBook(45, 1e15);
        settlement = new Settlement(
            address(baseToken),
            address(quoteToken),
            address(orderBook),
            adapter
        );
        orderBook.setSettlement(address(settlement));
        orderBook.setClearingAdapter(adapter);

        // Pre-fund settlement contract with base and quote tokens to facilitate counterparty transfers
        baseToken.mint(address(settlement), 1000e18);
        quoteToken.mint(address(settlement), 1000_000_000000);
    }

    function setupTrader(address trader, uint256 baseAmount, uint256 quoteAmount) internal {
        if (baseAmount > 0) {
            baseToken.mint(trader, baseAmount);
            vm.prank(trader);
            baseToken.approve(address(settlement), baseAmount);
        }
        if (quoteAmount > 0) {
            quoteToken.mint(trader, quoteAmount);
            vm.prank(trader);
            quoteToken.approve(address(settlement), quoteAmount);
        }
    }

    /// Case 1 — Perfect Match Settlement (07 §2 Case 1, 07 §3)
    function test_Case1_ExactMatchSettlement() public {
        // B1: Buy 2.0 WETH @ 3000 USDC
        // S1: Sell 2.0 WETH @ 3000 USDC
        setupTrader(alice, 0, 6000_000000);
        setupTrader(bob, 2e18, 0);

        vm.prank(alice);
        uint256 b1 = orderBook.submitOrder(true, 2e18, 3000_000000);
        vm.prank(bob);
        uint256 s1 = orderBook.submitOrder(false, 2e18, 3000_000000);

        vm.warp(block.timestamp + 45);
        orderBook.closeBatch();

        Fill[] memory fills = new Fill[](2);
        fills[0] = Fill({
            orderId: b1,
            trader: alice,
            isBuy: true,
            filledAmount: 2e18,
            clearingPrice: 3000_000000
        });
        fills[1] = Fill({
            orderId: s1,
            trader: bob,
            isBuy: false,
            filledAmount: 2e18,
            clearingPrice: 3000_000000
        });

        ClearingResult memory res = ClearingResult({
            batchId: 1,
            clearingPrice: 3000_000000,
            fills: fills
        });

        vm.prank(adapter);
        settlement.settleBatch(1, res);

        // Alice (buyer) receives 2 WETH, pays 6000 USDC
        assertEq(baseToken.balanceOf(alice), 2e18);
        assertEq(quoteToken.balanceOf(alice), 0);

        // Bob (seller) pays 2 WETH, receives 6000 USDC
        assertEq(baseToken.balanceOf(bob), 0);
        assertEq(quoteToken.balanceOf(bob), 6000_000000);

        // Orders marked FILLED
        assertEq(orderBook.getOrder(b1).status, uint8(OrderStatus.FILLED));
        assertEq(orderBook.getOrder(s1).status, uint8(OrderStatus.FILLED));

        // Batch marked SETTLED
        assertEq(orderBook.getBatch(1).status, uint8(BatchStatus.SETTLED));
    }

    /// Case 2 — Partial Fill & Remainder Settlement (07 §2 Case 2 / Spec 03 §17 Worked Example)
    function test_Case2_WorkedExampleSettlement() public {
        setupTrader(alice, 0, 10000_000000); // B1
        setupTrader(bob, 0, 10000_000000);   // B2
        setupTrader(charlie, 0, 10000_000000); // B3
        setupTrader(dave, 5e18, 0); // S1
        setupTrader(eve, 5e18, 0);  // S2
        setupTrader(frank, 5e18, 0);// S3

        vm.prank(alice);
        uint256 b1 = orderBook.submitOrder(true, 2e18, 3050_000000);
        vm.prank(bob);
        uint256 b2 = orderBook.submitOrder(true, 1e18, 3020_000000);
        vm.prank(charlie);
        uint256 b3 = orderBook.submitOrder(true, 3e18, 2990_000000);

        vm.prank(dave);
        uint256 s1 = orderBook.submitOrder(false, 15e17, 2980_000000); // 1.5 WETH
        vm.prank(eve);
        uint256 s2 = orderBook.submitOrder(false, 2e18, 3010_000000);   // 2.0 WETH
        vm.prank(frank);
        uint256 s3 = orderBook.submitOrder(false, 1e18, 3040_000000);   // 1.0 WETH

        vm.warp(block.timestamp + 45);
        orderBook.closeBatch();

        // Exact expected fills from Spec 03 §17:
        // P* = 3010_000000
        // B1: 2.0 WETH
        // B2: 1.0 WETH
        // S1: 1.285714285714285715 WETH
        // S2: 1.714285714285714285 WETH
        Fill[] memory fills = new Fill[](4);
        fills[0] = Fill(b1, alice, true, 2e18, 3010_000000);
        fills[1] = Fill(b2, bob, true, 1e18, 3010_000000);
        fills[2] = Fill(s1, dave, false, 1285714285714285715, 3010_000000);
        fills[3] = Fill(s2, eve, false, 1714285714285714285, 3010_000000);

        ClearingResult memory res = ClearingResult({
            batchId: 1,
            clearingPrice: 3010_000000,
            fills: fills
        });

        vm.prank(adapter);
        settlement.settleBatch(1, res);

        // Verify status updates
        assertEq(orderBook.getOrder(b1).status, uint8(OrderStatus.FILLED));
        assertEq(orderBook.getOrder(b2).status, uint8(OrderStatus.FILLED));
        assertEq(orderBook.getOrder(s1).status, uint8(OrderStatus.PARTIALLY_FILLED));
        assertEq(orderBook.getOrder(s2).status, uint8(OrderStatus.PARTIALLY_FILLED));
        assertEq(orderBook.getOrder(b3).status, uint8(OrderStatus.PENDING));
        assertEq(orderBook.getOrder(s3).status, uint8(OrderStatus.PENDING));

        // Verify unmatched and partially filled orders rolled forward into Batch 2 (03 §13)
        assertEq(orderBook.getOrder(s1).batchId, 2);
        assertEq(orderBook.getOrder(s2).batchId, 2);
        assertEq(orderBook.getOrder(b3).batchId, 2);
        assertEq(orderBook.getOrder(s3).batchId, 2);
    }

    /// Case 3 — Only Buys (07 §2 Case 3, 03 §13)
    function test_Case3_OnlyBuysRolloverNoTokensMoved() public {
        setupTrader(alice, 0, 5000_000000);
        setupTrader(bob, 0, 5000_000000);

        vm.prank(alice);
        uint256 b1 = orderBook.submitOrder(true, 1e18, 3000_000000);
        vm.prank(bob);
        uint256 b2 = orderBook.submitOrder(true, 2e18, 3050_000000);

        vm.warp(block.timestamp + 45);
        orderBook.closeBatch();

        ClearingResult memory res = ClearingResult({
            batchId: 1,
            clearingPrice: 0,
            fills: new Fill[](0)
        });

        uint256 aliceQuoteBefore = quoteToken.balanceOf(alice);
        uint256 bobQuoteBefore = quoteToken.balanceOf(bob);

        vm.prank(adapter);
        settlement.settleBatch(1, res);

        // Zero tokens moved (03 §13)
        assertEq(quoteToken.balanceOf(alice), aliceQuoteBefore);
        assertEq(quoteToken.balanceOf(bob), bobQuoteBefore);
        assertEq(baseToken.balanceOf(alice), 0);
        assertEq(baseToken.balanceOf(bob), 0);

        // Both rolled forward to Batch 2
        assertEq(orderBook.getOrder(b1).batchId, 2);
        assertEq(orderBook.getOrder(b2).batchId, 2);
        assertEq(orderBook.getOrder(b1).status, uint8(OrderStatus.PENDING));
        assertEq(orderBook.getOrder(b2).status, uint8(OrderStatus.PENDING));
    }

    /// Case 4 — Only Sells (07 §2 Case 4, 03 §13)
    function test_Case4_OnlySellsRolloverNoTokensMoved() public {
        setupTrader(dave, 2e18, 0);
        setupTrader(eve, 3e18, 0);

        vm.prank(dave);
        uint256 s1 = orderBook.submitOrder(false, 2e18, 3000_000000);
        vm.prank(eve);
        uint256 s2 = orderBook.submitOrder(false, 3e18, 2950_000000);

        vm.warp(block.timestamp + 45);
        orderBook.closeBatch();

        ClearingResult memory res = ClearingResult({
            batchId: 1,
            clearingPrice: 0,
            fills: new Fill[](0)
        });

        uint256 daveBaseBefore = baseToken.balanceOf(dave);
        uint256 eveBaseBefore = baseToken.balanceOf(eve);

        vm.prank(adapter);
        settlement.settleBatch(1, res);

        // Zero tokens moved
        assertEq(baseToken.balanceOf(dave), daveBaseBefore);
        assertEq(baseToken.balanceOf(eve), eveBaseBefore);
        assertEq(quoteToken.balanceOf(dave), 0);
        assertEq(quoteToken.balanceOf(eve), 0);

        // Both rolled forward to Batch 2
        assertEq(orderBook.getOrder(s1).batchId, 2);
        assertEq(orderBook.getOrder(s2).batchId, 2);
        assertEq(orderBook.getOrder(s1).status, uint8(OrderStatus.PENDING));
        assertEq(orderBook.getOrder(s2).status, uint8(OrderStatus.PENDING));
    }

    /// Case 5 — Multiple Prices Tie-Break Settlement (07 §2 Case 5, 03 §8)
    function test_Case5_TieBreakSettlement() public {
        setupTrader(alice, 0, 5000_000000); // B1
        setupTrader(bob, 0, 5000_000000);   // B2
        setupTrader(dave, 2e18, 0);         // S1
        setupTrader(eve, 2e18, 0);          // S2

        vm.prank(alice);
        uint256 b1 = orderBook.submitOrder(true, 1e18, 3050_000000);
        vm.prank(bob);
        uint256 b2 = orderBook.submitOrder(true, 1e18, 3000_000000);
        vm.prank(dave);
        uint256 s1 = orderBook.submitOrder(false, 1e18, 2990_000000);
        vm.prank(eve);
        uint256 s2 = orderBook.submitOrder(false, 1e18, 3010_000000);

        vm.warp(block.timestamp + 45);
        orderBook.closeBatch();

        // P* = 2990_000000
        // S1 fills 1.0 WETH
        // B1 fills 0.5 WETH, B2 fills 0.5 WETH
        Fill[] memory fills = new Fill[](3);
        fills[0] = Fill(b1, alice, true, 5e17, 2990_000000);
        fills[1] = Fill(b2, bob, true, 5e17, 2990_000000);
        fills[2] = Fill(s1, dave, false, 1e18, 2990_000000);

        ClearingResult memory res = ClearingResult(1, 2990_000000, fills);

        vm.prank(adapter);
        settlement.settleBatch(1, res);

        assertEq(orderBook.getOrder(b1).status, uint8(OrderStatus.PARTIALLY_FILLED));
        assertEq(orderBook.getOrder(b2).status, uint8(OrderStatus.PARTIALLY_FILLED));
        assertEq(orderBook.getOrder(s1).status, uint8(OrderStatus.FILLED));
        assertEq(orderBook.getOrder(s2).status, uint8(OrderStatus.PENDING));

        // Unfilled & partially filled roll to Batch 2
        assertEq(orderBook.getOrder(b1).batchId, 2);
        assertEq(orderBook.getOrder(b2).batchId, 2);
        assertEq(orderBook.getOrder(s2).batchId, 2);
    }

    /// Double settlement reverts with BatchAlreadySettled (07 §3, 07 §4)
    function test_NoDoubleSettlement() public {
        setupTrader(alice, 0, 3000_000000);
        setupTrader(bob, 1e18, 0);

        vm.prank(alice);
        uint256 b1 = orderBook.submitOrder(true, 1e18, 3000_000000);
        vm.prank(bob);
        uint256 s1 = orderBook.submitOrder(false, 1e18, 3000_000000);

        vm.warp(block.timestamp + 45);
        orderBook.closeBatch();

        Fill[] memory fills = new Fill[](2);
        fills[0] = Fill(b1, alice, true, 1e18, 3000_000000);
        fills[1] = Fill(s1, bob, false, 1e18, 3000_000000);

        ClearingResult memory res = ClearingResult({
            batchId: 1,
            clearingPrice: 3000_000000,
            fills: fills
        });

        vm.prank(adapter);
        settlement.settleBatch(1, res);

        // Second settle attempt reverts
        vm.prank(adapter);
        vm.expectRevert(abi.encodeWithSelector(ISettlement.BatchAlreadySettled.selector, 1));
        settlement.settleBatch(1, res);
    }

    /// Underfunded trader reverts settlement (MVP Known Limitation / Spec 06 §5, Spec 07 §3)
    function test_SettlementHandlesUnderfundedTrader() public {
        // Alice submits buy order for 1 WETH at 3000 USDC, but only holds 100 USDC
        setupTrader(alice, 0, 100_000000);
        setupTrader(bob, 1e18, 0);

        vm.prank(alice);
        uint256 b1 = orderBook.submitOrder(true, 1e18, 3000_000000);
        vm.prank(bob);
        uint256 s1 = orderBook.submitOrder(false, 1e18, 3000_000000);

        vm.warp(block.timestamp + 45);
        orderBook.closeBatch();

        Fill[] memory fills = new Fill[](2);
        fills[0] = Fill(b1, alice, true, 1e18, 3000_000000);
        fills[1] = Fill(s1, bob, false, 1e18, 3000_000000);

        ClearingResult memory res = ClearingResult({
            batchId: 1,
            clearingPrice: 3000_000000,
            fills: fills
        });

        // Reverts on SafeERC20 transfer pull due to insufficient balance
        vm.prank(adapter);
        vm.expectRevert();
        settlement.settleBatch(1, res);
    }

    /// Invariant: sum(quote debited from buyers) == sum(quote credited to sellers) (07 §4, Spec 03 §15)
    function test_Invariant_TokenConservation() public {
        setupTrader(alice, 0, 6000_000000);
        setupTrader(bob, 0, 3000_000000);
        setupTrader(dave, 2e18, 0);
        setupTrader(eve, 1e18, 0);

        vm.prank(alice);
        uint256 b1 = orderBook.submitOrder(true, 2e18, 3000_000000);
        vm.prank(bob);
        uint256 b2 = orderBook.submitOrder(true, 1e18, 3000_000000);
        vm.prank(dave);
        uint256 s1 = orderBook.submitOrder(false, 2e18, 3000_000000);
        vm.prank(eve);
        uint256 s2 = orderBook.submitOrder(false, 1e18, 3000_000000);

        vm.warp(block.timestamp + 45);
        orderBook.closeBatch();

        uint256 pStar = 3000_000000;
        Fill[] memory fills = new Fill[](4);
        fills[0] = Fill(b1, alice, true, 2e18, pStar);
        fills[1] = Fill(b2, bob, true, 1e18, pStar);
        fills[2] = Fill(s1, dave, false, 2e18, pStar);
        fills[3] = Fill(s2, eve, false, 1e18, pStar);

        ClearingResult memory res = ClearingResult(1, pStar, fills);

        uint256 aliceQuoteBefore = quoteToken.balanceOf(alice);
        uint256 bobQuoteBefore = quoteToken.balanceOf(bob);
        uint256 daveQuoteBefore = quoteToken.balanceOf(dave);
        uint256 eveQuoteBefore = quoteToken.balanceOf(eve);

        vm.prank(adapter);
        settlement.settleBatch(1, res);

        uint256 totalQuotePulled = (aliceQuoteBefore - quoteToken.balanceOf(alice)) +
                                   (bobQuoteBefore - quoteToken.balanceOf(bob));

        uint256 totalQuoteCredited = (quoteToken.balanceOf(dave) - daveQuoteBefore) +
                                     (quoteToken.balanceOf(eve) - eveQuoteBefore);

        assertEq(totalQuotePulled, totalQuoteCredited, "Value conservation: buyer debits must equal seller credits");
        assertEq(totalQuotePulled, 9000_000000);
    }

    /// Invariant: executionPrice identical for all fills (07 §4, Spec 03 §15 Invariant 3)
    function test_Invariant_ExecutionPriceIdenticalForAllFills() public {
        setupTrader(alice, 0, 3000_000000);
        setupTrader(bob, 1e18, 0);

        vm.prank(alice);
        uint256 b1 = orderBook.submitOrder(true, 1e18, 3000_000000);
        vm.prank(bob);
        uint256 s1 = orderBook.submitOrder(false, 1e18, 3000_000000);

        vm.warp(block.timestamp + 45);
        orderBook.closeBatch();

        uint256 uniformPrice = 3000_000000;
        Fill[] memory fills = new Fill[](2);
        fills[0] = Fill(b1, alice, true, 1e18, uniformPrice);
        fills[1] = Fill(s1, bob, false, 1e18, uniformPrice);

        ClearingResult memory res = ClearingResult(1, uniformPrice, fills);

        for (uint256 i = 0; i < res.fills.length; i++) {
            assertEq(res.fills[i].clearingPrice, res.clearingPrice, "Every fill price must match clearingPrice");
        }

        vm.prank(adapter);
        settlement.settleBatch(1, res);
    }

    /// Invariant: Custody safety for unfilled orders (07 §4, Spec 03 §15 Invariant 4)
    function test_Invariant_CustodySafetyForUnfilledOrders() public {
        setupTrader(alice, 0, 3000_000000); // Unmatched buy
        setupTrader(bob, 0, 3000_000000);   // Matched buy
        setupTrader(dave, 1e18, 0);         // Matched sell

        vm.prank(alice);
        uint256 b1 = orderBook.submitOrder(true, 1e18, 2900_000000); // Out of the money
        vm.prank(bob);
        uint256 b2 = orderBook.submitOrder(true, 1e18, 3000_000000);
        vm.prank(dave);
        uint256 s1 = orderBook.submitOrder(false, 1e18, 3000_000000);

        vm.warp(block.timestamp + 45);
        orderBook.closeBatch();

        uint256 aliceQuoteBefore = quoteToken.balanceOf(alice);
        uint256 aliceBaseBefore = baseToken.balanceOf(alice);

        Fill[] memory fills = new Fill[](2);
        fills[0] = Fill(b2, bob, true, 1e18, 3000_000000);
        fills[1] = Fill(s1, dave, false, 1e18, 3000_000000);

        ClearingResult memory res = ClearingResult(1, 3000_000000, fills);

        vm.prank(adapter);
        settlement.settleBatch(1, res);

        // Alice (unmatched trader) has 0 token balance changes
        assertEq(quoteToken.balanceOf(alice), aliceQuoteBefore, "Custody safety: zero quote change for unmatched trader");
        assertEq(baseToken.balanceOf(alice), aliceBaseBefore, "Custody safety: zero base change for unmatched trader");
        assertEq(orderBook.getOrder(b1).batchId, 2, "Unmatched order rolls to next batch");
    }
}
