import test from "node:test";
import assert from "node:assert/strict";
import {
  beginProtectedRecipientVerification,
  PROTECTED_AUTH_CANCELLED,
  PROTECTED_REAUTH_REQUIRED,
  PROTECTED_SESSION_ADDRESS_MISMATCH,
  ProtectedAuthError,
} from "../src/client/protectedAuthSession";

const address = "0x1111111111111111111111111111111111111111";
const otherAddress = "0x2222222222222222222222222222222222222222";

function reply(status: number, body: Record<string, unknown> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("an existing local address with a valid server session begins directly", async () => {
  const methods: string[] = [];
  let begins = 0;
  const result = await beginProtectedRecipientVerification({
    initialAddress: address,
    connect: async method => { methods.push(method); return address; },
    disconnect: async () => { throw new Error("disconnect must not run"); },
    begin: async () => { begins += 1; return reply(200, { flowId: "flow", challenge: "challenge" }); },
  });

  assert.equal(result.address, address);
  assert.equal(result.response.status, 200);
  assert.deepEqual(methods, []);
  assert.equal(begins, 1);
});
test("a missing server session reauthenticates the same recipient and retries once", async () => {
  const events: string[] = [];
  let begins = 0;
  const result = await beginProtectedRecipientVerification({
    initialAddress: address,
    connect: async method => { events.push(`connect:${method}`); return address; },
    disconnect: async () => { events.push("disconnect"); },
    begin: async () => {
      begins += 1;
      return begins === 1 ? reply(401, { error: "authentication required" }) : reply(200, { flowId: "flow", challenge: "challenge" });
    },
    onReauthenticationRequired: () => events.push("reauth-required"),
    onAuthenticationStarted: () => events.push("auth-started"),
    onAuthenticationRestored: () => events.push("auth-restored"),
  });

  assert.equal(result.response.status, 200);
  assert.equal(result.address, address);
  assert.equal(begins, 2);
  assert.deepEqual(events, ["reauth-required", "auth-started", "disconnect", "connect:login", "auth-restored"]);
});

test("a stale address that reauthenticates to another account fails closed without retry", async () => {
  let begins = 0;
  await assert.rejects(
    beginProtectedRecipientVerification({
      initialAddress: address,
      connect: async method => {
        assert.equal(method, "login");
        return otherAddress;
      },
      disconnect: async () => {},
      begin: async () => { begins += 1; return reply(401, { error: "authentication required" }); },
    }),
    (error: unknown) => error instanceof ProtectedAuthError
      && error.code === "ADDRESS_MISMATCH"
      && error.message === PROTECTED_SESSION_ADDRESS_MISMATCH,
  );
  assert.equal(begins, 1);
});

test("a fresh recipient registers normally and begins with the returned address", async () => {
  const methods: string[] = [];
  let begins = 0;
  const result = await beginProtectedRecipientVerification({
    connect: async method => { methods.push(method); return address; },
    begin: async () => { begins += 1; return reply(200, { flowId: "flow", challenge: "challenge" }); },
  });

  assert.equal(result.address, address);
  assert.deepEqual(methods, ["register"]);
  assert.equal(begins, 1);
});

test("a cancelled re-authentication fails closed and never retries begin", async () => {
  let begins = 0;
  await assert.rejects(
    beginProtectedRecipientVerification({
      initialAddress: address,
      connect: async () => { throw Object.assign(new Error("The operation was cancelled"), { name: "AbortError" }); },
      disconnect: async () => {},
      begin: async () => { begins += 1; return reply(401, { error: "authentication required" }); },
    }),
    (error: unknown) => error instanceof ProtectedAuthError
      && error.code === "AUTH_CANCELLED"
      && error.message === PROTECTED_AUTH_CANCELLED,
  );
  assert.equal(begins, 1);
});

test("a second 401 stops without an authentication loop", async () => {
  let begins = 0;
  let connects = 0;
  await assert.rejects(
    beginProtectedRecipientVerification({
      initialAddress: address,
      connect: async method => { connects += 1; assert.equal(method, "login"); return address; },
      disconnect: async () => {},
      begin: async () => { begins += 1; return reply(401, { error: "authentication required" }); },
    }),
    (error: unknown) => error instanceof ProtectedAuthError
      && error.code === "AUTH_REQUIRED"
      && error.message === PROTECTED_REAUTH_REQUIRED,
  );
  assert.equal(begins, 2);
  assert.equal(connects, 1);
});

