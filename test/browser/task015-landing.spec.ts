import { test, expect } from "@playwright/test";

const widths = [320, 375, 390, 768, 1280, 1440];
for (const width of widths) {
  test(`Task 015 landing retains content and layout at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 900 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByRole("heading", { name: /Send money to people/i })).toBeVisible();
    await expect(page.locator(".ux15-faq-item")).toHaveCount(9);
    for (const heading of ["Fast Payments", "Protected Payments", "Batch Payments", "How Reach works", "Clear from funding to recovery.", "The details should be visible."]) {
      await expect(page.getByRole("heading", { name: heading, exact: true })).toHaveCount(1);
    }
    const state = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - innerWidth,
      family: getComputedStyle(document.querySelector(".ux15-hero-title")!).fontFamily,
      fontLoaded: document.fonts.check('800 48px "Inter Variable"'),
      primaryColor: getComputedStyle(document.querySelector(".ux15-hero .ux15-button-primary")!).backgroundColor,
      sectionsVisible: [...document.querySelectorAll("main > section")].every((el) => getComputedStyle(el).opacity === "1" && getComputedStyle(el).visibility === "visible"),
      text: document.body.innerText,
    }));
    expect(state.overflow).toBe(0);
    expect(state.family).toContain("Inter Variable");
    expect(state.fontLoaded).toBe(true);
    expect(state.primaryColor).toBe("rgb(0, 245, 155)");
    expect(state.sectionsVisible).toBe(true);
    expect(state.text).toContain("test tokens, not real money");
    expect(state.text).not.toMatch(/Tempo Moderato|Chain ID|42431|pathUSD|WebAuthn|RPC|configured relay/i);
    expect(state.text).not.toMatch(/agent payments|MPP|product preview|sample balance/i);
    await expect(page.getByRole("img", { name: /Concept illustration: a sender shares a payment link/i })).toHaveCount(1);
    expect(errors).toEqual([]);
  });
}

test("Task 015 mobile menu, keyboard FAQ, and Get started reach the real account gateway", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const menu = page.getByRole("button", { name: "Open navigation" });
  await menu.click();
  await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();
  await page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("button", { name: "FAQ" }).click();
  await expect(page.getByRole("button", { name: "Open navigation" })).toHaveAttribute("aria-expanded", "false");
  const faq = page.getByRole("button", { name: "What is Reach?" });
  await faq.focus();
  await page.keyboard.press("Enter");
  await expect(faq).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#reach-faq-answer-0")).toHaveAttribute("aria-hidden", "false");
  await page.getByRole("button", { name: "Get started" }).first().click();
  await expect(page.getByText("Create an account to send money, receive payments, and manage payouts.")).toBeVisible();
});

test("Task 015 reduced motion leaves all content readable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(() => ({
    headingOpacity: getComputedStyle(document.querySelector(".ux15-hero-title")!).opacity,
    headingAnimation: getComputedStyle(document.querySelector(".ux15-hero-title")!).animationName,
    tokenAnimation: getComputedStyle(document.querySelector(".ux15-scene-token")!).animationName,
    sceneVisible: getComputedStyle(document.querySelector(".ux15-hero-scene")!).visibility,
    sectionsVisible: [...document.querySelectorAll("main > section")].every((el) => getComputedStyle(el).opacity === "1"),
    overflow: document.documentElement.scrollWidth - innerWidth,
  }));
  expect(result).toEqual({ headingOpacity: "1", headingAnimation: "none", tokenAnimation: "none", sceneVisible: "visible", sectionsVisible: true, overflow: 0 });
});

test("Task 015A hero handoff loops and responds to desktop hover", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const token = page.locator(".ux15-scene-token");
  await expect(token).toBeVisible();
  const before = await token.evaluate((el) => ({ name: getComputedStyle(el).animationName, duration: getComputedStyle(el).animationDuration, transform: getComputedStyle(el).transform }));
  await page.waitForTimeout(1450);
  const after = await token.evaluate((el) => getComputedStyle(el).transform);
  expect(before.name).toBe("ux15-token-travel");
  expect(after).not.toBe(before.transform);
  await page.locator(".ux15-hero-scene").hover();
  await expect.poll(() => token.evaluate((el) => getComputedStyle(el).animationDuration)).toBe("4.5s");
});
