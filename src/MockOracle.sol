// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MockOracle
/// @notice ETH price in USD with 18 decimals (1000e18 = $1000). The owner moves it on stage.
contract MockOracle is Ownable {
    uint256 public price;

    event PriceUpdated(uint256 price);

    error ZeroPrice();

    constructor(uint256 initialPrice) Ownable(msg.sender) {
        if (initialPrice == 0) revert ZeroPrice();
        price = initialPrice;
        emit PriceUpdated(initialPrice);
    }

    function setPrice(uint256 newPrice) external onlyOwner {
        if (newPrice == 0) revert ZeroPrice();
        price = newPrice;
        emit PriceUpdated(newPrice);
    }
}
