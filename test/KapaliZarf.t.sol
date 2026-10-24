// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {KapaliZarf} from "../src/KapaliZarf.sol";
import {DemoBase} from "./Base.t.sol";

contract KapaliZarfTest is DemoBase {
    // ---------------------------------------------------------------------
    // The document's example
    // ---------------------------------------------------------------------

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
        emit AuctionSettled(id, botA, 885e18, DEBT, 85e18);
        kz.settle(id);

        KapaliZarf.Auction memory a = kz.getAuction(id);
        assertEq(a.winner, botA);
        assertEq(a.price, 885e18);
        assertEq(a.debtRepaid, DEBT);
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
        bytes32 expectedId = keccak256(abi.encode(elif, uint256(0)));
        vm.expectEmit(true, true, false, true, address(kz));
        emit AuctionStarted(
            expectedId,
            elif,
            COLLATERAL,
            DEBT,
            DROP_PRICE,
            810e18,
            uint64(block.number + COMMIT_BLOCKS),
            uint64(block.number + COMMIT_BLOCKS + REVEAL_BLOCKS)
        );
        bytes32 id = pool.startAuction(elif);
        assertEq(id, expectedId);
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

    function test_UnrevealedUnlocked() public {
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

        // B's sealed 885 never counts: the second price is C's 870. B loses nothing and is unlocked.
        KapaliZarf.Auction memory a = kz.getAuction(id);
        assertEq(a.price, 870e18);
        assertEq(a.refund, 70e18);
        assertEq(usd.balanceOf(elif) - elifBefore, 70e18);
        assertEq(kz.balanceOf(botB), BOT_DEPOSIT);
        assertEq(kz.lockedOf(botB), 0);
        assertEq(kz.freeBalanceOf(botB), BOT_DEPOSIT);
    }

    function test_CommittedButNobodyRevealed_NoBidsAndUnlocked() public {
        bytes32 id = _start();
        _commit(botA, id, 890e18);
        _commit(botB, id, 885e18);
        _toSettle(id);
        kz.settle(id);

        assertEq(uint8(kz.phaseOf(id)), uint8(KapaliZarf.Phase.AwaitingFallback));
        assertEq(kz.lockedOf(botA) + kz.lockedOf(botB), 0);
        assertEq(kz.balanceOf(botA), BOT_DEPOSIT);
        assertEq(kz.balanceOf(botB), BOT_DEPOSIT);
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

    /// @notice Deeper crash on the auction side: even the best price leaves part of the debt open.
    /// settle must still go through; the shortfall is the pool's bad debt.
    function test_SettleBelowDebt_NeverReverts() public {
        oracle.setPrice(850e18); // value 850, reserve 765, debt 800
        bytes32 id = pool.startAuction(elif);
        _commit(botA, id, 790e18);
        _commit(botB, id, 780e18);
        _toReveal(id);
        _reveal(botA, id, 790e18);
        _reveal(botB, id, 780e18);
        _toSettle(id);
        uint256 elifBefore = usd.balanceOf(elif);
        kz.settle(id);

        KapaliZarf.Auction memory a = kz.getAuction(id);
        assertEq(a.winner, botA);
        assertEq(a.price, 780e18);
        assertEq(a.debtRepaid, 780e18);
        assertEq(a.refund, 0);
        assertEq(usd.balanceOf(elif), elifBefore);
        assertEq(pool.badDebt(), 20e18);
        (, uint256 debt, bool inAuction,,) = pool.positionOf(elif);
        assertEq(debt, 0);
        assertFalse(inAuction);
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

    /// @notice Same inputs hashed by viem in the bots:
    /// keccak256(encodeAbiParameters(parseAbiParameters("bytes32, uint256, bytes32, address"), [...]))
    function test_HashMatchesOffchain() public view {
        bytes32 id = bytes32(0x1111111111111111111111111111111111111111111111111111111111111111);
        bytes32 salt = bytes32(0x2222222222222222222222222222222222222222222222222222222222222222);
        address bidder = 0x00000000000000000000000000000000DeaDBeef;
        bytes32 viemHash = 0xf10079ca19d9a55e3271c4b420e66c34ac91317a2aac376c6a3d7bf6c747e5a3;
        assertEq(kz.hashBid(id, 890e18, salt, bidder), viemHash);
    }

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
        bytes32 hashA = kz.hashBid(id, 890e18, _salt(botA), botA);
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
        assertEq(a.commitEnd, block.number + COMMIT_BLOCKS);
        assertEq(a.revealEnd, block.number + COMMIT_BLOCKS + REVEAL_BLOCKS);

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
        bytes32 h = kz.hashBid(id, 890e18, _salt(botA), botA);
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
        bytes32 h = kz.hashBid(id, 880e18, _salt(botA), botA);
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
        bytes32 h = kz.hashBid(id, 890e18, _salt(poorBot), poorBot);
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
        bytes32 h = kz.hashBid(id, 880e18, _salt(extra), extra);
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
    // Access control
    // ---------------------------------------------------------------------

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
}
