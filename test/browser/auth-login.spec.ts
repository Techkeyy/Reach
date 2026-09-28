import { test, expect } from "@playwright/test";

test("failed passkey login is visible and does not silently stay on the landing page", async ({ page }) => {
  await page.route("**/auth/login/options", route =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "authentication unavailable" }),
    }),
  );

  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Launch Reach" }).last().click();

  await expect(page.getByRole("alert")).toContainText("We couldn't finish signing you in.");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Use another passkey" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});
