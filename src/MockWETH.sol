// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockWETH
/// @notice Demo collateral token (18 decimals). Anyone can mint: testnet only.
contract MockWETH is ERC20 {
    constructor() ERC20("Mock Wrapped Ether", "mWETH") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
