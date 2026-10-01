import assert from "node:assert/strict";
import { test } from "node:test";
import { PAYOUT_EXPIRY_MAX_SECONDS, PAYOUT_EXPIRY_MIN_SECONDS, resolvePayoutExpiry } from "../src/client/expiry";

const chainTime = 1_800_000_000n;

test("payout expiry presets are resolved from Tempo chain time", () => {
  assert.equal(resolvePayoutExpiry(chainTime, { kind: "PRESET", seconds: 3600 }), chainTime + 3600n);
  assert.equal(resolvePayoutExpiry(chainTime, { kind: "PRESET", seconds: 86400 }), chainTime + 86400n);
  assert.equal(resolvePayoutExpiry(chainTime, { kind: "PRESET", seconds: 259200 }), chainTime + 259200n);
  assert.equal(resolvePayoutExpiry(chainTime, { kind: "PRESET", seconds: 604800 }), chainTime + 604800n);
});

test("custom expiry is converted and bounded against chain time", () => {
  const selected = new Date(Number(chainTime + 7200n) * 1000);
  const localDateTime = `${selected.getFullYear()}-${String(selected.getMonth() + 1).padStart(2, "0")}-${String(selected.getDate()).padStart(2, "0")}T${String(selected.getHours()).padStart(2, "0")}:${String(selected.getMinutes()).padStart(2, "0")}`;
  const expiresAt = resolvePayoutExpiry(chainTime, { kind: "CUSTOM", localDateTime });
  assert.ok(expiresAt >= chainTime + 7199n && expiresAt <= chainTime + 7200n);
});

test("expiry rejects selections at, below minimum, and above maximum", () => {
  const localFor = (seconds: bigint) => {
    const selected = new Date(Number(chainTime + seconds) * 1000);
    return `${selected.getFullYear()}-${String(selected.getMonth() + 1).padStart(2, "0")}-${String(selected.getDate()).padStart(2, "0")}T${String(selected.getHours()).padStart(2, "0")}:${String(selected.getMinutes()).padStart(2, "0")}`;
  };
  assert.throws(() => resolvePayoutExpiry(chainTime, { kind: "PRESET", seconds: 0 }), /at least 10 minutes/);
  assert.throws(() => resolvePayoutExpiry(chainTime, { kind: "CUSTOM", localDateTime: localFor(0n) }), /at least 10 minutes/);
  assert.throws(() => resolvePayoutExpiry(chainTime, { kind: "CUSTOM", localDateTime: localFor(BigInt(PAYOUT_EXPIRY_MAX_SECONDS) + 60n) }), /more than 30 days/);
  assert.equal(PAYOUT_EXPIRY_MIN_SECONDS, 600);
});
