import { bytesToHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const CLAIM_CAPABILITY_BYTES = 32;
const PREFIX = "reach.claim.";
function decode(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length !== 43) throw new Error("invalid claim link");
  const raw = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=");
  const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0));
  if (bytes.length !== CLAIM_CAPABILITY_BYTES) throw new Error("invalid claim link");
  return bytes;
}
export function readCapability(hash: string): { raw: string; privateKey: Hex } { const raw = hash.startsWith("#") ? hash.slice(1) : hash; if (!raw || raw.includes("#") || raw.includes("?") || raw.includes("/")) throw new Error("invalid claim link"); return { raw, privateKey: bytesToHex(decode(raw)) }; }
export function claimSignerForCapability(privateKey: Hex) { return privateKeyToAccount(privateKey).address; }
export function rememberCapability(id: string, raw: string) { sessionStorage.setItem(`${PREFIX}${id}`, raw); }
export function recoverCapability(id: string) { const raw = sessionStorage.getItem(`${PREFIX}${id}`); return raw ? readCapability(raw) : null; }
export function clearCapability(id: string) { sessionStorage.removeItem(`${PREFIX}${id}`); sessionStorage.removeItem(`${PREFIX}${id}.pending`); }
export function rememberPending(id: string, value: { recipient: string; txHash?: string }) { sessionStorage.setItem(`${PREFIX}${id}.pending`, JSON.stringify(value)); }
export function recoverPending(id: string): { recipient: string; txHash?: string } | null { const raw = sessionStorage.getItem(`${PREFIX}${id}.pending`); if (!raw) return null; try { const value = JSON.parse(raw) as { recipient?: unknown; txHash?: unknown }; return typeof value.recipient === "string" ? { recipient: value.recipient, ...(typeof value.txHash === "string" ? { txHash: value.txHash } : {}) } : null; } catch { return null; } }
