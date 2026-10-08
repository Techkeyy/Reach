import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const VIEWPORTS = {
  desktop1920: { name: "desktop-1920x1080", width: 1920, height: 1080 },
  desktop1440: { name: "desktop-1440x900", width: 1440, height: 900 },
  mobile390: { name: "mobile-390x844", width: 390, height: 844 },
};

const screenshotDir = path.resolve(process.cwd(), "artifacts/screenshots-v3");

test.describe("Reach UI V3 Fluenci-Led Surface QA & Screenshots", () => {
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

  test("1. Public Dashboard 1920x1080", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop1920);
    await page.goto("/", { waitUntil: "networkidle" });
    await assertLayoutIntegrity(page, "Public Dashboard 1920");
    await page.screenshot({ path: path.join(screenshotDir, "01-public-dashboard-1920.png"), fullPage: false });
  });

  test("2. Public Dashboard 1440x900", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop1440);
    await page.goto("/", { waitUntil: "networkidle" });
    await assertLayoutIntegrity(page, "Public Dashboard 1440");
    await page.screenshot({ path: path.join(screenshotDir, "02-public-dashboard-1440.png"), fullPage: false });
  });

  test("3. Public Dashboard Mobile 390x844", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile390);
    await page.goto("/", { waitUntil: "networkidle" });
    await assertLayoutIntegrity(page, "Public Dashboard Mobile 390");
    await page.screenshot({ path: path.join(screenshotDir, "03-public-dashboard-mobile-390.png"), fullPage: false });
  });

  test("4. Public Dashboard Lower Sections After Scrolling", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop1440);
    await page.goto("/", { waitUntil: "networkidle" });
    
    // Scroll through page to trigger all reveals
    await page.evaluate(async () => {
      const scrollStep = window.innerHeight / 2;
      const totalHeight = document.body.scrollHeight;
      for (let y = 0; y < totalHeight; y += scrollStep) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 100));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(400);

    // Scroll down to the comparison matrix and modular grid
    await page.evaluate(() => {
      const el = document.getElementById("built-on-tempo") || document.querySelector(".modular-section");
      if (el) el.scrollIntoView({ behavior: "instant" });
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(screenshotDir, "04-public-dashboard-scrolled-1440.png"), fullPage: false });

    // Also capture the complete full-page composition
    await page.screenshot({ path: path.join(screenshotDir, "04-public-dashboard-fullpage-1440.png"), fullPage: true });
  });

  test("5. /app Desktop 1440x900", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop1440);
    await page.goto("/app/home?sessionFixture=connected", { waitUntil: "networkidle" });
    
    await page.evaluate(() => {
      window.sessionStorage.setItem("reach.sender.payouts", JSON.stringify([
        { id: "1790060937954", amount: "250000000", expiresAt: "2000000000", claimSigner: "0x1111111111111111111111111111111111111111", createdAt: new Date(Date.now() - 3600000).toISOString(), label: "Contractor payment" },
        { id: "1790060937955", amount: "50000000", expiresAt: "1700000000", claimSigner: "0x2222222222222222222222222222222222222222", createdAt: new Date(Date.now() - 86400000).toISOString(), label: "Dinner split" }
      ]));
    });
    await page.goto("/app/home?sessionFixture=connected", { waitUntil: "networkidle" });

    await assertLayoutIntegrity(page, "/app Desktop 1440");
    await page.screenshot({ path: path.join(screenshotDir, "05-app-desktop-1440.png"), fullPage: false });
  });

  test("6. /app Mobile 390x844", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile390);
    await page.goto("/app/home", { waitUntil: "networkidle" });
    await assertLayoutIntegrity(page, "/app Mobile 390");
    await page.screenshot({ path: path.join(screenshotDir, "06-app-mobile-390.png"), fullPage: false });
  });

  test("7. /app/send Desktop 1440x900", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop1440);
    await page.goto("/app/send?sessionFixture=connected", { waitUntil: "networkidle" });

    const amountInput = page.locator("input.amount-huge-input").first();
    if (await amountInput.isVisible()) {
      await amountInput.fill("50.00");
    }

    await assertLayoutIntegrity(page, "/app/send Desktop");
    await page.screenshot({ path: path.join(screenshotDir, "07-app-send-desktop-1440.png"), fullPage: false });
  });

  test("8. /app/send Mobile 390x844", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile390);
    await page.goto("/app/send?sessionFixture=connected", { waitUntil: "networkidle" });

    const mobileInput = page.locator("input.amount-huge-input").first();
    if (await mobileInput.isVisible()) {
      await mobileInput.fill("50.00");
    }

    await assertLayoutIntegrity(page, "/app/send Mobile");
    await page.screenshot({ path: path.join(screenshotDir, "08-app-send-mobile-390.png"), fullPage: false });
  });

  test("9. Recipient Claim Mobile 390x844", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.mobile390);
    // The visual shell is ready at DOMContentLoaded; live payout and balance
    // reads must not make this layout smoke wait on networkidle.
    await page.goto("/c/1790060937954", { waitUntil: "domcontentloaded" });
    await assertLayoutIntegrity(page, "Recipient Claim Mobile");
    await page.screenshot({ path: path.join(screenshotDir, "09-recipient-claim-mobile-390.png"), fullPage: false });
  });

  test("10. /app/fund Desktop 1440x900", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop1440);
    await page.goto("/app/fund?sessionFixture=connected", { waitUntil: "networkidle" });
    await assertLayoutIntegrity(page, "/app/fund Desktop 1440");
    await page.screenshot({ path: path.join(screenshotDir, "10-app-fund-desktop-1440.png"), fullPage: false });
  });

  test("11. /app/batch Desktop 1440x900", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop1440);
    await page.goto("/app/batch?sessionFixture=connected", { waitUntil: "networkidle" });
    await assertLayoutIntegrity(page, "/app/batch Desktop 1440");
    await page.screenshot({ path: path.join(screenshotDir, "11-app-batch-desktop-1440.png"), fullPage: false });
  });

  test("12. /app/automation Desktop 1440x900", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop1440);
    await page.goto("/app/automation?sessionFixture=connected", { waitUntil: "networkidle" });
    await assertLayoutIntegrity(page, "/app/automation Desktop 1440");
    await page.screenshot({ path: path.join(screenshotDir, "12-app-automation-desktop-1440.png"), fullPage: false });
  });

  test("13. sender Activity survives reload with public payout metadata and no bearer", async ({ page }) => {
    await page.route("**/api/activity/**", route => route.fulfill({
      json: { address: "0x0bf9000000000000000000000000000000000D42", activities: [], authorityIncomplete: true },
    }));
    await page.addInitScript(() => {
      window.localStorage.setItem("reach.sender.payouts", JSON.stringify([{
        id: "24599730976579210805774763736135222048697658670242430770008130491816224571791",
        amount: "100000000",
        expiresAt: "2000000000",
        claimSigner: "0x3333333333333333333333333333333333333333",
        fundingTxHash: "0x4444444444444444444444444444444444444444444444444444444444444444",
        createdAt: new Date().toISOString(),
        submissionState: "CONFIRMED",
      }]));
    });
    await page.goto("/app/activity?sessionFixture=connected", { waitUntil: "networkidle" });
    // Under the full serial visual suite, local module/API startup can exceed
    // Playwright's 5s locator default even though the fixture remains valid.
    await expect(page.getByText("$100.00", { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("listitem").click();
    await expect(page.getByText("Private claim link is unavailable on this device.", { exact: true })).toBeVisible();
    await expect(page.getByText("Checking payout status", { exact: true })).toBeVisible();
    await expect(page.getByText("Funded by sender", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Waiting for recipient", { exact: true })).toHaveCount(0);
    await page.goto("/app/payout/24599730976579210805774763736135222048697658670242430770008130491816224571791?sessionFixture=connected", { waitUntil: "networkidle" });
    await expect(page.getByText("Private claim link is unavailable on this device.", { exact: true })).toBeVisible();
    await expect(page.getByText("Checking payout status", { exact: true })).toBeVisible();
    await page.unroute("**/api/activity/**");
    await page.route("**/api/activity/**", route => route.fulfill({
      json: { address: "0x0bf9000000000000000000000000000000000D42", activities: [], authorityComplete: true, authorityIncomplete: false },
    }));
    await page.goto("/app/activity?sessionFixture=connected", { waitUntil: "networkidle" });
    await expect(page.getByRole("tab", { name: "All (0)", exact: true })).toBeVisible();
    await expect(page.getByRole("listitem")).toHaveCount(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("reach.sender.payouts") ?? "[]").length)).toBe(1);
  });
});
