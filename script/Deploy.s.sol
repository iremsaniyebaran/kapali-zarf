// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MockUSD} from "../src/MockUSD.sol";
import {MockWETH} from "../src/MockWETH.sol";
import {MockOracle} from "../src/MockOracle.sol";
import {LendingPool} from "../src/LendingPool.sol";
import {KapaliZarf} from "../src/KapaliZarf.sol";

/// @notice Deploys the five contracts, wires them together, funds the pool and writes
/// deployments/<chainId>.json for the bot scripts and the stage page.
/// Usage: npm run deploy   (reads DEPLOYER_PK, optional COMMIT_BLOCKS / REVEAL_BLOCKS from .env)
contract Deploy is Script {
    uint256 internal constant START_PRICE = 1000e18;
    uint256 internal constant POOL_LIQUIDITY = 1_000_000e18;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PK");
        uint256 commitBlocks = vm.envOr("COMMIT_BLOCKS", uint256(3));
        uint256 revealBlocks = vm.envOr("REVEAL_BLOCKS", uint256(3));

        vm.startBroadcast(deployerKey);
        MockUSD usd = new MockUSD();
        MockWETH weth = new MockWETH();
        MockOracle oracle = new MockOracle(START_PRICE);
        LendingPool pool = new LendingPool(usd, weth, oracle);
        KapaliZarf kz = new KapaliZarf(usd, weth, address(pool), commitBlocks, revealBlocks);
        pool.setKapaliZarf(kz);
        usd.mint(address(pool), POOL_LIQUIDITY);
        vm.stopBroadcast();

        string memory key = "deployment";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeUint(key, "deployBlock", block.number);
        vm.serializeUint(key, "commitBlocks", commitBlocks);
        vm.serializeUint(key, "revealBlocks", revealBlocks);
        vm.serializeAddress(key, "owner", vm.addr(deployerKey));
        vm.serializeAddress(key, "MockUSD", address(usd));
        vm.serializeAddress(key, "MockWETH", address(weth));
        vm.serializeAddress(key, "MockOracle", address(oracle));
        vm.serializeAddress(key, "LendingPool", address(pool));
        string memory json = vm.serializeAddress(key, "KapaliZarf", address(kz));

        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);

        console.log("MockUSD     ", address(usd));
        console.log("MockWETH    ", address(weth));
        console.log("MockOracle  ", address(oracle));
        console.log("LendingPool ", address(pool));
        console.log("KapaliZarf  ", address(kz));
        console.log("Written to  ", path);
    }
}
