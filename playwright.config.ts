import { defineConfig, devices } from "@playwright/test";

const targetUrl = process.env.TARGET_URL;

export default defineConfig({
  testDir: "test/browser",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  use: {
    baseURL: targetUrl || "http://localhost:5173",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  ...(targetUrl
    ? {}
    : {
        webServer: [
          { command: "pnpm dev:server", url: "http://127.0.0.1:8787/health", reuseExistingServer: !process.env.CI, timeout: 30_000 },
          { command: "pnpm dev:web", url: "http://localhost:5173", reuseExistingServer: !process.env.CI, timeout: 30_000 },
        ],
      }),
});
