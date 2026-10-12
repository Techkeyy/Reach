import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const source = pathToFileURL(resolve(root, "public/reach-mark.svg")).href;
const destination = resolve(root, "public/icons");
await mkdir(destination, { recursive: true });

const browser = await chromium.launch();
try {
  for (const size of [16, 32, 48, 180, 192, 512]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.goto(source);
    await page.screenshot({ path: resolve(destination, `reach-${size}.png`), omitBackground: size !== 180 });
    await page.close();
  }
} finally {
  await browser.close();
}
