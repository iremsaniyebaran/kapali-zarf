// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MockUSD} from "../src/MockUSD.sol";
import {MockWETH} from "../src/MockWETH.sol";
import {MockOracle} from "../src/MockOracle.sol";
import {LendingPool} from "../src/LendingPool.sol";
import {KapaliZarf} from "../src/KapaliZarf.sol";

/// @notice Deploys the five contracts, wires them together, funds the pool and writes the address
/// file shared by the bots and the stage page: shared/addresses.json on Monad testnet,
/// shared/addresses.<chainId>.json anywhere else (so a local Anvil run never overwrites testnet).
/// Usage: npm run deploy   (reads DEPLOYER_PK, optional COMMIT_BLOCKS / REVEAL_BLOCKS from .env)
contract Deploy is Script {
    uint256 internal constant MONAD_TESTNET = 10143;
    uint256 internal constant START_PRICE = 1000e18;
    uint256 internal constant POOL_LIQUIDITY = 1_000_000e18;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PK");
        // Roadmap decision 1: start at 8/8 blocks, measure on testnet, then shorten to 3-5.
        uint256 commitBlocks = vm.envOr("COMMIT_BLOCKS", uint256(8));
        uint256 revealBlocks = vm.envOr("REVEAL_BLOCKS", uint256(8));
        uint256 deployBlock = block.number;

        vm.startBroadcast(deployerKey);
        MockUSD usd = new MockUSD();
        MockWETH weth = new MockWETH();
        MockOracle oracle = new MockOracle(START_PRICE);
        LendingPool pool = new LendingPool(usd, weth, oracle);
        KapaliZarf kz = new KapaliZarf(usd, weth, address(pool), commitBlocks, revealBlocks);
        pool.setKapaliZarf(kz);
        usd.mint(address(pool), POOL_LIQUIDITY);
        vm.stopBroadcast();

        console.log("MockUSD     ", address(usd));
        console.log("MockWETH    ", address(weth));
        console.log("MockOracle  ", address(oracle));
        console.log("LendingPool ", address(pool));
        console.log("KapaliZarf  ", address(kz));
        console.log("Windows     ", commitBlocks, revealBlocks);

        vm.serializeAddress("addresses", "usd", address(usd));
        vm.serializeAddress("addresses", "weth", address(weth));
        vm.serializeAddress("addresses", "oracle", address(oracle));
        vm.serializeAddress("addresses", "pool", address(pool));
        vm.serializeAddress("addresses", "zarf", address(kz));
        vm.serializeUint("addresses", "commitBlocks", commitBlocks);
        vm.serializeUint("addresses", "revealBlocks", revealBlocks);
        _write(vm.addr(deployerKey), deployBlock);
    }

    /// @dev Finishes the "addresses" JSON started in run() and writes it.
    function _write(address owner, uint256 deployBlock) internal {
        // Demo wallets are optional here: npm run reset fills them in later if they are missing.
        vm.serializeAddress("bots", "a", _roleAddress("BOT_A_PK"));
        vm.serializeAddress("bots", "b", _roleAddress("BOT_B_PK"));
        vm.serializeAddress("bots", "c", _roleAddress("BOT_C_PK"));
        string memory botsJson = vm.serializeAddress("bots", "fast", _roleAddress("FAST_BOT_PK"));

        vm.serializeUint("addresses", "chainId", block.chainid);
        vm.serializeAddress("addresses", "owner", owner);
        vm.serializeAddress("addresses", "elifKlasik", _roleAddress("ELIF_KLASIK_PK"));
        vm.serializeAddress("addresses", "elifZarf", _roleAddress("ELIF_ZARF_PK"));
        vm.serializeString("addresses", "bots", botsJson);
        string memory json = vm.serializeUint("addresses", "deployBlock", deployBlock);

        string memory path = block.chainid == MONAD_TESTNET
            ? "shared/addresses.json"
            : string.concat("shared/addresses.", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);
        console.log("Written to  ", path);
    }

    function _roleAddress(string memory envKey) internal view returns (address) {
        uint256 pk = vm.envOr(envKey, uint256(0));
        return pk == 0 ? address(0) : vm.addr(pk);
    }
}
