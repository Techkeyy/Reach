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

  test("restored landing content scrolls and FAQ is keyboard accessible", async ({ page }) => {
    test.setTimeout(120_000);
    for (const viewport of [
      { width: 320, height: 700 },
      { width: 375, height: 667 },
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/", { waitUntil: "networkidle" });

      await expect(page.getByRole("heading", { name: "Payment infrastructure that starts with the person." })).toBeVisible();
      await expect(page.getByRole("heading", { name: "A payment workspace for humans and agents." })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Let an agent pay for a service, with you in control." })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Frequently asked questions." })).toBeVisible();
      await expect(page.getByText("Most crypto payouts fail the usability test before they even start.", { exact: false })).toBeVisible();
      await expect(page.locator(".landing-rich-faq-item")).toHaveCount(10);
      await assertNoHorizontalOverflow(page);

      const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
      expect(pageHeight).toBeGreaterThan(3000);

      const faqButton = page.getByRole("button", { name: /How does a recipient claim money without an existing wallet/ });
      await faqButton.focus();
      await faqButton.press("Enter");
      await expect(faqButton).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByText("No wallet app, browser extension or pre-existing address is needed.", { exact: false })).toBeVisible();
      await faqButton.press("Enter");
      await expect(faqButton).toHaveAttribute("aria-expanded", "false");

      const screenshotName = viewport.width === 1440 ? "task-008-ux-landing-desktop-full.png" : `task-008-ux-landing-${viewport.width}.png`;
      await page.screenshot({ path: path.join(screenshotDir, screenshotName), fullPage: true });
    }
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
