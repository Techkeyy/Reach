import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const target = process.argv[2] || 'http://localhost:5173/';
const output = path.resolve('artifacts/task015a', target.startsWith('https:') ? 'live' : 'local');
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
for (const width of [320, 375, 390, 768, 1280, 1440]) {
  const height = width <= 390 ? 844 : 900;
  const context = await browser.newContext({ viewport: { width, height }, recordVideo: [390, 1440].includes(width) ? { dir: output, size: { width, height } } : undefined });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  const response = await page.goto(target, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(output, `hero-${width}.png`) });
  const initial = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - innerWidth,
    height: document.documentElement.scrollHeight,
    heroFont: getComputedStyle(document.querySelector('h1')).fontFamily,
    ctaColor: getComputedStyle(document.querySelector('.ux15-hero .ux15-button-primary')).backgroundColor,
    tokenAnimation: getComputedStyle(document.querySelector('.ux15-scene-token')).animationName,
    tokenTransform: getComputedStyle(document.querySelector('.ux15-scene-token')).transform,
    faqCount: document.querySelectorAll('.ux15-faq-item').length,
    technicalText: /Tempo Moderato|42431|pathUSD|WebAuthn|configured relay/.test(document.body.innerText),
  }));
  await page.waitForTimeout(1400);
  const moved = await page.locator('.ux15-scene-token').evaluate((el, original) => getComputedStyle(el).transform !== original, initial.tokenTransform);
  if (width === 1440) {
    await page.locator('.ux15-hero-scene').hover();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(output, 'hero-hover-1440.png') });
  }
  const maxY = initial.height - height;
  for (let y = 0; y <= maxY; y += Math.round(height * .62)) {
    await page.evaluate((value) => scrollTo({ top: value, behavior: 'instant' }), y);
    await page.waitForTimeout([390, 1440].includes(width) ? 180 : 35);
  }
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(output, `full-${width}.png`), fullPage: true });
  await page.getByRole('button', { name: 'What is Reach?' }).click();
  const faqOpen = await page.getByRole('button', { name: 'What is Reach?' }).getAttribute('aria-expanded');
  if (width <= 768) {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.waitForTimeout(270);
    await page.screenshot({ path: path.join(output, `menu-${width}.png`) });
  }
  const video = page.video();
  await context.close();
  if (video) await fs.rename(await video.path(), path.join(output, `motion-${width}.webm`));
  console.log(JSON.stringify({ width, status: response?.status(), ...initial, tokenMoved: moved, faqOpen, errors }));
}
const reduced = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
const reducedPage = await reduced.newPage();
await reducedPage.goto(target, { waitUntil: 'domcontentloaded' });
await reducedPage.screenshot({ path: path.join(output, 'reduced-motion-390.png') });
console.log(JSON.stringify({ reducedMotion: await reducedPage.evaluate(() => ({ tokenAnimation: getComputedStyle(document.querySelector('.ux15-scene-token')).animationName, tokenVisible: getComputedStyle(document.querySelector('.ux15-scene-token')).visibility, overflow: document.documentElement.scrollWidth - innerWidth })) }));
await reduced.close();
await browser.close();
