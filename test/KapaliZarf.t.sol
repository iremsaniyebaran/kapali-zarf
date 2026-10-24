// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MockUSD} from "../src/MockUSD.sol";
import {MockWETH} from "../src/MockWETH.sol";
import {MockOracle} from "../src/MockOracle.sol";
import {LendingPool} from "../src/LendingPool.sol";
import {KapaliZarf} from "../src/KapaliZarf.sol";

contract KapaliZarfTest is Test {
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

    event AuctionSettled(bytes32 indexed id, address indexed winner, uint256 price, uint256 refund);

    function setUp() public {
        usd = new MockUSD();
        weth = new MockWETH();
        oracle = new MockOracle(START_PRICE);
        pool = new LendingPool(usd, weth, oracle);
        kz = new KapaliZarf(usd, weth, address(pool), 3, 3);
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
        bytes32 h = kz.commitHashOf(id, amount, _salt(bot), bot);
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

    // ---------------------------------------------------------------------
    // The document's example
    // ---------------------------------------------------------------------

    function test_ClassicLiquidation_ElifGets10() public {
        oracle.setPrice(DROP_PRICE);
        uint256 elifBefore = usd.balanceOf(elif);
        uint256 botBefore = usd.balanceOf(fastBot);

        vm.prank(fastBot);
        uint256 refund = pool.liquidateClassic(elif);

        assertEq(refund, 10e18);
        assertEq(usd.balanceOf(elif) - elifBefore, 10e18);
        assertEq(botBefore - usd.balanceOf(fastBot), 810e18);
        assertEq(weth.balanceOf(fastBot), COLLATERAL);
        (uint256 collateral, uint256 debt,,,) = pool.positionOf(elif);
        assertEq(collateral, 0);
        assertEq(debt, 0);
    }

    function test_SecondPriceAuction_ElifGets85() public {
        bytes32 id = _start();
        _commit(botA, id, 890e18);
        _commit(botB, id, 885e18);
        _commit(botC, id, 870e18);

        _toReveal(id);
        _reveal(botA, id, 890e18);
        _reveal(botB, id, 885e18);
        _reveal(botC, id, 870e18);

        _toSettle(id);
        uint256 elifBefore = usd.balanceOf(elif);
        uint256 poolBefore = usd.balanceOf(address(pool));

        vm.expectEmit(true, true, false, true, address(kz));
        emit AuctionSettled(id, botA, 885e18, 85e18);
        kz.settle(id);

        KapaliZarf.Auction memory a = kz.getAuction(id);
        assertEq(a.winner, botA);
        assertEq(a.price, 885e18);
        assertEq(a.refund, 85e18);
        assertEq(usd.balanceOf(elif) - elifBefore, 85e18);
        assertEq(usd.balanceOf(address(pool)) - poolBefore, DEBT);
        assertEq(weth.balanceOf(botA), COLLATERAL);

        // Winner pays the second price; losers keep everything and are unlocked.
        assertEq(kz.balanceOf(botA), BOT_DEPOSIT - 885e18);
        assertEq(kz.balanceOf(botB), BOT_DEPOSIT);
        assertEq(kz.balanceOf(botC), BOT_DEPOSIT);
        assertEq(kz.lockedOf(botA) + kz.lockedOf(botB) + kz.lockedOf(botC), 0);

        (uint256 collateral, uint256 debt, bool inAuction,,) = pool.positionOf(elif);
        assertEq(collateral, 0);
        assertEq(debt, 0);
        assertFalse(inAuction);
        assertEq(uint8(kz.phaseOf(id)), uint8(KapaliZarf.Phase.Settled));
    }

    function test_ReserveEqualsClassicPrice() public {
        oracle.setPrice(DROP_PRICE);
        uint256 classic = pool.classicPrice(elif);
        bytes32 id = pool.startAuction(elif);
        KapaliZarf.Auction memory a = kz.getAuction(id);
        assertEq(a.reservePrice, classic);
        assertEq(a.reservePrice, 810e18);
        assertEq(a.bidCap, DROP_PRICE);
        assertEq(a.debt, DEBT);
        assertEq(weth.balanceOf(address(kz)), COLLATERAL);
    }

    // ---------------------------------------------------------------------
    // Pricing rules
    // ---------------------------------------------------------------------

    function test_SingleBidPaysReserve() public {
        bytes32 id = _start();
        _commit(botA, id, 890e18);
        _toReveal(id);
        _reveal(botA, id, 890e18);
        _toSettle(id);
        uint256 elifBefore = usd.balanceOf(elif);
        kz.settle(id);

        KapaliZarf.Auction memory a = kz.getAuction(id);
        assertEq(a.price, 810e18);
        assertEq(usd.balanceOf(elif) - elifBefore, 10e18);
        assertEq(kz.balanceOf(botA), BOT_DEPOSIT - 810e18);
    }

    function test_TieGoesToFirstRevealAtThatPrice() public {
        bytes32 id = _start();
        _commit(botA, id, 885e18);
        _commit(botB, id, 885e18);
        _toReveal(id);
        _reveal(botB, id, 885e18);
        _reveal(botA, id, 885e18);
        _toSettle(id);
        kz.settle(id);

        KapaliZarf.Auction memory a = kz.getAuction(id);
        assertEq(a.winner, botB);
        assertEq(a.price, 885e18);
        assertEq(a.refund, 85e18);
    }

    function test_UnrevealedBidPenaltyGoesToBorrower() public {
        bytes32 id = _start();
        _commit(botA, id, 890e18);
        _commit(botB, id, 885e18); // never revealed
        _commit(botC, id, 870e18);
        _toReveal(id);
        _reveal(botA, id, 890e18);
        _reveal(botC, id, 870e18);
        _toSettle(id);
        uint256 elifBefore = usd.balanceOf(elif);
        kz.settle(id);

        // Second price is C's 870; B forfeits 1% of the 900 cap = 9.
        KapaliZarf.Auction memory a = kz.getAuction(id);
        assertEq(a.price, 870e18);
        assertEq(a.refund, 70e18 + 9e18);
        assertEq(usd.balanceOf(elif) - elifBefore, 79e18);
        assertEq(kz.balanceOf(botB), BOT_DEPOSIT - 9e18);
        assertEq(kz.lockedOf(botB), 0);
    }

    function testFuzz_WinnerPaysSecondHighest(uint256 bidA, uint256 bidB, uint256 bidC) public {
        bytes32 id = _start();
        KapaliZarf.Auction memory a = kz.getAuction(id);
        uint256[3] memory amounts = [
            bound(bidA, a.reservePrice, a.bidCap),
            bound(bidB, a.reservePrice, a.bidCap),
            bound(bidC, a.reservePrice, a.bidCap)
        ];
        address[3] memory bots = [botA, botB, botC];

        for (uint256 i; i < 3; ++i) {
            _commit(bots[i], id, amounts[i]);
        }
        _toReveal(id);

        uint256 high;
        uint256 second;
        address expectedWinner;
        for (uint256 i; i < 3; ++i) {
            _reveal(bots[i], id, amounts[i]);
            if (amounts[i] > high) {
                second = high;
                high = amounts[i];
                expectedWinner = bots[i];
            } else if (amounts[i] > second) {
                second = amounts[i];
            }
        }
        uint256 expectedPrice = second > a.reservePrice ? second : a.reservePrice;

        _toSettle(id);
        uint256 elifBefore = usd.balanceOf(elif);
        kz.settle(id);

        a = kz.getAuction(id);
        assertEq(a.winner, expectedWinner);
        assertEq(a.price, expectedPrice);
        assertEq(usd.balanceOf(elif) - elifBefore, expectedPrice - DEBT);
        // Never worse for the borrower than the classic liquidation (refund 10).
        assertGe(usd.balanceOf(elif) - elifBefore, 10e18);
        // The module stays fully backed by its liquidators' balances.
        assertEq(usd.balanceOf(address(kz)), kz.balanceOf(botA) + kz.balanceOf(botB) + kz.balanceOf(botC));
    }

    // ---------------------------------------------------------------------
    // Fallback
    // ---------------------------------------------------------------------

    function test_NoBidsThenFallbackAtClassicPrice() public {
        bytes32 id = _start();
        _toSettle(id);
        kz.settle(id);
        assertEq(uint8(kz.phaseOf(id)), uint8(KapaliZarf.Phase.AwaitingFallback));

        uint256 elifBefore = usd.balanceOf(elif);
        uint256 botBefore = usd.balanceOf(fastBot);
        vm.prank(fastBot);
        kz.fallbackLiquidate(id);

        assertEq(usd.balanceOf(elif) - elifBefore, 10e18);
        assertEq(botBefore - usd.balanceOf(fastBot), 810e18);
        assertEq(weth.balanceOf(fastBot), COLLATERAL);
        (, uint256 debt, bool inAuction,,) = pool.positionOf(elif);
        assertEq(debt, 0);
        assertFalse(inAuction);
        assertEq(uint8(kz.phaseOf(id)), uint8(KapaliZarf.Phase.FallbackLiquidated));
    }

    function test_FallbackPaysFromModuleBalance() public {
        bytes32 id = _start();
        _toSettle(id);
        kz.settle(id);

        uint256 walletBefore = usd.balanceOf(botA);
        vm.prank(botA);
        kz.fallbackLiquidate(id);

        assertEq(kz.balanceOf(botA), BOT_DEPOSIT - 810e18);
        assertEq(usd.balanceOf(botA), walletBefore);
        assertEq(weth.balanceOf(botA), COLLATERAL);
    }

    function test_RevertWhen_FallbackWhileAuctionHasBids() public {
        bytes32 id = _start();
        _commit(botA, id, 890e18);
        _toReveal(id);
        _reveal(botA, id, 890e18);
        _toSettle(id);
        vm.expectRevert(KapaliZarf.NotAwaitingFallback.selector);
        kz.fallbackLiquidate(id);
    }

    // ---------------------------------------------------------------------
    // Sealed bids
    // ---------------------------------------------------------------------

    function test_RevertWhen_WrongSalt() public {
        bytes32 id = _start();
        _commit(botA, id, 890e18);
        _toReveal(id);
        vm.prank(botA);
        vm.expectRevert(KapaliZarf.BadReveal.selector);
        kz.reveal(id, 890e18, bytes32("wrong"));
    }

    function test_RevertWhen_RevealingDifferentAmount() public {
        bytes32 id = _start();
        _commit(botA, id, 870e18);
        _toReveal(id);
        vm.expectRevert(KapaliZarf.BadReveal.selector);
        _reveal(botA, id, 890e18);
    }

    function test_RevertWhen_CopyingAnotherBiddersCommit() public {
        bytes32 id = _start();
        bytes32 hashA = kz.commitHashOf(id, 890e18, _salt(botA), botA);
        vm.prank(botA);
        kz.commit(id, hashA);
        vm.prank(botB);
        kz.commit(id, hashA);

        _toReveal(id);
        vm.prank(botB);
        vm.expectRevert(KapaliZarf.BadReveal.selector);
        kz.reveal(id, 890e18, _salt(botA));
    }

    function test_RevertWhen_BidBelowReserve() public {
        bytes32 id = _start();
        _commit(botA, id, 800e18);
        _toReveal(id);
        vm.expectRevert(KapaliZarf.BidOutOfRange.selector);
        _reveal(botA, id, 800e18);
    }

    function test_RevertWhen_BidAboveCap() public {
        bytes32 id = _start();
        _commit(botA, id, 901e18);
        _toReveal(id);
        vm.expectRevert(KapaliZarf.BidOutOfRange.selector);
        _reveal(botA, id, 901e18);
    }

    function test_BidsOfHidesAmountsUntilRevealed() public {
        bytes32 id = _start();
        _commit(botA, id, 890e18);
        _commit(botB, id, 885e18);

        (address[] memory bidders, uint256[] memory amounts, bool[] memory revealed) = kz.bidsOf(id);
        assertEq(bidders.length, 2);
        assertEq(amounts[0] + amounts[1], 0);
        assertFalse(revealed[0] || revealed[1]);

        _toReveal(id);
        _reveal(botA, id, 890e18);
        (, amounts, revealed) = kz.bidsOf(id);
        assertEq(amounts[0], 890e18);
        assertTrue(revealed[0]);
        assertEq(amounts[1], 0);
    }

    // ---------------------------------------------------------------------
    // Windows
    // ---------------------------------------------------------------------

    function test_PhaseTransitions() public {
        bytes32 id = _start();
        KapaliZarf.Auction memory a = kz.getAuction(id);
        assertEq(a.commitEnd, block.number + 3);
        assertEq(a.revealEnd, block.number + 6);

        assertEq(uint8(kz.phaseOf(id)), uint8(KapaliZarf.Phase.Commit));
        vm.roll(a.commitEnd);
        assertEq(uint8(kz.phaseOf(id)), uint8(KapaliZarf.Phase.Commit));
        vm.roll(a.commitEnd + 1);
        assertEq(uint8(kz.phaseOf(id)), uint8(KapaliZarf.Phase.Reveal));
        vm.roll(a.revealEnd);
        assertEq(uint8(kz.phaseOf(id)), uint8(KapaliZarf.Phase.Reveal));
        vm.roll(a.revealEnd + 1);
        assertEq(uint8(kz.phaseOf(id)), uint8(KapaliZarf.Phase.Settleable));
    }

    function test_RevertWhen_CommitAfterWindow() public {
        bytes32 id = _start();
        _toReveal(id);
        bytes32 h = kz.commitHashOf(id, 890e18, _salt(botA), botA);
        vm.prank(botA);
        vm.expectRevert(KapaliZarf.CommitClosed.selector);
        kz.commit(id, h);
    }

    function test_RevertWhen_RevealDuringCommit() public {
        bytes32 id = _start();
        _commit(botA, id, 890e18);
        vm.expectRevert(KapaliZarf.NotRevealPhase.selector);
        _reveal(botA, id, 890e18);
    }

    function test_RevertWhen_RevealAfterWindow() public {
        bytes32 id = _start();
        _commit(botA, id, 890e18);
        _toSettle(id);
        vm.expectRevert(KapaliZarf.NotRevealPhase.selector);
        _reveal(botA, id, 890e18);
    }

    function test_RevertWhen_SettleEarly() public {
        bytes32 id = _start();
        _toReveal(id);
        vm.expectRevert(KapaliZarf.RevealNotOver.selector);
        kz.settle(id);
    }

    function test_RevertWhen_SettleTwice() public {
        bytes32 id = _start();
        _commit(botA, id, 890e18);
        _toReveal(id);
        _reveal(botA, id, 890e18);
        _toSettle(id);
        kz.settle(id);
        vm.expectRevert(KapaliZarf.AuctionNotActive.selector);
        kz.settle(id);
    }

    function test_RevertWhen_DoubleCommitOrReveal() public {
        bytes32 id = _start();
        _commit(botA, id, 890e18);
        bytes32 h = kz.commitHashOf(id, 880e18, _salt(botA), botA);
        vm.prank(botA);
        vm.expectRevert(KapaliZarf.AlreadyCommitted.selector);
        kz.commit(id, h);

        _toReveal(id);
        _reveal(botA, id, 890e18);
        vm.expectRevert(KapaliZarf.AlreadyRevealed.selector);
        _reveal(botA, id, 890e18);

        vm.prank(botB);
        vm.expectRevert(KapaliZarf.NoCommit.selector);
        kz.reveal(id, 890e18, _salt(botB));
    }

    // ---------------------------------------------------------------------
    // Balances and limits
    // ---------------------------------------------------------------------

    function test_LockedFundsCannotBeWithdrawn() public {
        bytes32 id = _start();
        _commit(botA, id, 890e18);
        assertEq(kz.freeBalanceOf(botA), BOT_DEPOSIT - 900e18);

        vm.prank(botA);
        vm.expectRevert(KapaliZarf.InsufficientFreeBalance.selector);
        kz.withdraw(BOT_DEPOSIT);

        vm.prank(botA);
        kz.withdraw(BOT_DEPOSIT - 900e18);
        assertEq(kz.balanceOf(botA), 900e18);
    }

    function test_RevertWhen_CommitWithoutEnoughBalance() public {
        address poorBot = makeAddr("poorBot");
        usd.mint(poorBot, 100e18);
        vm.startPrank(poorBot);
        usd.approve(address(kz), 100e18);
        kz.deposit(100e18);
        vm.stopPrank();

        bytes32 id = _start();
        bytes32 h = kz.commitHashOf(id, 890e18, _salt(poorBot), poorBot);
        vm.prank(poorBot);
        vm.expectRevert(KapaliZarf.InsufficientFreeBalance.selector);
        kz.commit(id, h);
    }

    function test_RevertWhen_TooManyBidders() public {
        bytes32 id = _start();
        for (uint256 i; i < kz.MAX_BIDDERS(); ++i) {
            address bot = makeAddr(string.concat("bot", vm.toString(i)));
            _fundBot(bot);
            _commit(bot, id, 880e18);
        }
        address extra = makeAddr("extra");
        _fundBot(extra);
        bytes32 h = kz.commitHashOf(id, 880e18, _salt(extra), extra);
        vm.prank(extra);
        vm.expectRevert(KapaliZarf.TooManyBidders.selector);
        kz.commit(id, h);
    }

    /// @notice Worst case for settle(): 8 bidders. Logs the gas so the bots can pin a limit (+20%).
    function test_GasSettleWorstCase() public {
        bytes32 id = _start();
        address[] memory list = new address[](kz.MAX_BIDDERS());
        for (uint256 i; i < list.length; ++i) {
            list[i] = makeAddr(string.concat("gasbot", vm.toString(i)));
            _fundBot(list[i]);
            _commit(list[i], id, 820e18 + i * 10e18);
        }
        _toReveal(id);
        for (uint256 i; i < list.length; ++i) {
            _reveal(list[i], id, 820e18 + i * 10e18);
        }
        _toSettle(id);

        uint256 gasBefore = gasleft();
        kz.settle(id);
        uint256 used = gasBefore - gasleft();
        emit log_named_uint("settle gas, 8 bidders", used);
        assertLt(used, 500_000);
    }

    // ---------------------------------------------------------------------
    // Pool and access control
    // ---------------------------------------------------------------------

    function test_HealthyPositionCannotBeLiquidated() public {
        assertGe(pool.healthFactor(elif), 1e18);
        vm.expectRevert(LendingPool.NotLiquidatable.selector);
        pool.startAuction(elif);
        vm.prank(fastBot);
        vm.expectRevert(LendingPool.NotLiquidatable.selector);
        pool.liquidateClassic(elif);
    }

    function test_RevertWhen_BorrowPastThreshold() public {
        // 1 ETH at 1000 allows 850 debt; Elif already owes 800.
        vm.prank(elif);
        vm.expectRevert(LendingPool.Unhealthy.selector);
        pool.borrow(51e18);
    }

    function test_PositionInAuctionCannotBeLiquidatedAgain() public {
        _start();
        vm.expectRevert(LendingPool.NotLiquidatable.selector);
        pool.startAuction(elif);
        vm.prank(fastBot);
        vm.expectRevert(LendingPool.NotLiquidatable.selector);
        pool.liquidateClassic(elif);
    }

    function test_TwoAuctionsRunIndependently() public {
        address deniz = makeAddr("deniz");
        _openPosition(deniz);
        oracle.setPrice(DROP_PRICE);
        bytes32 idElif = pool.startAuction(elif);
        bytes32 idDeniz = pool.startAuction(deniz);
        assertTrue(idElif != idDeniz);

        _commit(botA, idElif, 890e18);
        _commit(botB, idElif, 885e18);
        _commit(botC, idDeniz, 880e18);

        _toReveal(idElif);
        _reveal(botA, idElif, 890e18);
        _reveal(botB, idElif, 885e18);
        _reveal(botC, idDeniz, 880e18);

        _toSettle(idElif);
        kz.settle(idDeniz);
        kz.settle(idElif);

        assertEq(kz.getAuction(idElif).price, 885e18);
        assertEq(kz.getAuction(idDeniz).price, 810e18);
        assertEq(kz.latestAuctionOf(elif), idElif);
        assertEq(kz.latestAuctionOf(deniz), idDeniz);
    }

    function test_OnlyPoolCanOpen() public {
        vm.expectRevert(KapaliZarf.OnlyPool.selector);
        kz.open(elif, COLLATERAL, DEBT, DROP_PRICE);
    }

    function test_OnlyKapaliZarfCanRepay() public {
        vm.expectRevert(LendingPool.OnlyKapaliZarf.selector);
        pool.repayFromAuction(elif, DEBT);
    }

    function test_RevertWhen_SettingKapaliZarfTwice() public {
        vm.expectRevert(LendingPool.KapaliZarfAlreadySet.selector);
        pool.setKapaliZarf(kz);
    }

    function test_OnlyOwnerMovesOraclePrice() public {
        vm.prank(fastBot);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, fastBot));
        oracle.setPrice(1e18);
    }
}
