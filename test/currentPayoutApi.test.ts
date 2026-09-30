import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeFunctionResult } from "viem";
import { createApp } from "../src/server/app";
import { vaultAbi } from "../src/shared/reach";

test("current payout endpoint rereads the vault, validates full shape, and forbids caching", async () => {
  const originalFetch = globalThis.fetch;
  let reads = 0;
  globalThis.fetch = async (_input, init) => {
    const rpc = JSON.parse(String(init?.body));
    assert.equal(rpc.method, "eth_call");
    reads++;
    const zero = "0x0000000000000000000000000000000000000000";
    const data = encodeFunctionResult({ abi: vaultAbi, functionName: "getPayout", result: [zero, 100000n, 1000n, zero, reads === 1 ? 1 : 2, zero] });
    return Response.json({ jsonrpc: "2.0", id: rpc.id, result: data });
  };
  try {
    const app = createApp();
    const first = await app.request("http://localhost/api/payout/42");
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("cache-control"), "no-store");
    assert.equal((await first.json()).status, 1);
    const second = await app.request("http://localhost/api/payout/42");
    assert.equal(second.status, 200);
    assert.equal((await second.json()).status, 2);
    assert.equal(reads, 2);
  } finally { globalThis.fetch = originalFetch; }
});
