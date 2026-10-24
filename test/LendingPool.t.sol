// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {LendingPool} from "../src/LendingPool.sol";
import {DemoBase} from "./Base.t.sol";

contract LendingPoolTest is DemoBase {
    function test_ClassicLiquidation_ElifGets10() public {
        oracle.setPrice(DROP_PRICE);
        uint256 elifBefore = usd.balanceOf(elif);
        uint256 botBefore = usd.balanceOf(fastBot);

        vm.expectEmit(true, true, false, true, address(pool));
        emit ClassicLiquidated(elif, fastBot, 810e18, DEBT, 10e18);
        vm.prank(fastBot);
        uint256 refund = pool.liquidateClassic(elif);

        assertEq(refund, 10e18);
        assertEq(pool.badDebt(), 0);
        assertEq(usd.balanceOf(elif) - elifBefore, 10e18);
        assertEq(botBefore - usd.balanceOf(fastBot), 810e18);
        assertEq(weth.balanceOf(fastBot), COLLATERAL);
        (uint256 collateral, uint256 debt,,,) = pool.positionOf(elif);
        assertEq(collateral, 0);
        assertEq(debt, 0);
    }

    /// @notice A deeper crash: the classic price (765) no longer covers the debt (800).
    function test_ClassicBelowDebt_RecordsBadDebt() public {
        oracle.setPrice(850e18);
        uint256 elifBefore = usd.balanceOf(elif);

        vm.prank(fastBot);
        uint256 refund = pool.liquidateClassic(elif);

        assertEq(refund, 0);
        assertEq(usd.balanceOf(elif), elifBefore);
        assertEq(pool.badDebt(), 35e18);
        (, uint256 debt,,,) = pool.positionOf(elif);
        assertEq(debt, 0);
    }

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

    function test_NoDoubleLiquidation() public {
        _start();
        vm.expectRevert(LendingPool.NotLiquidatable.selector);
        pool.startAuction(elif);
        vm.prank(fastBot);
        vm.expectRevert(LendingPool.NotLiquidatable.selector);
        pool.liquidateClassic(elif);
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
