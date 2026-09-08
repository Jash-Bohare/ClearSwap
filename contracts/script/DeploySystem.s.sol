// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MockWETH} from "../src/mocks/MockWETH.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {OrderBook} from "../src/OrderBook.sol";
import {ClearingAdapter} from "../src/ClearingAdapter.sol";
import {Settlement} from "../src/Settlement.sol";
import {Constants} from "../src/Constants.sol";

contract DeploySystem is Script {
    function run()
        external
        returns (
            address weth,
            address usdc,
            address orderBook,
            address clearingAdapter,
            address settlement
        )
    {
        vm.startBroadcast();

        // 1. Deploy Mock Tokens
        MockWETH mockWeth = new MockWETH();
        MockUSDC mockUsdc = new MockUSDC();
        weth = address(mockWeth);
        usdc = address(mockUsdc);

        // 2. Mock Clearing Engine placeholder address (or Stylus deployed address)
        address clearingEngine = address(0x1234567890123456789012345678901234567890);

        // 3. Deploy OrderBook
        OrderBook ob = new OrderBook(Constants.DEFAULT_BATCH_WINDOW_SECONDS, Constants.MIN_ORDER_SIZE);
        orderBook = address(ob);

        // 4. Deploy ClearingAdapter
        ClearingAdapter adapter = new ClearingAdapter(orderBook, clearingEngine, address(0));
        clearingAdapter = address(adapter);

        // 5. Deploy Settlement
        Settlement st = new Settlement(weth, usdc, orderBook, clearingAdapter);
        settlement = address(st);

        // 6. Complete cross-contract wiring (Spec 04 §11)
        ob.setSettlement(settlement);
        ob.setClearingAdapter(clearingAdapter);
        adapter.setSettlement(settlement);

        vm.stopBroadcast();

        console.log("=== ClearSwap System Deployed ===");
        console.log("MockWETH:        ", weth);
        console.log("MockUSDC:        ", usdc);
        console.log("OrderBook:       ", orderBook);
        console.log("ClearingAdapter: ", clearingAdapter);
        console.log("Settlement:      ", settlement);
    }
}
