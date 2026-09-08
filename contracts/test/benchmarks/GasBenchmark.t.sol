// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {SolidityClearingBenchmark} from "./SolidityClearingBenchmark.sol";
import {Order, ClearingResult, Fill} from "../../src/types/DataTypes.sol";

/// @title Gas Benchmark Test Suite
/// @notice Measures clearing gas across N = 2, 6, 10 orders for pure Solidity benchmark (Spec 07 §6)
contract GasBenchmarkTest is Test {
    SolidityClearingBenchmark internal engine;

    function setUp() public {
        engine = new SolidityClearingBenchmark();
    }

    function makeOrder(uint256 id, address trader, bool isBuy, uint256 amount, uint256 limitPrice) internal pure returns (Order memory) {
        return Order({
            id: id,
            trader: trader,
            isBuy: isBuy,
            amount: amount,
            limitPrice: limitPrice,
            batchId: 1,
            status: 0
        });
    }

    function test_Benchmark_N2_Orders() public view {
        Order[] memory orders = new Order[](2);
        orders[0] = makeOrder(1, address(0x1), true, 2 ether, 3000 * 1e6);
        orders[1] = makeOrder(2, address(0x2), false, 2 ether, 3000 * 1e6);

        uint256 gasBefore = gasleft();
        ClearingResult memory res = engine.computeClearing(orders);
        uint256 gasUsed = gasBefore - gasleft();

        console.log("Solidity Clearing Gas (N=2): ", gasUsed);
        assertEq(res.clearingPrice, 3000 * 1e6);
    }

    function test_Benchmark_N6_Orders() public view {
        Order[] memory orders = new Order[](6);
        orders[0] = makeOrder(1, address(0x1), true, 2 ether, 3050 * 1e6);
        orders[1] = makeOrder(2, address(0x2), true, 1 ether, 3020 * 1e6);
        orders[2] = makeOrder(3, address(0x3), true, 3 ether, 2990 * 1e6);
        orders[3] = makeOrder(4, address(0x4), false, 15e17, 2980 * 1e6);
        orders[4] = makeOrder(5, address(0x5), false, 2 ether, 3010 * 1e6);
        orders[5] = makeOrder(6, address(0x6), false, 1 ether, 3040 * 1e6);

        uint256 gasBefore = gasleft();
        ClearingResult memory res = engine.computeClearing(orders);
        uint256 gasUsed = gasBefore - gasleft();

        console.log("Solidity Clearing Gas (N=6): ", gasUsed);
        assertEq(res.clearingPrice, 3010 * 1e6);
    }

    function test_Benchmark_N10_Orders() public view {
        Order[] memory orders = new Order[](10);
        orders[0] = makeOrder(1, address(0x1), true, 2 ether, 3050 * 1e6);
        orders[1] = makeOrder(2, address(0x2), true, 1 ether, 3040 * 1e6);
        orders[2] = makeOrder(3, address(0x3), true, 1 ether, 3030 * 1e6);
        orders[3] = makeOrder(4, address(0x4), true, 2 ether, 3020 * 1e6);
        orders[4] = makeOrder(5, address(0x5), true, 3 ether, 2990 * 1e6);
        orders[5] = makeOrder(6, address(0x6), false, 1 ether, 2980 * 1e6);
        orders[6] = makeOrder(7, address(0x7), false, 2 ether, 3000 * 1e6);
        orders[7] = makeOrder(8, address(0x8), false, 2 ether, 3010 * 1e6);
        orders[8] = makeOrder(9, address(0x9), false, 1 ether, 3030 * 1e6);
        orders[9] = makeOrder(10, address(0xA), false, 2 ether, 3050 * 1e6);

        uint256 gasBefore = gasleft();
        ClearingResult memory res = engine.computeClearing(orders);
        uint256 gasUsed = gasBefore - gasleft();

        console.log("Solidity Clearing Gas (N=10):", gasUsed);
        assertTrue(res.clearingPrice > 0);
    }
}
