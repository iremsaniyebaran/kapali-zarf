// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MockOracle} from "./MockOracle.sol";
import {KapaliZarf} from "./KapaliZarf.sol";

/// @title LendingPool
/// @notice Minimal demo lending market: mWETH collateral, mUSD debt. A liquidatable position can be
/// closed the classic way (first liquidator buys all collateral at a fixed 10% discount) or sent to a
/// KapaliZarf sealed-bid auction. In both cases the debt is repaid and the rest goes to the borrower.
contract LendingPool is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    /// @notice A position is liquidatable once debt exceeds 85% of collateral value.
    uint256 public constant LIQ_THRESHOLD_BPS = 8_500;
    /// @notice Classic liquidation sells the collateral at 90% of its oracle value.
    uint256 public constant CLASSIC_DISCOUNT_BPS = 1_000;

    struct Position {
        uint256 collateral;
        uint256 debt;
        bool inAuction;
    }

    IERC20 public immutable usd;
    IERC20 public immutable weth;
    MockOracle public immutable oracle;
    KapaliZarf public kapaliZarf;

    mapping(address => Position) public positions;

    event KapaliZarfSet(address kapaliZarf);
    event CollateralDeposited(address indexed user, uint256 amount);
    event Borrowed(address indexed user, uint256 amount);
    event ClassicLiquidated(
        address indexed borrower, address indexed liquidator, uint256 collateral, uint256 price, uint256 refund
    );
    event LiquidationAuctionStarted(address indexed borrower, bytes32 indexed auctionId);
    event RepaidFromAuction(address indexed borrower, uint256 amount);

    error ZeroAmount();
    error PositionInAuction();
    error Unhealthy();
    error NotLiquidatable();
    error OnlyKapaliZarf();
    error KapaliZarfAlreadySet();
    error KapaliZarfNotSet();

    constructor(IERC20 usd_, IERC20 weth_, MockOracle oracle_) Ownable(msg.sender) {
        usd = usd_;
        weth = weth_;
        oracle = oracle_;
    }

    /// @notice One-time wiring; KapaliZarf is deployed after the pool because it needs the pool address.
    function setKapaliZarf(KapaliZarf kapaliZarf_) external onlyOwner {
        if (address(kapaliZarf) != address(0)) revert KapaliZarfAlreadySet();
        kapaliZarf = kapaliZarf_;
        emit KapaliZarfSet(address(kapaliZarf_));
    }

    // ---------------------------------------------------------------------
    // Borrower actions
    // ---------------------------------------------------------------------

    function depositCollateral(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Position storage pos = positions[msg.sender];
        if (pos.inAuction) revert PositionInAuction();
        pos.collateral += amount;
        weth.safeTransferFrom(msg.sender, address(this), amount);
        emit CollateralDeposited(msg.sender, amount);
    }

    function borrow(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Position storage pos = positions[msg.sender];
        if (pos.inAuction) revert PositionInAuction();
        pos.debt += amount;
        if (healthFactor(msg.sender) < 1e18) revert Unhealthy();
        usd.safeTransfer(msg.sender, amount);
        emit Borrowed(msg.sender, amount);
    }

    // ---------------------------------------------------------------------
    // Liquidation
    // ---------------------------------------------------------------------

    /// @notice Today's model: the first caller pays 90% of collateral value and takes all of it.
    function liquidateClassic(address borrower) external nonReentrant returns (uint256 refund) {
        if (!isLiquidatable(borrower)) revert NotLiquidatable();
        Position memory pos = positions[borrower];
        uint256 price = classicPrice(borrower);
        refund = price > pos.debt ? price - pos.debt : 0;

        delete positions[borrower];
        emit ClassicLiquidated(borrower, msg.sender, pos.collateral, price, refund);

        usd.safeTransferFrom(msg.sender, address(this), price);
        if (refund > 0) usd.safeTransfer(borrower, refund);
        weth.safeTransfer(msg.sender, pos.collateral);
    }

    /// @notice Anyone can move a liquidatable position into a KapaliZarf auction.
    function startAuction(address borrower) external nonReentrant returns (bytes32 auctionId) {
        if (address(kapaliZarf) == address(0)) revert KapaliZarfNotSet();
        if (!isLiquidatable(borrower)) revert NotLiquidatable();

        Position storage pos = positions[borrower];
        uint256 collateral = pos.collateral;
        uint256 value = collateralValue(borrower);

        pos.collateral = 0;
        pos.inAuction = true;

        weth.safeTransfer(address(kapaliZarf), collateral);
        auctionId = kapaliZarf.open(borrower, collateral, pos.debt, value);

        emit LiquidationAuctionStarted(borrower, auctionId);
    }

    /// @notice Called by KapaliZarf after it has transferred `amount` mUSD to the pool.
    /// Any debt above `amount` is written off as bad debt by the pool.
    function repayFromAuction(address borrower, uint256 amount) external {
        if (msg.sender != address(kapaliZarf)) revert OnlyKapaliZarf();
        Position storage pos = positions[borrower];
        pos.debt = 0;
        pos.inAuction = false;
        emit RepaidFromAuction(borrower, amount);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function collateralValue(address user) public view returns (uint256) {
        return positions[user].collateral * oracle.price() / 1e18;
    }

    /// @notice 1e18 = 1.0. Below 1e18 the position is liquidatable.
    function healthFactor(address user) public view returns (uint256) {
        uint256 debt = positions[user].debt;
        if (debt == 0) return type(uint256).max;
        return collateralValue(user) * LIQ_THRESHOLD_BPS * 1e18 / (debt * BPS);
    }

    function isLiquidatable(address user) public view returns (bool) {
        Position storage pos = positions[user];
        return pos.debt > 0 && !pos.inAuction && healthFactor(user) < 1e18;
    }

    /// @notice What the classic model pays for the whole collateral; also the auction's reserve price.
    function classicPrice(address user) public view returns (uint256) {
        return collateralValue(user) * (BPS - CLASSIC_DISCOUNT_BPS) / BPS;
    }

    function positionOf(address user)
        external
        view
        returns (uint256 collateral, uint256 debt, bool inAuction, uint256 value, uint256 hf)
    {
        Position storage pos = positions[user];
        return (pos.collateral, pos.debt, pos.inAuction, collateralValue(user), healthFactor(user));
    }
}
