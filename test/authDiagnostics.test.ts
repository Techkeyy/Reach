import test from "node:test";
import assert from "node:assert/strict";
import { authStageForPath, classifyAuthFailure, createAuthReference } from "../src/server/authDiagnostics";

test("auth diagnostics classify only coarse, secret-free failure classes", () => {
  assert.equal(classifyAuthFailure("Missing or expired challenge"), "CHALLENGE_MISSING_OR_EXPIRED");
  assert.equal(classifyAuthFailure("Credential already exists"), "CREDENTIAL_ALREADY_EXISTS");
  assert.equal(classifyAuthFailure("Authentication failed"), "AUTHENTICATION_FAILED");
  assert.equal(classifyAuthFailure("unrecognized internal detail"), "UNCLASSIFIED_ERROR");
  assert.equal(classifyAuthFailure(undefined), "NONE");
});

test("auth diagnostics identify the public request stage", () => {
  assert.equal(authStageForPath("/auth/register/options"), "REGISTER_OPTIONS");
  assert.equal(authStageForPath("/auth/register"), "REGISTER_COMPLETE");
  assert.equal(authStageForPath("/auth/register/reconcile"), "REGISTER_RECONCILE");
  assert.equal(authStageForPath("/auth/login/options"), "LOGIN_OPTIONS");
  assert.equal(authStageForPath("/auth/login"), "LOGIN_COMPLETE");
});

test("auth references are short opaque identifiers", () => {
  const reference = createAuthReference();
  assert.match(reference, /^RCH-[0-9A-F]{8}$/);
  assert.equal(reference.length, 12);
});
