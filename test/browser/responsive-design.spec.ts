import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const BASE_URL = process.env.TARGET_URL || "https://reach-seven-lemon.vercel.app";

const VIEWPORTS = [
  { name: "mobile-375x667", width: 375, height: 667 },
  { name: "mobile-390x844", width: 390, height: 844 },
  { name: "mobile-430x932", width: 430, height: 932 },
  { name: "tablet-768x1024", width: 768, height: 1024 },
  { name: "desktop-1440x900", width: 1440, height: 900 },
];

test.describe("Production Responsive Layout & QA Tests", () => {
  const screenshotDir = path.resolve(process.cwd(), "artifacts/screenshots");

  test.beforeAll(() => {
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
  });

  for (const vp of VIEWPORTS) {
    test(`Landing page renders without horizontal overflow on ${vp.name} (${vp.width}x${vp.height})`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });

      // Verify no horizontal overflow
      const overflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });
      expect(overflow).toBe(false);

      // Verify no em-dash or en-dash in rendered text
      const pageText = await page.evaluate(() => document.body.innerText);
      expect(pageText).not.toMatch(/[\u2013\u2014]/);

      // Verify primary action button exists and meets touch target sizing
      const actionBtn = page.locator("button.hero-cta-btn, button.claim-button").first();
      if (await actionBtn.isVisible()) {
        const box = await actionBtn.boundingBox();
        expect(box).not.toBeNull();
        if (box) {
          expect(box.height).toBeGreaterThanOrEqual(44);
        }
      }

      // Capture screenshot
      await page.screenshot({
        path: path.join(screenshotDir, `landing-${vp.name}.png`),
        fullPage: true,
      });
    });

    test(`Claim page renders correctly on ${vp.name} (${vp.width}x${vp.height})`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`${BASE_URL}/c/1790060937954`, { waitUntil: "networkidle" });

      // Verify no horizontal overflow
      const overflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });
      expect(overflow).toBe(false);

      // Verify no em-dash or en-dash in rendered text
      const pageText = await page.evaluate(() => document.body.innerText);
      expect(pageText).not.toMatch(/[\u2013\u2014]/);

      // Verify claim card is visible
      const claimCard = page.locator(".claim-card");
      await expect(claimCard).toBeVisible();

      // Capture screenshot
      await page.screenshot({
        path: path.join(screenshotDir, `claim-${vp.name}.png`),
        fullPage: true,
      });
    });
  }
});
