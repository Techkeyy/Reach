import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeAbiParameters, encodeFunctionResult, keccak256, parseAbi, toHex } from "viem";
import { createApp } from "../src/server/app";
import { vaultAbi } from "../src/shared/reach";

const sender = "0x6B6e9e45Cf4bB5CbC7d4a8B19cf3d886369Ff925";
const pathUsd = "0x20c0000000000000000000000000000000000000";
const vault = "0x98262c02746f3b91342249159deeebe87a54266c";
const txHash = "0x2d595645455ad01c73ed22729022fb4d0a61aba43596639be98640845c13f390";
const feeTokenAbi = parseAbi(["function decimals() view returns (uint8)", "function symbol() view returns (string)"]);
const payoutId = "42";
const claimSigner = "0x177DFAeF587815bE56356343ca46a3987133Ea4d";
const claimant = "0x8d1154e1Fcf5Ecc3fE509d2fA9fA65f00CEc7bc6";
const claimTxHash = "0xa97fb3a20a9441551fc2765c5ba521c2327fb3ce2226f5ea19799f0dd1de9e4c";
const reclaimTxHash = "0xc9fe22e2ceb3bb0fb7ae91798b5b98dd13bbf6b59a907a12c3e2bd75a0ec6ce1";
const payoutCreatedSelector = keccak256(toHex("PayoutCreated(uint256,address,uint256,uint64,address,bytes32)"));
const payoutClaimedSelector = keccak256(toHex("PayoutClaimed(uint256,address,uint256,bytes32)"));
const payoutReclaimedSelector = keccak256(toHex("PayoutReclaimed(uint256,address,uint256,bytes32)"));
const payoutCreatedData = encodeAbiParameters(
  [{ type: "uint256" }, { type: "uint64" }, { type: "address" }],
  [20000n, 1791019500n, claimSigner as `0x${string}`],
);
const indexerPayload = {
  columns: ["block_num", "block_timestamp", "tx_hash", "selector", "topic1", "topic2", "data"],
  rows: [[37966641, "2026-10-03T08:31:03.000Z", txHash, payoutCreatedSelector, `0x${BigInt(payoutId).toString(16).padStart(64, "0")}`, `0x${sender.slice(2).toLowerCase().padStart(64, "0")}`, payoutCreatedData]],
};
const claimPayload = {
  columns: ["block_num", "block_timestamp", "tx_hash", "selector", "topic1", "topic2", "data"],
  rows: [[37966700, "2026-10-03T08:40:00.000Z", claimTxHash, payoutClaimedSelector, `0x${BigInt(payoutId).toString(16).padStart(64, "0")}`, `0x${claimant.slice(2).toLowerCase().padStart(64, "0")}`, encodeAbiParameters([{ type: "uint256" }], [20000n])]],
};
const reclaimPayload = {
  columns: ["block_num", "block_timestamp", "tx_hash", "selector", "topic1", "topic2", "data"],
  rows: [[37966700, "2026-10-03T08:40:00.000Z", reclaimTxHash, payoutReclaimedSelector, `0x${BigInt(payoutId).toString(16).padStart(64, "0")}`, `0x${sender.slice(2).toLowerCase().padStart(64, "0")}`, encodeAbiParameters([{ type: "uint256" }], [20000n])]],
};

function rpcResponse(id: number, result: unknown) {
  return Response.json({ jsonrpc: "2.0", id, result });
}

async function withRpcMock(receipt: unknown, run: () => Promise<void>, options: { status?: number; claimant?: string } = {}) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("indexer.testnet.tempo.xyz")) {
      if (url.includes("PayoutClaimed")) return Response.json(claimPayload);
      if (url.includes("PayoutReclaimed")) return Response.json(reclaimPayload);
      return Response.json(indexerPayload);
    }
    const body = JSON.parse(String(init?.body)) as { id: number; method: string; params?: any[] };
    if (body.method === "eth_chainId") return rpcResponse(body.id, "0xa5bf");
    if (body.method === "eth_getTransactionByHash") return rpcResponse(body.id, { hash: txHash, from: sender, to: pathUsd, chainId: "0xa5bf" });
    if (body.method === "eth_getTransactionReceipt") {
      if (receipt instanceof Error) return Response.json({ jsonrpc: "2.0", id: body.id, error: { code: -32000, message: receipt.message } });
      return rpcResponse(body.id, receipt);
    }
    if (body.method === "eth_call") {
      const call = body.params?.[0] as { to?: string; data?: string };
      if (call.to?.toLowerCase() === vault) {
        return rpcResponse(body.id, encodeFunctionResult({ abi: vaultAbi, functionName: "getPayout", result: [sender as `0x${string}`, 20000n, 1791019500n, claimSigner as `0x${string}`, options.status ?? 1, (options.claimant ?? "0x0000000000000000000000000000000000000000") as `0x${string}`] }));
      }
      const selector = call.data?.slice(0, 10);
      if (selector === "0x313ce567") return rpcResponse(body.id, encodeFunctionResult({ abi: feeTokenAbi, functionName: "decimals", result: 6 }));
      if (selector === "0x95d89b41") return rpcResponse(body.id, encodeFunctionResult({ abi: feeTokenAbi, functionName: "symbol", result: "pathUSD" }));
    }
    throw new Error(`unexpected RPC request: ${body.method}`);
  };
  try { await run(); } finally { globalThis.fetch = originalFetch; }
}

test("payout API returns authoritative historical accounting and total deducted", async () => {
  await withRpcMock({ status: "0x1", transactionHash: txHash, gasUsed: "0xca448", effectiveGasPrice: "0x23c34601", feeToken: pathUsd, from: sender }, async () => {
    const response = await createApp({ serveStaticFallback: false }).request(`/api/payout/${payoutId}`);
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.status, 1);
    assert.equal(body.amount, "20000");
    assert.equal(body.fundingTxHash, txHash);
    assert.equal(body.accounting.receiptStatus, "success");
    assert.equal(body.accounting.actualFeeAmount, "497");
    assert.equal(body.accounting.feeToken, pathUsd);
    assert.equal(body.accounting.gasUsed, "828488");
    assert.equal(body.accounting.effectiveGasPrice, "600000001");
    assert.deepEqual(body.accounting.actualTotalDeducted, [{ amount: "20497", decimals: 6, symbol: "pathUSD", token: pathUsd }]);
  });
});

test("receipt recovery failure leaves the authoritative vault lifecycle intact", async () => {
  await withRpcMock(new Error("receipt unavailable"), async () => {
    const response = await createApp({ serveStaticFallback: false }).request(`/api/payout/${payoutId}`);
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.status, 1);
    assert.equal(body.accounting, null);
    assert.equal(body.fundingTxHash, txHash);
  });
});

test("payout API keeps distinct claim and reclaim transaction metadata", async () => {
  await withRpcMock({ status: "0x1", transactionHash: txHash, gasUsed: "0xca448", effectiveGasPrice: "0x23c34601", feeToken: pathUsd, from: sender }, async () => {
    const claimedResponse = await createApp({ serveStaticFallback: false }).request(`/api/payout/${payoutId}`);
    const body = await claimedResponse.json() as any;
    assert.equal(claimedResponse.status, 200);
    assert.equal(body.status, 2);
    assert.equal(body.fundingTxHash, txHash);
    assert.equal(body.claimTxHash, claimTxHash);
    assert.equal(body.reclaimTxHash, undefined);
  }, { status: 2, claimant });

  await withRpcMock({ status: "0x1", transactionHash: txHash, gasUsed: "0xca448", effectiveGasPrice: "0x23c34601", feeToken: pathUsd, from: sender }, async () => {
    const response = await createApp({ serveStaticFallback: false }).request(`/api/payout/${payoutId}`);
    const body = await response.json() as any;
    assert.equal(response.status, 200);
    assert.equal(body.status, 3);
    assert.equal(body.fundingTxHash, txHash);
    assert.equal(body.reclaimTxHash, reclaimTxHash);
    assert.equal(body.claimTxHash, undefined);
  }, { status: 3 });
});
