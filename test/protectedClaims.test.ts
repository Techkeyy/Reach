import assert from "node:assert/strict";
import test from "node:test";
import { Kv } from "accounts/server";
import { privateKeyToAccount } from "viem/accounts";
import { createProtectedClaimService, type ProtectedClaimProvider } from "../src/server/protectedClaims.js";
import { createProtectedShares, reconstructProtectedPrivateKey, signProtectedChallenge } from "../src/client/protectedClaims.js";

const encryptionKey = "11".repeat(32);
const sender = privateKeyToAccount(`0x${"22".repeat(32)}`).address;
const claimKey = `0x${"33".repeat(32)}` as `0x${string}`;
const claimSigner = privateKeyToAccount(claimKey).address;
const payout = { status: 1, amount: 50_000n, expiresAt: BigInt(Math.floor(Date.now() / 1000) + 3600), claimSigner };

function providerFixture() {
  const calls: string[] = [];
  const provider: ProtectedClaimProvider = {
    async sendVerificationCode(input) { calls.push(`send:${input.channel}:${input.recipient}`); },
    async verifyCode(input) { calls.push(`verify:${input.channel}:${input.recipient}:${input.code}`); return input.code === "123456"; },
  };
  return { provider, calls };
}

async function registered() {
  const kv = Kv.memory();
  const fixture = providerFixture();
  const service = createProtectedClaimService({ kv, encryptionKey, provider: fixture.provider });
  const shares = createProtectedShares(claimKey);
  await service.register({
    payoutId: "42",
    sender,
    claimSigner,
    channel: "EMAIL",
    recipient: "Recipient@Example.com",
    shareB: shares.shareB,
    shareAProofAddress: shares.shareAProofAddress,
  });
  return { kv, fixture, service, shares };
}

test("protected success requires link proof and channel verification, then releases B once", async () => {
  const { service, fixture, shares } = await registered();
  const session = { address: privateKeyToAccount(`0x${"44".repeat(32)}`).address };
  const begun = await service.begin({ payoutId: "42", payout, session });
  const proof = await signProtectedChallenge(shares.shareA, begun.challenge);
  const proved = await service.proveLink({ payoutId: "42", flowId: begun.flowId, session, proof });
  assert.match(proved.maskedRecipient, /^r•••@example\.com$/);
  assert.equal(fixture.calls.length, 1);
  const grant = await service.verifyCode({ payoutId: "42", flowId: begun.flowId, session, code: "123456" });
  const released = await service.releaseShare({ payoutId: "42", payout, grantToken: grant.grantToken, session });
  assert.equal(reconstructProtectedPrivateKey(shares.shareA, released.shareB).toLowerCase(), claimKey.toLowerCase());
  await assert.rejects(() => service.releaseShare({ payoutId: "42", payout, grantToken: grant.grantToken, session }), /verification grant expired/);
});

test("stolen link and channel-only attacker cannot obtain B", async () => {
  const { service, shares } = await registered();
  const session = { address: privateKeyToAccount(`0x${"55".repeat(32)}`).address };
  const begun = await service.begin({ payoutId: "42", payout, session });
  const wrongA = createProtectedShares(`0x${"66".repeat(32)}`).shareA;
  const wrongProof = await signProtectedChallenge(wrongA, begun.challenge);
  await assert.rejects(() => service.proveLink({ payoutId: "42", flowId: begun.flowId, session, proof: wrongProof }), /claim link verification failed/);
  await assert.rejects(() => service.releaseShare({ payoutId: "42", payout, grantToken: "A".repeat(43), session }), /verification grant expired/);
  assert.notEqual(shares.shareAProofAddress.toLowerCase(), session.address.toLowerCase());
});

test("wrong OTP increments attempts and never releases a grant", async () => {
  const { service, shares } = await registered();
  const session = { address: privateKeyToAccount(`0x${"77".repeat(32)}`).address };
  const begun = await service.begin({ payoutId: "42", payout, session });
  const proof = await signProtectedChallenge(shares.shareA, begun.challenge);
  await service.proveLink({ payoutId: "42", flowId: begun.flowId, session, proof });
  for (let i = 0; i < 5; i += 1) await assert.rejects(() => service.verifyCode({ payoutId: "42", flowId: begun.flowId, session, code: "000000" }), /verification code is invalid or expired/);
  await assert.rejects(() => service.verifyCode({ payoutId: "42", flowId: begun.flowId, session, code: "123456" }), /verification code is invalid or expired/);
});

test("protected verification is bound to one session and expired payouts cannot release B", async () => {
  const { service, shares } = await registered();
  const session = { address: privateKeyToAccount(`0x${"88".repeat(32)}`).address };
  const other = { address: privateKeyToAccount(`0x${"99".repeat(32)}`).address };
  const begun = await service.begin({ payoutId: "42", payout, session });
  const proof = await signProtectedChallenge(shares.shareA, begun.challenge);
  await service.proveLink({ payoutId: "42", flowId: begun.flowId, session, proof });
  const grant = await service.verifyCode({ payoutId: "42", flowId: begun.flowId, session, code: "123456" });
  await assert.rejects(() => service.releaseShare({ payoutId: "42", payout, grantToken: grant.grantToken, session: other }), /verification grant expired/);
  const expired = { ...payout, expiresAt: BigInt(Math.floor(Date.now() / 1000) - 1) };
  await assert.rejects(() => service.releaseShare({ payoutId: "42", payout: expired, grantToken: grant.grantToken, session }), /payout has expired/);
});

test("only one active verification flow can be created concurrently", async () => {
  const { service } = await registered();
  const first = { address: privateKeyToAccount(`0x${"ab".repeat(32)}`).address };
  const second = { address: privateKeyToAccount(`0x${"bc".repeat(32)}`).address };
  const results = await Promise.allSettled([
    service.begin({ payoutId: "42", payout, session: first }),
    service.begin({ payoutId: "42", payout, session: second }),
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.filter(result => result.status === "rejected").length, 1);
  assert.match((results.find(result => result.status === "rejected") as PromiseRejectedResult).reason.message, /verification already in progress/);
});

test("encrypted record contains neither raw B nor raw recipient, and corrupted B fails closed", async () => {
  const { kv, service, shares } = await registered();
  const stored = await kv.get<unknown>("protected:claim:42");
  const serialized = JSON.stringify(stored);
  assert.equal(serialized.includes(shares.shareB.slice(2)), false);
  assert.equal(serialized.includes("recipient@example.com"), false);
  const session = { address: privateKeyToAccount(`0x${"aa".repeat(32)}`).address };
  const begun = await service.begin({ payoutId: "42", payout, session });
  const proof = await signProtectedChallenge(shares.shareA, begun.challenge);
  await service.proveLink({ payoutId: "42", flowId: begun.flowId, session, proof });
  const grant = await service.verifyCode({ payoutId: "42", flowId: begun.flowId, session, code: "123456" });
  await kv.set("protected:claim:42", { ...(stored as any), encryptedShareB: "v1.000000000000000000000000.00000000000000000000000000000000000.deadbeef" });
  await assert.rejects(() => service.releaseShare({ payoutId: "42", payout, grantToken: grant.grantToken, session }));
});
