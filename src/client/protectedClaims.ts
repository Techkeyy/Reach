import { bytesToHex, hexToBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const PROTECTED_FRAGMENT_PREFIX = "p_";
export const PROTECTED_SHARE_BYTES = 32;

function encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error("invalid protected claim link");
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=");
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  if (bytes.length !== PROTECTED_SHARE_BYTES) throw new Error("invalid protected claim link");
  return bytes;
}

function randomBytes(): Uint8Array {
  const bytes = new Uint8Array(PROTECTED_SHARE_BYTES);
  crypto.getRandomValues(bytes);
  return bytes;
}

function xor(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.length !== right.length || left.length !== PROTECTED_SHARE_BYTES) throw new Error("invalid protected share");
  return Uint8Array.from(left, (value, index) => value ^ right[index]!);
}

export type ProtectedShares = {
  shareA: Uint8Array;
  shareB: Hex;
  shareAFragment: string;
  shareAProofAddress: `0x${string}`;
};

export function createProtectedShares(privateKey: Hex): ProtectedShares {
  const key = hexToBytes(privateKey);
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const shareA = randomBytes();
    try {
      const shareAProofAddress = privateKeyToAccount(bytesToHex(shareA)).address;
      const shareB = xor(key, shareA);
      return {
        shareA,
        shareB: bytesToHex(shareB),
        shareAFragment: `${PROTECTED_FRAGMENT_PREFIX}${encode(shareA)}`,
        shareAProofAddress,
      };
    } catch {
      // An invalid secp256k1 scalar is astronomically unlikely; retry safely.
    }
  }
  throw new Error("could not create protected claim shares");
}

export function readProtectedShare(fragment: string): Uint8Array {
  const value = fragment.startsWith(PROTECTED_FRAGMENT_PREFIX) ? fragment.slice(PROTECTED_FRAGMENT_PREFIX.length) : fragment;
  return decode(value);
}

export async function signProtectedChallenge(shareA: Uint8Array, challenge: string): Promise<Hex> {
  return privateKeyToAccount(bytesToHex(shareA)).signMessage({ message: challenge });
}

export function reconstructProtectedPrivateKey(shareA: Uint8Array, shareB: Hex): Hex {
  return bytesToHex(xor(shareA, hexToBytes(shareB)));
}

export function maskProtectedRecipient(channel: "EMAIL" | "SMS", value: string): string {
  const normalized = value.trim();
  if (channel === "EMAIL") {
    const [local, domain] = normalized.toLowerCase().split("@");
    if (!local || !domain) return "your email address";
    return `${local.slice(0, 1)}${"•".repeat(Math.min(3, Math.max(2, local.length - 1)))}@${domain}`;
  }
  return `${normalized.slice(0, 3)}${"•".repeat(Math.max(4, normalized.length - 7))}${normalized.slice(-4)}`;
}

export function clearProtectedBytes(...values: Uint8Array[]): void {
  for (const value of values) value.fill(0);
}
