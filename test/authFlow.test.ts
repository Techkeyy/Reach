import test from "node:test";
import assert from "node:assert/strict";
import { AUTH_FAILURE_MESSAGE, authFailure, authFailureCopy, authFailureMessage, hasAuthenticatedAccount, withTimeout } from "../src/client/authFlow";

test("auth success requires an account returned by the connector", () => {
  assert.equal(hasAuthenticatedAccount({ accounts: ["0x1111111111111111111111111111111111111111"] }), true);
  assert.equal(hasAuthenticatedAccount({ accounts: [] }), false);
  assert.equal(hasAuthenticatedAccount({}), false);
  assert.equal(hasAuthenticatedAccount(undefined), false);
});

test("auth failures stay flow-specific and never expose raw SDK errors", () => {
  assert.equal(authFailureMessage(new Error("secret SDK response"), "login"), "No additional details were provided.");
  assert.equal(authFailureMessage("raw failure", "register"), "No additional details were provided.");
  assert.equal(authFailure(new Error("HTTP 503"), "register").kind, "OPTIONS_FAILED");
  assert.equal(authFailure(new DOMException("The operation was cancelled", "AbortError"), "register").kind, "USER_CANCELLED");
  assert.equal(authFailure(new Error("Authentication timed out"), "register").kind, "TIMEOUT");
  assert.equal(authFailureCopy("register", "COMPLETE_FAILED").title, "We couldn't finish creating your account.");
  assert.equal(authFailureCopy("login", "WEBAUTHN_FAILED").title, AUTH_FAILURE_MESSAGE);
});

test("auth connection timeout rejects and successful connection resolves", async () => {
  await assert.rejects(withTimeout(new Promise<never>(() => {}), 5), /timed out/);
  assert.equal(await withTimeout(Promise.resolve("connected"), 50), "connected");
});
