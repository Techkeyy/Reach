import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeFunctionData, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { claimDomain, claimTypes, CLAIM_ACTION, vaultAbi, DEFAULT_VAULT_ADDRESS } from "../src/shared/reach";
import { parseClaimCall } from "../src/server/relayGuard";
import { claimSignerForCapability, readCapability } from "../src/client/claimCapability";

const from = "0x1234567890123456789012345678901234567890" as Address;
const payoutId = 123n;
const claimPrivateKey = `0x${"2a".repeat(32)}` as Hex;
const signer = privateKeyToAccount(claimPrivateKey);

async function claimData(recipient = from) {
  const signature = await signer.signTypedData({ domain: claimDomain(DEFAULT_VAULT_ADDRESS), types: claimTypes, primaryType: "Claim", message: { payoutId, recipient, action: CLAIM_ACTION, version: 1n } });
  return encodeFunctionData({ abi: vaultAbi, functionName: "claim", args: [payoutId, recipient, signature] });
}
function request(data: Hex, overrides: Record<string, unknown> = {}) { return { method: "eth_fillTransaction", params: [{ chainId: "0xa5bf", from, calls: [{ to: DEFAULT_VAULT_ADDRESS, data, value: "0x0" }], ...overrides }] }; }

describe("Phase 2 claim capability", () => {
  it("accepts a 32-byte fragment and derives the same local claim signer", () => { const raw = Buffer.from(claimPrivateKey.slice(2), "hex").toString("base64url"); const decoded = readCapability(`#${raw}`); assert.equal(decoded.raw, raw); assert.equal(claimSignerForCapability(decoded.privateKey), signer.address); });
  it("rejects missing, malformed, padded, and overlong fragments", () => { for (const value of ["", "#", "#not-base64", `#${"a".repeat(42)}`, `#${"a".repeat(44)}`, `#${"a".repeat(43)}=`]) assert.throws(() => readCapability(value)); });
  it("accepts only one zero-value Moderato vault claim to the transaction sender", async () => { const parsed = parseClaimCall(request(await claimData()), DEFAULT_VAULT_ADDRESS); assert.equal(parsed.payoutId, payoutId); assert.equal(parsed.from, from); assert.equal(parsed.recipient, from); });
  it("rejects sponsor requests outside the narrow claim boundary", async () => { const data = await claimData(); assert.throws(() => parseClaimCall(request(data, { chainId: "0x1" }), DEFAULT_VAULT_ADDRESS), /wrong chain/); assert.throws(() => parseClaimCall(request(data, { calls: [{ to: from, data, value: "0x0" }] }), DEFAULT_VAULT_ADDRESS), /Reach vault/); assert.throws(() => parseClaimCall(request(data, { calls: [{ to: DEFAULT_VAULT_ADDRESS, data, value: "0x1" }] }), DEFAULT_VAULT_ADDRESS), /native value/); assert.throws(() => parseClaimCall(request(data, { calls: [{ to: DEFAULT_VAULT_ADDRESS, data }, { to: DEFAULT_VAULT_ADDRESS, data }] }), DEFAULT_VAULT_ADDRESS), /one claim/); assert.throws(() => parseClaimCall(request(data, { from: "0x9999999999999999999999999999999999999999" }), DEFAULT_VAULT_ADDRESS), /recipient/); });
});
