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

async function registered(options: { now?: () => number } = {}) {
  const kv = Kv.memory();
  const fixture = providerFixture();
  const service = createProtectedClaimService({ kv, encryptionKey, provider: fixture.provider, ...options });
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

test("a successful link proof cannot be replayed on the same flow", async () => {
  const { service, fixture, shares } = await registered();
  const session = { address: privateKeyToAccount(`0x${"45".repeat(32)}`).address };
  const begun = await service.begin({ payoutId: "42", payout, session });
  const proof = await signProtectedChallenge(shares.shareA, begun.challenge);
  await service.proveLink({ payoutId: "42", flowId: begun.flowId, session, proof });
  await assert.rejects(() => service.proveLink({ payoutId: "42", flowId: begun.flowId, session, proof }), /proof already used/);
  assert.equal(fixture.calls.filter(call => call.startsWith("send:")).length, 1);
});

test("a proof from payout X cannot be used for payout Y", async () => {
  const { service, shares } = await registered();
  const claimKeyY = `0x${"44".repeat(32)}` as `0x${string}`;
  const claimSignerY = privateKeyToAccount(claimKeyY).address;
  const sharesY = createProtectedShares(claimKeyY);
  await service.register({
    payoutId: "43",
    sender,
    claimSigner: claimSignerY,
    channel: "EMAIL",
    recipient: "other@example.com",
    shareB: sharesY.shareB,
    shareAProofAddress: sharesY.shareAProofAddress,
  });
  const session = { address: privateKeyToAccount(`0x${"46".repeat(32)}`).address };
  const flowX = await service.begin({ payoutId: "42", payout, session });
  const flowY = await service.begin({ payoutId: "43", payout: { ...payout, claimSigner: claimSignerY }, session });
  const proofX = await signProtectedChallenge(shares.shareA, flowX.challenge);
  await assert.rejects(() => service.proveLink({ payoutId: "43", flowId: flowY.flowId, session, proof: proofX }), /claim link verification failed/);
});

test("a proof from session X cannot be used for session Y", async () => {
  const { service, shares } = await registered();
  const sessionX = { address: privateKeyToAccount(`0x${"47".repeat(32)}`).address };
  const sessionY = { address: privateKeyToAccount(`0x${"48".repeat(32)}`).address };
  const begun = await service.begin({ payoutId: "42", payout, session: sessionX });
  const proof = await signProtectedChallenge(shares.shareA, begun.challenge);
  await assert.rejects(() => service.proveLink({ payoutId: "42", flowId: begun.flowId, session: sessionY, proof }), /verification session expired/);
});

test("expired and modified challenges cannot prove link possession", async () => {
  let clock = Date.now();
  const { service, shares } = await registered({ now: () => clock });
  const session = { address: privateKeyToAccount(`0x${"49".repeat(32)}`).address };
  const begun = await service.begin({ payoutId: "42", payout, session });
  const modifiedProof = await signProtectedChallenge(shares.shareA, `${begun.challenge}-modified`);
  await assert.rejects(() => service.proveLink({ payoutId: "42", flowId: begun.flowId, session, proof: modifiedProof }), /claim link verification failed/);
  clock += 10 * 60 * 1000 + 1;
  const expiredProof = await signProtectedChallenge(shares.shareA, begun.challenge);
  await assert.rejects(() => service.proveLink({ payoutId: "42", flowId: begun.flowId, session, proof: expiredProof }), /verification session expired/);
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

test("a stolen database record without A cannot prove possession or obtain B", async () => {
  const { kv, service, fixture, shares } = await registered();
  const stored = await kv.get<Record<string, unknown>>("protected:claim:42");
  assert.ok(stored);
  assert.equal("shareA" in stored, false);
  assert.equal(JSON.stringify(stored).includes(shares.shareAFragment), false);
  const session = { address: privateKeyToAccount(`0x${"ad".repeat(32)}`).address };
  const begun = await service.begin({ payoutId: "42", payout, session });
  const attackerProof = await signProtectedChallenge(createProtectedShares(`0x${"ae".repeat(32)}`).shareA, begun.challenge);
  await assert.rejects(() => service.proveLink({ payoutId: "42", flowId: begun.flowId, session, proof: attackerProof }), /claim link verification failed/);
  assert.equal(fixture.calls.length, 0);
});
