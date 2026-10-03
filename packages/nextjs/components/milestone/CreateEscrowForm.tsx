"use client";

import { useState } from "react";
import { HederaAddressInput } from "@scaffold-hbar-ui/components";
import { keccak256, parseUnits, toHex } from "viem";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-hbar";
import { notification } from "~~/utils/scaffold-hbar";

const ZERO_REFERENCE = `0x${"0".repeat(64)}` as const;

/** Fire-and-forget mirror of a lifecycle event to the HCS audit topic. */
export async function postAudit(message: string) {
  try {
    await fetch("/api/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
  } catch {
    // Audit mirroring is additive; contract events remain the source of truth.
  }
}

export function CreateEscrowForm() {
  const [worker, setWorker] = useState("");
  const [workerEvm, setWorkerEvm] = useState("");
  const [usdAmount, setUsdAmount] = useState("100");
  const [deadlineDays, setDeadlineDays] = useState("7");
  const [reference, setReference] = useState("");

  const { writeContractAsync, isPending } = useScaffoldWriteContract({
    contractName: "MilestoneEscrow",
  });

  const handleCreate = async () => {
    try {
      const usdMicros = parseUnits(usdAmount || "0", 6);
      const days = Number.parseInt(deadlineDays || "0", 10);
      if ((!workerEvm && !worker) || usdMicros <= 0n || !Number.isFinite(days) || days <= 0) {
        notification.error("Worker address, a positive USD amount, and deadline days are required.");
        return;
      }
      const deadline = BigInt(Math.floor(Date.now() / 1000) + days * 24 * 3600);
      const referenceHash = reference.trim() ? keccak256(toHex(reference.trim())) : ZERO_REFERENCE;
      const workerAddress = workerEvm || worker;

      await writeContractAsync({
        functionName: "createEscrow",
        args: [workerAddress, usdMicros, deadline, referenceHash],
      });
      await postAudit(
        `EscrowCreated worker=${workerAddress} usdMicros=${usdMicros.toString()} reference=${reference || "-"}`,
      );
      notification.success("Escrow created. Fund it from the escrow panel below.");
    } catch (error) {
      console.error("createEscrow failed", error);
    }
  };

  return (
    <div className="card bg-base-100 shadow-xl">
      <div className="card-body">
        <h2 className="card-title">1. Create a milestone escrow</h2>
        <p className="text-sm opacity-70">
          Price the milestone in USD. The HBAR amount is only fixed when the client funds, at the live Chainlink price.
        </p>
        <label className="form-control">
          <span className="label-text">Worker (payee) address, 0.0.x or 0x...</span>
          <HederaAddressInput
            value={worker}
            onChange={setWorker}
            onResolvedEvmChange={address => setWorkerEvm(address ?? "")}
            placeholder="0.0.1234 or 0x..."
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="form-control">
            <span className="label-text">Amount (USD)</span>
            <input
              className="input input-bordered"
              inputMode="decimal"
              value={usdAmount}
              onChange={event => setUsdAmount(event.target.value)}
              placeholder="100.00"
            />
          </label>
          <label className="form-control">
            <span className="label-text">Deadline (days from now)</span>
            <input
              className="input input-bordered"
              inputMode="numeric"
              value={deadlineDays}
              onChange={event => setDeadlineDays(event.target.value)}
              placeholder="7"
            />
          </label>
        </div>
        <label className="form-control">
          <span className="label-text">Milestone reference (stored as a hash only)</span>
          <input
            className="input input-bordered"
            value={reference}
            onChange={event => setReference(event.target.value)}
            placeholder="e.g. milestone-1:design-approved"
          />
        </label>
        <button className="btn btn-primary" onClick={handleCreate} disabled={isPending}>
          {isPending ? <span className="loading loading-spinner loading-sm" /> : "Create escrow"}
        </button>
      </div>
    </div>
  );
}
