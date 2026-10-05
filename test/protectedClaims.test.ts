import assert from "node:assert/strict";
import test from "node:test";
import { Kv } from "accounts/server";
import { privateKeyToAccount } from "viem/accounts";
import { createBrevoEmailProvider, createProtectedClaimService, createTwilioVerifyProvider, type ProtectedClaimProvider } from "../src/server/protectedClaims.js";
import { createProtectedShares, reconstructProtectedPrivateKey, signProtectedChallenge } from "../src/client/protectedClaims.js";

const encryptionKey = "11".repeat(32);
const sender = privateKeyToAccount(`0x${"22".repeat(32)}`).address;
const claimKey = `0x${"33".repeat(32)}` as `0x${string}`;
const claimSigner = privateKeyToAccount(claimKey).address;
const payout = { status: 1, amount: 50_000n, expiresAt: BigInt(Math.floor(Date.now() / 1000) + 3600), claimSigner };

function providerFixture() {
  const calls: string[] = [];
  const provider: ProtectedClaimProvider = {
    async sendVerificationCode(input) { calls.push(`send:${input.channel}:${input.recipient}:${input.code ?? ""}`); },
    async verifyCode(input) { calls.push(`verify:${input.channel}:${input.recipient}:${input.code}`); return input.code === "123456"; },
  };
  return { provider, calls };
}

async function registered(options: { now?: () => number; generateOtp?: () => string; secureOtp?: boolean } = {}) {
  const kv = Kv.memory();
  const fixture = providerFixture();
  const { secureOtp, ...serviceOptions } = options;
  const service = createProtectedClaimService({ kv, encryptionKey, provider: fixture.provider, ...(secureOtp ? {} : { generateOtp: options.generateOtp ?? (() => "123456") }), ...serviceOptions });
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

test("production email OTP is six-digit, bound, and never persisted in plaintext", async () => {
  const { kv, service, fixture, shares } = await registered({ secureOtp: true });
  const session = { address: privateKeyToAccount(`0x${"af".repeat(32)}`).address };
  const begun = await service.begin({ payoutId: "42", payout, session });
  const proof = await signProtectedChallenge(shares.shareA, begun.challenge);
  await service.proveLink({ payoutId: "42", flowId: begun.flowId, session, proof });
  const sent = fixture.calls.find(call => call.startsWith("send:EMAIL:"));
  assert.ok(sent);
  const code = sent.split(":").at(-1)!;
  assert.match(code, /^[0-9]{6}$/);
  const flow = await kv.get<Record<string, unknown>>(`protected:flow:${begun.flowId}`);
  assert.ok(flow);
  assert.equal("code" in flow, false);
  assert.equal(JSON.stringify(flow).includes(code), false);
  assert.match(String(flow.otpVerifier), /^[0-9a-f]{64}$/);
  assert.equal(typeof flow.otpExpiresAt, "number");
  await assert.rejects(() => service.verifyCode({ payoutId: "42", flowId: begun.flowId, session, code: "000000" }), /verification code is invalid or expired/);
});

test("email OTP accepts the generated code locally and binds it to the session and payout", async () => {
  const { service, fixture, shares } = await registered({ generateOtp: () => "654321" });
  const session = { address: privateKeyToAccount(`0x${"b1".repeat(32)}`).address };
  const other = { address: privateKeyToAccount(`0x${"b2".repeat(32)}`).address };
  const begun = await service.begin({ payoutId: "42", payout, session });
  const proof = await signProtectedChallenge(shares.shareA, begun.challenge);
  await service.proveLink({ payoutId: "42", flowId: begun.flowId, session, proof });
  await assert.rejects(() => service.verifyCode({ payoutId: "42", flowId: begun.flowId, session: other, code: "654321" }), /verification session expired/);
  const grant = await service.verifyCode({ payoutId: "42", flowId: begun.flowId, session, code: "654321" });
  assert.match(grant.grantToken, /^[A-Za-z0-9_-]{40,64}$/);
  assert.equal(fixture.calls.filter(call => call.startsWith("send:")).length, 1);
});

test("email OTP expires, resend invalidates the old code, and cooldown is enforced", async () => {
  let clock = Date.now();
  const codes = ["111111", "222222"];
  const { service, shares } = await registered({ now: () => clock, generateOtp: () => codes.shift()! });
  const session = { address: privateKeyToAccount(`0x${"b3".repeat(32)}`).address };
  const begun = await service.begin({ payoutId: "42", payout, session });
  const proof = await signProtectedChallenge(shares.shareA, begun.challenge);
  await service.proveLink({ payoutId: "42", flowId: begun.flowId, session, proof });
  await assert.rejects(() => service.resend({ payoutId: "42", flowId: begun.flowId, session }), /please wait/);
  clock += OTP_RESEND_COOLDOWN_MS;
  await service.resend({ payoutId: "42", flowId: begun.flowId, session });
  await assert.rejects(() => service.verifyCode({ payoutId: "42", flowId: begun.flowId, session, code: "111111" }), /verification code is invalid or expired/);
  const grant = await service.verifyCode({ payoutId: "42", flowId: begun.flowId, session, code: "222222" });
  assert.ok(grant.grantToken);

  let expiryClock = Date.now();
  const expiry = await registered({ now: () => expiryClock, generateOtp: () => "333333" });
  const expirySession = { address: privateKeyToAccount(`0x${"b4".repeat(32)}`).address };
  const expiryFlow = await expiry.service.begin({ payoutId: "42", payout, session: expirySession });
  const expiryProof = await signProtectedChallenge(expiry.shares.shareA, expiryFlow.challenge);
  await expiry.service.proveLink({ payoutId: "42", flowId: expiryFlow.flowId, session: expirySession, proof: expiryProof });
  expiryClock += 5 * 60 * 1000 + 1;
  await assert.rejects(() => expiry.service.verifyCode({ payoutId: "42", flowId: expiryFlow.flowId, session: expirySession, code: "333333" }), /verification code is invalid or expired/);
});

test("email provider send failures and timeouts fail safely without issuing a verifier", async () => {
  const failingProvider: ProtectedClaimProvider = {
    async sendVerificationCode() { throw new Error("provider detail must not escape"); },
  };
  const failureKv = Kv.memory();
  const failureService = createProtectedClaimService({ kv: failureKv, encryptionKey, provider: failingProvider, generateOtp: () => "123456" });
  const failureShares = createProtectedShares(claimKey);
  await failureService.register({ payoutId: "42", sender, claimSigner, channel: "EMAIL", recipient: "recipient@example.com", shareB: failureShares.shareB, shareAProofAddress: failureShares.shareAProofAddress });
  const failureSession = { address: privateKeyToAccount(`0x${"b5".repeat(32)}`).address };
  const failureFlow = await failureService.begin({ payoutId: "42", payout, session: failureSession });
  const failureProof = await signProtectedChallenge(failureShares.shareA, failureFlow.challenge);
  await assert.rejects(() => failureService.proveLink({ payoutId: "42", flowId: failureFlow.flowId, session: failureSession, proof: failureProof }), /verification email unavailable/);
  const failedStoredFlow = await failureKv.get<Record<string, unknown>>(`protected:flow:${failureFlow.flowId}`);
  assert.equal(failedStoredFlow?.proofVerified, false);
  const timeoutProvider: ProtectedClaimProvider = { async sendVerificationCode() { await new Promise<void>(() => undefined); } };
  const timeoutService = createProtectedClaimService({ kv: Kv.memory(), encryptionKey, provider: timeoutProvider, providerTimeoutMs: 5 });
  await timeoutService.register({ payoutId: "42", sender, claimSigner, channel: "EMAIL", recipient: "recipient@example.com", shareB: failureShares.shareB, shareAProofAddress: failureShares.shareAProofAddress });
  const timeoutSession = { address: privateKeyToAccount(`0x${"b6".repeat(32)}`).address };
  const timeoutFlow = await timeoutService.begin({ payoutId: "42", payout, session: timeoutSession });
  const timeoutProof = await signProtectedChallenge(failureShares.shareA, timeoutFlow.challenge);
  await assert.rejects(() => timeoutService.proveLink({ payoutId: "42", flowId: timeoutFlow.flowId, session: timeoutSession, proof: timeoutProof }), /verification email unavailable/);
});

test("Brevo provider uses server-only credentials and sends no claim material", async () => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; init?: RequestInit } | undefined;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    request = { url: String(url), init };
    return { ok: true } as Response;
  }) as typeof fetch;
  try {
    const provider = createBrevoEmailProvider({ BREVO_API_KEY: "xkeysib-test-only", REACH_PROTECTED_EMAIL_FROM: "Reach <verify@example.com>" });
    assert.ok(provider);
    await provider.sendVerificationCode({ channel: "EMAIL", recipient: "recipient@example.com", code: "123456", payoutId: "42", flowId: "flow" });
    assert.equal(request?.url, "https://api.brevo.com/v3/smtp/email");
    assert.equal(request?.init?.method, "POST");
    const body = JSON.parse(String(request?.init?.body));
    assert.deepEqual(body.sender, { name: "Reach", email: "verify@example.com" });
    assert.deepEqual(body.to, [{ email: "recipient@example.com" }]);
    assert.equal(body.subject, "Your Reach verification code");
    assert.equal("textContent" in body, false);
    assert.equal(body.htmlContent.includes("https://"), false);
    assert.match(body.htmlContent, /123456/);
    assert.equal(body.htmlContent.includes("42"), false);
    assert.equal(JSON.stringify(body).includes("xkeysib-test-only"), false);
    assert.equal(JSON.stringify(body).includes("shareA"), false);
    assert.equal(JSON.stringify(body).includes("shareB"), false);
    const headers = request?.init?.headers as Record<string, string>;
    assert.equal(headers["api-key"], "xkeysib-test-only");
    assert.equal(headers["content-type"], "application/json");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Brevo provider normalizes provider failures without exposing response details", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: false, status: 401, text: async () => "secret Brevo response" }) as Response) as typeof fetch;
  try {
    const provider = createBrevoEmailProvider({ BREVO_API_KEY: "xkeysib-test-only", REACH_PROTECTED_EMAIL_FROM: "verify@example.com" });
    assert.ok(provider);
    await assert.rejects(
      () => provider.sendVerificationCode({ channel: "EMAIL", recipient: "recipient@example.com", code: "123456", payoutId: "42", flowId: "flow" }),
      error => error instanceof Error && error.message === "verification email unavailable" && !error.message.includes("Brevo"),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Brevo provider normalizes timeout failures", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new DOMException("timed out", "TimeoutError"); }) as typeof fetch;
  try {
    const provider = createBrevoEmailProvider({ BREVO_API_KEY: "xkeysib-test-only", REACH_PROTECTED_EMAIL_FROM: "verify@example.com" });
    assert.ok(provider);
    await assert.rejects(
      () => provider.sendVerificationCode({ channel: "EMAIL", recipient: "recipient@example.com", code: "123456", payoutId: "42", flowId: "flow" }),
      error => error instanceof Error && error.message === "verification email unavailable",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Brevo provider is unavailable unless both server-only settings exist", () => {
  assert.equal(createBrevoEmailProvider({ BREVO_API_KEY: "xkeysib-test-only" }), null);
  assert.equal(createBrevoEmailProvider({ REACH_PROTECTED_EMAIL_FROM: "verify@example.com" }), null);
  assert.ok(createBrevoEmailProvider({ BREVO_API_KEY: "xkeysib-test-only", REACH_PROTECTED_EMAIL_FROM: "verify@example.com" }));
});

test("Twilio provider remains SMS-only", async () => {
  const originalFetch = globalThis.fetch;
  let body = "";
  globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
    body = String(init?.body);
    return { ok: true, json: async () => ({ status: "approved" }) } as Response;
  }) as typeof fetch;
  try {
    const provider = createTwilioVerifyProvider({ TWILIO_ACCOUNT_SID: "ACtest", TWILIO_AUTH_TOKEN: "secret", TWILIO_VERIFY_SERVICE_SID: "VAservice" });
    assert.ok(provider);
    await provider.sendVerificationCode({ channel: "SMS", recipient: "+15551234567", payoutId: "42", flowId: "flow" });
    assert.match(body, /Channel=sms/);
    await provider.verifyCode!({ channel: "SMS", recipient: "+15551234567", code: "123456", payoutId: "42", flowId: "flow" });
    assert.match(body, /Code=123456/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const OTP_RESEND_COOLDOWN_MS = 30 * 1000;
