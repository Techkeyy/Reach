import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const owner = "0x0bf9000000000000000000000000000000000D42";
const recipient = "0x1111111111111111111111111111111111111111";
const policyId = "task-005c-mpp-policy";
const token = "reach_agent_" + "a".repeat(32) + "_" + "b".repeat(43);
const screenshotDir = path.resolve(process.cwd(), "artifacts/screenshots-v3");

test("Task 005C normal agent payment journey shows service output, financial record, refresh recovery, and revocation", async ({ page }) => {
  fs.mkdirSync(screenshotDir, { recursive: true });
  let revoked = false;
  const payment = {
    id: "payment-005c",
    policyId,
    idempotencyKey: "ui-005c-proof",
    mode: "charge",
    amountRaw: "1000000",
    recipient,
    endpointOrigin: "http://localhost:5173",
    state: "CONFIRMED",
    receipt: { status: "success", method: "tempo", reference: "0x" + "ab".repeat(32) },
    responseStatus: 200,
    responseBody: JSON.stringify({ ok: true, service: "Reach agent service", output: "actual paid result" }),
    responseContentType: "application/json",
    updatedAt: "2026-10-10T10:20:00.000Z",
  };
  const policy = () => ({
    id: policyId,
    ownerAddress: owner,
    agentAddress: "0x2222222222222222222222222222222222222222",
    chainId: 42431,
    currency: "0x20c0000000000000000000000000000000000000",
    maxPerPaymentRaw: "10000000",
    cumulativeBudgetRaw: "10000000",
    reservedRaw: "0",
    spentRaw: revoked ? "1000000" : "1000000",
    expiryTimestamp: 1_800_000_000,
    allowedDestinations: [recipient],
    allowedOrigins: ["http://localhost:5173"],
    purpose: "MPP_DIRECT",
    status: revoked ? "REVOKED" : "ACTIVE",
    createdAt: "2026-10-10T10:00:00.000Z",
    updatedAt: "2026-10-10T10:20:00.000Z",
    remainingRaw: "9000000",
  });

  await page.addInitScript(({ key, value }) => sessionStorage.setItem(key, value), { key: `reach.agent.session.v1:${owner.toLowerCase()}`, value: token });
  await page.route("**/health", (route) => route.fulfill({ json: { ok: true, chainId: 42431, mpp: { configured: true, chainId: 42431, recipient, price: "0.000001" } } }));
  await page.route("**/api/agent/authorizations", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { policies: [policy()] } });
    return route.fallback();
  });
  await page.route("**/api/agent/authorizations/*/payments", (route) => route.fulfill({ json: { policy: policy(), payments: [], mppPayments: [payment] } }));
  await page.route("**/api/mpp/payer/request", (route) => route.fulfill({ json: { payment, response: { status: 200, body: payment.responseBody, contentType: "application/json" } } }));
  await page.route("**/api/agent/authorizations/*/revoke", (route) => { revoked = true; return route.fulfill({ json: { ...policy(), status: "REVOKED" } }); });
  await page.route("**/api/activity/**", (route) => route.fulfill({ json: { activities: [] } }));
  await page.route("**/api/payouts/**", (route) => route.fulfill({ json: { payouts: [] } }));
  await page.route("**/api/balance/**", (route) => route.fulfill({ json: { status: "READY", balance: "250000000" } }));

  await page.goto("/app/automation?sessionFixture=connected", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Agent payments" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Owner-approved service", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pay for service", exact: true }).click();
  await expect(page.getByText("Actual service output", { exact: true })).toBeVisible();
  await expect(page.locator("pre").filter({ hasText: "actual paid result" }).first()).toBeVisible();
  await expect(page.getByText("Verified Tempo reference:", { exact: false })).toBeVisible();
  await expect(page.getByText("Financial record", { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(screenshotDir, "task-005c-agent-paid-result.png"), fullPage: true });

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("ui-005c-proof", { exact: false })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("CONFIRMED", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Revoke access", exact: true }).click();
  await expect(page.getByText("Server authorization revoked in the deterministic browser fixture.", { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(screenshotDir, "task-005c-agent-revoked.png"), fullPage: true });
});
