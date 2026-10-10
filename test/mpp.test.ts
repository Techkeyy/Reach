import assert from "node:assert/strict";
import { test } from "node:test";
import { Kv } from "accounts/server";
import { createMppService } from "../src/server/mpp";

test("MPP service emits a Tempo pathUSD HTTP 402 challenge when configured", async () => {
  const previousSecret = process.env.MPP_SECRET_KEY;
  const previousRecipient = process.env.REACH_MPP_RECIPIENT_ADDRESS;
  try {
    process.env.MPP_SECRET_KEY = "mpp-test-secret-".padEnd(40, "x");
    process.env.REACH_MPP_RECIPIENT_ADDRESS = "0x2222222222222222222222222222222222222222";
    const service = createMppService(Kv.memory());
    assert.ok(service);
    const response = await service.handle(new Request("https://reach.test/api/mpp/agent-service"));
    assert.equal(response.status, 402);
    assert.ok(response.headers.get("payment-required") || response.headers.get("www-authenticate"));
    const sessionResponse = await service.handleSession(new Request("https://reach.test/api/mpp/agent-session"));
    assert.equal(sessionResponse.status, 402);
    assert.ok(sessionResponse.headers.get("payment-required") || sessionResponse.headers.get("www-authenticate"));
  } finally {
    if (previousSecret === undefined) delete process.env.MPP_SECRET_KEY;
    else process.env.MPP_SECRET_KEY = previousSecret;
    if (previousRecipient === undefined) delete process.env.REACH_MPP_RECIPIENT_ADDRESS;
    else process.env.REACH_MPP_RECIPIENT_ADDRESS = previousRecipient;
  }
});
