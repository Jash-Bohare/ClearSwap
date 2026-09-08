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
        uint256 deployerPrivateKey = vm.envOr("PRIVATE_KEY", uint256(0));
        if (deployerPrivateKey != 0) {
            vm.startBroadcast(deployerPrivateKey);
        } else {
            vm.startBroadcast();
        }

        // 1. Deploy Mock Tokens (or reuse existing addresses if specified in env)
        address envWeth = vm.envOr("WETH_ADDRESS", address(0));
        address envUsdc = vm.envOr("USDC_ADDRESS", address(0));

        if (envWeth != address(0)) {
            weth = envWeth;
        } else {
            MockWETH mockWeth = new MockWETH();
            weth = address(mockWeth);
        }

        if (envUsdc != address(0)) {
            usdc = envUsdc;
        } else {
            MockUSDC mockUsdc = new MockUSDC();
            usdc = address(mockUsdc);
        }

        // 2. Read Stylus Clearing Engine address (from env or default placeholder)
        address clearingEngine = vm.envOr("STYLUS_ENGINE_ADDRESS", address(0x1234567890123456789012345678901234567890));

        // 3. Deploy OrderBook (Spec 04 §11)
        uint256 windowSeconds = vm.envOr("BATCH_WINDOW_SECONDS", Constants.DEFAULT_BATCH_WINDOW_SECONDS);
        uint256 minSize = vm.envOr("MIN_ORDER_SIZE", Constants.MIN_ORDER_SIZE);
        OrderBook ob = new OrderBook(windowSeconds, minSize);
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
        console.log("ClearingEngine:  ", clearingEngine);
        console.log("OrderBook:       ", orderBook);
        console.log("ClearingAdapter: ", clearingAdapter);
        console.log("Settlement:      ", settlement);
    }
}
