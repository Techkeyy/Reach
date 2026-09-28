import { test, expect } from "@playwright/test";

test("failed passkey login is visible after the explicit account gateway choice", async ({ page }) => {
  await page.route("**/auth/login/options", route =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "authentication unavailable" }),
    }),
  );

  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Launch Reach" }).last().click();
  await expect(page.locator('[data-onboarding-stage="ACCOUNT_GATEWAY"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Create Reach account" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Already have a Reach account/ })).toBeVisible();

  await page.getByRole("button", { name: /Already have a Reach account/ }).click();
  await expect(page.locator('[data-onboarding-stage="LOGIN"]')).toBeVisible();
  await page.getByRole("button", { name: "Sign in with passkey" }).click();

  await expect(page.getByRole("alert")).toContainText("We couldn't sign you in.");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Use another passkey" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});
