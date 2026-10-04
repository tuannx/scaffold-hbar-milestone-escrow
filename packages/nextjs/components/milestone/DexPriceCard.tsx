"use client";

import { useEffect, useState } from "react";

type DexPrice = { available: boolean; priceUsd?: number; tokenId?: string; source?: string };

/**
 * Reference price from SaucerSwap's testnet REST API, read-only.
 * Display-only cross-check next to the Chainlink price that actually
 * prices funding; never used for escrow math. Renders nothing when the
 * API is unreachable (keyless reads are best-effort, not guaranteed).
 */
export function DexPriceCard() {
  const [dex, setDex] = useState<DexPrice | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/dex")
      .then(r => r.json())
      .then((body: DexPrice) => {
        if (!cancelled) setDex(body);
      })
      .catch(() => {
        if (!cancelled) setDex({ available: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!dex?.available || dex.priceUsd === undefined) return null;

  return (
    <div className="card bg-base-100 shadow-xl">
      <div className="card-body py-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="card-title text-base">Reference: SaucerSwap (testnet DEX, read-only)</h2>
          <span className="text-2xl font-bold">${dex.priceUsd.toFixed(4)}</span>
        </div>
        <p className="text-sm opacity-70">
          WHBAR ({dex.tokenId}) via SaucerSwap&apos;s testnet API, shown as an independent cross-check. It is never
          used for funding — the Chainlink feed above prices every escrow.
        </p>
      </div>
    </div>
  );
}
