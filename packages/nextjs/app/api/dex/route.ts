import { NextResponse } from "next/server";

// Read-only SaucerSwap reference price, from its testnet REST API (verified
// live 2026-10-04: GET /tokens/0.0.15058 -> priceUsd ~0.1015, HTTP 200 with
// no API key; SaucerSwap's docs state a key is required, so treat keyless
// reads as best-effort). Display-only cross-check: it is never fed into
// escrow funding math — the Chainlink feed is the pricing source of truth.
// Token id is pinned (never a symbol lookup: spoof "HBAR" tokens exist).
// Server-side so CORS and API changes stay off the client; fail-soft.
const WHBAR_TOKEN_ID = "0.0.15058"; // WHBAR[new] on SaucerSwap testnet

export async function GET() {
  try {
    const resp = await fetch(`https://test-api.saucerswap.finance/tokens/${WHBAR_TOKEN_ID}`, {
      next: { revalidate: 30 },
    });
    if (!resp.ok) return NextResponse.json({ available: false });
    const token = await resp.json();
    const priceUsd = Number(token?.priceUsd);
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) return NextResponse.json({ available: false });
    return NextResponse.json({ available: true, priceUsd, tokenId: WHBAR_TOKEN_ID, source: "SaucerSwap (testnet)" });
  } catch {
    return NextResponse.json({ available: false });
  }
}
