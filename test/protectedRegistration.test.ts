import test from "node:test";
import assert from "node:assert/strict";
import {
  PROTECTED_REAUTH_REQUIRED,
  PROTECTED_SESSION_ADDRESS_MISMATCH,
  ProtectedRegistrationError,
  registerProtectedPayout,
  type ProtectedRegistrationPayload,
} from "../src/client/protectedRegistration";

const sender = "0x1111111111111111111111111111111111111111" as const;
const otherSender = "0x2222222222222222222222222222222222222222" as const;
const claimSigner = "0x3333333333333333333333333333333333333333" as const;
const shareB = `0x${"44".repeat(32)}` as `0x${string}`;
const shareAProofAddress = "0x5555555555555555555555555555555555555555" as const;

const payload: ProtectedRegistrationPayload = {
  payoutId: "123",
  sender,
  claimSigner,
  channel: "EMAIL",
  recipient: "owner@example.com",
  shareB,
  shareAProofAddress,
};

function reply(status: number, body: Record<string, unknown> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("protected registration accepts an already-authenticated server session", async () => {
  let requests = 0;
  let reauthCalls = 0;
  await registerProtectedPayout({
    payload,
    reauthenticate: async () => {
      reauthCalls += 1;
      return sender;
    },
    fetcher: async (_input, init) => {
      requests += 1;
      assert.equal(init?.credentials, "include");
      assert.equal(JSON.parse(String(init?.body)).sender, sender);
      return reply(201, { ok: true });
    },
  });
  assert.equal(requests, 1);
  assert.equal(reauthCalls, 0);
});

test("missing server session stops protected preparation with explicit re-auth state", async () => {
  let requests = 0;
  let authRequired = 0;
  await assert.rejects(
    registerProtectedPayout({
      payload,
      onAuthenticationRequired: () => { authRequired += 1; },
      fetcher: async () => {
        requests += 1;
        return reply(401, { error: "authentication required" });
      },
    }),
    (error: unknown) => error instanceof ProtectedRegistrationError
      && error.code === "AUTH_REQUIRED"
      && error.message === PROTECTED_REAUTH_REQUIRED,
  );
  assert.equal(requests, 1);
  assert.equal(authRequired, 1);
});

test("successful re-authentication retries registration for the same address", async () => {
  const requests: string[] = [];
  const callbacks: string[] = [];
  let attempt = 0;
  await registerProtectedPayout({
    payload,
    reauthenticate: async () => {
      callbacks.push("reauthenticate");
      return sender;
    },
    onAuthenticationRequired: () => { callbacks.push("required"); },
    onAuthenticationRestored: () => { callbacks.push("restored"); },
    fetcher: async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)).sender);
      attempt += 1;
      return reply(attempt === 1 ? 401 : 201, attempt === 1 ? { error: "authentication required" } : { ok: true });
    },
  });
  assert.deepEqual(requests, [sender, sender]);
  assert.deepEqual(callbacks, ["required", "reauthenticate", "restored"]);
});

test("re-authentication for a different account fails closed without retrying registration", async () => {
  let requests = 0;
  await assert.rejects(
    registerProtectedPayout({
      payload,
      reauthenticate: async () => otherSender,
      fetcher: async () => {
        requests += 1;
        return reply(401, { error: "authentication required" });
      },
    }),
    (error: unknown) => error instanceof ProtectedRegistrationError
      && error.code === "ADDRESS_MISMATCH"
      && error.message === PROTECTED_SESSION_ADDRESS_MISMATCH,
  );
  assert.equal(requests, 1);
});

test("an expired session that remains unauthorized after re-auth never loops or proceeds", async () => {
  let requests = 0;
  await assert.rejects(
    registerProtectedPayout({
      payload,
      reauthenticate: async () => sender,
      fetcher: async () => {
        requests += 1;
        return reply(401, { error: "authentication required" });
      },
    }),
    (error: unknown) => error instanceof ProtectedRegistrationError && error.code === "AUTH_REQUIRED",
  );
  assert.equal(requests, 2);
});
