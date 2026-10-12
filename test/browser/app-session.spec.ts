import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const screenshotDir = path.join(process.cwd(), "artifacts", "screenshots-onboarding");
const connectedAppPath = "/app/home?sessionFixture=connected";

function screenshotPath(name: string) {
  fs.mkdirSync(screenshotDir, { recursive: true });
  return path.join(screenshotDir, name);
}

async function expectPublicLanding(page: Page) {
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator(".app-layout")).toHaveCount(0);
  await expect(page.locator(".ux15-hero").getByRole("button", { name: /^(Get started|Open Reach)$/ })).toBeVisible();
}

test.describe("Reach app escape and sign-out", () => {
  test("the app logo returns home without signing out, and the hero action returns to the app", async ({ page }) => {
    const authRequests: string[] = [];
    page.on("request", request => {
      if (request.url().includes("/auth/")) authRequests.push(request.url());
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(connectedAppPath, { waitUntil: "networkidle" });
    await expect(page.locator(".app-layout")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out" }).first()).toBeVisible();
    await page.screenshot({ path: screenshotPath("app-session-signed-in-desktop.png"), fullPage: false });

    await page.locator("a.sidebar-brand").click();
    await expectPublicLanding(page);
    await page.screenshot({ path: screenshotPath("app-session-public-after-logo-desktop.png"), fullPage: false });

    await page.locator(".ux15-hero").getByRole("button", { name: /^(Get started|Open Reach)$/ }).click();
    await expect(page).toHaveURL(/\/app\/home$/);
    await expect(page.locator(".app-layout")).toBeVisible();
    expect(authRequests).toEqual([]);
  });

  test("Sign out clears the active session, returns home, and opens the gateway on the next launch", async ({ page }) => {
    const authRequests: string[] = [];
    page.on("request", request => {
      if (request.url().includes("/auth/")) authRequests.push(request.url());
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(connectedAppPath, { waitUntil: "networkidle" });
    await expect(page.getByText("Your Reach address", { exact: true })).toBeVisible();
    await page.locator(".desktop-sidebar").getByRole("button", { name: "Sign out" }).click();

    await expectPublicLanding(page);
    await expect(page.getByText("Your Reach address", { exact: true })).toHaveCount(0);
    await expect(page.locator(".desktop-sidebar")).toHaveCount(0);
    await page.screenshot({ path: screenshotPath("app-session-public-after-sign-out-desktop.png"), fullPage: false });

    await page.locator(".ux15-hero").getByRole("button", { name: "Get started" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('[data-onboarding-stage="ACCOUNT_GATEWAY"]')).toBeVisible();
    await expect(page.getByRole("heading", { name: "Welcome to Reach" })).toBeVisible();
    await page.screenshot({ path: screenshotPath("app-session-account-gateway-after-sign-out-desktop.png"), fullPage: false });
    expect(authRequests).toEqual([]);

    await page.goto(connectedAppPath, { waitUntil: "networkidle" });
    await expect(page.getByText("Your Reach address", { exact: true })).toBeVisible();
    await expect(page.locator(".account-address-value")).toHaveText("0x0bf9...0D42");
  });

  test("direct app routes redirect signed-out users to the public landing page", async ({ page }) => {
    await page.goto("/app/home", { waitUntil: "networkidle" });
    await expectPublicLanding(page);
    await expect(page.locator(".desktop-sidebar")).toHaveCount(0);
  });
});
