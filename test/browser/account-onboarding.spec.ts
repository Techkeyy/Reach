import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const screenshotDir = path.join(process.cwd(), "artifacts", "screenshots-onboarding");

function screenshotPath(name: string) {
  fs.mkdirSync(screenshotDir, { recursive: true });
  return path.join(screenshotDir, name);
}

async function expectStage(page: Page, stage: string) {
  await expect(page.locator(`[data-onboarding-stage="${stage}"]`)).toBeVisible();
}

test("Launch Reach opens the account gateway without invoking authentication", async ({ page }) => {
  const authRequests: string[] = [];
  page.on("request", request => {
    if (request.url().includes("/auth/")) authRequests.push(request.url());
  });

  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Launch Reach" }).last().click();

  await expectStage(page, "ACCOUNT_GATEWAY");
  await expect(page.getByRole("heading", { name: "Welcome to Reach" })).toBeVisible();
  await expect(page.getByText("Pay people, not wallet addresses.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create Reach account" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Already have a Reach account/ })).toBeVisible();
  expect(authRequests).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("account creation explains the passkey before starting the browser ceremony", async ({ page }) => {
  let registrationRequests = 0;
  const diagnosticMessages: string[] = [];
  page.on("console", message => {
    if (message.type() === "error" || message.text().includes("Reach diagnostic")) diagnosticMessages.push(message.text());
  });
  await page.route("**/auth/register/options", async route => {
    registrationRequests += 1;
    await new Promise(resolve => setTimeout(resolve, 400));
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "registration unavailable" }),
    });
  });

  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Launch Reach" }).last().click();
  await page.getByRole("button", { name: "Create Reach account" }).click();
  await expectStage(page, "CREATE_EXPLAINER");
  await expect(page.getByRole("heading", { name: "Secure your Reach account" })).toBeVisible();
  expect(registrationRequests).toBe(0);

  await page.getByRole("button", { name: "Create passkey" }).click();
  await expectStage(page, "REGISTERING_PASSKEY");
  await expectStage(page, "AUTH_FAILED");
  await expect(page.getByRole("alert")).toContainText("We couldn't start account setup.");
  expect(registrationRequests).toBe(1);
  expect(diagnosticMessages.some(message => message.includes("REGISTER_OPTIONS"))).toBe(true);
});

test("safe onboarding fixtures cover the owner-facing states", async ({ page }) => {
  test.setTimeout(60_000);
  const fixtures = [
    ["gateway", "ACCOUNT_GATEWAY", "gateway-desktop.png"],
    ["create-explainer", "CREATE_EXPLAINER", "create-explainer-desktop.png"],
    ["sign-in", "LOGIN", "sign-in-desktop.png"],
    ["authenticating", "AUTHENTICATING", "authenticating-desktop.png"],
    ["account-ready", "ACCOUNT_READY", "account-ready-desktop.png"],
    ["login-failure", "AUTH_FAILED", "login-failure-desktop.png"],
    ["registration-failure", "AUTH_FAILED", "registration-failure-desktop.png"],
  ] as const;

  for (const [fixture, stage, screenshot] of fixtures) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/?onboardingFixture=${fixture}`, { waitUntil: "networkidle" });
    await expectStage(page, stage);
    await expect(page.locator("main")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: screenshotPath(screenshot), fullPage: true });
  }

  for (const [fixture, stage, screenshot] of [
    ["gateway", "ACCOUNT_GATEWAY", "gateway-mobile.png"],
    ["create-explainer", "CREATE_EXPLAINER", "create-explainer-mobile.png"],
    ["sign-in", "LOGIN", "sign-in-mobile.png"],
  ] as const) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/?onboardingFixture=${fixture}`, { waitUntil: "networkidle" });
    await expectStage(page, stage);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: screenshotPath(screenshot), fullPage: true });
  }
});
