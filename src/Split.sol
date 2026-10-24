// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Split
/// @notice How a liquidation price is divided: debt first, the rest back to the borrower.
/// Shared by LendingPool and KapaliZarf so both sides compute the same numbers and a price below
/// the debt can never underflow.
library Split {
    function split(uint256 price, uint256 debt) internal pure returns (uint256 repaid, uint256 refund) {
        repaid = price < debt ? price : debt;
        refund = price - repaid;
    }
}
