#!/usr/bin/env bash
# verify-template.sh — run the Scaffold-HBAR bounty gate against this template
# exactly the way a judge would: scaffold fresh from GitHub, then install,
# lint, test, build, and boot-probe the result.
#
# Usage:
#   scripts/verify-template.sh [owner/repo]
#
# The argument defaults to this template's published repo. After forking,
# pass your own slug. Requires Node >= 20.18.3 and npm. Runs outside the
# repo (default workdir: ~/.verify-template-run, override with VERIFY_DIR)
# because a scaffold must not nest inside the template checkout.
set -euo pipefail

TEMPLATE="${1:-tuannx/scaffold-hbar-milestone-escrow}"
WORKDIR="${VERIFY_DIR:-$HOME/.verify-template-run}"
APP="verify-app"

step() { printf '\n== %s\n' "$1"; }

step "clean workdir $WORKDIR"
rm -rf "$WORKDIR"
mkdir -p "$WORKDIR"
cd "$WORKDIR"

step "G1 scaffold: npm create scaffold-hbar@latest -- --template $TEMPLATE"
npm create scaffold-hbar@latest "$APP" -- --template "$TEMPLATE" --ci --solidity-framework hardhat --package-manager npm
cd "$APP"

step "G4 install"
npm install

step "G4 lint"
npm run lint

step "G4 contract tests (the spec)"
(cd packages/hardhat && npx hardhat test test/MilestoneEscrow.test.ts)

step "G4 next build"
npm run next:build

step "G5 boot probe"
npm run next:start > /tmp/verify-template-next.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT
for i in $(seq 1 40); do
  curl -sf -o /dev/null http://localhost:3000 && break || sleep 2
done
ROOT_CODE=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/)
AUDIT_BODY=$(curl -s http://localhost:3000/api/audit)
echo "GET / -> $ROOT_CODE"
echo "GET /api/audit -> $AUDIT_BODY"
[ "$ROOT_CODE" = "200" ]
case "$AUDIT_BODY" in *'"configured"'*) ;; *) echo "unexpected /api/audit body"; exit 1;; esac
kill $SERVER_PID 2>/dev/null || true
trap - EXIT

step "GATE PASS"
echo "Scaffolded $TEMPLATE clean; install/lint/tests/build/boot all green."
echo "G6 (testnet tx), G2/G3/G7/G8 are evidenced in the repo README (Testnet proof,"
echo "template.json, licence, secret-free history). G9: Hedera Harness not used."
