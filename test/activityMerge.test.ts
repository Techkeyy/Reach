import assert from "node:assert/strict";
import { test } from "node:test";
import { activityFromSenderRecord, activityLabel, livePayoutFromActivity, mergeActivityDiscovery } from "../src/client/activity";
import { resolvePayoutLifecycle } from "../src/client/payoutLifecycle";
import type { SenderPayoutRecord } from "../src/client/senderStorage";

const record: SenderPayoutRecord = {
  id: "42", amount: "100000000", expiresAt: "2000000000",
  claimSigner: "0x3333333333333333333333333333333333333333",
  createdAt: "2026-10-08T00:00:00.000Z", submissionState: "CONFIRMED",
};
const address = "0x1111111111111111111111111111111111111111";

test("empty partial Activity preserves local discovery with no financial authority", () => {
  const rows = mergeActivityDiscovery([record], { address, activities: [], authorityIncomplete: true });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payoutId, record.id);
  assert.equal(rows[0].amount, record.amount);
  assert.equal(rows[0].lifecycle, "CHECKING");
  assert.equal(rows[0].authorityUnavailable, true);
  assert.equal(activityLabel(rows[0]), "Checking payout status");
  assert.equal(livePayoutFromActivity(rows[0]), undefined);
  const lifecycle = resolvePayoutLifecycle({ authoritativePayout: livePayoutFromActivity(rows[0]), operationJournal: record, authorityUnavailable: true });
  assert.equal(lifecycle.displayState, "CHECKING");
  assert.equal(lifecycle.financialState, "UNKNOWN");
  assert.equal(lifecycle.isClaimable, false);
  assert.equal(lifecycle.isReclaimable, false);
});

test("explicit complete authoritative absence reconciles displayed discovery only", () => {
  assert.deepEqual(mergeActivityDiscovery([record], { address, activities: [], authorityComplete: true, authorityIncomplete: false }), []);
  assert.equal(record.submissionState, "CONFIRMED");
});

test("missing or contradictory completeness cannot establish absence", () => {
  for (const response of [undefined, { address, activities: [], authorityIncomplete: false }, { address, activities: [], authorityComplete: true, authorityIncomplete: true }]) {
    assert.equal(mergeActivityDiscovery([record], response)[0].lifecycle, "CHECKING");
  }
});

test("partial discovery overlays resolved rows and retains missing IDs once", () => {
  const resolved = { ...activityFromSenderRecord(record), sender: address, lifecycle: "CLAIMED" as const };
  const missing = { ...record, id: "43", outcome: "FAILED" as const };
  const rows = mergeActivityDiscovery([record, missing], { address, activities: [resolved, resolved], authorityIncomplete: true });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].lifecycle, "CLAIMED");
  assert.equal(livePayoutFromActivity(rows[0])?.status, 2);
  assert.equal(rows[1].lifecycle, "CHECKING");
  assert.equal(livePayoutFromActivity(rows[1]), undefined);
});

test("unavailable server authority cannot advertise lifecycle certainty", () => {
  const rows = mergeActivityDiscovery([record], { address, activities: [{ ...activityFromSenderRecord(record), lifecycle: "FUNDED", authorityUnavailable: true }], authorityIncomplete: true });
  assert.equal(rows[0].lifecycle, "CHECKING");
  assert.equal(livePayoutFromActivity(rows[0]), undefined);
});
