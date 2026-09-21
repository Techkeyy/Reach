import { test, expect } from "@playwright/test";
import { privateKeyToAccount } from "viem/accounts";

const capabilityBytes = "2a".repeat(32);
const capability = Buffer.from(capabilityBytes, "hex").toString("base64url");
const capabilitySigner = privateKeyToAccount(`0x${capabilityBytes}`);
const zero = "0x0000000000000000000000000000000000000000";
const payout = (overrides: Record<string, unknown> = {}) => ({ sender: "0x1111111111111111111111111111111111111111", amount: "25000000", expiresAt: "4102444800", claimSigner: capabilitySigner.address, status: 1, claimant: zero, ...overrides });

test.describe("claim capability redaction", () => {
  test("sentinel capability stays out of network, DOM, URL, console, and request payloads", async ({ page }) => {
    const requests: Array<{ url: string; headers: Record<string, string>; body: string | null }> = [];
    const consoleText: string[] = [];
    page.on("request", (request) => requests.push({ url: request.url(), headers: request.headers(), body: request.postData() }));
    page.on("console", (message) => consoleText.push(message.text()));
    await page.route("**/api/payout/123", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payout()) }));
    await page.goto(`/c/123#${capability}`);
    await expect(page.getByRole("button", { name: "Claim $25.00" })).toBeVisible();
    expect(page.url()).not.toContain(capability);
    expect(await page.locator("body").textContent()).not.toContain(capability);
    expect(await page.locator("html").evaluate((html) => html.outerHTML)).not.toContain(capability);
    expect(await page.evaluate(() => sessionStorage.getItem("reach.claim.123"))).toBe(capability);
    expect(consoleText.join("\n")).not.toContain(capability);
    for (const request of requests) { expect(request.url).not.toContain(capability); expect(JSON.stringify(request.headers)).not.toContain(capability); expect(request.body ?? "").not.toContain(capability); }
  });
  test("missing fragment is incomplete and does not fetch a payout", async ({ page }) => { let payoutRead = false; await page.route("**/api/payout/123", (route) => { payoutRead = true; return route.abort(); }); await page.goto("/c/123"); await expect(page.getByText("This link is not valid")).toBeVisible(); expect(payoutRead).toBe(false); });
  test("mismatched capability is invalid without echoing the bearer value", async ({ page }) => { const wrongSigner = privateKeyToAccount(`0x${"3b".repeat(32)}`); await page.route("**/api/payout/123", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payout({ claimSigner: wrongSigner.address })) })); await page.goto(`/c/123#${capability}`); await expect(page.getByText("This link is not valid")).toBeVisible(); expect(await page.locator("body").textContent()).not.toContain(capability); });
  test("authoritative claimed state is terminal and clears same-tab capability storage", async ({ page }) => { await page.route("**/api/payout/123", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payout({ status: 2, claimant: capabilitySigner.address })) })); await page.goto(`/c/123#${capability}`); await expect(page.getByText("Already claimed")).toBeVisible(); expect(await page.evaluate(() => sessionStorage.getItem("reach.claim.123"))).toBe(null); });
});
