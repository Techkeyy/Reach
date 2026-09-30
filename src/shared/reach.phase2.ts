import type { Address } from "viem";
import { isAddress, keccak256, parseAbi, toHex } from "viem";
export const TEMPO_MODERATO_CHAIN_ID = 42431 as const;
export const TEMPO_MODERATO_RPC_URL = "https://rpc.moderato.tempo.xyz" as const;
export const PATH_USD_ADDRESS = "0x20c0000000000000000000000000000000000000" as const;
export const PATH_USD_DECIMALS = 6 as const;
export const DEFAULT_VAULT_ADDRESS = "0x98262c02746f3b91342249159deeebe87a54266c" as const;
export const vaultAbi = parseAbi([
  "function getPayout(uint256 payoutId) view returns (address sender, uint256 amount, uint64 expiresAt, address claimSigner, uint8 status, address claimant)",
  "function createPayout(uint256 payoutId, uint256 amount, address claimSigner, uint64 expiresAt)",
  "function claim(uint256 payoutId, address recipient, bytes claimAuthorizationSignature)",
  "function reclaim(uint256 payoutId)",
  "function totalFundedAmount() view returns (uint256)",
  "function hashClaimAuthorization(uint256 payoutId, address recipient) view returns (bytes32)",
]);
export const pathUsdAbi = parseAbi(["function balanceOf(address account) view returns (uint256)", "function approve(address spender, uint256 amount) returns (bool)", "function transfer(address to, uint256 amount) returns (bool)"]);
export const CLAIM_ACTION = keccak256(toHex("ReachPayoutVault.claim"));
export const CLAIM_AUTHORIZATION_VERSION = 1n;
export const claimTypes = { Claim: [{ name: "payoutId", type: "uint256" }, { name: "recipient", type: "address" }, { name: "action", type: "bytes32" }, { name: "version", type: "uint256" }] } as const;
export const payoutStatus = { NONE: 0, FUNDED: 1, CLAIMED: 2, RECLAIMED: 3 } as const;
export type PayoutStatus = (typeof payoutStatus)[keyof typeof payoutStatus];
export type PayoutRecord = { sender: Address; amount: bigint; expiresAt: bigint; claimSigner: Address; status: PayoutStatus; claimant: Address };
export function claimDomain(verifyingContract: Address) { return { name: "Reach Payout Vault", version: "1", chainId: TEMPO_MODERATO_CHAIN_ID, verifyingContract } as const; }
export class PayoutReadError extends Error {
  constructor(public readonly code: "DECODE_FAILURE" | "READ_UNAVAILABLE" | "NOT_FOUND") {
    super(code); this.name = "PayoutReadError";
  }
}
function uint(value: unknown, bits: number): bigint {
  if (typeof value !== "bigint" && !(typeof value === "number" && Number.isSafeInteger(value)) && !(typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value))) throw new PayoutReadError("DECODE_FAILURE");
  const parsed = BigInt(value as string | number | bigint);
  if (parsed < 0n || parsed >= (1n << BigInt(bits))) throw new PayoutReadError("DECODE_FAILURE");
  return parsed;
}
export function parsePayoutId(value: unknown): bigint {
  const id = uint(value, 256);
  if (id === 0n) throw new PayoutReadError("DECODE_FAILURE");
  return id;
}
/** Single runtime boundary for flat viem tuples, artifact structs and serialized
 * current-vault API objects. Shape validation does not grant discovery authority. */
export function payoutFromContractResult(result: unknown, payoutId?: unknown): PayoutRecord {
  if (payoutId !== undefined) parsePayoutId(payoutId);
  if (!result || typeof result !== "object") throw new PayoutReadError("DECODE_FAILURE");
  const names = ["sender", "amount", "expiresAt", "claimSigner", "status", "claimant"] as const;
  if (Array.isArray(result) && result.length !== names.length) throw new PayoutReadError("DECODE_FAILURE");
  const fields = Array.isArray(result) ? result : names.map(name => Object.hasOwn(result, name) ? (result as Record<string, unknown>)[name] : undefined);
  if (fields.some(value => value === undefined || value === null)) throw new PayoutReadError("DECODE_FAILURE");
  const [sender, amount, expiresAt, claimSigner, status, claimant] = fields;
  for (const address of [sender, claimSigner, claimant]) {
    if (typeof address !== "string" || !isAddress(address, { strict: false })) throw new PayoutReadError("DECODE_FAILURE");
  }
  const decodedStatus = uint(status, 8);
  if (decodedStatus > 3n) throw new PayoutReadError("DECODE_FAILURE");
  const objectId = (result as { id?: unknown }).id;
  if (objectId !== undefined && (parsePayoutId(objectId) !== (payoutId === undefined ? parsePayoutId(objectId) : parsePayoutId(payoutId)))) throw new PayoutReadError("DECODE_FAILURE");
  return { sender: sender as Address, amount: uint(amount, 256), expiresAt: uint(expiresAt, 64), claimSigner: claimSigner as Address, status: Number(decodedStatus) as PayoutStatus, claimant: claimant as Address };
}
export function serializePayout(payout: PayoutRecord) { return { sender: payout.sender, amount: payout.amount.toString(), expiresAt: payout.expiresAt.toString(), claimSigner: payout.claimSigner, status: payout.status, claimant: payout.claimant }; }
