# Agent instructions

Briefing for coding agents (Cursor, Claude Code, Codex) working in this template.
`CLAUDE.md` points here. One source of truth.

## What this is

A Scaffold-HBAR external template: a USD-priced milestone escrow settled in HBAR.
`MilestoneEscrow` prices funding through a Chainlink AggregatorV3 feed at funding time and
reverts on stale, incomplete, or non-positive rounds. Escrow lifecycle events can be mirrored
to an HCS topic through `POST /api/audit`. Next.js frontend, Hardhat contracts, npm workspaces.

## Invariants — do not break these

1. **Funding always re-prices.** `fundEscrow` must obtain its amount from `quoteHbarTinybar`
   (which calls `getPrice`) in the same transaction. Never store a creation-time HBAR amount
   and fund against it later; that deletes the point of the template.
2. **Fresh-or-revert.** `getPrice` reverts on `answeredInRound < roundId`, `updatedAt == 0`,
   `answer <= 0`, or age above `maxStalenessSeconds`. Do not catch, default, or widen the
   staleness window to make a failing flow pass.
3. **State before payout.** Escrow status changes before any HBAR transfer (`_pay` last).
4. **The mock is not the feed.** `MockPriceFeed` is deployed automatically only on `hardhat`
   and `localhost` networks. Live networks use `PRICE_FEED_ADDRESS` or the Hedera testnet
   HBAR/USD default in `deploy/00_deploy_milestone_escrow.ts`.
5. **Secrets stay server-side and uncommitted.** Operator keys live in `packages/nextjs/.env.local`
   (gitignored) and are read only by `services/hedera/auditLog.ts` and
   `scripts/create-audit-topic.mjs`. Never prefix them `NEXT_PUBLIC_`, never log them, never
   put a real key in `.env.example`, the README, or `deployedContracts.ts`.
6. **No world-writable audit topic.** Topics are created with the operator key as submit key.
7. **Respect the Hedera unit boundary.** Inside the EVM, contract amounts are tinybar
   (`msg.value`, balances, `call{value:}`; 1e8 per HBAR). Wallets and JSON-RPC send weibar
   (1e18 per HBAR) on the wire and the relay converts. Convert exactly once at the client
   wire boundary; never use `parseEther`/`formatEther` for contract-denominated amounts.
8. **SaucerSwap is display-only.** The `/api/dex` reference price (testnet WHBAR, token id
   pinned at `0.0.15058` — never a symbol lookup) must never feed contract calls, quotes,
   or funding math. Chainlink is the only pricing source.

## Map

| Area | Files |
|---|---|
| Escrow contract | `packages/hardhat/contracts/MilestoneEscrow.sol` |
| Feed interface | `packages/hardhat/contracts/interfaces/AggregatorV3Interface.sol` |
| Test double | `packages/hardhat/contracts/mocks/MockPriceFeed.sol` (tests/local only) |
| Deploy | `packages/hardhat/deploy/00_deploy_milestone_escrow.ts` |
| Tests (the spec) | `packages/hardhat/test/MilestoneEscrow.test.ts` |
| UI | `packages/nextjs/app/page.tsx`, `packages/nextjs/components/milestone/*` |
| HCS mirror | `packages/nextjs/services/hedera/auditLog.ts`, `packages/nextjs/app/api/audit/route.ts` |
| DEX reference | `packages/nextjs/app/api/dex/route.ts`, `packages/nextjs/components/milestone/DexPriceCard.tsx` |
| Topic setup | `packages/nextjs/scripts/create-audit-topic.mjs` |
| Manifest | `template.json` (validated by the create-scaffold-hbar CLI schema) |

`packages/nextjs/contracts/deployedContracts.ts` is **generated** by deploy
(`scripts/generateTsAbis`). Never edit it by hand; deploy again instead.

## Commands

npm is the default package manager (`packageManager` in the root `package.json`); yarn works
with the same scripts via the workspace tool. Run from the repo root unless a package is named.

```bash
npm run hardhat:chain                         # local fork node (terminal 1)
npm run hardhat:deploy -- --network localhost # deploys mock feed + escrow locally
npm run next:dev                              # http://localhost:3000 (terminal 2)
npm run hardhat:deploy -- --network hederaTestnet

cd packages/hardhat && npx hardhat test test/MilestoneEscrow.test.ts
npm run lint                                  # both workspaces
npm run next:check-types && npm run next:build
npm run audit:create-topic -w @sh/nextjs      # one-time HCS topic (needs operator env)
scripts/verify-template.sh                    # the full gate: fresh scaffold + install/lint/test/build/boot
```

Hooks in this codebase: `useScaffoldReadContract`, `useScaffoldWriteContract`,
`useDeployedContractInfo`, `useTargetNetwork` from `~~/hooks/scaffold-hbar`. Next.js imports
use the `~~` alias. The address input component is `HederaAddressInput` from
`@scaffold-hbar-ui/components` (it resolves `0.0.x` to an EVM address via
`onResolvedEvmChange`); use DaisyUI classes for UI.

## When you change something

- **Contract behaviour:** write or update the test first, in the naming style of the existing
  suite (the test name is the claim, e.g. `fundRevertsWhenPriceIsStale`). The README's
  claim→evidence table must stay true: if you rename a test, update the table.
- **Manifest:** if you add an env var, add it to `template.json` `envVars`, the matching
  `.env.example`, and the README table in the same change. Keep `capabilities`/`defaults`
  truthful: this template is Hardhat-only, nextjs-app-only.
- **UI claims:** the page copy states behaviour the contract enforces (fresh-or-revert,
  refund after deadline). Do not write UI text the contract does not implement.
- **Before calling work done:** `npx hardhat test test/MilestoneEscrow.test.ts` passes,
  `npm run lint` passes, `npm run next:build` passes, and a fresh scaffold of this repo
  (`npm create scaffold-hbar@latest -- --template <owner>/<repo>`) installs, lints, builds,
  and serves `/` and `/api/audit`. Those are the bounty gate checks; run them, do not assert
  them.
