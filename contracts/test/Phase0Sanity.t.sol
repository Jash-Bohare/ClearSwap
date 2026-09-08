// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {MockWETH} from "../src/mocks/MockWETH.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {Constants} from "../src/Constants.sol";
import {Order, Batch, Fill, ClearingResult, OrderStatus, BatchStatus} from "../src/types/DataTypes.sol";

contract Phase0SanityTest is Test {
    MockWETH public weth;
    MockUSDC public usdc;
    address public alice = address(0xA11CE);
    address public bob = address(0xB0B);

    function setUp() public {
        weth = new MockWETH();
        usdc = new MockUSDC();
    }

    function test_mock_decimals_and_constants() public view {
        assertEq(weth.decimals(), Constants.BASE_DECIMALS, "WETH must have 18 decimals");
        assertEq(usdc.decimals(), Constants.QUOTE_DECIMALS, "USDC must have 6 decimals");
        assertEq(Constants.MIN_ORDER_SIZE, 1e15, "MIN_ORDER_SIZE must be 0.001 WETH");
        assertEq(Constants.DEFAULT_BATCH_WINDOW_SECONDS, 45, "DEFAULT_BATCH_WINDOW_SECONDS must be 45s");
    }

    function test_minting() public {
        weth.mint(alice, 10 ether);
        usdc.mint(bob, 50_000 * 1e6);

        assertEq(weth.balanceOf(alice), 10 ether);
        assertEq(usdc.balanceOf(bob), 50_000 * 1e6);
    }

    function test_struct_sizes_and_types() public pure {
        uint256[] memory emptyIds = new uint256[](0);
        Batch memory batch = Batch({
            id: 1,
            status: uint8(BatchStatus.OPEN),
            startTime: 1000,
            endTime: 1045,
            orderIds: emptyIds
        });
        assertEq(batch.id, 1);
        assertEq(batch.status, 0);

        Order memory order = Order({
            id: 101,
            trader: address(0x1),
            isBuy: true,
            amount: 1 ether,
            limitPrice: 3000 * 1e6,
            batchId: 1,
            status: uint8(OrderStatus.PENDING)
        });
        assertEq(order.id, 101);
        assertEq(order.amount, 1 ether);
    }
}
