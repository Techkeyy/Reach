import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { encodeFunctionData, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { claimDomain, claimTypes, CLAIM_ACTION, vaultAbi, DEFAULT_VAULT_ADDRESS, compactPayoutId, expandCompactPayoutId, parseClaimPayoutId } from "../src/shared/reach";
import { parseClaimCall } from "../src/server/relayGuard";
import { claimSignerForCapability, readCapability } from "../src/client/claimCapability";
import { consumeClaimFragment } from "../src/client/claimFragment";
import { readProtectedShare } from "../src/client/protectedClaims";
import { claimedLinkView } from "../src/client/claimedLinkState";

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
  it("dispatches canonical protected fragments and recovers exactly 32 bytes", () => {
    const share = Buffer.from("2a".repeat(32), "hex");
    const fragment = `#p_${share.toString("base64url")}`;
    let cleared = false;
    const parsed = consumeClaimFragment(fragment, () => { cleared = true; }, readProtectedShare, readCapability);
    assert.equal(parsed.kind, "PROTECTED");
    if (parsed.kind !== "PROTECTED") throw new Error("protected fragment was not selected");
    assert.equal(parsed.value.length, 32);
    assert.deepEqual(Buffer.from(parsed.value), share);
    assert.equal(cleared, true);
  });
  it("dispatches canonical instant and legacy #cap= fragments", () => {
    const raw = Buffer.from(claimPrivateKey.slice(2), "hex").toString("base64url");
    const canonical = consumeClaimFragment(`#${raw}`, () => {}, readProtectedShare, readCapability);
    const legacy = consumeClaimFragment(`#cap=${raw}`, () => {}, readProtectedShare, readCapability);
    assert.equal(canonical.kind, "INSTANT");
    assert.equal(legacy.kind, "INSTANT");
    if (canonical.kind !== "INSTANT" || legacy.kind !== "INSTANT") throw new Error("instant fragment was not selected");
    assert.equal(canonical.value.raw, raw);
    assert.equal(legacy.value.raw, raw);
  });
  it("clears an invalid protected fragment before the protected parser throws", () => {
    const events: string[] = [];
    assert.throws(() => consumeClaimFragment("#p_invalid", () => { events.push("clear"); }, fragment => { events.push(`parse:${fragment.startsWith("p_")}`); return readProtectedShare(fragment); }, readCapability));
    assert.deepEqual(events, ["clear", "parse:true"]);
  });
  it("round-trips uint256 payout IDs through the compact URL representation", () => {
    const values = [0n, 1n, 123n, (1n << 256n) - 1n];
    for (const value of values) {
      const compact = compactPayoutId(value);
      assert.equal(compact.length, 43);
      assert.equal(expandCompactPayoutId(compact), value);
    }
  });
  it("accepts legacy decimal paths and rejects malformed compact IDs", () => {
    const compact = compactPayoutId(payoutId);
    assert.equal(parseClaimPayoutId(payoutId.toString()), payoutId);
    assert.equal(parseClaimPayoutId(compact), payoutId);
    assert.throws(() => parseClaimPayoutId("0"));
    assert.throws(() => parseClaimPayoutId(compact.slice(0, -1)));
    assert.throws(() => parseClaimPayoutId(`${compact}=`));
    assert.throws(() => parseClaimPayoutId(`${compact.slice(0, -1)}~`));
    const invalidPadding = `${compact.slice(0, -1)}B`;
    assert.throws(() => parseClaimPayoutId(invalidPadding));
  });
  it("only exposes the claimed-account view to the authenticated claimant", () => {
    const claimant = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    assert.equal(claimedLinkView(claimant, claimant.toUpperCase()), "CLAIMED");
    assert.equal(claimedLinkView(claimant), "ALREADY_CLAIMED");
    assert.equal(claimedLinkView(claimant, "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"), "ALREADY_CLAIMED");
  });
  it("accepts only one zero-value Moderato vault claim to the transaction sender", async () => { const parsed = parseClaimCall(request(await claimData()), DEFAULT_VAULT_ADDRESS); assert.equal(parsed.payoutId, payoutId); assert.equal(parsed.from, from); assert.equal(parsed.recipient, from); });
  it("rejects sponsor requests outside the narrow claim boundary", async () => { const data = await claimData(); assert.throws(() => parseClaimCall(request(data, { chainId: "0x1" }), DEFAULT_VAULT_ADDRESS), /wrong chain/); assert.throws(() => parseClaimCall(request(data, { calls: [{ to: from, data, value: "0x0" }] }), DEFAULT_VAULT_ADDRESS), /Reach vault/); assert.throws(() => parseClaimCall(request(data, { calls: [{ to: DEFAULT_VAULT_ADDRESS, data, value: "0x1" }] }), DEFAULT_VAULT_ADDRESS), /native value/); assert.throws(() => parseClaimCall(request(data, { calls: [{ to: DEFAULT_VAULT_ADDRESS, data }, { to: DEFAULT_VAULT_ADDRESS, data }] }), DEFAULT_VAULT_ADDRESS), /one claim/); assert.throws(() => parseClaimCall(request(data, { from: "0x9999999999999999999999999999999999999999" }), DEFAULT_VAULT_ADDRESS), /recipient/); });
});
