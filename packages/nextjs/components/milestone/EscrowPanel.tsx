"use client";

import { useState } from "react";
import { Address } from "@scaffold-hbar-ui/components";
import { postAudit } from "~~/components/milestone/CreateEscrowForm";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-hbar";
import { useTargetNetwork } from "~~/hooks/scaffold-hbar";
import { notification } from "~~/utils/scaffold-hbar";

const STATUS_LABELS = ["Open", "Funded", "Released", "Refunded", "Cancelled"] as const;

// Hedera unit boundary: the EVM executes in tinybar (1e8 per HBAR), while
// wagmi/viem sends value in weibar (1e18 per HBAR) and the relay converts.
// Contract reads are tinybar; the fund transaction converts exactly once here.
const TINYBAR_PER_HBAR = 100_000_000n;
const WEIBAR_PER_TINYBAR = 10_000_000_000n;
const formatTinybar = (tinybar: bigint) => (Number(tinybar) / Number(TINYBAR_PER_HBAR)).toFixed(4);
const tinybarToWeibar = (tinybar: bigint) => tinybar * WEIBAR_PER_TINYBAR;
// The scaffold hook types struct address fields as plain `string`; the chain
// returns checksummed hex addresses, so narrowing once here is safe.
const asViemAddress = (value: string) => value as `0x${string}`;

export function LivePriceCard() {
  const { data: priceData } = useScaffoldReadContract({
    contractName: "MilestoneEscrow",
    functionName: "getPrice",
  });
  const { data: quote100 } = useScaffoldReadContract({
    contractName: "MilestoneEscrow",
    functionName: "quoteHbarTinybar",
    args: [100_000_000n], // $100.00 in micro-USD
  });

  const price = priceData?.[0];
  const updatedAt = priceData?.[1];

  return (
    <div className="card bg-base-100 shadow-xl">
      <div className="card-body">
        <h2 className="card-title">Live HBAR/USD (Chainlink on Hedera)</h2>
        {price !== undefined ? (
          <>
            <p className="text-4xl font-bold">${(Number(price) / 1e8).toFixed(4)}</p>
            <p className="text-sm opacity-70">
              $100.00 milestone = {quote100 !== undefined ? `${formatTinybar(quote100)} HBAR` : "..."} at this price.
              Feed updated {updatedAt ? new Date(Number(updatedAt) * 1000).toLocaleString() : "..."}. Funding reverts if
              the feed goes stale, so this quote is only honoured while it is fresh.
            </p>
          </>
        ) : (
          <p className="text-sm opacity-70">
            No deployed MilestoneEscrow on the connected network yet. Deploy with{" "}
            <code>npm run hardhat:deploy --network hederaTestnet</code> (or the local fork) and this card reads the live
            feed through the contract.
          </p>
        )}
      </div>
    </div>
  );
}

export function EscrowPanel() {
  const [escrowIdInput, setEscrowIdInput] = useState("0");
  const escrowId = BigInt(Number.parseInt(escrowIdInput || "0", 10) || 0);
  const { targetNetwork } = useTargetNetwork();
  const { data: deployedContract } = useDeployedContractInfo({ contractName: "MilestoneEscrow" });

  const { data: escrow } = useScaffoldReadContract({
    contractName: "MilestoneEscrow",
    functionName: "getEscrow",
    args: [escrowId],
  });
  const { data: count } = useScaffoldReadContract({
    contractName: "MilestoneEscrow",
    functionName: "escrowCount",
  });
  const { data: quote } = useScaffoldReadContract({
    contractName: "MilestoneEscrow",
    functionName: "quoteHbarTinybar",
    args: [escrow?.usdMicros ?? 0n],
  });

  const { writeContractAsync, isPending } = useScaffoldWriteContract({
    contractName: "MilestoneEscrow",
  });

  const run = async (label: string, call: () => Promise<unknown>) => {
    try {
      await call();
      await postAudit(`${label} escrowId=${escrowId.toString()}`);
      notification.success(label);
    } catch (error) {
      console.error(label, error);
    }
  };

  const status = escrow ? STATUS_LABELS[Number(escrow.status)] : undefined;
  const hashscanBase = targetNetwork.id === 295 ? "https://hashscan.io/mainnet" : "https://hashscan.io/testnet";

  return (
    <div className="card bg-base-100 shadow-xl">
      <div className="card-body">
        <h2 className="card-title">2. Fund / release an escrow</h2>
        <div className="flex items-end gap-3">
          <label className="form-control grow">
            <span className="label-text">Escrow ID {count !== undefined ? `(total: ${count.toString()})` : ""}</span>
            <input
              className="input input-bordered"
              inputMode="numeric"
              value={escrowIdInput}
              onChange={event => setEscrowIdInput(event.target.value)}
            />
          </label>
          {deployedContract?.address && (
            <a
              className="btn btn-outline"
              href={`${hashscanBase}/contract/${deployedContract.address}`}
              target="_blank"
              rel="noreferrer"
            >
              View contract on HashScan
            </a>
          )}
        </div>

        {escrow ? (
          <div className="space-y-2 text-sm">
            <p>
              Status: <span className="badge badge-primary">{status}</span>
            </p>
            <p className="flex items-center gap-2">
              Client: <Address address={asViemAddress(escrow.client)} />
            </p>
            <p className="flex items-center gap-2">
              Worker: <Address address={asViemAddress(escrow.worker)} />
            </p>
            <p>Milestone: ${(Number(escrow.usdMicros) / 1e6).toFixed(2)} USD</p>
            <p>Funded: {formatTinybar(escrow.fundedTinybar)} HBAR</p>
            <p>Deadline: {new Date(Number(escrow.deadline) * 1000).toLocaleString()}</p>
            {status === "Open" && (
              <p>
                Funding now requires {quote !== undefined ? `${formatTinybar(quote)} HBAR` : "..."} (live Chainlink
                quote).
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm opacity-70">Escrow not found on this network yet.</p>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            className="btn btn-primary"
            disabled={isPending || status !== "Open" || quote === undefined}
            onClick={() =>
              run("EscrowFunded", () =>
                writeContractAsync({
                  functionName: "fundEscrow",
                  args: [escrowId],
                  value: quote ? tinybarToWeibar(quote) : 0n,
                }),
              )
            }
          >
            Fund escrow
          </button>
          <button
            className="btn btn-secondary"
            disabled={isPending || status !== "Funded"}
            onClick={() =>
              run("EscrowReleased", () => writeContractAsync({ functionName: "releaseEscrow", args: [escrowId] }))
            }
          >
            Release to worker
          </button>
          <button
            className="btn btn-outline"
            disabled={isPending || status !== "Funded"}
            onClick={() =>
              run("EscrowRefunded", () => writeContractAsync({ functionName: "refundExpiredEscrow", args: [escrowId] }))
            }
          >
            Refund (after deadline)
          </button>
          <button
            className="btn btn-ghost"
            disabled={isPending || status !== "Open"}
            onClick={() =>
              run("EscrowCancelled", () => writeContractAsync({ functionName: "cancelEscrow", args: [escrowId] }))
            }
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
