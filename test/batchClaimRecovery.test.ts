import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { privateKeyToAccount } from "viem/accounts";
import { recoverClaimLink, rememberCapability } from "../src/client/claimCapability";
import PayoutDetail from "../src/client/PayoutDetail";
import { readSenderPayouts, rememberSenderPayout, type SenderPayoutRecord } from "../src/client/senderStorage";
import { mergeSenderPayouts } from "../src/client/senderRecovery";
import type { LivePayout } from "../src/client/payoutLifecycle";

const sender = "0x1111111111111111111111111111111111111111";
const zero = "0x0000000000000000000000000000000000000000";
const privateKey = `0x${"11".repeat(32)}` as `0x${string}`;
const claimSigner = privateKeyToAccount(privateKey).address;
const payoutId = "42";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => { values.clear(); },
  };
}

const storage = memoryStorage();
Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: storage });
Object.defineProperty(globalThis, "window", { configurable: true, value: {
  sessionStorage: storage,
  localStorage: storage,
  location: { origin: "http://localhost:5173" },
} });

const baseRecord: SenderPayoutRecord = {
  id: payoutId,
  amount: "1000000",
  expiresAt: "2000",
  claimSigner,
  batchId: "batch:42,43,44",
  recipientName: "Alex Rivera",
  memo: "Design bounty",
  label: "Design bounty",
  createdAt: "2026-10-01T00:00:00.000Z",
  submissionState: "CONFIRMED",
};

const live: LivePayout = {
  sender,
  amount: baseRecord.amount,
  expiresAt: 2000n,
  claimSigner,
  status: 1,
  claimant: zero,
  chainTimestamp: 1000n,
};

function detail(record = baseRecord, options: { url?: string | null; livePayout?: LivePayout } = {}) {
  return renderToStaticMarkup(React.createElement(PayoutDetail, {
    record,
    live: options.livePayout ?? live,
    connectedAddress: sender,
    capabilityAvailable: Boolean(options.url),
    recoverableClaimUrl: options.url ?? null,
    onBack: () => {},
    onReturnFunds: async () => {},
    returningFunds: false,
  }));
}

afterEach(() => storage.clear());

test("batch records retain non-secret group metadata and capabilities stay outside public records", () => {
  const raw = Buffer.from(privateKey.slice(2), "hex").toString("base64url");
  rememberCapability(payoutId, raw);
  rememberSenderPayout(baseRecord);
  const stored = readSenderPayouts()[0];
  assert.equal(stored?.batchId, "batch:42,43,44");
  assert.equal(stored?.recipientName, "Alex Rivera");
  assert.equal(stored?.memo, "Design bounty");
  assert.equal(JSON.stringify(stored).includes(raw), false);
  assert.equal(JSON.stringify(stored).includes("privateKey"), false);

  const [merged] = mergeSenderPayouts([stored], [{
    id: payoutId,
    sender,
    amount: stored.amount,
    expiresAt: stored.expiresAt,
    claimSigner,
    status: 1,
    claimant: zero,
  }]);
  assert.equal(merged?.batchId, "batch:42,43,44");
  assert.equal(merged?.recipientName, "Alex Rivera");
  assert.equal(merged?.memo, "Design bounty");
});

test("sender recovery reconstructs the exact compact claim URL from session capability", () => {
  const raw = Buffer.from(privateKey.slice(2), "hex").toString("base64url");
  rememberCapability(payoutId, raw);
  assert.equal(recoverClaimLink(payoutId, "http://localhost:5173"), `http://localhost:5173/c/${Buffer.from(BigInt(payoutId).toString(16).padStart(64, "0"), "hex").toString("base64url")}#cap=${raw}`);
});

test("funded batch detail exposes Copy claim link only to the connected sender", () => {
  const raw = Buffer.from(privateKey.slice(2), "hex").toString("base64url");
  rememberCapability(payoutId, raw);
  const url = recoverClaimLink(payoutId, "http://localhost:5173");
  assert.ok(url);
  const html = detail(baseRecord, { url });
  assert.match(html, /Private claim link ready on this device/);
  assert.match(html, /Copy claim link/);
  assert.doesNotMatch(html, /Private claim link is unavailable on this device/);
});

test("missing capability shows an honest unavailable-device state", () => {
  const html = detail();
  assert.match(html, /Private claim link is unavailable on this device\./);
  assert.doesNotMatch(html, /Copy claim link/);
});

test("expired and terminal payouts never offer a recovered claim action", () => {
  const raw = Buffer.from(privateKey.slice(2), "hex").toString("base64url");
  rememberCapability(payoutId, raw);
  const url = recoverClaimLink(payoutId, "http://localhost:5173");
  assert.ok(url);
  const expired = detail(baseRecord, { url, livePayout: { ...live, chainTimestamp: 2000n } });
  assert.doesNotMatch(expired, /Copy claim link/);
  assert.doesNotMatch(expired, /Private claim link ready on this device/);
  const claimed = detail(baseRecord, { url, livePayout: { ...live, status: 2, claimant: "0x2222222222222222222222222222222222222222" } });
  assert.doesNotMatch(claimed, /Copy claim link/);
  assert.doesNotMatch(claimed, /Private claim link ready on this device/);
});
