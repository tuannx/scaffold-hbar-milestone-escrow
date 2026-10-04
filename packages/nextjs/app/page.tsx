"use client";

import type { NextPage } from "next";
import { useAccount } from "wagmi";
import { CreateEscrowForm } from "~~/components/milestone/CreateEscrowForm";
import { DexPriceCard } from "~~/components/milestone/DexPriceCard";
import { EscrowPanel, LivePriceCard } from "~~/components/milestone/EscrowPanel";
import { HederaAddress } from "~~/components/scaffold-hbar";
import { useTargetNetwork } from "~~/hooks/scaffold-hbar";

const Home: NextPage = () => {
  const { address: connectedAddress } = useAccount();
  const { targetNetwork } = useTargetNetwork();

  return (
    <div className="flex flex-col grow">
      <div className="hedera-gradient dark:bg-none dark:bg-hedera-charcoal w-full py-12 px-5">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-sm font-semibold tracking-widest uppercase text-white/80 dark:text-white/60">
            Scaffold-HBAR Template
          </p>
          <h1 className="text-4xl font-bold text-white mt-2">USD Milestone Escrow, settled in HBAR</h1>
          <p className="text-white/85 dark:text-white/70 mt-3">
            Freelance milestones priced in USD, funded and released in HBAR at the live Chainlink HBAR/USD price.
            Funding reverts on a stale or incomplete feed, so the price both parties see is the price the contract
            enforces.
          </p>
          {connectedAddress && (
            <div className="mt-4 flex justify-center">
              <HederaAddress address={connectedAddress} chain={targetNetwork} />
            </div>
          )}
        </div>
      </div>

      <div className="w-full max-w-4xl mx-auto px-5 py-8 space-y-6">
        <LivePriceCard />
        <DexPriceCard />
        <CreateEscrowForm />
        <EscrowPanel />
        <div className="card bg-base-100 shadow-xl">
          <div className="card-body">
            <h2 className="card-title">How it fits together</h2>
            <ul className="list-disc pl-5 space-y-1 text-sm">
              <li>
                <strong>Chainlink (Hedera testnet feed)</strong> prices every funding on-chain. Remove it and the escrow
                has no USD-to-HBAR conversion and cannot be funded. That is the load-bearing integration, proven by the
                Hardhat tests named <code>fundRevertsWhenPriceIsStale</code> and{" "}
                <code>fundRepricesAtFundingTimeAndRefundsExcess</code>.
              </li>
              <li>
                <strong>MilestoneEscrow (Solidity on Hedera)</strong> holds the HBAR, enforces client/worker roles and
                the deadline refund path, and emits every lifecycle event.
              </li>
              <li>
                <strong>HCS audit topic (optional)</strong> mirrors those events to a Hedera Consensus Service topic via{" "}
                <code>POST /api/audit</code> when an operator is configured, so auditors can read a consensus-ordered
                log from any mirror node. Off by default; the app runs on contract events alone.
              </li>
              <li>
                <strong>SaucerSwap (read-only reference)</strong> shows the testnet DEX price of WHBAR next to the
                Chainlink price as an independent cross-check. It prices nothing: the integration is display-only
                and funding always uses Chainlink.
              </li>
              <li>
                Local development needs no account: the deploy script seeds a mock feed at $0.10 on local networks.
                Testnet uses the real feed. See the README for the one-command scaffold and the testnet deployment
                proof.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Home;
