import type { Address } from "viem";
import { keccak256, parseAbi, toHex } from "viem";
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
export function payoutFromContractResult(result: unknown): PayoutRecord { if (Array.isArray(result)) { const [sender, amount, expiresAt, claimSigner, status, claimant] = result; return { sender: sender as Address, amount: BigInt(amount as bigint), expiresAt: BigInt(expiresAt as bigint), claimSigner: claimSigner as Address, status: Number(status) as PayoutStatus, claimant: claimant as Address }; } const value = result as Record<string, unknown>; return { sender: value.sender as Address, amount: BigInt(value.amount as bigint), expiresAt: BigInt(value.expiresAt as bigint), claimSigner: value.claimSigner as Address, status: Number(value.status) as PayoutStatus, claimant: value.claimant as Address }; }
export function serializePayout(payout: PayoutRecord) { return { sender: payout.sender, amount: payout.amount.toString(), expiresAt: payout.expiresAt.toString(), claimSigner: payout.claimSigner, status: payout.status, claimant: payout.claimant }; }
