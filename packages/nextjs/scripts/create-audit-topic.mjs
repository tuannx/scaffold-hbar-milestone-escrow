// One-time setup for the optional HCS audit mirror.
//
// Usage (from packages/nextjs):
//   1. Put HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY (ECDSA hex) in .env.local
//      (or export them). Fund the operator with testnet HBAR first.
//   2. npm run audit:create-topic
//   3. Copy the printed topic id into .env.local as HEDERA_AUDIT_TOPIC_ID.
//
// The topic is created with the operator key as submit key: without a submit
// key the topic would be world-writable and worthless as an audit log.
// The runtime mirror code lives in services/hedera/auditLog.ts.
import { Client, PrivateKey, TopicCreateTransaction } from "@hiero-ledger/sdk";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(here, "..", ".env.local");
if (fs.existsSync(envPath) && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(envPath);
}

const operatorId = process.env.HEDERA_OPERATOR_ID;
const operatorKey = process.env.HEDERA_OPERATOR_KEY;
if (!operatorId || !operatorKey) {
  console.error("Set HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY first (see .env.example).");
  process.exit(1);
}

const client = process.env.HEDERA_NETWORK === "mainnet" ? Client.forMainnet() : Client.forTestnet();
try {
  // Parse as ECDSA explicitly: a raw hex string lets the SDK misread the key
  // as ED25519, which fails precheck (INVALID_SIGNATURE) for EVM accounts.
  client.setOperator(operatorId, PrivateKey.fromStringECDSA(operatorKey));
  const submitKey = PrivateKey.fromStringECDSA(operatorKey);
  const tx = await new TopicCreateTransaction()
    .setTopicMemo("MilestoneEscrow audit log")
    .setSubmitKey(submitKey)
    .execute(client);
  const receipt = await tx.getReceipt(client);
  console.log(`HEDERA_AUDIT_TOPIC_ID=${receipt.topicId.toString()}`);
} finally {
  client.close();
}
