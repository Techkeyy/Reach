import { expect, test } from "@playwright/test";

test("batch draft edits never blank the page and keep submit disabled until valid", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/app/batch?sessionFixture=connected", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Batch Payouts" })).toBeVisible();

  await page.getByRole("button", { name: /Add Recipient/ }).click();
  const names = page.locator('input[placeholder="e.g. Alex Rivera"]');
  const amounts = page.locator('input[placeholder="0.00"]');
  await expect(names).toHaveCount(3);

  await names.nth(0).fill("Alice");
  await names.nth(1).fill("Bob");
  await names.nth(2).fill("Cara");
  await expect(page.getByText("Amount is required.", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve & Send Batch with Passkey" })).toBeDisabled();

  await amounts.nth(0).fill("1.");
  await amounts.nth(1).fill("0.");
  await amounts.nth(2).fill("1.0000001");
  await expect(page.getByRole("heading", { name: "Batch Payouts" })).toBeVisible();

  await amounts.nth(0).fill("1.25");
  await amounts.nth(1).fill("1.5");
  await amounts.nth(2).fill("0.25");
  await expect(page.getByText("$3.00 pathUSD", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve & Send Batch with Passkey" })).toBeDisabled();
  expect(pageErrors).toEqual([]);
});
