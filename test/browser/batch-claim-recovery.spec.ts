import { expect, test } from "@playwright/test";

test("Activity opens a funded batch payout with its sender-local Copy claim link action", async ({ page }) => {
  test.skip(Boolean(process.env.TARGET_URL), "Local module fixture only; never inject into a deployed app");
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    const entry = await (await fetch("/src/client/main.tsx")).text();
    const hook = await (await fetch("/src/client/useChainClock.ts")).text();
    const reactUrl = hook.match(/"([^"\n]*\/react\.js\?[^"\n]+)"/)![1];
    const domUrl = entry.match(/"([^"\n]*\/react-dom_client\.js\?[^"\n]+)"/)![1];
    const reactModule = await import(/* @vite-ignore */ reactUrl);
    const React = reactModule.default ?? reactModule;
    const domModule = await import(/* @vite-ignore */ domUrl);
    const { createRoot } = domModule.default ?? domModule;
    const { default: Activity } = await import(/* @vite-ignore */ "/src/client/ActivityFeed.tsx");
    const { default: Detail } = await import(/* @vite-ignore */ "/src/client/PayoutDetail.tsx");
    const h = React.createElement;
    const sender = "0x1111111111111111111111111111111111111111";
    const claimSigner = "0x2222222222222222222222222222222222222222";
    const record = {
      id: "42", amount: "1000000", expiresAt: "2000", claimSigner,
      batchId: "batch:42,43,44", recipientName: "Alex Rivera", memo: "Design bounty",
      label: "Design bounty", createdAt: "2026-10-01T00:00:00.000Z", submissionState: "CONFIRMED",
    };
    const live = { sender, amount: "1000000", expiresAt: 2000n, claimSigner, status: 1, claimant: "0x0000000000000000000000000000000000000000", chainTimestamp: 1000n };
    const url = "http://localhost:5173/c/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA#cap=ERERERERERERERERERERERERERERERERERERERERERE";
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: (value: string) => { (window as Window & { __copiedClaim?: string }).__copiedClaim = value; return Promise.resolve(); } } });
    function Harness() {
      const [detail, setDetail] = React.useState(false);
      return detail
        ? h(Detail, { record, live, connectedAddress: sender, capabilityAvailable: true, recoverableClaimUrl: url, onBack: () => setDetail(false), onReturnFunds: async () => {}, returningFunds: false })
        : h(Activity, { payouts: [record], payoutStatuses: { "42": live }, onSelectPayout: () => setDetail(true), onStartSend: () => {}, onRefresh: () => {}, refreshing: false });
    }
    const mount = document.createElement("div");
    mount.id = "batch-claim-recovery-fixture";
    document.body.append(mount);
    createRoot(mount).render(h(Harness));
  });
  const app = page.locator("#batch-claim-recovery-fixture");
  await expect(app).toContainText("$1.00");
  await app.getByRole("listitem").click();
  await expect(app.getByRole("button", { name: "Copy claim link", exact: true })).toBeVisible();
  await app.getByRole("button", { name: "Copy claim link", exact: true }).click();
  await expect(app.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { __copiedClaim?: string }).__copiedClaim)).toBe("http://localhost:5173/c/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA#cap=ERERERERERERERERERERERERERERERERERERERERERE");
});
