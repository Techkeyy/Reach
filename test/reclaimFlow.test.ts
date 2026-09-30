import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runReclaimFlow,
  SAFE_RECLAIM_NOT_EXPIRED,
  SAFE_RECLAIM_READ_FAILURE,
  SAFE_RECLAIM_SUBMISSION_UNCERTAIN,
  type ReclaimPayout,
  type ReclaimUiState,
} from "../src/client/reclaimFlow";

const sender = "0x6B6e9e45Cf4bB5CbC7d4a8B19cf3d886369Ff925";
const other = "0x1111111111111111111111111111111111111111";
const expired: ReclaimPayout = { status: 1, sender, amount: "10000", expiresAt: "1000", claimSigner: other, claimant: "0x0000000000000000000000000000000000000000" };

function run(overrides: Partial<Parameters<typeof runReclaimFlow>[0]> = {}) {
  const states: Array<{ state: ReclaimUiState; message?: string }> = [];
  let submitCalls = 0;
  let observed: ReclaimPayout[] = [];
  const options: Parameters<typeof runReclaimFlow>[0] = {
    connectedAddress: sender,
    readPayout: async () => expired,
    readChainTimestamp: async () => 1000n,
    submit: async () => { submitCalls += 1; return "0xhash"; },
    reconcile: async () => expired,
    onState: (state, message) => states.push({ state, ...(message ? { message } : {}) }),
    onPayout: payout => observed.push(payout),
    ...overrides,
  };
  return { promise: runReclaimFlow(options), states, get submitCalls() { return submitCalls; }, observed };
}

test("A — initial read throws with no provider call and an explicit no-submission failure", async () => {
  const execution = run({ readPayout: async () => { throw new Error("RPC unavailable"); } });
  const result = await execution.promise;
  assert.equal(result.outcome, "FAILED_BEFORE_SUBMISSION");
  assert.equal(execution.submitCalls, 0);
  assert.equal(execution.states.at(-1)?.state, "FAILED_BEFORE_SUBMISSION");
  assert.equal(execution.states.at(-1)?.message, SAFE_RECLAIM_READ_FAILURE);
});

test("B — null initial read is not treated as a silent non-funded return", async () => {
  const execution = run({ readPayout: async () => null });
  const result = await execution.promise;
  assert.equal(result.outcome, "FAILED_BEFORE_SUBMISSION");
  assert.equal(execution.submitCalls, 0);
  assert.equal(execution.states.at(-1)?.state, "FAILED_BEFORE_SUBMISSION");
  assert.match(execution.states.at(-1)?.message ?? "", /No transaction was submitted/);
});

test("C — preparation exception is an explicit pre-submission failure", async () => {
  const execution = run({ prepareSubmission: () => { throw new Error("encoding failed"); } });
  const result = await execution.promise;
  assert.equal(result.outcome, "FAILED_BEFORE_SUBMISSION");
  assert.equal(execution.submitCalls, 0);
  assert.equal(execution.states.at(-1)?.state, "FAILED_BEFORE_SUBMISSION");
});

test("D — authoritative RECLAIMED state renders terminal success without a provider call", async () => {
  const execution = run({ readPayout: async () => ({ ...expired, status: 3 }) });
  const result = await execution.promise;
  assert.equal(result.outcome, "RECLAIMED");
  assert.equal(execution.submitCalls, 0);
  assert.equal(execution.states.at(-1)?.state, "RECLAIMED");
  assert.equal(execution.observed.at(-1)?.status, 3);
});

test("E — authoritative CLAIMED state renders terminal lifecycle without a provider call", async () => {
  const execution = run({ readPayout: async () => ({ ...expired, status: 2, claimant: other }) });
  const result = await execution.promise;
  assert.equal(result.outcome, "CLAIMED");
  assert.equal(execution.submitCalls, 0);
  assert.equal(execution.states.at(-1)?.state, "IDLE");
  assert.equal(execution.observed.at(-1)?.status, 2);
});

test("F — FUNDED but not expired is explicit and never reaches the provider", async () => {
  const execution = run({ readChainTimestamp: async () => 999n });
  const result = await execution.promise;
  assert.equal(result.outcome, "FAILED_BEFORE_SUBMISSION");
  assert.equal(execution.submitCalls, 0);
  assert.equal(execution.states.at(-1)?.message, SAFE_RECLAIM_NOT_EXPIRED);
});

test("G — wrong sender is explicit and never reaches the provider", async () => {
  const execution = run({ connectedAddress: other });
  const result = await execution.promise;
  assert.equal(result.outcome, "FAILED_BEFORE_SUBMISSION");
  assert.equal(execution.submitCalls, 0);
  assert.match(execution.states.at(-1)?.message ?? "", /Only the sender/);
});

test("H — provider throw after the submission boundary reconciles instead of becoming pre-submission failure", async () => {
  const states: ReclaimUiState[] = [];
  const messages: string[] = [];
  const execution = run({
    submit: async () => { throw new Error("provider response lost"); },
    reconcile: async () => expired,
    onState: (state, message) => {
      states.push(state);
      if (message) messages.push(message);
    },
  });
  const result = await execution.promise;
  assert.equal(result.outcome, "SUBMISSION_UNCERTAIN");
  assert.equal(execution.submitCalls, 0);
  assert.equal(states.includes("RECOVERING"), true);
  assert.equal(states.includes("FAILED_BEFORE_SUBMISSION"), false);
  assert.equal(states.at(-1), "SUBMISSION_UNCERTAIN");
  assert.equal(messages.at(-1), SAFE_RECLAIM_SUBMISSION_UNCERTAIN);
});

test("I — an ambiguous provider result that later reads RECLAIMED immediately reaches terminal success", async () => {
  const execution = run({
    submit: async () => { throw new Error("response lost"); },
    reconcile: async () => ({ ...expired, status: 3 }),
  });
  const result = await execution.promise;
  assert.equal(result.outcome, "RECLAIMED");
  assert.equal(execution.states.at(-1)?.state, "RECLAIMED");
  assert.equal(execution.observed.at(-1)?.status, 3);
});

test("J — every pre-submission path ends with a visible non-IDLE result", async () => {
  const scenarios = [
    { readPayout: async () => null },
    { connectedAddress: other },
    { readChainTimestamp: async () => 999n },
    { prepareSubmission: () => { throw new Error("prepare"); } },
  ];

  for (const scenario of scenarios) {
    const execution = run(scenario);
    const result = await execution.promise;
    assert.notEqual(result.outcome, "SUBMISSION_UNCERTAIN");
    assert.notEqual(execution.states.at(-1)?.state, "IDLE");
    assert.ok(execution.states.at(-1)?.message, "pre-submission outcome must include visible copy");
  }
});
