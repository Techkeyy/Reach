import assert from "node:assert/strict";
import test from "node:test";
import { createTempoRpcReadCoordinator, RpcAuthorityUnavailableError } from "../src/server/rpcCoordinator";

test("429 with a null error payload stays bounded and rejects safely", async () => {
  let calls = 0;
  const coordinator = createTempoRpcReadCoordinator({ maxRetries: 0, logger: () => {} });

  await assert.rejects(
    coordinator.read(async () => {
      calls += 1;
      throw { status: 429, error: null, raw: null };
    }, { key: "null-error-payload", kind: "getPayout" }),
    (error: unknown) => error instanceof RpcAuthorityUnavailableError,
  );
  assert.equal(calls, 1);
});
