// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// Test-only stand-in for a Chainlink AggregatorV3 feed. Lets tests drive
/// price, staleness, and round completeness deterministically, offline.
contract MockPriceFeed {
    uint8 public decimals = 8;
    int256 public answer;
    uint256 public updatedAt;
    uint80 public roundId = 1;
    uint80 public answeredInRound = 1;

    function setRound(int256 nextAnswer, uint256 nextUpdatedAt) external {
        answer = nextAnswer;
        updatedAt = nextUpdatedAt;
        roundId += 1;
        answeredInRound = roundId;
    }

    function setAnsweredInRound(uint80 value) external {
        answeredInRound = value;
    }

    function description() external pure returns (string memory) {
        return "Mock HBAR / USD";
    }

    function version() external pure returns (uint256) {
        return 4;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, answer, updatedAt, updatedAt, answeredInRound);
    }
}
