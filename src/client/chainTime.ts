import { withTimeout } from "./authFlow";

export const CHAIN_TIME_TIMEOUT_MS = 10_000;

export type ChainTimeReader = {
  getBlock: (args?: { blockTag?: "latest" }) => Promise<{ timestamp: bigint | number | string }>;
};

export async function readChainTimestamp(reader: ChainTimeReader, timeoutMs = CHAIN_TIME_TIMEOUT_MS): Promise<bigint> {
  const block = await withTimeout(reader.getBlock({ blockTag: "latest" }), timeoutMs);
  const value = block?.timestamp;
  if (typeof value !== "bigint" && !(typeof value === "number" && Number.isSafeInteger(value)) && !(typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value))) throw new Error("chain timestamp unavailable");
  const timestamp = BigInt(value);
  if (timestamp < 0n || timestamp >= 1n << 64n) throw new Error("chain timestamp unavailable");
  return timestamp;
}
export function expiryFromChainTimestamp(chainTimestamp: bigint, lifetimeSeconds: number): bigint {
  if (!Number.isSafeInteger(lifetimeSeconds) || lifetimeSeconds <= 0) throw new Error("invalid expiry");
  return chainTimestamp + BigInt(lifetimeSeconds);
}

/** One clock per sender session. Failed reads remove authority; older RPC
 * responses cannot move an already observed chain timestamp backwards. */
export function createChainClock(reader: ChainTimeReader, timeoutMs = CHAIN_TIME_TIMEOUT_MS) {
  let timestamp: bigint | undefined;
  let highWater: bigint | undefined;
  let pending: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  const publish = () => listeners.forEach(listener => listener());
  return {
    getSnapshot: () => timestamp,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh(): Promise<void> {
      if (pending) return pending;
      pending = readChainTimestamp(reader, timeoutMs).then(next => {
        highWater = highWater === undefined || next > highWater ? next : highWater;
        timestamp = highWater;
      }).catch(() => { timestamp = undefined; }).finally(() => {
        pending = undefined;
        publish();
      });
      return pending;
    },
  };
}

