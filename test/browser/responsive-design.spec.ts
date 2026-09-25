import { test, expect } from "@playwright/test";
import { privateKeyToAccount } from "viem/accounts";

const capabilityBytes = "2a".repeat(32);
const capability = Buffer.from(capabilityBytes, "hex").toString("base64url");
const capabilitySigner = privateKeyToAccount(`0x${capabilityBytes}`);
const zero = "0x0000000000000000000000000000000000000000";
const payout = {
  sender: "0x1111111111111111111111111111111111111111",
  amount: "50000000",
  expiresAt: "4102444800",
  claimSigner: capabilitySigner.address,
  status: 1,
  claimant: zero,
};

const viewports = [
  { width: 375, height: 667, name: "mobile_375x667" },
  { width: 390, height: 844, name: "mobile_390x844" },
  { width: 430, height: 932, name: "mobile_430x932" },
  { width: 768, height: 1024, name: "tablet_768x1024" },
  { width: 1440, height: 900, name: "desktop_1440x900" },
];

for (const vp of viewports) {
  test(`sender dashboard renders without horizontal overflow at ${vp.width}x${vp.height}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.route("**/api/payouts/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ payouts: [] }) }));
    await page.goto("/");
    
    // Check no horizontal scroll
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1); // 1px rounding tolerance
    
    // Check main elements
    await expect(page.getByRole("heading", { name: "Send pathUSD" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Review payout/ })).toBeVisible();
  });

  test(`recipient claim renders without horizontal overflow at ${vp.width}x${vp.height}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.route("**/api/payout/123", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payout) }));
    await page.goto(`/c/123#${capability}`);
    
    // Check no horizontal scroll
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
    
    // Check dominant amount and claim button
    await expect(page.getByRole("button", { name: "Claim $50.00" })).toBeVisible();
  });
}
