// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { AggregatorV3Interface } from "./interfaces/AggregatorV3Interface.sol";

/// USD-priced milestone escrow settled in HBAR.
///
/// The Chainlink HBAR/USD feed is load-bearing: `fundEscrow` re-prices the
/// milestone at funding time and reverts on an incomplete, non-positive, or
/// stale round. Without a fresh price the escrow cannot be funded, released
/// pricing cannot be audited, and the USD amount the worker agreed to has no
/// HBAR equivalent.
///
/// Amounts: USD is stored in micro-USD (1e6 = $1.00). HBAR is handled in wei
/// (1e18 = 1 HBAR), matching Hedera JSON-RPC `msg.value` semantics.
contract MilestoneEscrow {
    enum Status {
        Open,
        Funded,
        Released,
        Refunded,
        Cancelled
    }

    struct Escrow {
        address client;
        address worker;
        uint256 usdMicros;
        uint256 fundedWei;
        uint256 fundedPrice;
        uint64 deadline;
        bytes32 referenceHash;
        Status status;
    }

    uint256 public constant USD_MICROS = 1e6;

    AggregatorV3Interface public immutable priceFeed;
    uint256 public immutable maxStalenessSeconds;

    Escrow[] private _escrows;

    event EscrowCreated(
        uint256 indexed escrowId,
        address indexed client,
        address indexed worker,
        uint256 usdMicros,
        uint64 deadline,
        bytes32 referenceHash
    );
    event EscrowFunded(uint256 indexed escrowId, uint256 fundedWei, uint256 priceUsed);
    event EscrowReleased(uint256 indexed escrowId, address indexed worker, uint256 amountWei);
    event EscrowRefunded(uint256 indexed escrowId, address indexed client, uint256 amountWei);
    event EscrowCancelled(uint256 indexed escrowId);

    error InvalidWorker();
    error InvalidUsdAmount();
    error InvalidDeadline();
    error EscrowNotFound(uint256 escrowId);
    error NotClient(uint256 escrowId);
    error NotParty(uint256 escrowId);
    error WrongStatus(uint256 escrowId, Status status);
    error Underfunded(uint256 requiredWei, uint256 sentWei);
    error DeadlineNotReached(uint256 escrowId);
    error PayoutFailed(address to, uint256 amountWei);
    error IncompleteRound(uint80 roundId, uint80 answeredInRound);
    error InvalidPrice(int256 answer);
    error StalePrice(uint256 updatedAt, uint256 maxStalenessSeconds);

    constructor(address priceFeedAddress, uint256 maxStaleness) {
        if (priceFeedAddress == address(0)) revert InvalidWorker();
        priceFeed = AggregatorV3Interface(priceFeedAddress);
        maxStalenessSeconds = maxStaleness;
    }

    /// Fresh Chainlink price or revert. Returns the raw feed answer and its
    /// decimals-normalised update time; callers use `quoteHbarWei` for amounts.
    function getPrice() public view returns (uint256 price, uint256 updatedAt) {
        (uint80 roundId, int256 answer, , uint256 roundUpdatedAt, uint80 answeredInRound) = priceFeed.latestRoundData();
        if (answeredInRound < roundId || roundUpdatedAt == 0) revert IncompleteRound(roundId, answeredInRound);
        if (answer <= 0) revert InvalidPrice(answer);
        if (block.timestamp - roundUpdatedAt > maxStalenessSeconds) {
            revert StalePrice(roundUpdatedAt, maxStalenessSeconds);
        }
        return (uint256(answer), roundUpdatedAt);
    }

    /// HBAR wei required for `usdMicros` at the current fresh price.
    /// hbarWei = usdMicros * 10^(feedDecimals + 12) / answer
    /// (1e6 micros per USD, 1e18 wei per HBAR, answer scaled by feedDecimals).
    function quoteHbarWei(uint256 usdMicros) public view returns (uint256) {
        (uint256 price, ) = getPrice();
        uint256 scale = 10 ** (uint256(priceFeed.decimals()) + 12);
        return (usdMicros * scale) / price;
    }

    function createEscrow(
        address worker,
        uint256 usdMicros,
        uint64 deadline,
        bytes32 referenceHash
    ) external returns (uint256 escrowId) {
        if (worker == address(0) || worker == msg.sender) revert InvalidWorker();
        if (usdMicros == 0) revert InvalidUsdAmount();
        if (deadline <= block.timestamp) revert InvalidDeadline();

        escrowId = _escrows.length;
        _escrows.push(
            Escrow({
                client: msg.sender,
                worker: worker,
                usdMicros: usdMicros,
                fundedWei: 0,
                fundedPrice: 0,
                deadline: deadline,
                referenceHash: referenceHash,
                status: Status.Open
            })
        );
        emit EscrowCreated(escrowId, msg.sender, worker, usdMicros, deadline, referenceHash);
    }

    /// Funds at the live price, not the creation-time price. Overpayment is
    /// refunded in the same transaction; the funded amount is the quote.
    function fundEscrow(uint256 escrowId) external payable {
        Escrow storage escrow = _escrowAt(escrowId);
        if (msg.sender != escrow.client) revert NotClient(escrowId);
        if (escrow.status != Status.Open) revert WrongStatus(escrowId, escrow.status);

        uint256 requiredWei = quoteHbarWei(escrow.usdMicros);
        if (msg.value < requiredWei) revert Underfunded(requiredWei, msg.value);
        (uint256 priceUsed, ) = getPrice();

        escrow.fundedWei = requiredWei;
        escrow.fundedPrice = priceUsed;
        escrow.status = Status.Funded;
        emit EscrowFunded(escrowId, requiredWei, priceUsed);

        uint256 excessWei = msg.value - requiredWei;
        if (excessWei > 0) _pay(escrow.client, excessWei);
    }

    function releaseEscrow(uint256 escrowId) external {
        Escrow storage escrow = _escrowAt(escrowId);
        if (msg.sender != escrow.client) revert NotClient(escrowId);
        if (escrow.status != Status.Funded) revert WrongStatus(escrowId, escrow.status);

        escrow.status = Status.Released;
        emit EscrowReleased(escrowId, escrow.worker, escrow.fundedWei);
        _pay(escrow.worker, escrow.fundedWei);
    }

    /// After the deadline either party can return the funds to the client.
    function refundExpiredEscrow(uint256 escrowId) external {
        Escrow storage escrow = _escrowAt(escrowId);
        if (msg.sender != escrow.client && msg.sender != escrow.worker) revert NotParty(escrowId);
        if (escrow.status != Status.Funded) revert WrongStatus(escrowId, escrow.status);
        if (block.timestamp <= escrow.deadline) revert DeadlineNotReached(escrowId);

        escrow.status = Status.Refunded;
        emit EscrowRefunded(escrowId, escrow.client, escrow.fundedWei);
        _pay(escrow.client, escrow.fundedWei);
    }

    function cancelEscrow(uint256 escrowId) external {
        Escrow storage escrow = _escrowAt(escrowId);
        if (msg.sender != escrow.client) revert NotClient(escrowId);
        if (escrow.status != Status.Open) revert WrongStatus(escrowId, escrow.status);

        escrow.status = Status.Cancelled;
        emit EscrowCancelled(escrowId);
    }

    function escrowCount() external view returns (uint256) {
        return _escrows.length;
    }

    function getEscrow(uint256 escrowId) external view returns (Escrow memory) {
        return _escrowAt(escrowId);
    }

    function _escrowAt(uint256 escrowId) internal view returns (Escrow storage escrow) {
        if (escrowId >= _escrows.length) revert EscrowNotFound(escrowId);
        return _escrows[escrowId];
    }

    function _pay(address to, uint256 amountWei) internal {
        (bool success, ) = payable(to).call{ value: amountWei }("");
        if (!success) revert PayoutFailed(to, amountWei);
    }
}
