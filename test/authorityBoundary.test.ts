import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { decodeFunctionResult, encodeFunctionResult } from "viem";
import { payoutFromContractResult, serializePayout, vaultAbi, DEFAULT_VAULT_ADDRESS, PayoutReadError } from "../src/shared/reach";
import { readCurrentPayoutApi, readPublicPayout } from "../src/client/readPublicPayout";
import { resolvePayoutLifecycle } from "../src/client/payoutLifecycle";
import { submitClaimAndReconcile } from "../src/client/claimAuthority";
import { readBatchAuthority, persistVerifiedBatchMembers } from "../src/client/batchAuthority";
import { submitAndReconcile } from "../src/client/submitAndReconcile";
import { createClaimCapability, rememberCapability, recoverCapability } from "../src/client/claimCapability";
import { rememberSenderPayout, readSenderPayouts } from "../src/client/senderStorage";
import PayoutDetail from "../src/client/PayoutDetail";
import { canonicalPayout } from "./fixtures/canonicalPayout";
import { readChainTimestamp } from "../src/client/chainTime";

const { sender, claimSigner, claimant } = canonicalPayout;
const fields = ["sender", "amount", "expiresAt", "claimSigner", "status", "claimant"];
function tuple(status = 1) {
  const wire = encodeFunctionResult({ abi: vaultAbi, functionName: "getPayout", result: [sender as `0x${string}`, 100000n, 1000n, claimSigner as `0x${string}`, status, claimant as `0x${string}`] });
  return decodeFunctionResult({ abi: vaultAbi, functionName: "getPayout", data: wire });
}
const artifact = JSON.parse(readFileSync(new URL("../artifacts/contracts/ReachPayoutVault.sol/ReachPayoutVault.json", import.meta.url), "utf8"));
test("real zero/NONE tuple is valid, but missing or malformed chain time never authorizes FUNDED", async () => {
  const zero = "0x0000000000000000000000000000000000000000";
  const none = serializePayout(payoutFromContractResult([zero, 0n, 0n, zero, 0, zero]));
  assert.equal(resolvePayoutLifecycle({ authoritativePayout: none }).financialState, "NONE");
  for (const value of [null, undefined, -1n, 1n << 64n, "", " ", "1.5", NaN, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(readChainTimestamp({ getBlock: async () => ({ timestamp: value as any }) }));
    const state = resolvePayoutLifecycle({ authoritativePayout: canonicalPayout, chainTimestamp: value as any, capabilityPresent: true, connectedAccount: sender });
    assert.equal(state.displayState, "CHECKING");
    assert.equal(state.isClaimable || state.isReclaimable, false);
  }
});
for (const status of [0, 1, 2, 3] as const) test(`runtime decoder: tuple, artifact struct, and serialized representation agree for enum ${status}`, () => {
  const raw = tuple(status);
  assert.ok(Array.isArray(raw));
  const named = Object.fromEntries(fields.map((key, index) => [key, raw[index]]));
  const wire = encodeFunctionResult({ abi: artifact.abi, functionName: "getPayout", result: named });
  const struct = decodeFunctionResult({ abi: artifact.abi, functionName: "getPayout", data: wire });
  assert.equal(Array.isArray(struct), false);
  const actual = payoutFromContractResult(raw, "42");
  assert.deepEqual(payoutFromContractResult(struct, "42"), actual);
  assert.deepEqual(payoutFromContractResult({ id: "42", ...serializePayout(actual) }, "42"), actual);
  const lifecycle = resolvePayoutLifecycle({ authoritativePayout: serializePayout(actual) });
  assert.equal(lifecycle.displayState, ["NONE", "CHECKING", "CLAIMED", "RECLAIMED"][status]);
});

const malformed: unknown[] = [null, undefined, {}, [], [...tuple(), 7], tuple().slice(0, 5), { ...canonicalPayout, status: 4 }, { ...canonicalPayout, status: -1 }, { ...canonicalPayout, status: true }, { ...canonicalPayout, id: "43" }];
for (const field of fields) {
  const missing = { ...canonicalPayout } as Record<string, unknown>; delete missing[field];
  malformed.push(missing, { ...canonicalPayout, [field]: null }, { ...canonicalPayout, [field]: undefined });
}
for (const field of ["sender", "claimSigner", "claimant"]) malformed.push({ ...canonicalPayout, [field]: "0x123" }, { ...canonicalPayout, [field]: 0 });
for (const field of ["amount", "expiresAt", "status"]) for (const value of ["", " ", "1.1", "1e2", "-1", "0x1", -1n, 0.1, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, false]) malformed.push({ ...canonicalPayout, [field]: value });
malformed.push({ ...canonicalPayout, amount: 1n << 256n }, { ...canonicalPayout, expiresAt: 1n << 64n });
test("all malformed representations reject with a sanitized typed error and cannot authorize actions", () => {
  for (const value of malformed) {
    assert.throws(() => payoutFromContractResult(value, "42"), error => error instanceof PayoutReadError && error.code === "DECODE_FAILURE" && error.message === "DECODE_FAILURE");
    // A malformed or mismatched id must never reach the normalized resolver.
    if (value && typeof value === "object" && !Array.isArray(value) && !("id" in value)) {
      const lifecycle = resolvePayoutLifecycle({ authoritativePayout: value as any, chainTimestamp: 1000n, connectedAccount: sender, capabilityPresent: true });
      assert.equal(lifecycle.financialState, "UNKNOWN");
      assert.equal(lifecycle.isClaimable || lifecycle.isReclaimable || lifecycle.canRevealClaimLink, false);
    }
  }
});

test("RPC and current API reads share the strict decoder and keep failures distinct from NONE", async () => {
  const canonical = await readPublicPayout({ readContract: async () => tuple() }, DEFAULT_VAULT_ADDRESS, "42");
  let request: { url: unknown; options: unknown } | undefined;
  const api = await readCurrentPayoutApi("42", (async (url, options) => { request = { url, options }; return Response.json(canonical); }) as typeof fetch);
  assert.deepEqual(api, canonical);
  assert.equal(request?.url, "/api/payout/42");
  assert.equal((request?.options as RequestInit).cache, "no-store");
  for (const body of [{ ...canonical, amount: null }, { ...canonical, id: "43" }]) await assert.rejects(readCurrentPayoutApi("42", (async () => Response.json(body)) as typeof fetch), { code: "DECODE_FAILURE" });
  await assert.rejects(readPublicPayout({ readContract: async () => { throw Error("private RPC details"); } }, DEFAULT_VAULT_ADDRESS, "42"), { code: "READ_UNAVAILABLE", message: "READ_UNAVAILABLE" });
  for (const id of ["0", "-1", "1.2", (1n << 256n).toString()]) await assert.rejects(readPublicPayout({ readContract: async () => { throw Error("must not read"); } }, DEFAULT_VAULT_ADDRESS, id), { code: "DECODE_FAILURE" });
});

test("checking authority and missing capability coexist; terminal link controls are not applicable", () => {
  const record = { id: "42", amount: "100000", expiresAt: "1000", claimSigner, createdAt: "2026-09-30T00:00:00Z", submissionState: "CONFIRMED" as const };
  const state = resolvePayoutLifecycle({ operationJournal: record, capabilityPresent: false });
  assert.equal(state.displayState, "CHECKING"); assert.equal(state.capabilityState, "MISSING");
  const html = renderToStaticMarkup(React.createElement(PayoutDetail, { record, onBack: () => {}, onReturnFunds: async () => {}, returningFunds: false }));
  assert.match(html, /Checking payout status/); assert.doesNotMatch(html, /Copy claim link/);
  assert.doesNotMatch(html, /Funded by sender|Waiting for recipient|Active until|Return funds to wallet/);
  for (const status of [2, 3] as const) {
    const terminal = resolvePayoutLifecycle({ authoritativePayout: { ...canonicalPayout, status }, capabilityPresent: true });
    assert.equal(terminal.capabilityState, "NOT_APPLICABLE"); assert.equal(terminal.canRevealClaimLink, false);
  }
});

test("claim-link reveal requires the connected sender and an unexpired funded payout", () => {
  assert.equal(resolvePayoutLifecycle({ authoritativePayout: canonicalPayout, chainTimestamp: 999n, connectedAccount: sender, capabilityPresent: true }).canRevealClaimLink, true);
  assert.equal(resolvePayoutLifecycle({ authoritativePayout: canonicalPayout, chainTimestamp: 999n, connectedAccount: "0x3333333333333333333333333333333333333333", capabilityPresent: true }).canRevealClaimLink, false);
  assert.equal(resolvePayoutLifecycle({ authoritativePayout: canonicalPayout, chainTimestamp: 1000n, connectedAccount: sender, capabilityPresent: true }).canRevealClaimLink, false);
});

test("PayoutDetail labels funding, claim, and reclaim transactions independently", () => {
  const fundingTxHash = "0x1111111111111111111111111111111111111111111111111111111111111111";
  const claimTxHash = "0x2222222222222222222222222222222222222222222222222222222222222222";
  const reclaimTxHash = "0x3333333333333333333333333333333333333333333333333333333333333333";
  const baseRecord = { id: "42", amount: "100000", expiresAt: "1000", claimSigner, createdAt: "2026-09-30T00:00:00Z", fundingTxHash };

  const claimedHtml = renderToStaticMarkup(React.createElement(PayoutDetail, {
    record: { ...baseRecord, claimTxHash },
    onBack: () => {},
    onReturnFunds: async () => {},
    returningFunds: false,
  }));
  assert.match(claimedHtml, /Funding transaction/);
  assert.match(claimedHtml, new RegExp(`moderato\\.tempo\\.xyz/tx/${fundingTxHash}`));
  assert.match(claimedHtml, /Claim transaction/);
  assert.match(claimedHtml, new RegExp(`moderato\\.tempo\\.xyz/tx/${claimTxHash}`));
  assert.doesNotMatch(claimedHtml, /Reclaim transaction/);

  const reclaimedHtml = renderToStaticMarkup(React.createElement(PayoutDetail, {
    record: { ...baseRecord, reclaimTxHash },
    onBack: () => {},
    onReturnFunds: async () => {},
    returningFunds: false,
  }));
  assert.match(reclaimedHtml, /Funding transaction/);
  assert.match(reclaimedHtml, new RegExp(`moderato\\.tempo\\.xyz/tx/${fundingTxHash}`));
  assert.match(reclaimedHtml, /Reclaim transaction/);
  assert.match(reclaimedHtml, new RegExp(`moderato\\.tempo\\.xyz/tx/${reclaimTxHash}`));
  assert.doesNotMatch(reclaimedHtml, /Claim transaction/);
});

test("batch cannot confirm a mismatched member or missing chain time", async () => {
  const expected = [{ ...canonicalPayout, id: "42" }];
  for (const [read, time] of [[async () => ({ ...canonicalPayout, amount: "1" }), 999n], [async () => tuple(), undefined]] as const) {
    const [result] = await readBatchAuthority(expected, read, time);
    assert.equal(result.funded, false);
  }
});

for (const outcome of ["claimed", "funded", "unavailable", "malformed"] as const) test(`claim response loss: ${outcome} authority, bounded recovery, one submission`, async () => {
  let sends = 0; let reads = 0; const states: string[] = [];
  const result = await submitClaimAndReconcile({
    operation: { operationId: "claim:42", payoutIds: ["42"], state: "PREPARED" },
    submit: async () => { sends++; throw Error("relay response lost"); },
    readAuthoritativeState: async () => { reads++; if (outcome === "unavailable") throw Error("offline"); return outcome === "malformed" ? { status: 2 } : tuple(outcome === "claimed" ? 2 : 1); },
    onState: state => states.push(state), reconcileAttempts: 2, reconcileDelayMs: 0,
  });
  assert.equal(sends, 1);
  assert.equal(result.outcome, outcome === "claimed" ? "CONFIRMED" : "SUBMISSION_UNCERTAIN");
  assert.equal(reads, outcome === "claimed" ? 1 : 2);
  assert.equal(states.includes("FAILED") || states.includes("FAILED_BEFORE_SUBMISSION"), false);
  assert.equal(states.at(-1), result.outcome);
});

for (const complete of [false, true]) test(`batch response loss independently reconciles members; all available=${complete}`, async () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { sessionStorage: storage } });
  try {
    const records = ["42", "43"].map(id => ({ id, amount: canonicalPayout.amount, expiresAt: canonicalPayout.expiresAt, claimSigner, createdAt: "2026-09-30T00:00:00Z", submissionState: "SUBMITTING" as const }));
    const capabilities = records.map((record, index) => { const value = createClaimCapability(bytes => bytes.fill(index + 1)); rememberCapability(record.id, value.raw); rememberSenderPayout(record); return value.raw; });
    let sends = 0; const confirmed = new Set<string>(); const readIds: string[] = [];
    const result = await submitAndReconcile({
      operation: { operationId: "batch:42,43", payoutIds: ["42", "43"], state: "PREPARED" },
      submit: async () => { sends++; throw Error("provider response lost"); },
      readAuthoritativeState: async () => {
        const authority = await readBatchAuthority(records.map(record => ({ ...record, sender })), async id => { readIds.push(id); if (id === "43" && !complete) throw Error("one RPC failed"); return tuple(); }, 999n);
        persistVerifiedBatchMembers(authority, records, confirmed); return authority;
      },
      successPredicate: members => members.every(member => member.funded), reconcileAttempts: 2, reconcileDelayMs: 0,
    });
    assert.equal(sends, 1); assert.equal(result.outcome, complete ? "CONFIRMED" : "SUBMISSION_UNCERTAIN");
    assert.ok(readIds.includes("42") && readIds.includes("43"));
    assert.equal(readSenderPayouts().find(record => record.id === "42")?.submissionState, "CONFIRMED");
    assert.equal(confirmed.has("43"), complete);
    records.forEach((record, index) => assert.equal(recoverCapability(record.id)?.raw, capabilities[index]));
    assert.equal(result.authoritative?.find(member => member.id === "43")?.lifecycle.displayState, complete ? "FUNDED" : "RECOVERING");
  } finally { delete (globalThis as any).sessionStorage; delete (globalThis as any).window; }
});
