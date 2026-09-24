import { decodeAbiParameters, isAddress, keccak256, toHex, type Address, type Hex } from "viem";

export const PAYOUT_CREATED_SIGNATURE = "PayoutCreated(uint256 indexed payoutId,address indexed sender,uint256 amount,uint64 expiresAt,address claimSigner,bytes32 indexed memo)" as const;
const PAYOUT_CREATED_TOPIC = keccak256(toHex("PayoutCreated(uint256,address,uint256,uint64,address,bytes32)"));
const INDEXED_TOPIC = /^0x[a-fA-F0-9]{64}$/;
const TRANSACTION_HASH = /^0x[a-fA-F0-9]{64}$/;

export type DiscoveredPayout = {
  id: string;
  sender: Address;
  amount: string;
  expiresAt: string;
  claimSigner: Address;
  fundingTxHash?: Hex;
  createdAt?: string;
  createdBlock?: string;
};

type IndexerPayload = {
  columns?: unknown;
  rows?: unknown;
};

function rowValue(row: unknown[], columns: string[], name: string): unknown {
  const index = columns.indexOf(name);
  return index >= 0 ? row[index] : undefined;
}

function addressFromTopic(value: unknown): Address | null {
  if (typeof value !== "string" || !INDEXED_TOPIC.test(value)) return null;
  const address = `0x${value.slice(-40)}`;
  return isAddress(address) ? (address as Address) : null;
}

function exactBlock(value: unknown): string | undefined {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  return undefined;
}

function exactTransactionHash(value: unknown): Hex | undefined {
  return typeof value === "string" && TRANSACTION_HASH.test(value) ? (value as Hex) : undefined;
}

function createdAt(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
}

export function parsePayoutCreatedRows(payload: unknown, requestedSender: Address): DiscoveredPayout[] {
  if (!payload || typeof payload !== "object") throw new Error("payout discovery response malformed");
  const value = payload as IndexerPayload;
  if (!Array.isArray(value.columns) || !value.columns.every((column) => typeof column === "string")) throw new Error("payout discovery columns missing");
  if (!Array.isArray(value.rows) || !value.rows.every((row) => Array.isArray(row))) throw new Error("payout discovery rows missing");

  const columns = value.columns as string[];
  const expectedSender = requestedSender.toLowerCase();
  const payouts: DiscoveredPayout[] = [];

  for (const row of value.rows as unknown[][]) {
    const selector = rowValue(row, columns, "selector");
    const payoutIdTopic = rowValue(row, columns, "topic1");
    const senderTopic = rowValue(row, columns, "topic2");
    const data = rowValue(row, columns, "data");
    if (selector !== PAYOUT_CREATED_TOPIC || typeof data !== "string" || !/^0x[0-9a-fA-F]*$/.test(data)) continue;
    if (!INDEXED_TOPIC.test(String(payoutIdTopic)) || !INDEXED_TOPIC.test(String(senderTopic))) continue;

    const eventSender = addressFromTopic(senderTopic);
    if (!eventSender || eventSender.toLowerCase() !== expectedSender) continue;
    const decoded = decodeAbiParameters([
      { type: "uint256" },
      { type: "uint64" },
      { type: "address" },
    ], data as Hex);
    const claimSigner = decoded[2] as Address;
    if (!isAddress(claimSigner)) continue;

    payouts.push({
      id: BigInt(String(payoutIdTopic)).toString(),
      sender: requestedSender,
      amount: decoded[0].toString(),
      expiresAt: decoded[1].toString(),
      claimSigner,
      ...(exactTransactionHash(rowValue(row, columns, "tx_hash")) ? { fundingTxHash: exactTransactionHash(rowValue(row, columns, "tx_hash")) } : {}),
      ...(createdAt(rowValue(row, columns, "block_timestamp")) ? { createdAt: createdAt(rowValue(row, columns, "block_timestamp")) } : {}),
      ...(exactBlock(rowValue(row, columns, "block_num")) ? { createdBlock: exactBlock(rowValue(row, columns, "block_num")) } : {}),
    });
  }

  return payouts;
}

export async function discoverPayoutsBySender(sender: Address, options: { indexerUrl: string; fetchImpl?: typeof fetch; signal?: AbortSignal }): Promise<DiscoveredPayout[]> {
  const url = new URL(options.indexerUrl);
  const sql = `SELECT block_num, block_timestamp, tx_hash, selector, topic1, topic2, data FROM PayoutCreated WHERE sender = '${sender.toLowerCase()}' ORDER BY block_num DESC LIMIT 1000`;
  url.searchParams.set("chainId", "42431");
  url.searchParams.set("signature", PAYOUT_CREATED_SIGNATURE);
  url.searchParams.set("sql", sql);
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(url, { headers: { accept: "application/json" }, signal: options.signal });
  if (!response.ok) throw new Error("payout discovery unavailable");
  return parsePayoutCreatedRows(await response.json(), sender);
}
