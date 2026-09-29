import { test, expect, type Page } from "@playwright/test";
const address = "0x1111111111111111111111111111111111111111";
const base = { address, chainId: 42431, token: "0x20c0000000000000000000000000000000000000", startingBalance: "847369" };
// Actual component, fixture public account, mocked HTTP. No real wallet or faucet.
async function mountFunding(page: Page) {
  await page.route("**/fund-component-test", route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/src/client/styles.css"></head><body><div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
    const {default: React} = await import('/node_modules/.vite/deps/react.js'); const {default: ReactDOM} = await import('/node_modules/.vite/deps/react-dom_client.js'); const {createRoot} = ReactDOM; const {default: Fund} = await import('/src/client/FundExperience.tsx');
    createRoot(document.getElementById('root')).render(React.createElement(Fund,{address:'${address}',onConnect:()=>{},onSend:()=>{document.title='Send money'},onBalance:b=>{window.verifiedBalance=b}}));
    </script></body></html>` }));
  await page.route("**/api/balance/**", route => route.fulfill({ json: { address, token: base.token, balance: "847369" } }));
  await page.goto("/fund-component-test"); await expect(page.getByText("0.847369 pathUSD", { exact: true })).toBeVisible();
}
test("Home Add test funds opens the real /app/fund route", async ({ page }) => {
  await page.goto("/app/home?sessionFixture=connected"); await page.getByRole("button", { name: "Add test funds", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/fund$/); await expect(page.getByRole("heading", { name: "Add test funds" })).toBeVisible();
  await expect(page.getByText("Test funds have no real-world value.")).toBeVisible(); await expect(page.getByRole("button", { name: "Connect Reach account" })).toBeVisible();
});
test.describe("funding component with public fixtures", () => {
  test.skip(Boolean(process.env.TARGET_URL), "Fixture harness uses local Vite, not deployment.");
  test("copy, requesting, waiting, authoritative success and next action", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]); let posts = 0, polls = 0;
    await page.route("**/api/testnet/fund", async route => { posts++; expect(route.request().postDataJSON()).toEqual({ address }); await new Promise(r => setTimeout(r, 300)); await route.fulfill({ status: 202, json: { ...base, stage: "WAITING_FOR_BALANCE" } }); });
    await page.route("**/api/testnet/fund/*", route => route.fulfill({ json: { ...base, stage: ++polls > 1 ? "FUNDED" : "WAITING_FOR_BALANCE", balance: "1000000847369" } }));
    await mountFunding(page); await page.getByRole("button", { name: "Copy address" }).click(); expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(address);
    await page.getByRole("button", { name: "Add test funds", exact: true }).click(); await expect(page.getByText("Requesting test funds...")).toBeVisible(); await expect(page.getByText("Waiting for your pathUSD balance to increase...")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Test funds added" })).toBeVisible(); await expect(page.getByText("Previous: 0.847369 pathUSD")).toBeVisible(); await expect(page.getByText("Available now: 1,000,000.847369 pathUSD")).toBeVisible();
    expect(posts).toBe(1); expect(await page.evaluate(() => (window as any).verifiedBalance)).toBe("1000000847369"); await page.getByRole("button", { name: "Send money" }).click(); await expect(page).toHaveTitle("Send money");
  });
  test("faucet failure shows without automatic retry", async ({ page }) => { let posts = 0; await page.route("**/api/testnet/fund", route => { posts++; return route.fulfill({ status: 429, json: { error: "Please wait before requesting again." } }); }); await mountFunding(page); await page.getByRole("button", { name: "Add test funds", exact: true }).click(); await expect(page.getByRole("alert")).toContainText("Please wait"); await expect(page.getByRole("button", { name: "Add test funds", exact: true })).toBeDisabled(); expect(posts).toBe(1); });
  test("success with unchanged balance is rejected", async ({ page }) => { await page.route("**/api/testnet/fund", route => route.fulfill({ status: 202, json: { ...base, stage: "WAITING_FOR_BALANCE" } })); await page.route("**/api/testnet/fund/*", route => route.fulfill({ json: { ...base, stage: "FUNDED", balance: base.startingBalance } })); await mountFunding(page); await page.getByRole("button", { name: "Add test funds", exact: true }).click(); await expect(page.getByRole("alert")).toContainText("could not be verified"); await expect(page.getByRole("heading", { name: "Test funds added" })).toHaveCount(0); });
  for (const width of [375, 1280]) test(`funding layout ${width}px`, async ({ page }) => { await page.setViewportSize({ width, height: 900 }); await mountFunding(page); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: `artifacts/funding-${width}.png`, fullPage: true }); });
});
