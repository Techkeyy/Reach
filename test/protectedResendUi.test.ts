import assert from "node:assert/strict";
import test from "node:test";
import { PROTECTED_RESEND_ERROR, protectedResendMessage } from "../src/client/protectedResendUi";

test("protected resend shows sending, success, and existing idle copy", () => {
  assert.equal(protectedResendMessage("sending"), "Sending...");
  assert.equal(protectedResendMessage("resent"), "Code resent");
  assert.equal(protectedResendMessage("idle", "r***@example.com"), "A code was sent to r***@example.com.");
});

test("protected resend uses concise safe failure copy", () => {
  assert.equal(PROTECTED_RESEND_ERROR, "Couldn't resend the code. Try again shortly.");
});
