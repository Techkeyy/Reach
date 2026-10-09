import test from "node:test";
import assert from "node:assert/strict";
import { Kv } from "accounts/server";
import { createApp } from "../src/server/app";
import { createKvStore } from "../src/server/kvAdapter";
import type { GmailApiEmailProvider } from "../src/server/protectedClaims.js";

test("server app - /health returns 200 with Moderato chain ID and storage evidence", async () => {
  const app = createApp({ serveStaticFallback: false });
  const res = await app.request("/health");
  assert.equal(res.status, 200);
  const data = (await res.json()) as { ok: boolean; chainId: number; sponsorConfigured: boolean; webAuthnStorage: string; protectedClaims: { emailConfigured: boolean; smsConfigured: boolean; gmailApiConfigured: boolean } };
  assert.equal(data.ok, true);
  assert.equal(data.chainId, 42431);
  assert.equal(typeof data.sponsorConfigured, "boolean");
  assert.ok(data.webAuthnStorage === "memory" || data.webAuthnStorage === "durable");
  assert.equal(typeof data.protectedClaims.emailConfigured, "boolean");
  assert.equal(typeof data.protectedClaims.smsConfigured, "boolean");
  assert.equal(typeof data.protectedClaims.gmailApiConfigured, "boolean");
});

test("relay rejects malformed requests with sanitized 4xx responses", async () => {
  const previousFeePayerKey = process.env.REACH_FEE_PAYER_PRIVATE_KEY;
  process.env.REACH_FEE_PAYER_PRIVATE_KEY = `0x${"11".repeat(32)}`;
  try {
    const app = createApp({ serveStaticFallback: false });
    const cases: Array<[string, RequestInit, number]> = [
      ["/relay", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }, 400],
      ["/relay", { method: "POST", headers: { "Content-Type": "application/json" }, body: "not-json" }, 400],
      ["/relay", { method: "GET" }, 405],
    ];
    for (const [path, init, expectedStatus] of cases) {
      const response = await app.request(path, init);
      assert.equal(response.status, expectedStatus);
      const body = await response.json() as { error?: string };
      assert.equal(body.error, "sponsorship request rejected");
      assert.doesNotMatch(JSON.stringify(body), /invalid relay request|only transaction fills|private|secret/i);
    }
  } finally {
    if (previousFeePayerKey === undefined) delete process.env.REACH_FEE_PAYER_PRIVATE_KEY;
    else process.env.REACH_FEE_PAYER_PRIVATE_KEY = previousFeePayerKey;
  }
});

test("server app - health reports email protection configured only when Gmail API OAuth settings exist", async () => {
  const previousClientId = process.env.GMAIL_OAUTH_CLIENT_ID;
  const previousClientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET;
  const previousRefreshToken = process.env.GMAIL_OAUTH_REFRESH_TOKEN;
  const previousFrom = process.env.REACH_PROTECTED_EMAIL_FROM;
  const previousEncryptionKey = process.env.REACH_PROTECTED_CLAIMS_ENCRYPTION_KEY;
  const previousBrevoKey = process.env.BREVO_API_KEY;
  try {
    process.env.GMAIL_OAUTH_CLIENT_ID = "client-id";
    process.env.GMAIL_OAUTH_CLIENT_SECRET = "client-secret";
    process.env.GMAIL_OAUTH_REFRESH_TOKEN = "refresh-token";
    process.env.REACH_PROTECTED_EMAIL_FROM = "Reach <verify@example.com>";
    process.env.REACH_PROTECTED_CLAIMS_ENCRYPTION_KEY = "11".repeat(32);
    process.env.BREVO_API_KEY = "stale-brevo-key-must-not-matter";
    const configured = await createApp({ serveStaticFallback: false }).request("/health");
    assert.equal((await configured.json() as any).protectedClaims.emailConfigured, true);
    assert.equal((await createApp({ serveStaticFallback: false }).request("/health").then(response => response.json()) as any).protectedClaims.gmailApiConfigured, true);

    delete process.env.GMAIL_OAUTH_REFRESH_TOKEN;
    const missingRefreshToken = await createApp({ serveStaticFallback: false }).request("/health");
    assert.equal((await missingRefreshToken.json() as any).protectedClaims.emailConfigured, false);
    assert.equal((await createApp({ serveStaticFallback: false }).request("/health").then(response => response.json()) as any).protectedClaims.gmailApiConfigured, false);
  } finally {
    if (previousClientId === undefined) delete process.env.GMAIL_OAUTH_CLIENT_ID;
    else process.env.GMAIL_OAUTH_CLIENT_ID = previousClientId;
    if (previousClientSecret === undefined) delete process.env.GMAIL_OAUTH_CLIENT_SECRET;
    else process.env.GMAIL_OAUTH_CLIENT_SECRET = previousClientSecret;
    if (previousRefreshToken === undefined) delete process.env.GMAIL_OAUTH_REFRESH_TOKEN;
    else process.env.GMAIL_OAUTH_REFRESH_TOKEN = previousRefreshToken;
    if (previousFrom === undefined) delete process.env.REACH_PROTECTED_EMAIL_FROM;
    else process.env.REACH_PROTECTED_EMAIL_FROM = previousFrom;
    if (previousEncryptionKey === undefined) delete process.env.REACH_PROTECTED_CLAIMS_ENCRYPTION_KEY;
    else process.env.REACH_PROTECTED_CLAIMS_ENCRYPTION_KEY = previousEncryptionKey;
    if (previousBrevoKey === undefined) delete process.env.BREVO_API_KEY;
    else process.env.BREVO_API_KEY = previousBrevoKey;
  }
});

test("internal Gmail verification requires auth, accepts no body, rate-limits, and sends no email", async () => {
  const address = "0x1111111111111111111111111111111111111111" as const;
  let verifyCalls = 0;
  let sendCalls = 0;
  const provider: GmailApiEmailProvider = {
    gmailApiConfigured: true,
    async sendVerificationCode() { sendCalls += 1; },
    async verifyTransport() {
      verifyCalls += 1;
      return { ok: true, provider: "gmail-api", scopeAuthorized: true };
    },
  };
  const authKv = Kv.memory();
  const app = createApp({
    serveStaticFallback: false,
    authKv,
    emailProvider: provider,
    protectedSession: async () => ({ address }),
  });
  const unauthenticated = createApp({
    serveStaticFallback: false,
    emailProvider: provider,
    protectedSession: async () => undefined,
  });

  const denied = await unauthenticated.request("/api/internal/email-provider/verify", { method: "POST" });
  assert.equal(denied.status, 401);
  assert.deepEqual(await denied.json(), { error: "authentication required" });

  const withBody = await app.request("/api/internal/email-provider/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: "must-not-be-accepted" }),
  });
  assert.equal(withBody.status, 400);
  assert.deepEqual(await withBody.json(), { error: "empty request required" });
  assert.equal(verifyCalls, 0);

  const verified = await app.request("/api/internal/email-provider/verify", { method: "POST" });
  assert.equal(verified.status, 200);
  assert.deepEqual(await verified.json(), { ok: true, provider: "gmail-api", scopeAuthorized: true });
  assert.equal(verifyCalls, 1);
  assert.equal(sendCalls, 0);

  const limited = await app.request("/api/internal/email-provider/verify", { method: "POST" });
  assert.equal(limited.status, 429);
  assert.deepEqual(await limited.json(), { ok: false, provider: "gmail-api", category: "QUOTA_OR_RATE_LIMIT" });
  assert.equal(verifyCalls, 1);
  assert.equal(sendCalls, 0);
});

test("server app - /api validation guards", async () => {
  const app = createApp({ serveStaticFallback: false });

  // Invalid payout id
  const badPayoutRes = await app.request("/api/payout/0");
  assert.equal(badPayoutRes.status, 404);

  // Invalid sender address
  const badSenderRes = await app.request("/api/payouts/not-an-address");
  assert.equal(badSenderRes.status, 400);

  const badActivityRes = await app.request("/api/activity/not-an-address");
  assert.equal(badActivityRes.status, 400);

  // Invalid balance address
  const badBalanceRes = await app.request("/api/balance/not-an-address");
  assert.equal(badBalanceRes.status, 400);
});

test("server app - /auth/register/options returns WebAuthn options with configured rpId", async () => {
  process.env.REACH_RP_ID = "reach-test.vercel.app";
  process.env.REACH_ORIGIN = "https://reach-test.vercel.app";
  const app = createApp({ serveStaticFallback: false });

  const res = await app.request("/auth/register/options", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://reach-test.vercel.app",
    },
    body: JSON.stringify({
      name: "Reach sender",
    }),
  });

  assert.equal(res.status, 200);
  const data = (await res.json()) as any;
  assert.ok(data.options?.publicKey);
  assert.equal(data.options.publicKey.rp.id, "reach-test.vercel.app");
  assert.ok(data.options.publicKey.pubKeyCredParams.some((param: any) => param.alg === -7));
});

test("server app - /auth rejects mismatched origin when REACH_ORIGIN is set", async () => {
  process.env.REACH_RP_ID = "reach-test.vercel.app";
  process.env.REACH_ORIGIN = "https://reach-test.vercel.app";
  const app = createApp({ serveStaticFallback: false });

  const res = await app.request("/auth/register/options", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://attacker.com",
    },
    body: JSON.stringify({
      name: "Reach sender",
    }),
  });

  assert.equal(res.status, 403);
});

test("server app - registration reconciliation survives separate app instances and only acknowledges an exact SDK credential record", async () => {
  const authKv = Kv.memory();
  const credentialId = "fixture-credential-id";
  const publicKey = `0x04${"11".repeat(64)}`;
  const writer = createApp({ serveStaticFallback: false, authKv });
  const reader = createApp({ serveStaticFallback: false, authKv });
  await authKv.set(`credential:${credentialId}`, { publicKey });

  const matched = await reader.request("/auth/register/reconcile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credentialId, publicKey }),
  });
  assert.equal(matched.status, 200);
  assert.deepEqual(await matched.json(), { status: "already_committed" });
  assert.equal(matched.headers.get("cache-control"), "no-store");

  const wrongKey = await writer.request("/auth/register/reconcile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credentialId, publicKey: `0x04${"22".repeat(64)}` }),
  });
  assert.equal(wrongKey.status, 404);
  assert.deepEqual(await wrongKey.json(), { status: "not_committed" });

  const malformed = await reader.request("/auth/register/reconcile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credentialId, publicKey: "not-a-public-key" }),
  });
  assert.equal(malformed.status, 400);
});

test("kvAdapter - memory fallback supports get, set, delete, create, and take", async () => {
  delete process.env.KV_REST_API_URL;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.NODE_ENV;
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;

  const { kv, storageType } = createKvStore();
  assert.equal(storageType, "memory");

  // set and get
  await kv.set("test:key1", { hello: "world" });
  const val1 = await kv.get<{ hello: string }>("test:key1");
  assert.deepEqual(val1, { hello: "world" });

  // delete
  await kv.delete("test:key1");
  const valDeleted = await kv.get("test:key1");
  assert.equal(valDeleted, undefined);

  // create (atomic if absent)
  if (kv.create) {
    const created1 = await kv.create("test:key2", { foo: "bar" });
    assert.equal(created1, true);
    const created2 = await kv.create("test:key2", { foo: "baz" });
    assert.equal(created2, false);
  }

  // take (read and delete)
  if (kv.take) {
    await kv.set("test:key3", { oneTime: true });
    const taken1 = await kv.take<{ oneTime: boolean }>("test:key3");
    assert.deepEqual(taken1, { oneTime: true });
    const taken2 = await kv.take("test:key3");
    assert.equal(taken2, undefined);
  }
});

test("kvAdapter - fails closed in production when durable KV env is missing", () => {
  delete process.env.KV_REST_API_URL;
  delete process.env.UPSTASH_REDIS_REST_URL;
  process.env.VERCEL_ENV = "production";

  assert.throws(() => createKvStore(), /Durable KV configuration missing in production/);
  delete process.env.VERCEL_ENV;
});

test("protected registration requires the server session and binds it to the active sender", async () => {
  const previousClientId = process.env.GMAIL_OAUTH_CLIENT_ID;
  const previousClientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET;
  const previousRefreshToken = process.env.GMAIL_OAUTH_REFRESH_TOKEN;
  const previousFrom = process.env.REACH_PROTECTED_EMAIL_FROM;
  const previousEncryptionKey = process.env.REACH_PROTECTED_CLAIMS_ENCRYPTION_KEY;
  const sender = "0x1111111111111111111111111111111111111111" as const;
  const otherSender = "0x2222222222222222222222222222222222222222" as const;
  try {
    process.env.GMAIL_OAUTH_CLIENT_ID = "client-id";
    process.env.GMAIL_OAUTH_CLIENT_SECRET = "client-secret";
    process.env.GMAIL_OAUTH_REFRESH_TOKEN = "refresh-token";
    process.env.REACH_PROTECTED_EMAIL_FROM = "Reach <verify@example.com>";
    process.env.REACH_PROTECTED_CLAIMS_ENCRYPTION_KEY = "11".repeat(32);

    const authKv = Kv.memory();
    const body = (payoutId: string, bodySender = sender) => JSON.stringify({
      payoutId,
      sender: bodySender,
      claimSigner: "0x3333333333333333333333333333333333333333",
      channel: "EMAIL",
      recipient: "owner@example.com",
      shareB: `0x${"44".repeat(32)}`,
      shareAProofAddress: "0x5555555555555555555555555555555555555555",
    });
    const request = (payoutId: string, bodySender = sender) => ({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body(payoutId, bodySender),
    });

    const valid = createApp({
      serveStaticFallback: false,
      authKv,
      protectedSession: async () => ({ address: sender }),
    });
    const validResponse = await valid.request("/api/protected/register", request("7001"));
    assert.equal(validResponse.status, 201);
    assert.deepEqual(await validResponse.json(), { ok: true });
    assert.ok(await authKv.get("protected:claim:7001"));

    const missingSession = createApp({
      serveStaticFallback: false,
      authKv,
      protectedSession: async () => undefined,
    });
    const missingResponse = await missingSession.request("/api/protected/register", request("7002"));
    assert.equal(missingResponse.status, 401);
    assert.deepEqual(await missingResponse.json(), { error: "authentication required" });
    assert.equal(await authKv.get("protected:claim:7002"), undefined);

    const mismatch = createApp({
      serveStaticFallback: false,
      authKv,
      protectedSession: async () => ({ address: otherSender }),
    });
    const mismatchResponse = await mismatch.request("/api/protected/register", request("7003"));
    assert.equal(mismatchResponse.status, 401);
    assert.deepEqual(await mismatchResponse.json(), { error: "authenticated sender required" });
    assert.equal(await authKv.get("protected:claim:7003"), undefined);
  } finally {
    if (previousClientId === undefined) delete process.env.GMAIL_OAUTH_CLIENT_ID;
    else process.env.GMAIL_OAUTH_CLIENT_ID = previousClientId;
    if (previousClientSecret === undefined) delete process.env.GMAIL_OAUTH_CLIENT_SECRET;
    else process.env.GMAIL_OAUTH_CLIENT_SECRET = previousClientSecret;
    if (previousRefreshToken === undefined) delete process.env.GMAIL_OAUTH_REFRESH_TOKEN;
    else process.env.GMAIL_OAUTH_REFRESH_TOKEN = previousRefreshToken;
    if (previousFrom === undefined) delete process.env.REACH_PROTECTED_EMAIL_FROM;
    else process.env.REACH_PROTECTED_EMAIL_FROM = previousFrom;
    if (previousEncryptionKey === undefined) delete process.env.REACH_PROTECTED_CLAIMS_ENCRYPTION_KEY;
    else process.env.REACH_PROTECTED_CLAIMS_ENCRYPTION_KEY = previousEncryptionKey;
  }
});
