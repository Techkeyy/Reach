import test from "node:test";
import assert from "node:assert/strict";
import { Kv } from "accounts/server";
import { createApp } from "../src/server/app";
import { createKvStore } from "../src/server/kvAdapter";

test("server app - /health returns 200 with Moderato chain ID and storage evidence", async () => {
  const app = createApp({ serveStaticFallback: false });
  const res = await app.request("/health");
  assert.equal(res.status, 200);
  const data = (await res.json()) as { ok: boolean; chainId: number; sponsorConfigured: boolean; webAuthnStorage: string };
  assert.equal(data.ok, true);
  assert.equal(data.chainId, 42431);
  assert.equal(typeof data.sponsorConfigured, "boolean");
  assert.ok(data.webAuthnStorage === "memory" || data.webAuthnStorage === "durable");
});

test("server app - /api validation guards", async () => {
  const app = createApp({ serveStaticFallback: false });

  // Invalid payout id
  const badPayoutRes = await app.request("/api/payout/0");
  assert.equal(badPayoutRes.status, 404);

  // Invalid sender address
  const badSenderRes = await app.request("/api/payouts/not-an-address");
  assert.equal(badSenderRes.status, 400);

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
