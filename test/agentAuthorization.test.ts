import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Kv } from "accounts/server";
import { KeyAuthorization } from "ox/tempo";
import { privateKeyToAccount } from "viem/accounts";
import { PATH_USD_ADDRESS, TEMPO_MODERATO_CHAIN_ID, DEFAULT_VAULT_ADDRESS } from "../src/shared/reach";
import { createAgentAuthorizationService } from "../src/server/agentAuthorization";
import { createApp } from "../src/server/app";

const owner = privateKeyToAccount("0x59c6995e998f97a5a0044976f0945389dc9e86dae88a8c6a4c1f8c6c4d5b5b5b");
const destination = "0x1111111111111111111111111111111111111111" as const;

async function activate(service: ReturnType<typeof createAgentAuthorizationService>, created: Awaited<ReturnType<typeof service.create>>) {
  const unsigned = KeyAuthorization.from({
    address: created.policy.agentAddress,
    chainId: BigInt(TEMPO_MODERATO_CHAIN_ID),
    expiry: created.policy.expiryTimestamp,
    type: "secp256k1",
    limits: [{ token: PATH_USD_ADDRESS, limit: BigInt(created.policy.cumulativeBudgetRaw) }],
    scopes: [
      { address: PATH_USD_ADDRESS, selector: "0x095ea7b3", recipients: [DEFAULT_VAULT_ADDRESS] },
      { address: DEFAULT_VAULT_ADDRESS, selector: "0x28e47b74" },
    ],
  });
  const signature = await owner.sign({ hash: KeyAuthorization.getSignPayload(unsigned) });
  const signed = KeyAuthorization.from(unsigned, { signature });
  return service.activate(created.policy.id, owner.address, KeyAuthorization.toRpc(signed), owner.address);
}

async function activateMpp(service: ReturnType<typeof createAgentAuthorizationService>, created: Awaited<ReturnType<typeof service.create>>) {
  const unsigned = KeyAuthorization.from({
    address: created.policy.agentAddress,
    chainId: BigInt(TEMPO_MODERATO_CHAIN_ID),
    expiry: created.policy.expiryTimestamp,
    type: "secp256k1",
    limits: [{ token: PATH_USD_ADDRESS, limit: BigInt(created.policy.cumulativeBudgetRaw) }],
    scopes: [{ address: PATH_USD_ADDRESS, selector: "0xa9059cbb", recipients: [destination] }],
  });
  const signature = await owner.sign({ hash: KeyAuthorization.getSignPayload(unsigned) });
  const signed = KeyAuthorization.from(unsigned, { signature });
  return service.activate(created.policy.id, owner.address, KeyAuthorization.toRpc(signed), owner.address);
}

describe("delegated agent authorization service", () => {
  it("keeps signer material server-side and enforces concurrent budget reservations", async () => {
    const previousKey = process.env.REACH_AGENT_ENCRYPTION_KEY;
    process.env.REACH_AGENT_ENCRYPTION_KEY = "11".repeat(32);
    try {
      const kv = Kv.memory();
      const service = createAgentAuthorizationService(kv, {
        now: () => 1_000,
        verifyOnchainAuthorization: async () => {},
        submitPayout: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { approveTxHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const, createTxHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const };
        },
      });
      const created = await service.create({ maxPerPaymentRaw: "60", cumulativeBudgetRaw: "100", expiryTimestamp: 50_000 }, owner.address);
      assert.doesNotMatch(JSON.stringify(created), /privateKey|ciphertext|tokenHash/i);
      assert.doesNotThrow(() => JSON.stringify(created));
      await activate(service, created);

      const results = await Promise.allSettled([
        service.pay(created.token, { amountRaw: "60", destination, idempotencyKey: "concurrent-a" }),
        service.pay(created.token, { amountRaw: "60", destination, idempotencyKey: "concurrent-b" }),
      ]);
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(results.filter((result) => result.status === "rejected").length, 1);
      const policy = await service.readPolicy(created.policy.id);
      assert.equal(policy?.spentRaw, "60");
      assert.equal(policy?.reservedRaw, "0");

      const replay = await service.pay(created.token, { amountRaw: "60", destination, idempotencyKey: "concurrent-a" });
      assert.equal(replay.payment.state, "CONFIRMED");

      await service.revoke(created.policy.id, owner.address);
      await assert.rejects(() => service.pay(created.token, { amountRaw: "1", destination, idempotencyKey: "after-revoke" }), /revoked/i);
    } finally {
      if (previousKey === undefined) delete process.env.REACH_AGENT_ENCRYPTION_KEY;
      else process.env.REACH_AGENT_ENCRYPTION_KEY = previousKey;
    }
  });

  it("retains an unknown settlement reservation and refuses an automatic retry", async () => {
    const previousKey = process.env.REACH_AGENT_ENCRYPTION_KEY;
    process.env.REACH_AGENT_ENCRYPTION_KEY = "22".repeat(32);
    try {
      const service = createAgentAuthorizationService(Kv.memory(), {
        now: () => 1_000,
        verifyOnchainAuthorization: async () => {},
        submitPayout: async () => { throw new Error("network timeout after broadcast"); },
        readPayout: async () => ({ sender: owner.address, amount: 5n, expiresAt: 49_000n, claimSigner: destination, status: 1 }),
      });
      const created = await service.create({ maxPerPaymentRaw: "10", cumulativeBudgetRaw: "10", expiryTimestamp: 50_000 }, owner.address);
      await activate(service, created);
      await assert.rejects(
        () => service.pay(created.token, { amountRaw: "5", destination, idempotencyKey: "unknown-1" }),
        (error: any) => error?.code === "UNKNOWN_SETTLEMENT",
      );
      const payment = await service.getPayment(created.token, "unknown-1");
      assert.equal(payment.payment.state, "UNKNOWN");
      assert.equal(payment.policy.reservedRaw, "5");
      await assert.rejects(() => service.pay(created.token, { amountRaw: "5", destination, idempotencyKey: "unknown-1" }), /uncertain|unknown/i);
      const reconciled = await service.reconcilePayment(created.token, "unknown-1");
      assert.equal(reconciled.payment.state, "CONFIRMED");
      assert.equal(reconciled.policy.reservedRaw, "0");
      assert.equal(reconciled.policy.spentRaw, "5");
    } finally {
      if (previousKey === undefined) delete process.env.REACH_AGENT_ENCRYPTION_KEY;
      else process.env.REACH_AGENT_ENCRYPTION_KEY = previousKey;
    }
  });

  it("binds API policy creation to the owner session and never serializes server secrets", async () => {
    const previousKey = process.env.REACH_AGENT_ENCRYPTION_KEY;
    process.env.REACH_AGENT_ENCRYPTION_KEY = "33".repeat(32);
    try {
      const kv = Kv.memory();
      const service = createAgentAuthorizationService(kv, {
        now: () => 1_000,
        verifyOnchainAuthorization: async () => {},
        submitPayout: async () => ({ approveTxHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const, createTxHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const }),
      });
      const app = createApp({
        authKv: kv,
        agentService: service,
        protectedSession: async () => ({ address: owner.address }),
      });
      const response = await app.request("/api/agent/authorizations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maxPerPaymentRaw: "10", cumulativeBudgetRaw: "10", expiryTimestamp: 50_000 }),
      });
      assert.equal(response.status, 201);
      const created = await response.json() as Awaited<ReturnType<typeof service.create>>;
      const serialized = JSON.stringify(created);
      assert.doesNotMatch(serialized, /encryptedPrivateKey|ciphertext|tokenHash|privateKey/i);
      assert.match(created.token, /^reach_agent_/);

      const denied = await createApp({ protectedSession: async () => undefined }).request("/api/agent/authorizations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maxPerPaymentRaw: "10", cumulativeBudgetRaw: "10", expiryTimestamp: 50_000 }),
      });
      assert.equal(denied.status, 401);
    } finally {
      if (previousKey === undefined) delete process.env.REACH_AGENT_ENCRYPTION_KEY;
      else process.env.REACH_AGENT_ENCRYPTION_KEY = previousKey;
    }
  });

  it("discovers only the authenticated owner's policies and payment records", async () => {
    const previousKey = process.env.REACH_AGENT_ENCRYPTION_KEY;
    process.env.REACH_AGENT_ENCRYPTION_KEY = "55".repeat(32);
    try {
      const otherOwner = privateKeyToAccount("0x8b3a350cf5c34c9194ca3b3e6e5cfc2a7eb5f7dc7d4e0d3a9f9a0b9c8d7e6f5a");
      const kv = Kv.memory();
      const service = createAgentAuthorizationService(kv, { now: () => 1_000, verifyOnchainAuthorization: async () => {} });
      const first = await service.create({
        maxPerPaymentRaw: "10",
        cumulativeBudgetRaw: "10",
        expiryTimestamp: 50_000,
        purpose: "MPP_DIRECT",
        allowedDestinations: [destination],
        allowedOrigins: ["https://paid.example"],
      }, owner.address);
      const second = await service.create({
        maxPerPaymentRaw: "10",
        cumulativeBudgetRaw: "10",
        expiryTimestamp: 50_000,
        purpose: "MPP_DIRECT",
        allowedDestinations: [destination],
        allowedOrigins: ["https://paid.example"],
      }, otherOwner.address);

      assert.deepEqual((await service.listPolicies(owner.address)).map((policy) => policy.id), [first.policy.id]);
      assert.deepEqual((await service.listPolicies(otherOwner.address)).map((policy) => policy.id), [second.policy.id]);

      const ownerApp = createApp({
        serveStaticFallback: false,
        authKv: kv,
        agentService: service,
        protectedSession: async () => ({ address: owner.address }),
      });
      const otherApp = createApp({
        serveStaticFallback: false,
        authKv: kv,
        agentService: service,
        protectedSession: async () => ({ address: otherOwner.address }),
      });
      const ownerList = await ownerApp.request("/api/agent/authorizations");
      assert.equal(ownerList.status, 200);
      assert.deepEqual((await ownerList.json() as any).policies.map((policy: any) => policy.id), [first.policy.id]);
      const otherList = await otherApp.request("/api/agent/authorizations");
      assert.equal(otherList.status, 200);
      assert.deepEqual((await otherList.json() as any).policies.map((policy: any) => policy.id), [second.policy.id]);

      const crossOwnerLedger = await ownerApp.request(`/api/agent/authorizations/${second.policy.id}/payments`);
      assert.equal(crossOwnerLedger.status, 404);
      const unauthenticated = await createApp({ serveStaticFallback: false, agentService: service, protectedSession: async () => undefined }).request("/api/agent/authorizations");
      assert.equal(unauthenticated.status, 401);
    } finally {
      if (previousKey === undefined) delete process.env.REACH_AGENT_ENCRYPTION_KEY;
      else process.env.REACH_AGENT_ENCRYPTION_KEY = previousKey;
    }
  });

  it("cryptographically verifies the owner approval and keeps MPP scopes separate from vault scopes", async () => {
    const previousKey = process.env.REACH_AGENT_ENCRYPTION_KEY;
    process.env.REACH_AGENT_ENCRYPTION_KEY = "44".repeat(32);
    try {
      let onchainChecks = 0;
      const kv = Kv.memory();
      const service = createAgentAuthorizationService(kv, {
        now: () => 1_000,
        verifyOnchainAuthorization: async () => { onchainChecks += 1; },
      });
      const created = await service.create({
        maxPerPaymentRaw: "10",
        cumulativeBudgetRaw: "10",
        expiryTimestamp: 50_000,
        purpose: "MPP_DIRECT",
        allowedDestinations: [destination],
        allowedOrigins: ["https://paid.example"],
      }, owner.address);
      assert.equal(created.policy.purpose, "MPP_DIRECT");
      assert.deepEqual(created.authorization.scopes, [{ address: PATH_USD_ADDRESS, selector: "0xa9059cbb", recipients: [destination] }]);
      await activateMpp(service, created);
      assert.equal(onchainChecks, 1);

      const payment = await service.mppReserve(created.token, {
        amountRaw: "10",
        recipient: destination,
        endpointOrigin: "https://paid.example",
        idempotencyKey: "mpp-1",
        mode: "charge",
      });
      assert.equal(payment.payment.state, "RESERVED");
      assert.deepEqual((await service.listMppPayments(owner.address, created.policy.id))?.payments.map((entry) => entry.idempotencyKey), ["mpp-1"]);
      const ledgerResponse = await createApp({
        serveStaticFallback: false,
        authKv: kv,
        agentService: service,
        protectedSession: async () => ({ address: owner.address }),
      }).request(`/api/agent/authorizations/${created.policy.id}/payments`);
      assert.equal(ledgerResponse.status, 200);
      assert.deepEqual((await ledgerResponse.json() as any).mppPayments.map((entry: any) => entry.idempotencyKey), ["mpp-1"]);
      await assert.rejects(() => service.mppReserve(created.token, {
        amountRaw: "1",
        recipient: destination,
        endpointOrigin: "https://paid.example",
        idempotencyKey: "mpp-2",
        mode: "charge",
      }), /cumulative budget/i);

      const second = await service.create({ maxPerPaymentRaw: "10", cumulativeBudgetRaw: "20", expiryTimestamp: 50_000, purpose: "MPP_DIRECT", allowedDestinations: [destination], allowedOrigins: ["https://paid.example"] }, owner.address);
      const broad = KeyAuthorization.from({
        address: second.policy.agentAddress,
        chainId: BigInt(TEMPO_MODERATO_CHAIN_ID),
        expiry: created.policy.expiryTimestamp,
        type: "secp256k1",
        limits: [{ token: PATH_USD_ADDRESS, limit: 20n }],
        // No selector means any call on pathUSD; it must never be accepted.
        scopes: [{ address: PATH_USD_ADDRESS }],
      });
      const broadSignature = await owner.sign({ hash: KeyAuthorization.getSignPayload(broad) });
      const broadSigned = KeyAuthorization.from(broad, { signature: broadSignature });
      await assert.rejects(() => service.activate(second.policy.id, owner.address, KeyAuthorization.toRpc(broadSigned), owner.address), /scopes|broader/i);

      await service.mppFail(created.token, "mpp-1", "deterministic failure", false);
      await service.revoke(created.policy.id, owner.address);
      await assert.rejects(() => service.mppReserve(created.token, { amountRaw: "1", recipient: destination, endpointOrigin: "https://paid.example", idempotencyKey: "mpp-after-revoke", mode: "charge" }), /revoked/i);
    } finally {
      if (previousKey === undefined) delete process.env.REACH_AGENT_ENCRYPTION_KEY;
      else process.env.REACH_AGENT_ENCRYPTION_KEY = previousKey;
    }
  });

  it("rejects a validly shaped authorization signed by the wrong owner before any onchain activation check", async () => {
    const previousKey = process.env.REACH_AGENT_ENCRYPTION_KEY;
    process.env.REACH_AGENT_ENCRYPTION_KEY = "55".repeat(32);
    try {
      let onchainChecks = 0;
      const service = createAgentAuthorizationService(Kv.memory(), {
        now: () => 1_000,
        verifyOnchainAuthorization: async () => { onchainChecks += 1; },
      });
      const created = await service.create({ maxPerPaymentRaw: "10", cumulativeBudgetRaw: "10", expiryTimestamp: 50_000 }, owner.address);
      const unsigned = KeyAuthorization.from({
        address: created.policy.agentAddress,
        chainId: BigInt(TEMPO_MODERATO_CHAIN_ID),
        expiry: created.policy.expiryTimestamp,
        type: "secp256k1",
        limits: [{ token: PATH_USD_ADDRESS, limit: 10n }],
        scopes: [
          { address: PATH_USD_ADDRESS, selector: "0x095ea7b3", recipients: [DEFAULT_VAULT_ADDRESS] },
          { address: DEFAULT_VAULT_ADDRESS, selector: "0x28e47b74" },
        ],
      });
      const wrongOwner = privateKeyToAccount("0x8b3a350cf5c34c9194ca3b3e6e5cfc2a7eb5f7dc7d4e0d3a9f9a0b9c8d7e6f5a");
      const signed = KeyAuthorization.from(unsigned, { signature: await wrongOwner.sign({ hash: KeyAuthorization.getSignPayload(unsigned) }) });
      await assert.rejects(() => service.activate(created.policy.id, owner.address, KeyAuthorization.toRpc(signed), owner.address), /signature/i);
      assert.equal(onchainChecks, 0);
    } finally {
      if (previousKey === undefined) delete process.env.REACH_AGENT_ENCRYPTION_KEY;
      else process.env.REACH_AGENT_ENCRYPTION_KEY = previousKey;
    }
  });

  it("holds ambiguous MPP budget until an authoritative receipt resolves it exactly once", async () => {
    const previousKey = process.env.REACH_AGENT_ENCRYPTION_KEY;
    process.env.REACH_AGENT_ENCRYPTION_KEY = "66".repeat(32);
    try {
      const service = createAgentAuthorizationService(Kv.memory(), {
        now: () => 1_000,
        verifyOnchainAuthorization: async () => {},
        readMppReceipt: async () => ({ status: "success", method: "tempo", reference: "0x" + "ab".repeat(32) }),
      });
      const created = await service.create({ maxPerPaymentRaw: "5", cumulativeBudgetRaw: "5", expiryTimestamp: 50_000, purpose: "MPP_DIRECT", allowedDestinations: [destination], allowedOrigins: ["https://paid.example"] }, owner.address);
      await activateMpp(service, created);
      await service.mppReserve(created.token, { amountRaw: "5", recipient: destination, endpointOrigin: "https://paid.example", idempotencyKey: "mpp-unknown", mode: "charge" });
      const reference = ("0x" + "cd".repeat(32)) as `0x${string}`;
      await service.mppFail(created.token, "mpp-unknown", "response lost after broadcast", true, reference);
      assert.equal((await service.getMppPayment(created.token, "mpp-unknown")).payment.reference, reference);
      await assert.rejects(() => service.mppReserve(created.token, { amountRaw: "1", recipient: destination, endpointOrigin: "https://paid.example", idempotencyKey: "mpp-retry", mode: "charge" }), /cumulative budget/i);
      const reconciled = await Promise.all([
        service.mppReconcile(created.token, "mpp-unknown"),
        service.mppReconcile(created.token, "mpp-unknown"),
      ]);
      assert.equal(reconciled[0].payment.state, "CONFIRMED");
      assert.equal(reconciled[1].payment.state, "CONFIRMED");
      const policy = await service.readPolicy(created.policy.id);
      assert.equal(policy?.reservedRaw, "0");
      assert.equal(policy?.spentRaw, "5");
    } finally {
      if (previousKey === undefined) delete process.env.REACH_AGENT_ENCRYPTION_KEY;
      else process.env.REACH_AGENT_ENCRYPTION_KEY = previousKey;
    }
  });
});
