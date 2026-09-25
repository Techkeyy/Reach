import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, encodeFunctionData } from "viem";
import { claimSignerForCapability, clearCapability, createClaimCapability, recoverCapability, rememberCapability } from "../src/client/claimCapability";
import { createPayoutId, expiryFromNow, failedBalance, fundingAllowed, isReclaimEligible, loadingBalance, parseAuthoritativeBalance, parsePathUsdAmount, publicStatusLabel, readyBalance, resolveFundingStage } from "../src/client/senderFlow";
import { readSenderPayouts, rememberSenderPayout, type SenderPayoutRecord } from "../src/client/senderStorage";
import { DEFAULT_VAULT_ADDRESS, PATH_USD_ADDRESS, PATH_USD_DECIMALS, payoutStatus, pathUsdAbi, vaultAbi } from "../src/shared/reach";
import { preflightFunding, resolveFundingReceipt, toFundingFillRequest } from "../src/client/senderFunding";

test("sender capability generation is 32 random bytes and derives the contract signer", () => { const capability = createClaimCapability((bytes) => bytes.fill(0x2a)); assert.equal(capability.raw.length, 43); assert.match(capability.raw, /^[A-Za-z0-9_-]{43}$/); assert.equal(claimSignerForCapability(capability.privateKey), "0xB0E5863D0DDf7e105e409Fee0eCC0123a362e14B"); });
test("payout ids use a positive 256-bit value", () => { assert.equal(createPayoutId((bytes) => bytes.fill(0)), "1"); assert.equal(createPayoutId((bytes) => bytes.fill(0xff)).length, 78); });
test("pathUSD decimal conversion is exact", () => { assert.equal(parsePathUsdAmount("1").toString(), "1000000"); assert.equal(parsePathUsdAmount("1.2").toString(), "1200000"); assert.equal(parsePathUsdAmount("0.000001").toString(), "1"); for (const value of ["", "0", "-1", "1.0000001", "1e2", " 1"]) assert.throws(() => parsePathUsdAmount(value)); });
test("create/fund calls contain exact approve and createPayout calldata", () => { const amount = parsePathUsdAmount("1.25"); const payoutId = 123456789n; const claimSigner = "0x000000000000000000000000000000000000002A" as const; const expiresAt = 2000000000n; const approve = encodeFunctionData({ abi: pathUsdAbi, functionName: "approve", args: [DEFAULT_VAULT_ADDRESS, amount] }); const create = encodeFunctionData({ abi: vaultAbi, functionName: "createPayout", args: [payoutId, amount, claimSigner, expiresAt] }); const decodedApprove = decodeFunctionData({ abi: pathUsdAbi, data: approve }); const decodedCreate = decodeFunctionData({ abi: vaultAbi, data: create }); assert.equal(String(decodedApprove.args?.[0]).toLowerCase(), DEFAULT_VAULT_ADDRESS.toLowerCase()); assert.equal(decodedApprove.args?.[1], amount); assert.equal(decodedCreate.args?.[0], payoutId); assert.equal(decodedCreate.args?.[1], amount); assert.equal(String(decodedCreate.args?.[2]).toLowerCase(), claimSigner.toLowerCase()); assert.equal(decodedCreate.args?.[3], expiresAt); assert.equal(PATH_USD_ADDRESS, "0x20c0000000000000000000000000000000000000"); assert.equal(PATH_USD_DECIMALS, 6); });
test("expiry validation and reclaim boundaries are sender-only", () => { assert.equal(expiryFromNow(1000, 3600), 4600n); assert.throws(() => expiryFromNow(1000, 0)); const sender = "0xAbc0000000000000000000000000000000000001"; assert.equal(isReclaimEligible(payoutStatus.FUNDED, 1000n, 999n, sender, sender), false); assert.equal(isReclaimEligible(payoutStatus.FUNDED, 1000n, 1000n, sender, sender.toLowerCase()), true); assert.equal(isReclaimEligible(payoutStatus.FUNDED, 1000n, 1000n, sender, "0x0000000000000000000000000000000000000002"), false); assert.equal(isReclaimEligible(payoutStatus.CLAIMED, 1000n, 1001n, sender, sender), false); assert.equal(isReclaimEligible(payoutStatus.RECLAIMED, 1000n, 1001n, sender, sender), false); assert.equal(publicStatusLabel(payoutStatus.FUNDED, 1000n, 1000n), "EXPIRED - RECLAIM AVAILABLE"); assert.equal(publicStatusLabel(payoutStatus.CLAIMED, 1000n, 1001n), "CLAIMED"); assert.equal(publicStatusLabel(payoutStatus.RECLAIMED, 1000n, 1001n), "RECLAIMED"); });
test("funding is not marked funded before authoritative confirmation", () => { assert.equal(resolveFundingStage({ onchainStatus: undefined, transactionSubmitted: true, failed: false }), "CONFIRMING"); assert.equal(resolveFundingStage({ onchainStatus: payoutStatus.FUNDED, transactionSubmitted: true, failed: false }), "FUNDED"); assert.equal(resolveFundingStage({ onchainStatus: undefined, transactionSubmitted: true, failed: true }), "FAILED_RETRYABLE"); assert.equal(resolveFundingStage({ onchainStatus: undefined, transactionSubmitted: true, failed: false, recoveryRequired: true }), "RECOVERY_REQUIRED"); });
test("refreshable sender index keeps only public data and no bearer capability", () => { const values = new Map<string, string>(); Object.defineProperty(globalThis, "window", { configurable: true, value: { sessionStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } } } }); const capability = createClaimCapability((bytes) => bytes.fill(0x2a)); const record: SenderPayoutRecord = { id: "42", amount: "1000000", expiresAt: "2000000000", claimSigner: claimSignerForCapability(capability.privateKey), createdAt: "2026-09-23T00:00:00.000Z" }; rememberSenderPayout(record); const serialized = values.get("reach.sender.payouts") ?? ""; assert.equal(serialized.includes(capability.raw), false); assert.deepEqual(readSenderPayouts(), [record]); });

test("pending balance keeps funding unavailable", () => { const balance = loadingBalance(); assert.equal(balance.status, "LOADING"); assert.equal(balance.balance, null); assert.equal(fundingAllowed(balance, 1n), false); });
test("successful balance is authoritative and uses exact base units", () => { const balance = readyBalance("1000000"); assert.equal(balance.status, "READY"); assert.equal(balance.balance, "1000000"); assert.equal(fundingAllowed(balance, 1000000n), true); assert.equal(fundingAllowed(balance, 1000001n), false); });
test("HTTP 502 becomes an explicit unavailable state and cannot authorize a transaction", () => { const balance = failedBalance("We couldn't read your Tempo balance.", 502); assert.equal(balance.status, "ERROR"); assert.equal(balance.httpStatus, 502); assert.equal(balance.error, "We couldn't read your Tempo balance."); assert.equal(fundingAllowed(balance, 1n), false); });
test("retry transitions from error through loading to ready", () => { const failed = failedBalance("We couldn't read your Tempo balance.", 502); const loading = loadingBalance(); const ready = readyBalance("1000000"); assert.equal(failed.status, "ERROR"); assert.equal(loading.status, "LOADING"); assert.equal(ready.status, "READY"); assert.equal(fundingAllowed(ready, 1000000n), true); });
test("insufficient balance is blocked before funding", () => { const balance = readyBalance("1000000"); assert.equal(fundingAllowed(balance, parsePathUsdAmount("1.000001")), false); });
test("malformed balance response becomes a safe error without rendering or funding", () => { assert.throws(() => parseAuthoritativeBalance({ balance: 1000000 })); assert.throws(() => parseAuthoritativeBalance({ balance: "1.0" })); assert.throws(() => parseAuthoritativeBalance({})); const balance = failedBalance("We couldn't read your Tempo balance."); assert.equal(balance.status, "ERROR"); assert.equal(fundingAllowed(balance, 1n), false); });
test("A — full-balance fill fails before any signing or submission", async () => {
  const sender = "0xAF75774194AbeEC3A0D86693d8A7bC1139311061" as const;
  let fillCalls = 0;
  let signCalls = 0;
  const result = await preflightFunding({ request: async () => { fillCalls += 1; throw new Error("execution reverted 0x045c4b02 TokenTransferFailed()"); } }, toFundingFillRequest(sender, []));
  if (result.ok) signCalls += 1;
  assert.equal(fillCalls, 1);
  assert.equal(signCalls, 0);
  assert.equal(result.ok, false);
  assert.match("message" in result ? result.message : "", /exceeds your available balance/);
});

test("B — affordable fill reaches READY_TO_SIGN without signing", async () => {
  const sender = "0xAF75774194AbeEC3A0D86693d8A7bC1139311061" as const;
  const result = await preflightFunding({ request: async ({ method }) => { assert.equal(method, "eth_fillTransaction"); return { tx: { type: "0x76", calls: [] } }; } }, toFundingFillRequest(sender, []));
  assert.equal(result.ok, true);
});

test("C — preflight success is not FUNDED", () => {
  const expected = { sender: "0x0000000000000000000000000000000000000001", amount: "100000", expiresAt: "2000000000", claimSigner: "0x0000000000000000000000000000000000000002" };
  assert.equal(resolveFundingReceipt({ receiptStatus: "success", expected }), "RECOVERY_REQUIRED");
});

test("D — reverted receipt is retryable and has no claim link outcome", () => {
  const expected = { sender: "0x0000000000000000000000000000000000000001", amount: "100000", expiresAt: "2000000000", claimSigner: "0x0000000000000000000000000000000000000002" };
  assert.equal(resolveFundingReceipt({ receiptStatus: "reverted", expected }), "FAILED_RETRYABLE");
});

test("E — successful receipt with mismatched payout requires recovery", () => {
  const expected = { sender: "0x0000000000000000000000000000000000000001", amount: "100000", expiresAt: "2000000000", claimSigner: "0x0000000000000000000000000000000000000002" };
  assert.equal(resolveFundingReceipt({ receiptStatus: "success", expected, payout: { ...expected, amount: "99999", status: 1 } }), "RECOVERY_REQUIRED");
});

test("F — successful receipt plus exact authoritative payout is FUNDED", () => {
  const expected = { sender: "0x0000000000000000000000000000000000000001", amount: "100000", expiresAt: "2000000000", claimSigner: "0x0000000000000000000000000000000000000002" };
  assert.equal(resolveFundingReceipt({ receiptStatus: "success", expected, payout: { ...expected, status: 1 } }), "FUNDED");
});

test("G/H — failed artifact remains public metadata while capability is cleared", () => {
  const values = new Map<string, string>();
  const session = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: session });
  const capability = createClaimCapability((bytes) => bytes.fill(0x2a));
  const id = "failed-artifact";
  rememberCapability(id, capability.raw);
  assert.ok(recoverCapability(id));
  clearCapability(id);
  assert.equal(recoverCapability(id), null);
  const failed = { id, amount: "1000000", expiresAt: "2000000000", claimSigner: claimSignerForCapability(capability.privateKey), createdAt: "2026-09-24T00:00:00.000Z", fundingTxHash: "0xreceipt", outcome: "FAILED" as const, failureMessage: "Funding failed. No payout was created." };
  rememberSenderPayout(failed);
  assert.deepEqual(readSenderPayouts()[0], failed);
});

test("I — receipt resolution is deterministic after refresh and never invents a funded payout", () => {
  const expected = { sender: "0x0000000000000000000000000000000000000001", amount: "100000", expiresAt: "2000000000", claimSigner: "0x0000000000000000000000000000000000000002" };
  assert.equal(resolveFundingReceipt({ receiptStatus: "success", expected, payout: undefined }), "RECOVERY_REQUIRED");
  assert.equal(resolveFundingReceipt({ receiptStatus: "reverted", expected, payout: undefined }), "FAILED_RETRYABLE");
});

test("J — fill request preserves exact BigInt call values and sender-pays flags", () => {
  const sender = "0xAF75774194AbeEC3A0D86693d8A7bC1139311061" as const;
  const request = toFundingFillRequest(sender, [{ to: PATH_USD_ADDRESS, data: "0x1234", value: 1000000n }]);
  assert.equal(request.from, sender);
  assert.equal(request.chainId, "0xa5bf");
  assert.equal(request.feePayer, false);
  assert.equal(request.keyType, "webAuthn");
  assert.equal(request.calls[0]?.value, "0xf4240");
});
