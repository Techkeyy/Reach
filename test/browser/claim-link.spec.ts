import { test, expect } from "@playwright/test";
import { privateKeyToAccount } from "viem/accounts";

const capabilityBytes = "2a".repeat(32);
const capability = Buffer.from(capabilityBytes, "hex").toString("base64url");
const capabilitySigner = privateKeyToAccount(`0x${capabilityBytes}`);
const zero = "0x0000000000000000000000000000000000000000";
const payout = (overrides: Record<string, unknown> = {}) => ({
  sender: "0x1111111111111111111111111111111111111111",
  amount: "25000000",
  expiresAt: "4102444800",
  claimSigner: capabilitySigner.address,
  status: 1,
  claimant: zero,
  ...overrides,
});

async function expectNoMutationRequests(page: import("@playwright/test").Page, requests: string[]) {
  await expect.poll(() => requests.filter((url) => /\/(?:auth|relay)(?:\/|$)/.test(new URL(url).pathname))).toEqual([]);
  expect(requests.some((url) => /\/(?:auth|relay)(?:\/|$)/.test(new URL(url).pathname))).toBe(false);
}

test.describe("claim capability redaction", () => {
  test("sentinel capability stays out of network, DOM, URL, console, and request payloads", async ({ page }) => {
    const requests: Array<{ url: string; headers: Record<string, string>; body: string | null }> = [];
    const consoleText: string[] = [];
    page.on("request", (request) => requests.push({ url: request.url(), headers: request.headers(), body: request.postData() }));
    page.on("console", (message) => consoleText.push(message.text()));
    await page.route("**/api/payout/123", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payout()) }));
    await page.goto(`/c/123#${capability}`);
    await expect(page.getByRole("button", { name: /Get my money/ })).toBeVisible();
    expect(page.url()).not.toContain(capability);
    expect(await page.locator("body").textContent()).not.toContain(capability);
    expect(await page.locator("html").evaluate((html) => html.outerHTML)).not.toContain(capability);
    expect(await page.evaluate(() => sessionStorage.getItem("reach.claim.123"))).toBe(capability);
    expect(consoleText.join("\n")).not.toContain(capability);
    for (const request of requests) {
      expect(request.url).not.toContain(capability);
      expect(JSON.stringify(request.headers)).not.toContain(capability);
      expect(request.body ?? "").not.toContain(capability);
    }
  });

  test("CLAIMED payout with no fragment resolves terminal without WebAuthn or relay", async ({ page }) => {
    const mutationRequests: string[] = [];
    page.on("request", (request) => mutationRequests.push(request.url()));
    await page.route("**/api/payout/123", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payout({ status: 2, claimant: capabilitySigner.address })) }));
    await page.goto("/c/123");
    await expect(page.getByText("You got it", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: /Get my money/ })).toHaveCount(0);
    await expectNoMutationRequests(page, mutationRequests);
  });

  test("CLAIMED payout with stale session capability clears it without mutation", async ({ page }) => {
    const mutationRequests: string[] = [];
    page.on("request", (request) => mutationRequests.push(request.url()));
    await page.addInitScript((value) => sessionStorage.setItem("reach.claim.123", value), capability);
    await page.route("**/api/payout/123", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payout({ status: 2, claimant: capabilitySigner.address })) }));
    await page.goto("/c/123");
    await expect(page.getByText("You got it", { exact: false })).toBeVisible();
    await expectNoMutationRequests(page, mutationRequests);
  });

  test("FUNDED payout with no capability shows a truthful missing-credential state", async ({ page }) => {
    await page.route("**/api/payout/123", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payout()) }));
    await page.goto("/c/123");
    await expect(page.getByText("Missing claim key", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: /Get my money/ })).toHaveCount(0);
  });

  test("FUNDED payout with valid capability keeps the normal claim path available", async ({ page }) => {
    await page.route("**/api/payout/123", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payout()) }));
    await page.goto(`/c/123#${capability}`);
    await expect(page.getByRole("button", { name: /Get my money/ })).toBeVisible();
  });

  test("RECLAIMED payout with no capability resolves terminal", async ({ page }) => {
    await page.route("**/api/payout/123", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payout({ status: 3 })) }));
    await page.goto("/c/123");
    await expect(page.getByText("Funds returned to sender", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: /Get my money/ })).toHaveCount(0);
  });

  test("nonexistent payout resolves invalid without a claim CTA", async ({ page }) => {
    await page.route("**/api/payout/123", (route) => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "payout unavailable" }) }));
    await page.goto("/c/123");
    await expect(page.getByText("Invalid claim link", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: /Get my money/ })).toHaveCount(0);
  });

  test("mismatched capability is invalid without echoing the bearer value", async ({ page }) => {
    const wrongSigner = privateKeyToAccount(`0x${"3b".repeat(32)}`);
    await page.route("**/api/payout/123", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payout({ claimSigner: wrongSigner.address })) }));
    await page.goto(`/c/123#${capability}`);
    await expect(page.getByText("Invalid claim link")).toBeVisible();
    expect(await page.locator("body").textContent()).not.toContain(capability);
  });
});
