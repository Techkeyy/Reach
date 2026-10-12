import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const target = process.argv[2] ?? "http://localhost:5173";
const destination = resolve(import.meta.dirname, "../docs/images");
await mkdir(destination, { recursive: true });

const browser = await chromium.launch();
try {
  const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await desktop.emulateMedia({ reducedMotion: "reduce" });
  await desktop.goto(target, { waitUntil: "domcontentloaded" });
  await desktop.evaluate(() => document.fonts.ready);
  await desktop.screenshot({ path: resolve(destination, "reach-landing-desktop.png") });
  await desktop.locator("#payments").screenshot({ path: resolve(destination, "reach-payment-modes.png") });
  await desktop.locator(".ux15-hero").getByRole("button", { name: "Get started" }).click();
  await desktop.getByText("Create an account to send money, receive payments, and manage payouts.").waitFor();
  await desktop.screenshot({ path: resolve(destination, "reach-account-entry.png") });
  await desktop.close();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await mobile.emulateMedia({ reducedMotion: "reduce" });
  await mobile.goto(target, { waitUntil: "domcontentloaded" });
  await mobile.evaluate(() => document.fonts.ready);
  await mobile.screenshot({ path: resolve(destination, "reach-landing-mobile.png") });
  await mobile.close();
} finally {
  await browser.close();
}
