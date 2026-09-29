import test from "node:test";
import assert from "node:assert/strict";
import { prepareFreshRegistration } from "../src/client/registerPreparation";

test("fresh registration clears provider state before registration starts", async () => {
  const events: string[] = [];

  await prepareFreshRegistration(async () => {
    events.push("disconnect");
    throw new Error("stale logout endpoint is unavailable");
  });
  events.push("register");

  assert.deepEqual(events, ["disconnect", "register"]);
});

test("a stale logout failure does not block fresh registration", async () => {
  await prepareFreshRegistration(async () => {
    throw new Error("session already expired");
  });

  assert.ok(true);
});
