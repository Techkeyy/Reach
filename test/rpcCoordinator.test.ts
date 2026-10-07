import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeAbiParameters, encodeFunctionResult, keccak256, toHex } from "viem";
import { createTempoRpcReadCoordinator, RpcAuthorityUnavailableError } from "../src/server/rpcCoordinator";
import { createSessionRefreshGate } from "../src/client/sessionRefresh";
import { createChainClock } from "../src/client/chainTime";
import { BalanceAuthorityError, readAuthoritativeBalanceApi } from "../src/client/balanceRefresh";
import { createApp } from "../src/server/app";
import { PAYOUT_CLAIMED_SIGNATURE, PAYOUT_CREATED_SIGNATURE } from "../src/server/payoutDiscovery";
import { payoutStatus, vaultAbi } from "../src/shared/reach";

const sender = "0x6B6e9e45Cf4bB5CbC7d4a8B19cf3d886369Ff925" as const;

test("RPC coordinator bounds 14 payout reads and deduplicates identical work", async () => {
  let active = 0;
  let maxActive = 0;
  let calls = 0;
  const coordinator = createTempoRpcReadCoordinator({ concurrency: 3, logger: () => {} });
  const values = await Promise.all(Array.from({ length: 14 }, (_, index) => coordinator.read(async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    calls += 1;
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
    active -= 1;
    return index;
  }, { key: `payout:${index}`, kind: "getPayout" })));

  assert.deepEqual(values, Array.from({ length: 14 }, (_, index) => index));
  assert.equal(calls, 14);
  assert.equal(maxActive, 3);
  assert.equal(coordinator.metrics().maxConcurrency, 3);

  let duplicateCalls = 0;
  const duplicate = () => coordinator.read(async () => {
    duplicateCalls += 1;
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
    return "same-result";
  }, { key: "payout:duplicate", kind: "getPayout" });
  const [left, right] = await Promise.all([duplicate(), duplicate()]);
  assert.equal(left, "same-result");
  assert.equal(right, "same-result");
  assert.equal(duplicateCalls, 1);
  assert.equal(coordinator.metrics().dedupHits, 1);
});
test("RPC coordinator bounds 429 retries and opens a circuit for nonessential reads", async () => {
  let clock = 0;
  const delays: number[] = [];
  let calls = 0;
  const coordinator = createTempoRpcReadCoordinator({
    concurrency: 3,
    maxRetries: 1,
    retryBaseMs: 10,
    retryMaxMs: 100,
    retryTotalMs: 100,
    circuitFailureThreshold: 2,
    circuitCooldownMs: 50,
    random: () => 0,
    now: () => clock,
    sleep: async (milliseconds) => { delays.push(milliseconds); clock += milliseconds; },
    logger: () => {},
  });
  let logical = 0;
  const rateLimited = () => coordinator.read(async () => {
    calls += 1;
    const error = Object.assign(new Error("Too Many Requests"), { status: 429 });
    throw error;
  }, { key: `limited:${logical++}`, kind: "getPayout" });

  const results = await Promise.allSettled([rateLimited(), rateLimited()]);
  assert.equal(results.every((result) => result.status === "rejected"), true);
  assert.ok(results.every((result) => result.status === "rejected" && result.reason instanceof RpcAuthorityUnavailableError));
  assert.ok(calls <= 4, `unexpected retry amplification: ${calls}`);
  assert.ok(delays.length <= 2);
  assert.ok(delays.every((delay) => delay >= 10 && delay <= 100));
  assert.ok(coordinator.metrics().rateLimitEvents <= 4);
  assert.ok(coordinator.metrics().retryCount <= 2);
  assert.equal(coordinator.metrics().circuitBreakerOpens, 1);

  let blockedCalls = 0;
  await assert.rejects(
    coordinator.read(async () => { blockedCalls += 1; return true; }, { key: "blocked", kind: "latestBlock" }),
    (error: unknown) => error instanceof RpcAuthorityUnavailableError,
  );
  assert.equal(blockedCalls, 0);

  clock += 50;
  const recovered = await coordinator.read(async () => true, { key: "recovered", kind: "latestBlock" });
  assert.equal(recovered, true);
  assert.equal(coordinator.isCircuitOpen(), false);
});

test("RPC coordinator honors a bounded Retry-After hint", async () => {
  const delays: number[] = [];
  let calls = 0;
  const coordinator = createTempoRpcReadCoordinator({
    maxRetries: 1,
    retryBaseMs: 10,
    retryMaxMs: 100,
    retryTotalMs: 100,
    sleep: async (milliseconds) => { delays.push(milliseconds); },
    random: () => 0,
    logger: () => {},
  });
  const value = await coordinator.read(async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error("rate limited"), { status: 429, retryAfterMs: 25 });
    return "ok";
  }, { key: "retry-after", kind: "latestBlock" });
  assert.equal(value, "ok");
  assert.deepEqual(delays, [25]);
  assert.equal(coordinator.metrics().retryCount, 1);
});

test("session refresh gate shares in-flight Home work, applies focus cooldown, and rejects stale completion", async () => {
  let now = 1_000;
  const gate = createSessionRefreshGate({ cooldownMs: 2_500, now: () => now });
  let runs = 0;
  let resolveFirst!: () => void;
  const first = gate.run("alice", async (isCurrent) => {
    runs += 1;
    await new Promise<void>((resolve) => { resolveFirst = resolve; });
    assert.equal(isCurrent(), true);
    return "first";
  });
  const duplicate = gate.run("alice", async () => { runs += 1; return "duplicate"; });
  assert.equal(first, duplicate);
  assert.equal(runs, 1);
  resolveFirst();
  assert.equal(await first, "first");

  const cooldown = await gate.run("alice", async () => { runs += 1; return "cooldown"; });
  assert.equal(cooldown, undefined);
  assert.equal(runs, 1);

  now += 2_500;
  let resolveOld!: () => void;
  const old = gate.run("alice", async (isCurrent) => {
    await new Promise<void>((resolve) => { resolveOld = resolve; });
    return isCurrent() ? "old-current" : "old-stale";
  }, { force: true });
  const newer = gate.run("bob", async (isCurrent) => isCurrent() ? "new-current" : "new-stale", { force: true });
  assert.equal(await newer, "new-current");
  resolveOld();
  assert.equal(await old, "old-stale");
});

test("chain clock coalesces mount/focus/interval reads and fails closed without browser time", async () => {
  let now = 10_000;
  let reads = 0;
  let chainTimestamp = 500n;
  const clock = createChainClock({
    getBlock: async () => {
      reads += 1;
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
      return { timestamp: chainTimestamp };
    },
  }, 1_000, 2_000, () => now);

  await Promise.all([clock.refresh({ force: true }), clock.refresh({ force: true }), clock.refreshIfFresh()]);
  assert.equal(reads, 1);
  assert.equal(clock.getSnapshot(), 500n);
  await clock.refreshIfFresh();
  assert.equal(reads, 1);
  now += 2_000;
  chainTimestamp = 501n;
  await clock.refreshIfFresh();
  assert.equal(reads, 2);
  assert.equal(clock.getSnapshot(), 501n);
  chainTimestamp = 100n;
  await clock.refresh({ force: true });
  assert.equal(clock.getSnapshot(), 501n);
  await clock.refresh({ force: true });
  // A provider failure clears authority; the lifecycle must render CHECKING,
  // never infer expiry from Date.now().
  chainTimestamp = -1n;
  await clock.refresh({ force: true });
  assert.equal(clock.getSnapshot(), undefined);
});

test("balance API failure stays unavailable without a direct browser RPC fallback", async () => {
  let apiCalls = 0;
  let directRpcCalls = 0;
  await assert.rejects(
    readAuthoritativeBalanceApi(sender, async () => {
      apiCalls += 1;
      return new Response("unavailable", { status: 503 });
    }),
    (error: unknown) => error instanceof BalanceAuthorityError && error.status === 503,
  );
  // There is intentionally no reader callback: failed API authority cannot
  // trigger a second browser-side balanceOf request.
  assert.equal(apiCalls, 1);
  assert.equal(directRpcCalls, 0);
});

// Keep the event encoding close to the route tests below so a future fixture
// can reuse it without pulling production indexer parsing into the test.
export const payoutCreatedSelector = keccak256(toHex("PayoutCreated(uint256,address,uint256,uint64,address,bytes32)"));
export const payoutCreatedData = (amount: bigint, expiresAt: bigint, claimSigner: `0x${string}`) => encodeAbiParameters(
  [{ type: "uint256" }, { type: "uint64" }, { type: "address" }],
  [amount, expiresAt, claimSigner],
);
export const senderTopic = `0x${sender.slice(2).toLowerCase().padStart(64, "0")}`;
export const payoutIdTopic = (id: string) => `0x${BigInt(id).toString(16).padStart(64, "0")}`;
export const payoutWire = (senderAddress: `0x${string}`, amount: bigint, expiresAt: bigint, claimSigner: `0x${string}`, status: number) => encodeFunctionResult({
  abi: vaultAbi,
  functionName: "getPayout",
  result: [senderAddress, amount, expiresAt, claimSigner, status, "0x0000000000000000000000000000000000000000"],
});

function rpcResponse(id: number, result: unknown) {
  return Response.json({ jsonrpc: "2.0", id, result });
}

function createdRows(count: number) {
  const claimSigner = "0x177DFAeF587815bE56356343ca46a3987133Ea4d" as const;
  return Array.from({ length: count }, (_, index) => {
    const id = String(index + 1);
    return [
      10_000 + index,
      "2026-10-07T00:00:00.000Z",
      `0x${String(index + 1).padStart(64, "0")}`,
      payoutCreatedSelector,
      payoutIdTopic(id),
      senderTopic,
      payoutCreatedData(1_000n + BigInt(index), 2_000n + BigInt(index), claimSigner),
    ];
  });
}

test("/api/payouts preserves all discovered rows when one vault read is unavailable", async () => {
  const originalFetch = globalThis.fetch;
  let active = 0;
  let maxActive = 0;
  let payoutReads = 0;
  const failingId = "7";
  const rows = createdRows(14);
  const coordinator = createTempoRpcReadCoordinator({ concurrency: 3, maxRetries: 0, logger: () => {} });
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("indexer.testnet.tempo.xyz")) {
      return Response.json({
        columns: ["block_num", "block_timestamp", "tx_hash", "selector", "topic1", "topic2", "data"],
        rows,
      });
    }
    const body = JSON.parse(String(init?.body)) as { id: number; method: string; params?: Array<{ data?: string }> };
    if (body.method !== "eth_call") throw new Error(`unexpected ${body.method}`);
    const id = BigInt(`0x${body.params?.[0]?.data?.slice(-64) ?? "0"}`).toString();
    if (id === failingId) return new Response("rate limited", { status: 429 });
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
    active -= 1;
    payoutReads += 1;
    return rpcResponse(body.id, payoutWire(sender, 1_000n + BigInt(id) - 1n, 2_000n + BigInt(id) - 1n, "0x177DFAeF587815bE56356343ca46a3987133Ea4d", payoutStatus.FUNDED));
  };
  try {
    const response = await createApp({ serveStaticFallback: false, rpcCoordinator: coordinator }).request(`/api/payouts/${sender}`);
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.payouts.length, 14);
    assert.equal(body.authorityIncomplete, true);
    assert.equal(body.unresolvedCount, 1);
    assert.equal(body.payouts.find((payout: any) => payout.id === failingId).authorityUnavailable, true);
    assert.equal(body.payouts.find((payout: any) => payout.id === failingId).status, payoutStatus.NONE);
    assert.equal(body.payouts.find((payout: any) => payout.id === "1").status, payoutStatus.FUNDED);
    assert.ok(maxActive <= 3);
    assert.equal(payoutReads, 13);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("/api/activity deduplicates overlapping discovery IDs and reads chain time once", async () => {
  const originalFetch = globalThis.fetch;
  const id = "42";
  const claimSigner = "0x177DFAeF587815bE56356343ca46a3987133Ea4d" as const;
  const claimRecipientTopic = senderTopic;
  const created = createdRows(1).map((row) => [...row.slice(0, 4), payoutIdTopic(id), row[5], payoutCreatedData(2_000n, 2_000n, claimSigner)]);
  const claimed = [[
    11_000,
    "2026-10-07T00:01:00.000Z",
    `0x${"b".repeat(64)}`,
    keccak256(toHex("PayoutClaimed(uint256,address,uint256,bytes32)")),
    payoutIdTopic(id),
    claimRecipientTopic,
    encodeAbiParameters([{ type: "uint256" }], [2_000n]),
  ]];
  let payoutReads = 0;
  let blockReads = 0;
  const coordinator = createTempoRpcReadCoordinator({ concurrency: 3, maxRetries: 0, logger: () => {} });
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "indexer.testnet.tempo.xyz") {
      const signature = url.searchParams.get("signature");
      return Response.json({
        columns: ["block_num", "block_timestamp", "tx_hash", "selector", "topic1", "topic2", "data"],
        rows: signature === PAYOUT_CLAIMED_SIGNATURE ? claimed : created,
      });
    }
    const body = JSON.parse(String(init?.body)) as { id: number; method: string };
    if (body.method === "eth_getBlockByNumber") {
      blockReads += 1;
      return rpcResponse(body.id, { timestamp: "0x64", transactions: [] });
    }
    if (body.method === "eth_call") {
      payoutReads += 1;
      return rpcResponse(body.id, payoutWire(sender, 2_000n, 2_000n, claimSigner, payoutStatus.FUNDED));
    }
    throw new Error(`unexpected ${body.method}`);
  };
  try {
    const response = await createApp({ serveStaticFallback: false, rpcCoordinator: coordinator }).request(`/api/activity/${sender}`);
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.activities.length, 1);
    assert.equal(body.activities[0].payoutId, id);
    assert.equal(body.activities[0].lifecycle, "FUNDED");
    assert.equal(payoutReads, 1);
    assert.equal(blockReads, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
