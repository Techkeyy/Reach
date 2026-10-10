import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const screenshotDir = path.resolve(process.cwd(), "artifacts/screenshots-v3");

async function assertNoHorizontalOverflow(page: any) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function mockConnectedReads(page: any) {
  await page.route("**/health", route => route.fulfill({ json: { ok: true, chainId: 42431, protectedClaims: { emailConfigured: false, smsConfigured: false } } }));
  await page.route("**/api/balance/**", route => route.fulfill({ json: { status: "READY", balance: "250000000", address: "0x0bf9000000000000000000000000000000000D42" } }));
  await page.route("**/api/activity/**", route => route.fulfill({ json: { activities: [] } }));
  await page.route("**/api/payouts/**", route => route.fulfill({ json: { payouts: [] } }));
  await page.route("**/api/agent/authorizations", route => route.fulfill({ json: { policies: [] } }));
}

test.describe("Task 005C-UX normal Reach shell", () => {
  test.beforeAll(() => fs.mkdirSync(screenshotDir, { recursive: true }));

  test("public landing is honest, concise and responsive", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/", { waitUntil: "networkidle" });

    await expect(page.getByRole("heading", { name: "Payments that start with a passkey." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Get started with a passkey" })).toBeVisible();
    await expect(page.getByText("Tempo Moderato testnet", { exact: true })).toBeVisible();
    await expect(page.locator(".interactive-hero-stage")).toHaveCount(0);
    await expect(page.getByText("Sender Payout", { exact: true })).toHaveCount(0);
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: path.join(screenshotDir, "task-005c-ux-landing-mobile-390.png"), fullPage: false });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload({ waitUntil: "networkidle" });
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: path.join(screenshotDir, "task-005c-ux-landing-desktop-1440.png"), fullPage: false });
  });

  test("authenticated shell exposes the six product areas and real secondary flows", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockConnectedReads(page);
    await page.goto("/app/home?sessionFixture=connected", { waitUntil: "networkidle" });

    await expect(page.getByText("Available Balance", { exact: true })).toBeVisible({ timeout: 15_000 });
    for (const label of ["Overview", "Send", "Activity", "Agents", "Funding", "Settings"]) {
      await expect(page.getByRole("button", { name: label, exact: true }).last()).toBeVisible();
    }
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: path.join(screenshotDir, "task-005c-ux-overview-mobile-390.png"), fullPage: false });

    await page.getByRole("button", { name: "Settings", exact: true }).last().click();
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
    await expect(page.getByText("Passkey account", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Agents", exact: true }).last().click();
    await expect(page.getByRole("heading", { name: "Agent payments", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Send", exact: true }).last().click();
    await expect(page.getByText("How do you want to send?", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Pay multiple people", exact: true })).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: path.join(screenshotDir, "task-005c-ux-send-mobile-390.png"), fullPage: false });

    await page.getByRole("button", { name: "Activity", exact: true }).last().click();
    await expect(page.getByRole("heading", { name: "Activity", exact: true })).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });
});
