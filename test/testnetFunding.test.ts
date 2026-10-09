import test from "node:test";
import assert from "node:assert/strict";
import { Kv } from "accounts/server";
import { createTestnetFunding, faucetHashes, FundingError, fundingNetworkKey } from "../src/server/testnetFunding";
import { createApp } from "../src/server/app";
const address = "0x1111111111111111111111111111111111111111";
const address2 = "0x2222222222222222222222222222222222222222";
const address3 = "0x3333333333333333333333333333333333333333";
const token = "0x20c0000000000000000000000000000000000000";
const hash = `0x${"ab".repeat(32)}`;
function harness(overrides: Record<string, unknown> = {}) {
  const calls: { url: string; method: string; params: any[] }[] = [];
  let reads = 0, time = 1000;
  const kv = Kv.memory();
  const fetchMock: typeof fetch = async (input, init) => {
    const { method, params } = JSON.parse(init!.body as string);
    calls.push({ url: String(input), method, params });
    if (overrides.throw) throw Error("private upstream failure");
    if (overrides.http) return new Response("", { status: Number(overrides.http) });
    const results = { eth_chainId: "0xa5bf", eth_call: `0x${(method === "eth_call" && ++reads > 1 ? 1000000n : 0n).toString(16).padStart(64, "0")}`, tempo_fundAddress: [hash], eth_getTransactionReceipt: { transactionHash: hash, status: "0x1" }, ...overrides };
    if (overrides.error) return Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "refused" } });
    return Response.json({ jsonrpc: "2.0", id: 1, result: results[method] });
  };
  return { service: createTestnetFunding(kv, { fetch: fetchMock, now: () => time }), kv, calls, advance: () => { time += 46000; } };
}
test("verified increase uses fixed RPC, chain and token; only one faucet call", async () => {
  const h = harness(); const initial = await h.service.request({ address });
  assert.equal(initial.stage, "WAITING_FOR_BALANCE"); assert.equal(initial.startingBalance, "0");
  const result = await h.service.status(address);
  assert.equal(result.stage, "FUNDED"); assert.equal(result.balance, "1000000"); assert.equal(result.chainId, 42431); assert.equal(result.token, token);
  assert.equal(h.calls.filter(c => c.method === "tempo_fundAddress").length, 1);
  assert.ok(h.calls.every(c => c.url === "https://rpc.moderato.tempo.xyz"));
  assert.ok(h.calls.filter(c => c.method === "eth_call").every(c => c.params[0].to === token && c.params[0].data === `0x70a08231${address.slice(2).padStart(64, "0")}`));
});
for (const body of [null, [], {}, { address: "bad" }, { address: "0x0000000000000000000000000000000000000000" }, { address, chainId: 1 }, { address, rpcUrl: "https://evil.invalid" }, { address, token }]) test(`reject invalid/arbitrary request ${JSON.stringify(body)}`, async () => {
  const h = harness(); await assert.rejects(h.service.request(body), (e: FundingError) => e.status === 400); assert.equal(h.calls.length, 0);
});
test("wrong upstream chain blocks faucet", async () => { const h = harness({ eth_chainId: "0x1079" }); await assert.rejects(h.service.request({ address }), /only on Tempo Moderato/); assert.equal(h.calls.filter(c => c.method === "tempo_fundAddress").length, 0); });
test("RPC failure is safe and retains cooldown", async () => { const h = harness({ throw: true }); await assert.rejects(h.service.request({ address }), /could not be reached/); await assert.rejects(h.service.request({ address }), (e: FundingError) => e.code === "COOLDOWN"); });
test("HTTP rate limit surfaced", async () => { const h = harness({ http: 429 }); await assert.rejects(h.service.request({ address }), (e: FundingError) => e.status === 429); });
test("upstream refusal not success", async () => { const h = harness({ error: true }); await assert.rejects(h.service.request({ address }), /refused/); });
test("unexpected response does not retry", async () => { const h = harness({ tempo_fundAddress: { hash } }); await assert.rejects(h.service.request({ address }), /unexpected/); assert.equal((await h.service.status(address)).stage, "FAILED"); assert.equal(h.calls.filter(c => c.method === "tempo_fundAddress").length, 1); });
test("parser explicitly supports single hash, rejects bad shapes", () => { assert.deepEqual(faucetHashes(hash), [hash]); for (const bad of [[], null, true, {}, ["bad"], Array(17).fill(hash)]) assert.throws(() => faucetHashes(bad)); });
test("reverted receipt blocks success despite increased balance", async () => { const h = harness({ eth_getTransactionReceipt: { transactionHash: hash, status: "0x0" } }); await h.service.request({ address }); const r = await h.service.status(address); assert.equal(r.stage, "FAILED"); assert.match(r.error!, /reverted/); });
test("missing receipt stays pending", async () => { const h = harness({ eth_getTransactionReceipt: null }); await h.service.request({ address }); assert.equal((await h.service.status(address)).stage, "WAITING_FOR_BALANCE"); });
test("wrong receipt hash rejected", async () => { const h = harness({ eth_getTransactionReceipt: { transactionHash: `0x${"cd".repeat(32)}`, status: "0x1" } }); await h.service.request({ address }); await assert.rejects(h.service.status(address), /unexpected evidence/); });
test("unchanged balance waits then times out without another faucet", async () => { const h = harness({ eth_call: `0x${"0".repeat(64)}` }); await h.service.request({ address }); assert.equal((await h.service.status(address)).stage, "WAITING_FOR_BALANCE"); h.advance(); assert.equal((await h.service.status(address)).stage, "FAILED"); assert.equal(h.calls.filter(c => c.method === "tempo_fundAddress").length, 1); });
test("atomic cooldown covers concurrent requests", async () => { const h = harness(); const r = await Promise.allSettled([h.service.request({ address }), h.service.request({ address })]); assert.equal(r.filter(x => x.status === "fulfilled").length, 1); assert.equal(h.calls.filter(c => c.method === "tempo_fundAddress").length, 1); });
test("another instance sharing KV retains cooldown", async () => { const h = harness(); await h.service.request({ address }); const other = createTestnetFunding(h.kv, { fetch: async () => { throw Error("must not call network"); } }); await assert.rejects(other.request({ address }), (e: FundingError) => e.code === "COOLDOWN"); });
test("durable network and global quotas stop account rotation and volume before the faucet", async () => {
  const h = harness();
  const service = createTestnetFunding(h.kv, { fetch: async (input, init) => h.calls.push({ url: String(input), method: JSON.parse(init!.body as string).method, params: JSON.parse(init!.body as string).params }) && Response.json({ jsonrpc: "2.0", id: 1, result: JSON.parse(init!.body as string).method === "eth_chainId" ? "0xa5bf" : JSON.parse(init!.body as string).method === "tempo_fundAddress" ? [hash] : `0x${"0".repeat(64)}` }), now: () => 1000, limits: { networkMaxRequests: 50, globalMaxRequests: 2, rotationMaxAddresses: 50 } });
  await service.request({ address }, { networkKey: "network-a" });
  await service.request({ address: address2 }, { networkKey: "network-b" });
  await assert.rejects(service.request({ address: address3 }, { networkKey: "network-c" }), (error: FundingError) => error.code === "GLOBAL_RATE_LIMIT");
  assert.equal(h.calls.filter(call => call.method === "tempo_fundAddress").length, 2);
});
test("durable network quota limits requests across different authenticated accounts", async () => {
  const h = harness();
  const service = createTestnetFunding(h.kv, { fetch: async (input, init) => h.calls.push({ url: String(input), method: JSON.parse(init!.body as string).method, params: JSON.parse(init!.body as string).params }) && Response.json({ jsonrpc: "2.0", id: 1, result: JSON.parse(init!.body as string).method === "eth_chainId" ? "0xa5bf" : JSON.parse(init!.body as string).method === "tempo_fundAddress" ? [hash] : `0x${"0".repeat(64)}` }), now: () => 1000, limits: { networkMaxRequests: 2, globalMaxRequests: 50, rotationMaxAddresses: 50 } });
  await service.request({ address }, { networkKey: "network-a" });
  await service.request({ address: address2 }, { networkKey: "network-a" });
  await assert.rejects(service.request({ address: address3 }, { networkKey: "network-a" }), (error: FundingError) => error.code === "NETWORK_RATE_LIMIT");
  assert.equal(h.calls.filter(call => call.method === "tempo_fundAddress").length, 2);
});
test("durable account-rotation quota limits distinct accounts without blocking another request from a known account", async () => {
  const h = harness();
  const service = createTestnetFunding(h.kv, { fetch: async (input, init) => h.calls.push({ url: String(input), method: JSON.parse(init!.body as string).method, params: JSON.parse(init!.body as string).params }) && Response.json({ jsonrpc: "2.0", id: 1, result: JSON.parse(init!.body as string).method === "eth_chainId" ? "0xa5bf" : JSON.parse(init!.body as string).method === "tempo_fundAddress" ? [hash] : `0x${"0".repeat(64)}` }), now: () => 1000, limits: { networkMaxRequests: 50, globalMaxRequests: 50, rotationMaxAddresses: 2 } });
  await service.request({ address }, { networkKey: "network-a" });
  await service.request({ address: address2 }, { networkKey: "network-a" });
  await assert.rejects(service.request({ address: address3 }, { networkKey: "network-a" }), (error: FundingError) => error.code === "ACCOUNT_ROTATION_LIMIT");
  assert.equal(h.calls.filter(call => call.method === "tempo_fundAddress").length, 2);
});
test("network identity is hashed before it reaches a funding key", () => {
  const request = new Request("https://reach.test/api/testnet/fund", { headers: { "x-forwarded-for": "203.0.113.10, 10.0.0.1" } });
  const key = fundingNetworkKey(request);
  assert.match(key, /^[0-9a-f]{32}$/);
  assert.doesNotMatch(key, /203\.0\.113\.10/);
});
test("storage failure fails closed", async () => { const service = createTestnetFunding({ ...Kv.memory(), create: async () => { throw Error("KV unavailable"); } }); await assert.rejects(service.request({ address }), /KV unavailable/); });
test("real Hono routing rejects invalid inputs and cross-origin request without network", async () => {
  const app = createApp();
  for (const body of [{ address: "bad" }, { address, rpc: "evil" }, { address, token }, { address, chainId: 1 }]) assert.equal((await app.request("/api/testnet/fund", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).status, 400);
  assert.equal((await app.request("/api/testnet/fund", { method: "POST", headers: { Origin: "https://evil.invalid", "Content-Type": "application/json" }, body: JSON.stringify({ address }) })).status, 403);
  assert.equal((await app.request(`/api/testnet/fund/${address}`)).status, 404);
});

test("funding route requires a server session bound to the requested account", async () => {
  const unauthenticated = createApp({ protectedSession: async () => undefined });
  const request = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address }) };
  assert.equal((await unauthenticated.request("/api/testnet/fund", request)).status, 401);

  const differentAddress = "0x2222222222222222222222222222222222222222" as const;
  const mismatched = createApp({ protectedSession: async () => ({ address: differentAddress }) });
  const response = await mismatched.request("/api/testnet/fund", request);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "authenticated account required" });
});
