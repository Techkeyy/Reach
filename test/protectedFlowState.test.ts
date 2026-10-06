import test from "node:test";
import assert from "node:assert/strict";
import { ProtectedFlowState } from "../src/client/protectedFlowState";

const address = "0x1111111111111111111111111111111111111111" as `0x${string}`;

test("boot snapshots cannot commit after a Protected flow advances", () => {
  const state = new ProtectedFlowState();
  const boot = state.beginBoot();

  assert.equal(state.canCommitBoot(boot), true);
  assert.equal(state.start("42", address), true);
  assert.equal(state.canCommitBoot(boot), false);

  state.recordBegin({ payoutId: "42", flowId: "flow", challenge: "challenge", address });
  state.recordCodeSent({ payoutId: "42", flowId: "flow", expiresAt: 1000, resendAvailableAt: 900, address });

  const rerun = state.beginBoot();
  assert.equal(state.canCommitBoot(rerun), false);
  assert.equal(state.phase, "CODE_SENT");
  assert.deepEqual(state.otpFlow("42"), { payoutId: "42", flowId: "flow", expiresAt: 1000, resendAvailableAt: 900, address });
});

test("a stale boot completion cannot regress OTP state after a newer boot starts", () => {
  const state = new ProtectedFlowState();
  const firstBoot = state.beginBoot();
  const secondBoot = state.beginBoot();

  assert.equal(state.canCommitBoot(firstBoot), false);
  assert.equal(state.canCommitBoot(secondBoot), true);

  assert.equal(state.start("42", address), true);
  state.recordBegin({ payoutId: "42", flowId: "flow", challenge: "challenge", address });
  state.recordCodeSent({ payoutId: "42", flowId: "flow", expiresAt: 1000, resendAvailableAt: 900, address });
  assert.equal(state.canCommitBoot(secondBoot), false);
  assert.equal(state.phase, "CODE_SENT");
});

test("an active in-memory flow blocks a second begin and can be cleared after completion", () => {
  const state = new ProtectedFlowState();
  assert.equal(state.start("42", address), true);
  state.recordBegin({ payoutId: "42", flowId: "flow", challenge: "challenge", address });
  assert.equal(state.start("42", address), false);
  assert.equal(state.beginAttempt("42")?.flowId, "flow");

  state.recordCodeSent({ payoutId: "42", flowId: "flow", expiresAt: 1000, resendAvailableAt: 900, address });
  assert.equal(state.start("42", address), false);
  assert.equal(state.otpFlow("42")?.flowId, "flow");

  state.clear();
  assert.equal(state.phase, "IDLE");
  assert.equal(state.start("42", address), true);
});
