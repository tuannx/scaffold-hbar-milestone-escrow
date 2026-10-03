import type { HardhatRuntimeEnvironment } from "hardhat/types";
import type { DeployFunction } from "hardhat-deploy/types";

import { getDeployGasPrice } from "../utils/getDeployGasPrice";

/**
 * Deploys MilestoneEscrow wired to a Chainlink HBAR/USD feed.
 *
 * Networks:
 * - hederaTestnet / hederaMainnet: uses PRICE_FEED_ADDRESS when set, otherwise
 *   the Hedera testnet HBAR/USD feed below (verified live, see README).
 * - hardhat / localhost: deploys MockPriceFeed at $0.10 so the full lifecycle
 *   runs offline with no credentials.
 */
const HEDERA_TESTNET_HBAR_USD_FEED = "0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a";
const DEFAULT_MAX_STALENESS_SECONDS = 10800; // 3h template default; tune per feed heartbeat.

const deployMilestoneEscrow: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;
  const gasPrice = await getDeployGasPrice(hre);

  let priceFeedAddress = process.env.PRICE_FEED_ADDRESS;
  const isLocalNetwork = hre.network.name === "hardhat" || hre.network.name === "localhost";

  if (!priceFeedAddress && isLocalNetwork) {
    const mock = await deploy("MockPriceFeed", {
      from: deployer,
      args: [],
      log: true,
      autoMine: true,
      gasPrice,
    });
    priceFeedAddress = mock.address;

    const mockFeed = await hre.ethers.getContractAt("MockPriceFeed", mock.address);
    const latestBlock = await hre.ethers.provider.getBlock("latest");
    // $0.10 with 8 decimals, timestamped at the latest block so quotes are fresh.
    await mockFeed.setRound(10_000_000n, BigInt(latestBlock?.timestamp ?? Math.floor(Date.now() / 1000)));
    console.log(`MockPriceFeed seeded at $0.10 (local network ${hre.network.name})`);
  }

  if (!priceFeedAddress) {
    priceFeedAddress = HEDERA_TESTNET_HBAR_USD_FEED;
  }

  const maxStalenessSeconds = BigInt(process.env.MAX_STALENESS_SECONDS ?? DEFAULT_MAX_STALENESS_SECONDS);

  await deploy("MilestoneEscrow", {
    from: deployer,
    args: [priceFeedAddress, maxStalenessSeconds],
    log: true,
    autoMine: true,
    gasPrice,
  });

  console.log(`MilestoneEscrow price feed: ${priceFeedAddress}, max staleness: ${maxStalenessSeconds}s`);
};

deployMilestoneEscrow.tags = ["MilestoneEscrow"];
export default deployMilestoneEscrow;
