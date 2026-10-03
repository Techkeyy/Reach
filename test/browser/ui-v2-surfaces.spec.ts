import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const VIEWPORTS = {
  desktop: { name: "desktop-1440x900", width: 1440, height: 900 },
  mobile: { name: "mobile-390x844", width: 390, height: 844 },
};

const screenshotDir = path.resolve(process.cwd(), "artifacts/screenshots-v2");

test.describe("Reach UI V2 Surface QA & Screenshot Capture", () => {
  test.beforeAll(() => {
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
  });

  async function assertLayoutIntegrity(page: any, contextName: string) {
    const hasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    expect(hasOverflow, `${contextName} should not have horizontal overflow`).toBe(false);

    const text = await page.evaluate(() => document.body.innerText);
    expect(text, `${contextName} should not contain em-dashes`).not.toMatch(/[\u2014]/);
  }

  test("1. Landing Page (Desktop & Mobile)", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.goto("/", { waitUntil: "networkidle" });
    await assertLayoutIntegrity(page, "Landing Desktop");
    await page.screenshot({ path: path.join(screenshotDir, "01-landing-desktop.png"), fullPage: true });

    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto("/", { waitUntil: "networkidle" });
    await assertLayoutIntegrity(page, "Landing Mobile");
    await page.screenshot({ path: path.join(screenshotDir, "01-landing-mobile.png"), fullPage: true });
  });

  test("2. Home Dashboard (Desktop & Mobile)", async ({ page }) => {
    // This surface performs four local Vite navigations plus two full-page
    // screenshots. Under cold-start/loaded-worker conditions the traced test
    // measured 48.1s; keep the timeout scoped to this harness-heavy case.
    test.setTimeout(90_000);
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.goto("/app/home?sessionFixture=connected", { waitUntil: "networkidle" });
    
    await page.evaluate(() => {
      window.sessionStorage.setItem("reach.sender.payouts", JSON.stringify([
        { id: "1790060937954", amount: "250000000", expiresAt: "2000000000", claimSigner: "0x1111111111111111111111111111111111111111", createdAt: new Date(Date.now() - 3600000).toISOString(), label: "Contractor payment" },
        { id: "1790060937955", amount: "50000000", expiresAt: "1700000000", claimSigner: "0x2222222222222222222222222222222222222222", createdAt: new Date(Date.now() - 86400000).toISOString(), label: "Dinner split" }
      ]));
    });
    await page.goto("/app/home?sessionFixture=connected", { waitUntil: "networkidle" });

    const sendBtn = page.locator("button.btn-send-cta, button.btn-primary:has-text('Send money')").first();
    if (await sendBtn.isVisible()) {
      const box = await sendBtn.boundingBox();
      if (box) expect(box.height).toBeGreaterThanOrEqual(44);
    }

    await assertLayoutIntegrity(page, "Home Desktop");
    await page.screenshot({ path: path.join(screenshotDir, "02-home-desktop.png"), fullPage: true });

    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto("/app/home?sessionFixture=connected", { waitUntil: "networkidle" });
    await assertLayoutIntegrity(page, "Home Mobile");
    await page.screenshot({ path: path.join(screenshotDir, "02-home-mobile.png"), fullPage: true });
  });

  test("3. Send Amount Screen (Desktop & Mobile)", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.goto("/app/send?sessionFixture=connected", { waitUntil: "networkidle" });

    const amountInput = page.locator("input.amount-huge-input").first();
    if (await amountInput.isVisible()) {
      await amountInput.fill("50.00");
    }

    await assertLayoutIntegrity(page, "Send Amount Desktop");
    await page.screenshot({ path: path.join(screenshotDir, "03-send-amount-desktop.png"), fullPage: true });

    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto("/app/send?sessionFixture=connected", { waitUntil: "networkidle" });
    const mobileInput = page.locator("input.amount-huge-input").first();
    if (await mobileInput.isVisible()) {
      await mobileInput.fill("50.00");
    }
    await assertLayoutIntegrity(page, "Send Amount Mobile");
    await page.screenshot({ path: path.join(screenshotDir, "03-send-amount-mobile.png"), fullPage: true });
  });

  test("4. Review Payout Screen (Desktop & Mobile)", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.goto("/app/send?sessionFixture=connected", { waitUntil: "networkidle" });

    const amountInput = page.locator("input.amount-huge-input").first();
    if (await amountInput.isVisible()) {
      await amountInput.fill("25.00");
      const continueBtn = page.locator("button:has-text('Continue')").first();
      await continueBtn.click();
    }

    await page.waitForTimeout(300);
    await assertLayoutIntegrity(page, "Review Desktop");
    await page.screenshot({ path: path.join(screenshotDir, "04-review-desktop.png"), fullPage: true });

    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto("/app/send?sessionFixture=connected", { waitUntil: "networkidle" });
    const mobileInput = page.locator("input.amount-huge-input").first();
    if (await mobileInput.isVisible()) {
      await mobileInput.fill("25.00");
      const continueBtn = page.locator("button:has-text('Continue')").first();
      await continueBtn.click();
    }
    await page.waitForTimeout(300);
    await assertLayoutIntegrity(page, "Review Mobile");
    await page.screenshot({ path: path.join(screenshotDir, "04-review-mobile.png"), fullPage: true });
  });

  test("5. Activity Feed (Desktop & Mobile)", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.goto("/app/activity?sessionFixture=connected", { waitUntil: "networkidle" });

    await assertLayoutIntegrity(page, "Activity Desktop");
    await page.screenshot({ path: path.join(screenshotDir, "05-activity-desktop.png"), fullPage: true });

    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto("/app/activity?sessionFixture=connected", { waitUntil: "networkidle" });
    await assertLayoutIntegrity(page, "Activity Mobile");
    await page.screenshot({ path: path.join(screenshotDir, "05-activity-mobile.png"), fullPage: true });
  });

  test("6. Recipient Claim Page (Desktop & Mobile)", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await page.goto("/c/1790060937954", { waitUntil: "networkidle" });
    await assertLayoutIntegrity(page, "Claim Desktop");
    await page.screenshot({ path: path.join(screenshotDir, "06-claim-desktop.png"), fullPage: true });

    await page.setViewportSize(VIEWPORTS.mobile);
    await page.goto("/c/1790060937954", { waitUntil: "networkidle" });
    await assertLayoutIntegrity(page, "Claim Mobile");
    await page.screenshot({ path: path.join(screenshotDir, "06-claim-mobile.png"), fullPage: true });
  });
});
