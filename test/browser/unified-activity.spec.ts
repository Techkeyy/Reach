import { test, expect } from "@playwright/test";

const address = "0x0bf9000000000000000000000000000000000D42";
const other = "0x2222222222222222222222222222222222222222";
const signer = "0x3333333333333333333333333333333333333333";

test("authenticated account address and unified sent/received activity use public authority", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.route("**/api/activity/**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      address,
      activities: [
        {
          payoutId: "101",
          direction: "SENT",
          amount: "1000000",
          lifecycle: "FUNDED",
          sender: address,
          claimant: "0x0000000000000000000000000000000000000000",
          expiresAt: "2000000000",
          claimSigner: signer,
          createdAt: "2026-09-30T10:00:00.000Z",
        },
        {
          payoutId: "102",
          direction: "RECEIVED",
          amount: "2500000",
          lifecycle: "CLAIMED",
          sender: other,
          claimant: address,
          expiresAt: "2000000000",
          claimSigner: signer,
          claimedAt: "2026-09-30T11:00:00.000Z",
          txHash: "0x4444444444444444444444444444444444444444444444444444444444444444",
        },
        {
          payoutId: "103",
          direction: "SENT",
          amount: "500000",
          lifecycle: "RECLAIMED",
          sender: address,
          claimant: "0x0000000000000000000000000000000000000000",
          expiresAt: "1000000000",
          claimSigner: signer,
          createdAt: "2026-09-29T10:00:00.000Z",
        },
      ],
    }),
  }));

  await page.goto("/app/home?sessionFixture=connected", { waitUntil: "networkidle" });
  await expect(page.getByText("Your Reach address", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Copy address", exact: true }).click();
  await expect(page.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(address);

  await page.goto("/app/send?sessionFixture=connected", { waitUntil: "networkidle" });
  await expect(page.getByText("Your Reach address", { exact: true })).toBeVisible();
  await expect(page.locator(".account-address-value")).toHaveText("0x0bf9...0D42");
  await page.getByRole("button", { name: "Copy address", exact: true }).click();
  await expect(page.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(address);

  await page.getByRole("button", { name: "Activity", exact: true }).first().click();
  await expect(page.getByRole("tab", { name: "All (3)" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Sent (2)" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Received (1)" })).toBeVisible();

  await page.getByRole("tab", { name: "Received (1)" }).click();
  await expect(page.getByText("Received", { exact: true })).toBeVisible();
  await page.getByRole("listitem").click();
  await expect(page.getByText("Claimed by recipient", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Return funds to wallet", { exact: true })).toHaveCount(0);
});
