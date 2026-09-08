// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MockWETH} from "../src/mocks/MockWETH.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

contract DeployMocks is Script {
    function run() external returns (address wethAddress, address usdcAddress) {
        vm.startBroadcast();

        MockWETH weth = new MockWETH();
        MockUSDC usdc = new MockUSDC();

        // Pre-mint test balances for canonical demo addresses
        address deployer = msg.sender;
        weth.mint(deployer, 1000 ether);
        usdc.mint(deployer, 1_000_000 * 1e6);

        vm.stopBroadcast();

        console.log("MockWETH deployed at:", address(weth));
        console.log("MockUSDC deployed at:", address(usdc));

        return (address(weth), address(usdc));
    }
}
