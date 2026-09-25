import { decodeFunctionData, isAddress, toFunctionSelector, type Address, type Hex } from "viem";
import { vaultAbi, TEMPO_MODERATO_CHAIN_ID } from "../shared/reach.js";

const CLAIM_SELECTOR = toFunctionSelector("claim(uint256,address,bytes)");
type RequestRecord = Record<string, unknown>;
function record(value: unknown): RequestRecord { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid relay request"); return value as RequestRecord; }
function zeroValue(value: unknown) { if (value === undefined || value === null || value === "0x" || value === "0x0" || value === 0 || value === 0n) return true; try { return BigInt(value as string | number | bigint) === 0n; } catch { return false; } }
function chainId(value: unknown) { try { return Number(BigInt(value as string | number | bigint)); } catch { return NaN; } }
export type ParsedClaimCall = { chainId: typeof TEMPO_MODERATO_CHAIN_ID; from: Address; payoutId: bigint; recipient: Address; claimAuthorizationSignature: Hex; data: Hex };
export function parseClaimCall(request: unknown, vaultAddress: Address): ParsedClaimCall {
  const root = record(request); if (root.method !== "eth_fillTransaction") throw new Error("only transaction fills are sponsored"); const params = Array.isArray(root.params) ? root.params : []; const tx = record(params[0]);
  if (chainId(tx.chainId) !== TEMPO_MODERATO_CHAIN_ID) throw new Error("wrong chain"); if (typeof tx.from !== "string" || !isAddress(tx.from)) throw new Error("missing sender"); if (!zeroValue(tx.value)) throw new Error("native value is not sponsored"); if (tx.authorizationList) throw new Error("authorization lists are not sponsored");
  const calls = tx.calls; if (!Array.isArray(calls) || calls.length !== 1) throw new Error("only one claim call is sponsored"); const call = record(calls[0]);
  if (typeof call.to !== "string" || !isAddress(call.to) || call.to.toLowerCase() !== vaultAddress.toLowerCase()) throw new Error("only the Reach vault is sponsored"); if (!zeroValue(call.value)) throw new Error("claim call cannot send native value"); if (typeof call.data !== "string" || !call.data.startsWith("0x") || call.data.slice(0, 10).toLowerCase() !== CLAIM_SELECTOR.toLowerCase()) throw new Error("only the Reach claim selector is sponsored"); if (typeof tx.data === "string" && tx.data !== "0x") throw new Error("top-level data is not sponsored");
  const decoded = decodeFunctionData({ abi: vaultAbi, data: call.data as Hex }); if (decoded.functionName !== "claim") throw new Error("only the Reach claim selector is sponsored"); const [payoutId, recipient, claimAuthorizationSignature] = decoded.args as readonly [bigint, Address, Hex];
  if (!isAddress(recipient) || recipient.toLowerCase() !== tx.from.toLowerCase()) throw new Error("claim recipient must be the transaction sender"); if (!claimAuthorizationSignature || claimAuthorizationSignature === "0x") throw new Error("missing claim authorization");
  return { chainId: TEMPO_MODERATO_CHAIN_ID, from: tx.from as Address, payoutId, recipient, claimAuthorizationSignature, data: call.data as Hex };
}
