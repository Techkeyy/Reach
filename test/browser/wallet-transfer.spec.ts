import { test, expect } from "@playwright/test";

const address = "0x0bf9000000000000000000000000000000000D42";
const recipient = "0x2222222222222222222222222222222222222222";

test("send mode makes direct wallet intent explicit and reviews without creating a Reach payout", async ({ page }) => {
  const relayRequests: string[] = [];
  page.on("request", request => {
    if (new URL(request.url()).pathname === "/relay") relayRequests.push(request.method());
  });
  await page.route("**/api/balance/**", route => route.fulfill({ json: { address, token: "0x20c0000000000000000000000000000000000000", balance: "10000000" } }));
  await page.route("**/api/activity/**", route => route.fulfill({ json: { address, activities: [] } }));

  await page.goto("/app/send?sessionFixture=connected", { waitUntil: "networkidle" });
  await expect(page.getByRole("group", { name: "How do you want to send?" })).toBeVisible();
  await page.getByRole("button", { name: /Send to wallet/ }).click();
  const wallet = page.getByRole("region", { name: "Send to wallet" });
  await expect(wallet).toBeVisible();

  await wallet.getByLabel("Recipient wallet address").fill(recipient);
  await wallet.getByLabel("Amount").fill("1.25");
  await wallet.getByRole("button", { name: "Review transfer" }).click();
  await expect(wallet.locator(".review-breakdown-table")).toBeVisible();
  await expect(wallet.getByText("$1.25 pathUSD", { exact: true })).toBeVisible();
  await expect(wallet.getByText("Tempo Moderato", { exact: true })).toBeVisible();
  expect(relayRequests).toEqual([]);
});

test("wallet transfer form rejects an invalid recipient before review", async ({ page }) => {
  await page.route("**/api/balance/**", route => route.fulfill({ json: { address, token: "0x20c0000000000000000000000000000000000000", balance: "10000000" } }));
  await page.goto("/app/send?sessionFixture=connected", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Send to wallet/ }).click();
  const wallet = page.getByRole("region", { name: "Send to wallet" });
  await wallet.getByLabel("Recipient wallet address").fill("not-an-address");
  await wallet.getByLabel("Amount").fill("1");
  await wallet.getByRole("button", { name: "Review transfer" }).click();
  await expect(page.getByRole("alert")).toContainText("valid Tempo wallet address");
});
