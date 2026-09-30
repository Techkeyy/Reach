import assert from "node:assert/strict";
import { test } from "node:test";
import { resolvePayoutLifecycle } from "../src/client/payoutLifecycle";
import { submitAndReconcile } from "../src/client/submitAndReconcile";
import { OPERATION_JOURNAL_KEY, upsertOperation } from "../src/client/operationJournal";

const sender = "0x1111111111111111111111111111111111111111";
const recipient = "0x2222222222222222222222222222222222222222";
const base = { id: "42", sender, amount: "1000000", expiresAt: "2000", claimSigner: "0x3333333333333333333333333333333333333333", claimant: "0x0000000000000000000000000000000000000000" };

test("canonical resolver gives terminal vault states precedence over local uncertainty", () => {
  const claimed = resolvePayoutLifecycle({ authoritativePayout: { ...base, status: 2, claimant: recipient }, chainTimestamp: 3000n, operationJournal: { state: "SUBMISSION_UNCERTAIN" }, connectedAccount: sender, capabilityPresent: true });
  assert.equal(claimed.financialState, "CLAIMED");
  assert.equal(claimed.requiresRecovery, false);
  assert.deepEqual(claimed.allowedActions, []);

  const reclaimed = resolvePayoutLifecycle({ authoritativePayout: { ...base, status: 3 }, chainTimestamp: 3000n, operationJournal: { state: "SUBMISSION_UNCERTAIN" }, connectedAccount: sender, capabilityPresent: true });
  assert.equal(reclaimed.financialState, "RECLAIMED");
  assert.equal(reclaimed.canRevealClaimLink, false);
});
test("canonical resolver uses chain time, never browser time, for expiry and reclaim", () => {
  const before = resolvePayoutLifecycle({ authoritativePayout: { ...base, status: 1 }, chainTimestamp: 1999n, connectedAccount: sender, capabilityPresent: true });
  assert.equal(before.financialState, "FUNDED");
  assert.equal(before.isReclaimable, false);
  assert.equal(before.isClaimable, true);

  const after = resolvePayoutLifecycle({ authoritativePayout: { ...base, status: 1 }, chainTimestamp: 2000n, connectedAccount: sender, capabilityPresent: false });
  assert.equal(after.financialState, "EXPIRED_FUNDED");
  assert.equal(after.isReclaimable, true);
  assert.equal(after.canRevealClaimLink, false);
});

test("capability controls only private link actions", () => {
  const without = resolvePayoutLifecycle({ authoritativePayout: { ...base, status: 1 }, chainTimestamp: 1500n, connectedAccount: sender, capabilityPresent: false });
  const withCapability = resolvePayoutLifecycle({ authoritativePayout: { ...base, status: 1 }, chainTimestamp: 1500n, connectedAccount: sender, capabilityPresent: true });
  assert.equal(without.financialState, "FUNDED");
  assert.equal(without.canRevealClaimLink, false);
  assert.equal(without.isClaimable, true);
  assert.equal(withCapability.canRevealClaimLink, true);
});

test("unavailable authority does not fabricate a financial state", () => {
  const result = resolvePayoutLifecycle({ authorityUnavailable: true, operationJournal: { state: "SUBMISSION_UNCERTAIN" }, connectedAccount: sender, capabilityPresent: true });
  assert.equal(result.financialState, "UNKNOWN");
  assert.equal(result.displayState, "RECOVERING");
  assert.equal(result.isReclaimable, false);
  assert.equal(result.canRevealClaimLink, false);
});

test("submitAndReconcile persists the boundary and reconciles provider response loss", async () => {
  const states: string[] = [];
  const persisted: Record<string, unknown>[] = [];
  let reads = 0;
  const result = await submitAndReconcile({
    operation: { operationId: "fund:42", payoutIds: ["42"], submissionBoundaryReached: false, createdAt: new Date(0).toISOString() },
    submit: async () => { throw new Error("response lost"); },
    readAuthoritativeState: async () => { reads += 1; return reads === 1 ? null : { status: "FUNDED" }; },
    successPredicate: value => value.status === "FUNDED",
    sleep: async () => undefined,
    reconcileAttempts: 2,
    onState: state => states.push(state),
    persist: update => persisted.push(update),
  });
  assert.equal(result.outcome, "CONFIRMED");
  assert.equal(states.includes("SUBMISSION_ATTEMPTED"), true);
  assert.equal(states.at(-1), "CONFIRMED");
  assert.equal(persisted.some(update => update.submissionBoundaryReached === true), true);
});

test("submitAndReconcile never labels a pre-boundary preparation failure as uncertain", async () => {
  let submitCalls = 0;
  const result = await submitAndReconcile({
    operation: { operationId: "fund:43", payoutIds: ["43"], submissionBoundaryReached: false, createdAt: new Date(0).toISOString() },
    prepare: async () => { throw new Error("chain time unavailable"); },
    submit: async () => { submitCalls += 1; },
    readAuthoritativeState: async () => null,
    successPredicate: () => false,
  });
  assert.equal(result.outcome, "FAILED_BEFORE_SUBMISSION");
  assert.equal(submitCalls, 0);
});

test("operation journal persists only public fields", () => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
      sessionStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
    },
  });
  upsertOperation({
    operationType: "FUND",
    operationId: "fund:1",
    payoutIds: ["1"],
    createdAt: "2026-01-01T00:00:00.000Z",
    submissionBoundaryReached: false,
    state: "PREPARED",
    expectedAmount: "1000000",
    ...( { capability: "must-not-persist" } as never ),
  });
  const serialized = values.get(OPERATION_JOURNAL_KEY) ?? "";
  assert.equal(serialized.includes("must-not-persist"), false);
  assert.match(serialized, /expectedAmount/);
});

