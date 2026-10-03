import { Client, PrivateKey, TopicCreateTransaction, TopicMessageSubmitTransaction } from "@hiero-ledger/sdk";

/**
 * Server-side HCS audit log (Hedera Consensus Service).
 *
 * Escrow lifecycle events that already exist as contract events on-chain can
 * also be mirrored to an HCS topic, giving auditors a Hedera-native,
 * consensus-ordered message log they can read from any mirror node without
 * indexing contract logs. The module is fail-soft: with no operator env set
 * it reports `configured: false` and the app keeps working on contract
 * events alone. Keys are read from server env only and never reach the browser.
 */

export type AuditSubmitResult = { configured: boolean; sequenceNumber?: string; topicId?: string };

function auditConfig() {
  const operatorId = process.env.HEDERA_OPERATOR_ID;
  const operatorKey = process.env.HEDERA_OPERATOR_KEY;
  const topicId = process.env.HEDERA_AUDIT_TOPIC_ID;
  if (!operatorId || !operatorKey || !topicId) return null;
  return { operatorId, operatorKey, topicId };
}

export function isAuditConfigured(): boolean {
  return auditConfig() !== null;
}

export async function submitAuditMessage(message: string): Promise<AuditSubmitResult> {
  const config = auditConfig();
  if (!config) return { configured: false };

  const network = process.env.HEDERA_NETWORK === "mainnet" ? "mainnet" : "testnet";
  const client = network === "mainnet" ? Client.forMainnet() : Client.forTestnet();
  try {
    client.setOperator(config.operatorId, config.operatorKey);
    const submitTx = await new TopicMessageSubmitTransaction()
      .setTopicId(config.topicId)
      .setMessage(message)
      .execute(client);
    const receipt = await submitTx.getReceipt(client);
    return {
      configured: true,
      sequenceNumber: receipt.topicSequenceNumber?.toString(),
      topicId: config.topicId,
    };
  } finally {
    client.close();
  }
}

/** Creates the audit topic with the operator as submit key. Run once, then set
 * HEDERA_AUDIT_TOPIC_ID from the printed topic id. See scripts/create-audit-topic.mjs. */
export async function createAuditTopic(memo: string): Promise<string> {
  const operatorId = process.env.HEDERA_OPERATOR_ID;
  const operatorKey = process.env.HEDERA_OPERATOR_KEY;
  if (!operatorId || !operatorKey) {
    throw new Error("HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY must be set to create the audit topic.");
  }

  const network = process.env.HEDERA_NETWORK === "mainnet" ? "mainnet" : "testnet";
  const client = network === "mainnet" ? Client.forMainnet() : Client.forTestnet();
  try {
    client.setOperator(operatorId, operatorKey);
    // Operator keys for this template are ECDSA (the EVM deployer flow).
    // The submit key stops the audit topic being world-writable.
    const submitKey = PrivateKey.fromStringECDSA(operatorKey);
    const topicTx = await new TopicCreateTransaction().setTopicMemo(memo).setSubmitKey(submitKey).execute(client);
    const receipt = await topicTx.getReceipt(client);
    if (!receipt.topicId) throw new Error("Topic creation returned no topic id.");
    return receipt.topicId.toString();
  } finally {
    client.close();
  }
}
