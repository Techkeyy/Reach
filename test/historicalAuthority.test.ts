import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { decodeFunctionResult, type Hex } from "viem";
import { payoutFromContractResult, serializePayout, vaultAbi } from "../src/shared/reach";
import { resolvePayoutLifecycle } from "../src/client/payoutLifecycle";

// Actual public eth_call bytes reread at pinned Moderato block 37566216.
const replay = JSON.parse(readFileSync(new URL("./fixtures/moderato-authority.json", import.meta.url), "utf8"));
for (const { id, data, expected } of replay.payouts as { id: string; data: Hex; expected: string }[]) {
  test(`historical Moderato ${id}: ${expected} at recorded chain timestamp`, () => {
    assert.equal(replay.timestamp, "1790775847");
    const tuple = decodeFunctionResult({ abi: vaultAbi, functionName: "getPayout", data });
    assert.ok(Array.isArray(tuple));
    const payout = serializePayout(payoutFromContractResult(tuple, id));
    const state = resolvePayoutLifecycle({ authoritativePayout: payout, chainTimestamp: BigInt(replay.timestamp) });
    assert.equal(state.financialState, expected);
    if (expected === "RECLAIMED") assert.equal(resolvePayoutLifecycle({ authoritativePayout: payout }).financialState, "RECLAIMED");
  });
}
