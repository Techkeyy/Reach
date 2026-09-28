import { isAddress, zeroAddress, type Address } from "viem";
import type { Kv } from "accounts/server";
import { PATH_USD_ADDRESS, TEMPO_MODERATO_RPC_URL } from "../shared/reach.js";

export const FUND_COOLDOWN_SECONDS = 600;
const CONFIRMATION_MS = 45_000;
const hashPattern = /^0x[0-9a-fA-F]{64}$/;
type Attempt = {
  address: Address;
  stage: "REQUESTING_TEST_FUNDS" | "WAITING_FOR_BALANCE" | "FUNDED" | "FAILED";
  startedAt: number;
  startingBalance?: string;
  balance?: string;
  txHashes?: string[];
  error?: string;
};

export class FundingError extends Error {
  constructor(public code: string, message: string, public status: 400 | 404 | 409 | 429 | 502 | 503 = 503) {
    super(message);
  }
}

export function fundingAddress(body: unknown): Address {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || !("address" in body)) {
    throw new FundingError("INVALID_REQUEST", "Provide only your Reach account address.", 400);
  }
  const address = (body as { address: unknown }).address;
  if (typeof address !== "string" || !isAddress(address) || address.toLowerCase() === zeroAddress) {
    throw new FundingError("INVALID_ADDRESS", "A valid Reach account address is required.", 400);
  }
  return address.toLowerCase() as Address;
}

// The upstream result is evidence, not proof that the balance increased.
export function faucetHashes(result: unknown): string[] {
  const values = typeof result === "string" ? [result] : result;
  if (!Array.isArray(values) || values.length < 1 || values.length > 16 || !values.every(x => typeof x === "string" && hashPattern.test(x))) {
    throw new FundingError("UNEXPECTED_RESPONSE", "The faucet returned an unexpected response. Check your balance before requesting again.", 502);
  }
  return [...new Set(values)];
}

export function createTestnetFunding(kv: Kv.Kv, dependencies: { fetch?: typeof fetch; now?: () => number } = {}) {
  const fetchRpc = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? Date.now;
  const key = (address: Address) => `reach:testnet-fund:42431:${address.toLowerCase()}`;
  async function storage<T>(operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([operation, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new FundingError("STORAGE_UNAVAILABLE", "Funding storage is unavailable. Check your balance before requesting again.")), 5_000);
      })]);
    } finally { clearTimeout(timer!); }
  }

  async function rpc(method: string, params: unknown[]) {
    let response: Response;
    try {
      response = await fetchRpc(TEMPO_MODERATO_RPC_URL, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      throw new FundingError("RPC_UNAVAILABLE", "Tempo could not be reached. Funding may be uncertain; check your balance before requesting again.");
    }
    if (response.status === 429) throw new FundingError("FAUCET_RATE_LIMIT", "The testnet service is rate limited. Wait before requesting again.", 429);
    if (!response.ok) throw new FundingError("RPC_UNAVAILABLE", "The Tempo testnet service is unavailable.");
    let data: any;
    try { data = await response.json(); } catch { throw new FundingError("UNEXPECTED_RESPONSE", "The Tempo service returned an unreadable response.", 502); }
    if (data?.error) throw new FundingError("FAUCET_REFUSED", "The Tempo service refused this request. Check your balance before requesting again.", 502);
    if (data?.jsonrpc !== "2.0" || data?.id !== 1 || !("result" in data)) throw new FundingError("UNEXPECTED_RESPONSE", "The Tempo service returned an unexpected response.", 502);
    return data.result;
  }

  async function assertChain() {
    if (await rpc("eth_chainId", []) !== "0xa5bf") throw new FundingError("WRONG_CHAIN", "Test funding is available only on Tempo Moderato.");
  }
  async function balanceOf(address: Address): Promise<string> {
    const result = await rpc("eth_call", [{ to: PATH_USD_ADDRESS, data: `0x70a08231${address.slice(2).padStart(64, "0")}` }, "latest"]);
    if (typeof result !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(result)) throw new FundingError("BALANCE_UNAVAILABLE", "Your authoritative pathUSD balance could not be read.");
    return BigInt(result).toString();
  }
  const publicResult = (attempt: Attempt) => ({ ...attempt, chainId: 42431, token: PATH_USD_ADDRESS, retryAfter: FUND_COOLDOWN_SECONDS });
  const failure = (error: unknown) => error instanceof FundingError ? error : new FundingError("FUNDING_UNAVAILABLE", "Test funding is unavailable. Check your balance before requesting again.");

  return {
    async request(body: unknown) {
      const address = fundingAddress(body);
      const attempt: Attempt = { address, stage: "REQUESTING_TEST_FUNDS", startedAt: now() };
      // Atomic NX + TTL. Keep this reservation even after an ambiguous upstream error.
      if (!kv.create || !await storage(kv.create(key(address), attempt, { ttl: FUND_COOLDOWN_SECONDS }))) {
        throw new FundingError("COOLDOWN", "This account requested test funds recently. Check its balance or wait 10 minutes.", 429);
      }
      try {
        await assertChain();
        attempt.startingBalance = await balanceOf(address);
        // Exactly one call, without transport retries or a deployment/sponsor key.
        attempt.txHashes = faucetHashes(await rpc("tempo_fundAddress", [address]));
        attempt.stage = "WAITING_FOR_BALANCE";
        await storage(kv.set(key(address), attempt, { ttl: FUND_COOLDOWN_SECONDS }));
        return publicResult(attempt);
      } catch (error) {
        const safe = failure(error);
        await storage(kv.set(key(address), { ...attempt, stage: "FAILED", error: safe.message }, { ttl: FUND_COOLDOWN_SECONDS }));
        throw safe;
      }
    },
    async status(input: string) {
      const address = fundingAddress({ address: input });
      const attempt = await storage(kv.get<Attempt>(key(address)));
      if (!attempt) throw new FundingError("NO_ATTEMPT", "No recent test funding request was found. Check your balance.", 404);
      if (attempt.stage === "FUNDED" || attempt.stage === "FAILED") return publicResult(attempt);
      if (now() - attempt.startedAt > CONFIRMATION_MS) {
        return publicResult({ ...attempt, stage: "FAILED", error: "Balance confirmation timed out. Funds may arrive later. Check your balance; do not immediately request again." });
      }
      if (!attempt.txHashes || attempt.startingBalance === undefined) return publicResult(attempt);
      await assertChain();
      const [balance, ...receipts] = await Promise.all([
        balanceOf(address), ...attempt.txHashes.map(hash => rpc("eth_getTransactionReceipt", [hash])),
      ]);
      if (receipts.some(r => r?.status === "0x0")) return publicResult({ ...attempt, stage: "FAILED", balance, error: "A faucet transaction reverted. Check your balance before requesting again." });
      if (receipts.some((r, i) => r !== null && (!r || r.transactionHash?.toLowerCase() !== attempt.txHashes![i].toLowerCase() || !["0x0", "0x1"].includes(r.status)))) {
        throw new FundingError("UNEXPECTED_RECEIPT", "Faucet confirmation returned unexpected evidence.", 502);
      }
      const stage = receipts.every(r => r?.status === "0x1") && BigInt(balance) > BigInt(attempt.startingBalance) ? "FUNDED" : "WAITING_FOR_BALANCE";
      return publicResult({ ...attempt, stage, balance });
    },
  };
}
