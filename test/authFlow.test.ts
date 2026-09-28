import test from "node:test";
import assert from "node:assert/strict";
import { AUTH_FAILURE_MESSAGE, authFailureMessage, hasAuthenticatedAccount, withTimeout } from "../src/client/authFlow";

test("auth success requires an account returned by the connector", () => {
  assert.equal(hasAuthenticatedAccount({ accounts: ["0x1111111111111111111111111111111111111111"] }), true);
  assert.equal(hasAuthenticatedAccount({ accounts: [] }), false);
  assert.equal(hasAuthenticatedAccount({}), false);
  assert.equal(hasAuthenticatedAccount(undefined), false);
});

test("auth failures expose a stable user-safe message and never raw SDK errors", () => {
  assert.equal(authFailureMessage(new Error("secret SDK response")), AUTH_FAILURE_MESSAGE);
  assert.equal(authFailureMessage("raw failure"), AUTH_FAILURE_MESSAGE);
});

test("auth connection timeout rejects and successful connection resolves", async () => {
  await assert.rejects(withTimeout(new Promise<never>(() => {}), 5), /timed out/);
  assert.equal(await withTimeout(Promise.resolve("connected"), 50), "connected");
});
