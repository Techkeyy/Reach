import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { encodeFunctionResult, decodeFunctionResult } from "viem";
import { vaultAbi, DEFAULT_VAULT_ADDRESS } from "../src/shared/reach";
import { resolvePayoutLifecycle } from "../src/client/payoutLifecycle";
import { createChainClock } from "../src/client/chainTime";
import { readPublicPayout } from "../src/client/readPublicPayout";
import HomeDashboard from "../src/client/HomeDashboard";
import ActivityFeed from "../src/client/ActivityFeed";
import PayoutDetail from "../src/client/PayoutDetail";
import type { SenderPayoutRecord } from "../src/client/senderStorage";

const sender = "0x6B6e9e45Cf4bB5CbC7d4a8B19cf3d886369Ff925";
const zero = "0x0000000000000000000000000000000000000000";
const signer = "0x7Ad068B42c3652A73EB2cB82ffCd5A8DF30bAa57";
const record: SenderPayoutRecord = { id: "32623884757742957646259674214505491779688334013179864495367932908249507365629", amount: "10000", expiresAt: "1790720335", claimSigner: signer, createdAt: "2026-09-29T21:19:07.000Z", submissionState: "CONFIRMED" };
const payout = { ...record, sender, status: 1 as const, claimant: zero };
const expiry = BigInt(record.expiresAt);
const noop = () => {};

test("real multi-output ABI tuple reaches the lifecycle instead of throwing on result.amount", async () => {
  const wire = encodeFunctionResult({ abi: vaultAbi, functionName: "getPayout", result: [sender, 10000n, expiry, signer, 1, zero] });
  const tuple = decodeFunctionResult({ abi: vaultAbi, functionName: "getPayout", data: wire });
  assert.equal(Array.isArray(tuple), true);
  const actual = await readPublicPayout({ readContract: async () => tuple }, DEFAULT_VAULT_ADDRESS, record.id);
  assert.deepEqual(actual, { sender, amount: "10000", expiresAt: record.expiresAt, claimSigner: signer, status: 1, claimant: zero });
  assert.equal(resolvePayoutLifecycle({ authoritativePayout: actual, chainTimestamp: expiry, connectedAccount: sender }).displayState, "EXPIRED_FUNDED");
});

for (const [name, time, expected] of [
  ["A before", expiry - 1n, "FUNDED"], ["B equal", expiry, "EXPIRED_FUNDED"],
  ["C after", expiry + 1n, "EXPIRED_FUNDED"], ["D missing", undefined, "CHECKING"],
] as const) test(name, () => {
  const value = resolvePayoutLifecycle({ authoritativePayout: payout, chainTimestamp: time, connectedAccount: sender, capabilityPresent: true });
  assert.equal(value.displayState, expected);
  if (time === undefined) {
    assert.equal(value.financialState, "UNKNOWN");
    assert.equal(value.isReclaimable, false);
    assert.equal(value.isClaimable, false);
    assert.equal(value.canRevealClaimLink, false);
  }
});

function surfaces(timestamp?: bigint, available = true) {
  const live = available ? { ...payout, expiresAt: expiry, chainTimestamp: timestamp } : undefined;
  const payoutStatuses = live ? { [record.id]: live } : {};
  return [
    React.createElement(HomeDashboard, { balanceState: { status: "UNAVAILABLE", error: "fixture" } as any, payouts: [record], payoutStatuses, onStartSend: noop, onAddTestFunds: noop, onSelectPayout: noop, onViewAllActivity: noop, onRefreshBalance: noop, refreshing: false }),
    React.createElement(ActivityFeed, { payouts: [record], payoutStatuses, onSelectPayout: noop, onStartSend: noop, onRefresh: noop, refreshing: false }),
    React.createElement(PayoutDetail, { record, live, connectedAddress: sender, onBack: noop, onReturnFunds: async () => {}, returningFunds: false }),
  ].map(component => renderToStaticMarkup(component));
}

test("E clock rejection and timeout fail closed on all real surfaces", async () => {
  for (const getBlock of [async () => { throw Error("RPC unavailable"); }, () => new Promise<{ timestamp: bigint }>(() => {})]) {
    const clock = createChainClock({ getBlock }, 5);
    await clock.refresh();
    assert.equal(clock.getSnapshot(), undefined);
    for (const html of surfaces(clock.getSnapshot())) {
      assert.match(html, /Checking payout expiry/);
      assert.doesNotMatch(html, /Waiting for recipient|Active until|Return funds to wallet/);
    }
  }
});

test("F Home, Activity, Detail agree before, at, and after expiry", () => {
  for (const time of [expiry - 1n, expiry, expiry + 1n]) {
    for (const html of surfaces(time)) {
      assert.match(html, time < expiry ? /Funded · Waiting for recipient/ : /Expired · Ready to return/);
    }
  }
  for (const html of surfaces(undefined, false)) {
    assert.match(html, /Checking(?: payout)? status/);
    assert.doesNotMatch(html, /Waiting for recipient|Active until|Return funds to wallet/);
  }
});

test("G shared refresh deduplicates reads, rejects backward clock movement, and recovers after failure", async () => {
  let next = expiry;
  let fail = false;
  let reads = 0;
  const clock = createChainClock({ getBlock: async () => { reads++; if (fail) throw Error("offline"); return { timestamp: next }; } });
  await Promise.all([clock.refresh(), clock.refresh(), clock.refresh()]);
  assert.equal(reads, 1);
  next = expiry - 100n;
  await clock.refresh();
  assert.equal(clock.getSnapshot(), expiry);
  for (const html of surfaces(clock.getSnapshot())) assert.match(html, /Expired · Ready to return/);
  fail = true;
  await clock.refresh();
  for (const html of surfaces(clock.getSnapshot())) assert.doesNotMatch(html, /Waiting for recipient/);
  fail = false;
  await clock.refresh();
  for (const html of surfaces(clock.getSnapshot())) assert.match(html, /Expired · Ready to return/);
});

test("terminal vault states override stale local failures even without chain time", () => {
  for (const status of [2, 3] as const) {
    assert.equal(resolvePayoutLifecycle({ authoritativePayout: { ...payout, status }, operationJournal: { outcome: "FAILED" } }).displayState, status === 2 ? "CLAIMED" : "RECLAIMED");
  }
});
