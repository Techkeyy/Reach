import { expect, test } from "@playwright/test";

test("shared chain clock keeps Home, Activity and Detail truthful through failure and navigation", async ({ page }) => {
  test.skip(Boolean(process.env.TARGET_URL), "Local module fixture only; never inject into a deployed app");
  page.on("pageerror", error => console.error("fixture runtime:", error.message));
  await page.goto("/");
  const mountFixture = () => page.evaluate(async () => {
    const entry = await (await fetch("/src/client/main.tsx")).text();
    const hook = await (await fetch("/src/client/useChainClock.ts")).text();
    const reactUrl = hook.match(/"([^"\n]*\/react\.js\?[^"\n]+)"/)![1];
    const domUrl = entry.match(/"([^"\n]*\/react-dom_client\.js\?[^"\n]+)"/)![1];
    const reactModule = await import(/* @vite-ignore */ reactUrl);
    const React = reactModule.default ?? reactModule;
    const domModule = await import(/* @vite-ignore */ domUrl);
    const { createRoot } = domModule.default ?? domModule;
    const { useChainClock } = await import(/* @vite-ignore */ "/src/client/useChainClock.ts");
    const { default: Detail } = await import(/* @vite-ignore */ "/src/client/PayoutDetail.tsx");
    const { default: Activity } = await import(/* @vite-ignore */ "/src/client/ActivityFeed.tsx");
    const { default: Home } = await import(/* @vite-ignore */ "/src/client/HomeDashboard.tsx");
    const h = React.createElement;
    const record = { id: "42", amount: "10000", expiresAt: "2000", claimSigner: "0x1111111111111111111111111111111111111111", createdAt: "2026-09-29T21:19:07.000Z", submissionState: "CONFIRMED" };
    const sender = "0x2222222222222222222222222222222222222222";
    let next: bigint | undefined;
    const reader = { getBlock: async () => { if (next === undefined) throw Error("fixture unavailable"); return { timestamp: next }; } };
    const noop = () => {};
    function Harness() {
      const clock = useChainClock(reader, true);
      const [view, setView] = React.useState("home");
      const live = { ...record, status: 1, expiresAt: 2000n, sender, claimant: "0x0000000000000000000000000000000000000000", chainTimestamp: clock.timestamp };
      const shared = { payouts: [record], payoutStatuses: { "42": live }, refreshing: false, onStartSend: noop, onSelectPayout: () => setView("detail") };
      return h("div", {},
        h("button", { onClick: () => { next = 2000n; void clock.refresh(); } }, "Fixture expire"),
        h("button", { onClick: () => { next = undefined; void clock.refresh(); } }, "Fixture fail"),
        h("button", { onClick: () => { next = 1000n; void clock.refresh(); } }, "Fixture older block"),
        h("button", { onClick: () => setView("activity") }, "Fixture Activity"),
        view === "home" ? h(Home, { ...shared, balanceState: { status: "UNAVAILABLE" }, onAddTestFunds: noop, onViewAllActivity: () => setView("activity"), onRefreshBalance: noop }) :
        view === "activity" ? h(Activity, { ...shared, onRefresh: clock.refresh }) :
        h(Detail, { record, live, connectedAddress: sender, onBack: () => setView("activity"), onReturnFunds: async () => { throw Error("Forbidden in read-only fixture"); }, returningFunds: false }),
      );
    }
    const mount = document.createElement("div");
    mount.id = "expiry-fixture";
    document.body.append(mount);
    createRoot(mount).render(h(Harness));
  });
  await mountFixture();
  const app = page.locator("#expiry-fixture");
  await expect(app).toContainText("Checking payout expiry");
  await expect(app).not.toContainText("Waiting for recipient");
  await app.getByRole("button", { name: "Fixture expire", exact: true }).click();
  await expect(app).toContainText("Expired · Ready to return");
  await app.getByRole("button", { name: "Fixture Activity", exact: true }).click();
  await expect(app).toContainText("Expired · Ready to return");
  await app.getByRole("listitem").click();
  await expect(app.getByRole("button", { name: "Return funds to wallet" })).toBeVisible();
  await app.getByRole("button", { name: "Fixture fail", exact: true }).click();
  await expect(app).toContainText("Verifying payout status");
  await expect(app).not.toContainText("Active until");
  await expect(app.getByRole("button", { name: "Return funds to wallet" })).toHaveCount(0);
  await app.getByRole("button", { name: "Fixture older block", exact: true }).click();
  await expect(app).toContainText("Expired · Ready to return");
  await app.getByRole("button", { name: "Back to activity" }).click();
  await expect(app).toContainText("Expired · Ready to return");
  await page.reload();
  await mountFixture();
  await expect(app).toContainText("Checking payout expiry");
  await expect(app).not.toContainText("Waiting for recipient");
  await app.getByRole("button", { name: "Fixture expire", exact: true }).click();
  await expect(app).toContainText("Expired · Ready to return");
});
