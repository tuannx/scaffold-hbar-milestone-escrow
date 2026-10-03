import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

const PRICE_010 = 10_000_000n; // $0.10 with 8 feed decimals
const PRICE_020 = 20_000_000n; // $0.20
const USD_100 = 100_000_000n; // $100.00 in micro-USD
// Hedera's EVM accounts in tinybar inside contracts (1 HBAR = 1e8). Hardhat's
// local EVM treats the same raw numbers as wei; the unit contract is the raw
// integer the contract sees, which is what these constants pin.
const HBAR_1000 = 1000n * 100_000_000n;
const HBAR_500 = 500n * 100_000_000n;
const STALENESS = 3600;

describe("MilestoneEscrow", function () {
  async function deployFixture() {
    const [client, worker, stranger] = await ethers.getSigners();

    const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
    const feed = await MockPriceFeed.deploy();
    await feed.waitForDeployment();
    await feed.setRound(PRICE_010, await time.latest());

    const MilestoneEscrow = await ethers.getContractFactory("MilestoneEscrow");
    const escrow = await MilestoneEscrow.deploy(await feed.getAddress(), STALENESS);
    await escrow.waitForDeployment();

    const deadline = (await time.latest()) + 7 * 24 * 3600;
    const referenceHash = ethers.keccak256(ethers.toUtf8Bytes("milestone-1:design-approved"));

    return { escrow, feed, client, worker, stranger, deadline, referenceHash };
  }

  async function createFundedEscrow(fixture: Awaited<ReturnType<typeof deployFixture>>) {
    const { escrow, client, worker, deadline, referenceHash } = fixture;
    await escrow.connect(client).createEscrow(worker.address, USD_100, deadline, referenceHash);
    await escrow.connect(client).fundEscrow(0, { value: HBAR_1000 });
  }

  describe("Pricing (Chainlink is load-bearing)", function () {
    it("quotesUsdInHbarAtLivePrice", async function () {
      const { escrow } = await deployFixture();
      expect(await escrow.quoteHbarTinybar(USD_100)).to.equal(HBAR_1000);
    });

    it("fundRevertsWhenPriceIsStale", async function () {
      const { escrow, feed, client, worker, deadline, referenceHash } = await deployFixture();
      await escrow.connect(client).createEscrow(worker.address, USD_100, deadline, referenceHash);
      await feed.setRound(PRICE_010, (await time.latest()) - STALENESS - 1);
      await expect(escrow.connect(client).fundEscrow(0, { value: HBAR_1000 })).to.be.revertedWithCustomError(
        escrow,
        "StalePrice",
      );
    });

    it("fundRevertsOnIncompleteRound", async function () {
      const { escrow, feed, client, worker, deadline, referenceHash } = await deployFixture();
      await escrow.connect(client).createEscrow(worker.address, USD_100, deadline, referenceHash);
      await feed.setAnsweredInRound(0);
      await expect(escrow.connect(client).fundEscrow(0, { value: HBAR_1000 })).to.be.revertedWithCustomError(
        escrow,
        "IncompleteRound",
      );
    });

    it("fundRevertsOnNonPositivePrice", async function () {
      const { escrow, feed, client, worker, deadline, referenceHash } = await deployFixture();
      await escrow.connect(client).createEscrow(worker.address, USD_100, deadline, referenceHash);
      await feed.setRound(0n, await time.latest());
      await expect(escrow.connect(client).fundEscrow(0, { value: HBAR_1000 })).to.be.revertedWithCustomError(
        escrow,
        "InvalidPrice",
      );
    });

    it("fundRepricesAtFundingTimeAndRefundsExcess", async function () {
      const { escrow, feed, client, worker, deadline, referenceHash } = await deployFixture();
      await escrow.connect(client).createEscrow(worker.address, USD_100, deadline, referenceHash);
      // Price doubles between creation and funding: $100 now needs 500 HBAR, not 1000.
      await feed.setRound(PRICE_020, await time.latest());
      await expect(escrow.connect(client).fundEscrow(0, { value: HBAR_1000 })).to.changeEtherBalances(
        [client, escrow],
        [-HBAR_500, HBAR_500],
      );
      const stored = await escrow.getEscrow(0);
      expect(stored.fundedTinybar).to.equal(HBAR_500);
      expect(stored.fundedPrice).to.equal(PRICE_020);
      expect(stored.status).to.equal(1); // Funded
    });

    it("fundUnderQuoteReverts", async function () {
      const { escrow, client, worker, deadline, referenceHash } = await deployFixture();
      await escrow.connect(client).createEscrow(worker.address, USD_100, deadline, referenceHash);
      await expect(escrow.connect(client).fundEscrow(0, { value: HBAR_500 })).to.be.revertedWithCustomError(
        escrow,
        "Underfunded",
      );
    });
  });

  describe("Lifecycle", function () {
    it("releasePaysWorkerFundedAmount", async function () {
      const fixture = await deployFixture();
      const { escrow, client, worker } = fixture;
      await createFundedEscrow(fixture);
      await expect(escrow.connect(client).releaseEscrow(0)).to.changeEtherBalances(
        [escrow, worker],
        [-HBAR_1000, HBAR_1000],
      );
      expect((await escrow.getEscrow(0)).status).to.equal(2); // Released
    });

    it("releaseRevertsForNonClient", async function () {
      const fixture = await deployFixture();
      const { escrow, worker } = fixture;
      await createFundedEscrow(fixture);
      await expect(escrow.connect(worker).releaseEscrow(0)).to.be.revertedWithCustomError(escrow, "NotClient");
    });

    it("refundAfterDeadlineReturnsClientFunds", async function () {
      const fixture = await deployFixture();
      const { escrow, client, worker, deadline } = fixture;
      await createFundedEscrow(fixture);
      await time.increaseTo(deadline + 1);
      await expect(escrow.connect(worker).refundExpiredEscrow(0)).to.changeEtherBalances(
        [escrow, client],
        [-HBAR_1000, HBAR_1000],
      );
      expect((await escrow.getEscrow(0)).status).to.equal(3); // Refunded
    });

    it("refundBeforeDeadlineReverts", async function () {
      const fixture = await deployFixture();
      const { escrow, client } = fixture;
      await createFundedEscrow(fixture);
      await expect(escrow.connect(client).refundExpiredEscrow(0)).to.be.revertedWithCustomError(
        escrow,
        "DeadlineNotReached",
      );
    });

    it("cancelOpenEscrowByClient", async function () {
      const { escrow, client, worker, deadline, referenceHash } = await deployFixture();
      await escrow.connect(client).createEscrow(worker.address, USD_100, deadline, referenceHash);
      await escrow.connect(client).cancelEscrow(0);
      expect((await escrow.getEscrow(0)).status).to.equal(4); // Cancelled
    });
  });

  describe("Validation", function () {
    it("createEscrowRejectsZeroWorkerSelfWorkerZeroUsdAndPastDeadline", async function () {
      const { escrow, client, worker, deadline, referenceHash } = await deployFixture();
      await expect(
        escrow.connect(client).createEscrow(ethers.ZeroAddress, USD_100, deadline, referenceHash),
      ).to.be.revertedWithCustomError(escrow, "InvalidWorker");
      await expect(
        escrow.connect(client).createEscrow(client.address, USD_100, deadline, referenceHash),
      ).to.be.revertedWithCustomError(escrow, "InvalidWorker");
      await expect(
        escrow.connect(client).createEscrow(worker.address, 0, deadline, referenceHash),
      ).to.be.revertedWithCustomError(escrow, "InvalidUsdAmount");
      await expect(
        escrow.connect(client).createEscrow(worker.address, USD_100, await time.latest(), referenceHash),
      ).to.be.revertedWithCustomError(escrow, "InvalidDeadline");
    });
  });
});
