// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ILiquidationPool {
    function repayFromAuction(address borrower, uint256 amount) external;
}

/// @title KapaliZarf
/// @notice Sealed-bid, second-price (Vickrey) liquidation auctions.
/// Liquidators commit a hash, reveal it a few blocks later, and the highest bidder wins but pays the
/// second-highest bid (or the reserve price when alone). The debt is repaid and everything above it
/// goes straight back to the borrower. The reserve price equals the classic liquidation price, so the
/// borrower never receives less than under a fixed-discount liquidation.
/// @dev Windows are counted in blocks, not seconds: Monad produces several blocks per second.
contract KapaliZarf is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    /// @notice Reserve = collateral value x 90%. Must match LendingPool.CLASSIC_DISCOUNT_BPS (10%).
    uint256 public constant RESERVE_BPS = 9_000;
    /// @notice Bounds the loop in settle().
    uint256 public constant MAX_BIDDERS = 8;

    enum Status {
        None,
        Active,
        Settled,
        AwaitingFallback,
        FallbackLiquidated
    }

    enum Phase {
        None,
        Commit,
        Reveal,
        Settleable,
        Settled,
        AwaitingFallback,
        FallbackLiquidated
    }

    struct Auction {
        address borrower;
        uint256 collateral;
        uint256 debt;
        uint256 reservePrice;
        uint256 bidCap;
        uint64 commitEnd;
        uint64 revealEnd;
        Status status;
        address highBidder;
        uint256 highBid;
        uint256 secondBid;
        address winner;
        uint256 price;
        uint256 refund;
    }

    struct Bid {
        bytes32 commitHash;
        uint256 amount;
        bool revealed;
    }

    IERC20 public immutable usd;
    IERC20 public immutable weth;
    address public immutable pool;
    uint256 public immutable commitBlocks;
    uint256 public immutable revealBlocks;

    /// @notice Liquidators keep mUSD inside the module; every commit locks `bidCap` of it.
    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public lockedOf;

    mapping(bytes32 => Auction) internal _auctions;
    mapping(bytes32 => address[]) internal _bidders;
    mapping(bytes32 => mapping(address => Bid)) public bids;
    mapping(address => uint256) public nonces;
    mapping(address => bytes32) public latestAuctionOf;

    event Deposited(address indexed liquidator, uint256 amount);
    event Withdrawn(address indexed liquidator, uint256 amount);
    event AuctionStarted(
        bytes32 indexed id,
        address indexed borrower,
        uint256 collateral,
        uint256 debt,
        uint256 reservePrice,
        uint256 bidCap,
        uint64 commitEnd,
        uint64 revealEnd
    );
    event BidCommitted(bytes32 indexed id, address indexed bidder);
    event BidRevealed(bytes32 indexed id, address indexed bidder, uint256 amount);
    event AuctionSettled(bytes32 indexed id, address indexed winner, uint256 price, uint256 refund);
    event NoBids(bytes32 indexed id);
    event FallbackLiquidated(bytes32 indexed id, address indexed liquidator, uint256 price, uint256 refund);

    error ZeroAmount();
    error ZeroAddress();
    error ZeroWindow();
    error OnlyPool();
    error InsufficientFreeBalance();
    error AuctionNotActive();
    error CommitClosed();
    error EmptyCommit();
    error AlreadyCommitted();
    error TooManyBidders();
    error NotRevealPhase();
    error NoCommit();
    error AlreadyRevealed();
    error BadReveal();
    error BidOutOfRange();
    error RevealNotOver();
    error NotAwaitingFallback();

    modifier onlyPool() {
        if (msg.sender != pool) revert OnlyPool();
        _;
    }

    constructor(IERC20 usd_, IERC20 weth_, address pool_, uint256 commitBlocks_, uint256 revealBlocks_) {
        if (pool_ == address(0)) revert ZeroAddress();
        if (commitBlocks_ == 0 || revealBlocks_ == 0) revert ZeroWindow();
        usd = usd_;
        weth = weth_;
        pool = pool_;
        commitBlocks = commitBlocks_;
        revealBlocks = revealBlocks_;
    }

    // ---------------------------------------------------------------------
    // Liquidator balances
    // ---------------------------------------------------------------------

    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        balanceOf[msg.sender] += amount;
        usd.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (amount > freeBalanceOf(msg.sender)) revert InsufficientFreeBalance();
        balanceOf[msg.sender] -= amount;
        usd.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function freeBalanceOf(address liquidator) public view returns (uint256) {
        return balanceOf[liquidator] - lockedOf[liquidator];
    }

    // ---------------------------------------------------------------------
    // Auction lifecycle
    // ---------------------------------------------------------------------

    /// @notice Called by the pool after it has moved `collateral` mWETH here.
    function open(address borrower, uint256 collateral, uint256 debt, uint256 value)
        external
        onlyPool
        returns (bytes32 id)
    {
        id = keccak256(abi.encode(borrower, nonces[borrower]++));
        // Block numbers stay far below 2^64 for the lifetime of any chain.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 commitEnd = uint64(block.number + commitBlocks);
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 revealEnd = uint64(commitEnd + revealBlocks);

        Auction storage a = _auctions[id];
        a.borrower = borrower;
        a.collateral = collateral;
        a.debt = debt;
        a.reservePrice = value * RESERVE_BPS / BPS;
        a.bidCap = value;
        a.commitEnd = commitEnd;
        a.revealEnd = revealEnd;
        a.status = Status.Active;

        latestAuctionOf[borrower] = id;
        emit AuctionStarted(id, borrower, collateral, debt, a.reservePrice, value, commitEnd, revealEnd);
    }

    /// @notice Sealed bid. Locks `bidCap` so the locked amount says nothing about the bid itself.
    function commit(bytes32 id, bytes32 commitHash) external {
        Auction storage a = _auctions[id];
        if (a.status != Status.Active) revert AuctionNotActive();
        if (block.number > a.commitEnd) revert CommitClosed();
        if (commitHash == bytes32(0)) revert EmptyCommit();

        Bid storage b = bids[id][msg.sender];
        if (b.commitHash != bytes32(0)) revert AlreadyCommitted();
        if (_bidders[id].length >= MAX_BIDDERS) revert TooManyBidders();
        if (freeBalanceOf(msg.sender) < a.bidCap) revert InsufficientFreeBalance();

        lockedOf[msg.sender] += a.bidCap;
        b.commitHash = commitHash;
        _bidders[id].push(msg.sender);

        emit BidCommitted(id, msg.sender);
    }

    /// @notice Opens the envelope. Equal bids: the one revealed first wins and pays that amount.
    function reveal(bytes32 id, uint256 amount, bytes32 salt) external {
        Auction storage a = _auctions[id];
        if (a.status != Status.Active) revert AuctionNotActive();
        if (block.number <= a.commitEnd || block.number > a.revealEnd) revert NotRevealPhase();

        Bid storage b = bids[id][msg.sender];
        if (b.commitHash == bytes32(0)) revert NoCommit();
        if (b.revealed) revert AlreadyRevealed();
        if (commitHashOf(id, amount, salt, msg.sender) != b.commitHash) revert BadReveal();
        if (amount < a.reservePrice || amount > a.bidCap) revert BidOutOfRange();

        b.revealed = true;
        b.amount = amount;

        if (amount > a.highBid) {
            a.secondBid = a.highBid;
            a.highBid = amount;
            a.highBidder = msg.sender;
        } else if (amount > a.secondBid) {
            a.secondBid = amount;
        }

        emit BidRevealed(id, msg.sender, amount);
    }

    /// @notice Anyone can settle once the reveal window is over.
    function settle(bytes32 id) external nonReentrant {
        Auction storage a = _auctions[id];
        if (a.status != Status.Active) revert AuctionNotActive();
        if (block.number <= a.revealEnd) revert RevealNotOver();

        // Every lock is released, unrevealed bids included. No penalty: settle must never revert.
        _releaseLocks(id, a.bidCap);

        if (a.highBidder == address(0)) {
            a.status = Status.AwaitingFallback;
            emit NoBids(id);
            return;
        }

        address winner = a.highBidder;
        uint256 price = a.secondBid > a.reservePrice ? a.secondBid : a.reservePrice;
        uint256 repaid = price < a.debt ? price : a.debt;
        uint256 refund = price - repaid;

        balanceOf[winner] -= price;
        a.status = Status.Settled;
        a.winner = winner;
        a.price = price;
        a.refund = refund;
        emit AuctionSettled(id, winner, price, refund);

        usd.safeTransfer(pool, repaid);
        ILiquidationPool(pool).repayFromAuction(a.borrower, repaid);
        if (refund > 0) usd.safeTransfer(a.borrower, refund);
        weth.safeTransfer(winner, a.collateral);
    }

    /// @notice No valid bid: anyone liquidates at the reserve (the classic price). Pays from the
    /// caller's free module balance when it is large enough, otherwise pulls mUSD from the caller.
    function fallbackLiquidate(bytes32 id) external nonReentrant {
        Auction storage a = _auctions[id];
        if (a.status != Status.AwaitingFallback) revert NotAwaitingFallback();

        uint256 price = a.reservePrice;
        uint256 repaid = price < a.debt ? price : a.debt;
        uint256 refund = price - repaid;

        a.status = Status.FallbackLiquidated;
        a.winner = msg.sender;
        a.price = price;
        a.refund = refund;
        emit FallbackLiquidated(id, msg.sender, price, refund);

        if (freeBalanceOf(msg.sender) >= price) {
            balanceOf[msg.sender] -= price;
        } else {
            usd.safeTransferFrom(msg.sender, address(this), price);
        }

        usd.safeTransfer(pool, repaid);
        ILiquidationPool(pool).repayFromAuction(a.borrower, repaid);
        if (refund > 0) usd.safeTransfer(a.borrower, refund);
        weth.safeTransfer(msg.sender, a.collateral);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function commitHashOf(bytes32 id, uint256 amount, bytes32 salt, address bidder) public pure returns (bytes32) {
        return keccak256(abi.encode(id, amount, salt, bidder));
    }

    function getAuction(bytes32 id) external view returns (Auction memory) {
        return _auctions[id];
    }

    /// @notice Amounts stay 0 until revealed, so this never leaks a sealed bid.
    function bidsOf(bytes32 id)
        external
        view
        returns (address[] memory bidders, uint256[] memory amounts, bool[] memory revealed)
    {
        bidders = _bidders[id];
        amounts = new uint256[](bidders.length);
        revealed = new bool[](bidders.length);
        for (uint256 i; i < bidders.length; ++i) {
            Bid storage b = bids[id][bidders[i]];
            amounts[i] = b.amount;
            revealed[i] = b.revealed;
        }
    }

    function phaseOf(bytes32 id) external view returns (Phase) {
        Auction storage a = _auctions[id];
        if (a.status == Status.None) return Phase.None;
        if (a.status == Status.Settled) return Phase.Settled;
        if (a.status == Status.AwaitingFallback) return Phase.AwaitingFallback;
        if (a.status == Status.FallbackLiquidated) return Phase.FallbackLiquidated;
        if (block.number <= a.commitEnd) return Phase.Commit;
        if (block.number <= a.revealEnd) return Phase.Reveal;
        return Phase.Settleable;
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _releaseLocks(bytes32 id, uint256 bidCap) private {
        address[] storage list = _bidders[id];
        for (uint256 i; i < list.length; ++i) {
            lockedOf[list[i]] -= bidCap;
        }
    }
}
