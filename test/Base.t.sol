// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSD} from "../src/MockUSD.sol";
import {MockWETH} from "../src/MockWETH.sol";
import {MockOracle} from "../src/MockOracle.sol";
import {LendingPool} from "../src/LendingPool.sol";
import {KapaliZarf} from "../src/KapaliZarf.sol";

/// @notice Shared state and helpers: the document's demo setup with one borrower and three bidders.
abstract contract DemoBase is Test {
    MockUSD internal usd;
    MockWETH internal weth;
    MockOracle internal oracle;
    LendingPool internal pool;
    KapaliZarf internal kz;

    address internal elif = makeAddr("elif");
    address internal botA = makeAddr("botA");
    address internal botB = makeAddr("botB");
    address internal botC = makeAddr("botC");
    address internal fastBot = makeAddr("fastBot");

    // The document's example: 1 ETH collateral, 800 debt, ETH falls from 1000 to 900.
    uint256 internal constant COLLATERAL = 1e18;
    uint256 internal constant DEBT = 800e18;
    uint256 internal constant START_PRICE = 1000e18;
    uint256 internal constant DROP_PRICE = 900e18;
    uint256 internal constant BOT_DEPOSIT = 5_000e18;
    // Same windows as the first testnet deploy (roadmap: start at 8/8, measure, then shorten).
    uint256 internal constant COMMIT_BLOCKS = 8;
    uint256 internal constant REVEAL_BLOCKS = 8;

    event AuctionStarted(
        bytes32 indexed id,
        address indexed borrower,
        uint256 collateral,
        uint256 debt,
        uint256 value,
        uint256 reservePrice,
        uint64 commitEnd,
        uint64 revealEnd
    );
    event AuctionSettled(bytes32 indexed id, address indexed winner, uint256 price, uint256 debtRepaid, uint256 refund);
    event ClassicLiquidated(
        address indexed borrower, address indexed liquidator, uint256 price, uint256 debtRepaid, uint256 refund
    );

    function setUp() public {
        usd = new MockUSD();
        weth = new MockWETH();
        oracle = new MockOracle(START_PRICE);
        pool = new LendingPool(usd, weth, oracle);
        kz = new KapaliZarf(usd, weth, address(pool), COMMIT_BLOCKS, REVEAL_BLOCKS);
        pool.setKapaliZarf(kz);
        usd.mint(address(pool), 1_000_000e18);

        _openPosition(elif);

        _fundBot(botA);
        _fundBot(botB);
        _fundBot(botC);

        usd.mint(fastBot, 10_000e18);
        vm.startPrank(fastBot);
        usd.approve(address(pool), type(uint256).max);
        usd.approve(address(kz), type(uint256).max);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    function _openPosition(address borrower) internal {
        weth.mint(borrower, COLLATERAL);
        vm.startPrank(borrower);
        weth.approve(address(pool), COLLATERAL);
        pool.depositCollateral(COLLATERAL);
        pool.borrow(DEBT);
        vm.stopPrank();
    }

    function _fundBot(address bot) internal {
        usd.mint(bot, 10_000e18);
        vm.startPrank(bot);
        usd.approve(address(kz), type(uint256).max);
        kz.deposit(BOT_DEPOSIT);
        vm.stopPrank();
    }

    function _start() internal returns (bytes32 id) {
        oracle.setPrice(DROP_PRICE);
        id = pool.startAuction(elif);
    }

    function _salt(address bot) internal pure returns (bytes32) {
        return keccak256(abi.encode("salt", bot));
    }

    function _commit(address bot, bytes32 id, uint256 amount) internal {
        bytes32 h = kz.hashBid(id, amount, _salt(bot), bot);
        vm.prank(bot);
        kz.commit(id, h);
    }

    function _reveal(address bot, bytes32 id, uint256 amount) internal {
        vm.prank(bot);
        kz.reveal(id, amount, _salt(bot));
    }

    function _toReveal(bytes32 id) internal {
        vm.roll(kz.getAuction(id).commitEnd + 1);
    }

    function _toSettle(bytes32 id) internal {
        vm.roll(kz.getAuction(id).revealEnd + 1);
    }
}
