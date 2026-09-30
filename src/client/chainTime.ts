import { withTimeout } from "./authFlow";

export const CHAIN_TIME_TIMEOUT_MS = 10_000;

export type ChainTimeReader = {
  getBlock: (args?: { blockTag?: "latest" }) => Promise<{ timestamp: bigint | number | string }>;
};

export async function readChainTimestamp(reader: ChainTimeReader, timeoutMs = CHAIN_TIME_TIMEOUT_MS): Promise<bigint> {
  const block = await withTimeout(reader.getBlock({ blockTag: "latest" }), timeoutMs);
  if (block?.timestamp === undefined || block?.timestamp === null) throw new Error("chain timestamp unavailable");
  return BigInt(block.timestamp);
}
export function expiryFromChainTimestamp(chainTimestamp: bigint, lifetimeSeconds: number): bigint {
  if (!Number.isSafeInteger(lifetimeSeconds) || lifetimeSeconds <= 0) throw new Error("invalid expiry");
  return chainTimestamp + BigInt(lifetimeSeconds);
}

