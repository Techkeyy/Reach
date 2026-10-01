import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { Account as TempoAccount } from "viem/tempo";
import { PENDING_REGISTRATION_TTL_MS } from "../../src/client/identityRecovery";

type CredentialResult = { credentialId: string; publicKey: `0x${string}` };

async function addVirtualAuthenticator(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

async function installCreateCounter(page: Page) {
  await page.addInitScript(() => {
    const countKey = "__reachCreateCount";
    const credentials = navigator.credentials;
    const originalCreate = credentials.create.bind(credentials);
    credentials.create = async options => {
      const count = Number(sessionStorage.getItem(countKey) ?? "0") + 1;
      sessionStorage.setItem(countKey, String(count));
      return originalCreate(options);
    };
  });
}

async function createAccount(page: Page) {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Launch Reach" }).last().click();
  await page.getByRole("button", { name: "Create Reach account" }).click();
  await page.getByRole("button", { name: "Create passkey" }).click();
}

function accountFromCredential(result: CredentialResult) {
  return TempoAccount.fromWebAuthnP256(
    { id: result.credentialId, publicKey: result.publicKey },
    { rpId: "localhost" },
  ).address;
}

async function readTempoSnapshot(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const request = indexedDB.open("tempo");
    const db = await new Promise<IDBDatabase | null>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => resolve(null);
    });
    if (!db || !db.objectStoreNames.contains("store")) {
      db?.close();
      return false;
    }
    return await new Promise<boolean>((resolve, reject) => {
      const transaction = db.transaction("store", "readonly");
      const get = transaction.objectStore("store").get("tempo.store");
      get.onsuccess = () => resolve(get.result !== undefined);
      get.onerror = () => reject(get.error);
      transaction.oncomplete = () => db.close();
    });
  });
}

async function clearTempoSnapshot(page: Page) {
  await page.evaluate(async () => {
    const request = indexedDB.open("tempo");
    const db = await new Promise<IDBDatabase | null>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => resolve(null);
    });
    if (!db || !db.objectStoreNames.contains("store")) {
      db?.close();
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("store", "readwrite");
      transaction.objectStore("store").delete("tempo.store");
      transaction.objectStore("store").delete("tempo.lastCredentialId");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  });
}

async function readPendingRecord(page: Page): Promise<unknown> {
  return page.evaluate(async () => {
    const request = indexedDB.open("tempo");
    const db = await new Promise<IDBDatabase | null>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => resolve(null);
    });
    if (!db || !db.objectStoreNames.contains("store")) {
      db?.close();
      return null;
    }
    return await new Promise<unknown>((resolve, reject) => {
      const transaction = db.transaction("store", "readonly");
      const get = transaction.objectStore("store").get("reach.identity.pendingRegistration");
      get.onsuccess = () => resolve(get.result ?? null);
      get.onerror = () => reject(get.error);
      transaction.oncomplete = () => db.close();
    });
  });
}

async function seedPendingRecord(page: Page, createdAt: number, expiresAt: number) {
  await page.evaluate(({ createdAt, expiresAt }) => {
    const request = indexedDB.open("tempo", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("store")) request.result.createObjectStore("store");
    };
    request.onsuccess = () => {
      const transaction = request.result.transaction("store", "readwrite");
      transaction.objectStore("store").put({
        state: "PASSKEY_CREATED_SETUP_INCOMPLETE",
        name: "stale test record",
        createdAt,
        expiresAt,
        credential: {
          id: "stale-credential",
          publicKey: `0x04${"11".repeat(64)}`,
          clientDataJSON: "stale",
          attestationObject: "stale",
        },
      }, "reach.identity.pendingRegistration");
    };
  }, { createdAt, expiresAt });
  await page.waitForTimeout(50);
}

test.describe("localhost SDK-native identity continuity", () => {
  test("registration survives Tempo snapshot and session loss", async ({ browser }) => {
    // This journey performs two real SDK-native WebAuthn ceremonies plus local
    // Vite/API startup and Tempo snapshot reads. Keep the integration budget
    // evidence-based and separate from the default 30-second unit-style cap.
    test.setTimeout(60_000);
    const context = await browser.newContext();
    const page = await context.newPage();
    await addVirtualAuthenticator(context, page);

    let registration: CredentialResult | undefined;
    let login: CredentialResult | undefined;
    page.on("response", async response => {
      if (response.status() !== 200) return;
      if (response.url().endsWith("/auth/register")) registration = await response.json().catch(() => undefined);
      if (response.url().endsWith("/auth/login")) login = await response.json().catch(() => undefined);
    });

    await createAccount(page);
    await expect(page.locator('[data-onboarding-stage="ACCOUNT_READY"]')).toBeVisible({ timeout: 30_000 });
    expect(registration).toBeDefined();
    const accountX = accountFromCredential(registration!);
    console.log("identity continuity public account", accountX);
    expect(await readTempoSnapshot(page)).toBe(true);

    await page.getByRole("button", { name: "Enter Reach" }).click();
    await expect(page).toHaveURL(/\/app\/home$/);
    await clearTempoSnapshot(page);
    expect(await readTempoSnapshot(page)).toBe(false);
    await context.clearCookies();

    await page.goto("/", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Launch Reach" }).last().click();
    await expect(page.locator('[data-onboarding-stage="ACCOUNT_GATEWAY"]')).toBeVisible();
    await page.getByRole("button", { name: /Already have a Reach account/ }).click();
    await page.getByRole("button", { name: "Sign in with passkey" }).click();
    await expect(page).toHaveURL(/\/app\/home$/, { timeout: 30_000 });
    expect(login).toBeDefined();
    expect(accountFromCredential(login!)).toBe(accountX);
    await context.close();
  });

  test("lost registration response reconciles without a second create ceremony", async ({ browser }) => {
    // Recovery includes a forced transport loss, a reload, reconciliation, and
    // a second server-backed completion. Give the local integration journey
    // the same measured budget as the continuity test above.
    test.setTimeout(60_000);
    const context = await browser.newContext();
    const page = await context.newPage();
    await installCreateCounter(page);
    await addVirtualAuthenticator(context, page);

    let registration: CredentialResult | undefined;
    let login: CredentialResult | undefined;
    let dropResponse = true;
    const authEvents: string[] = [];
    page.on("request", request => {
      if (request.url().includes("/auth/")) authEvents.push(`request ${request.method()} ${new URL(request.url()).pathname}`);
    });
    page.on("response", response => {
      if (response.url().includes("/auth/")) authEvents.push(`response ${response.status()} ${new URL(response.url()).pathname}`);
    });
    page.on("response", async response => {
      if (response.status() === 200 && response.url().endsWith("/auth/login")) login = await response.json().catch(() => undefined);
    });
    await page.route("**/auth/register", async route => {
      const upstream = await route.fetch();
      if (dropResponse) {
        dropResponse = false;
        registration = await upstream.json();
        await route.abort("failed");
        return;
      }
      await route.fulfill({ response: upstream });
    });

    await createAccount(page);
    await page.waitForTimeout(500);
    const pendingLocator = page.locator('[data-onboarding-stage="PASSKEY_CREATED_SETUP_INCOMPLETE"]');
    await expect(pendingLocator).toBeVisible({ timeout: 30_000 });
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator('[data-onboarding-stage="PASSKEY_CREATED_SETUP_INCOMPLETE"]')).toBeVisible();
    expect(registration).toBeDefined();
    const accountX = accountFromCredential(registration!);
    expect(await page.evaluate(() => Number(sessionStorage.getItem("__reachCreateCount") ?? "0"))).toBe(1);

    await page.getByRole("button", { name: "Finish setup" }).click();
    await expect(page.locator('[data-onboarding-stage="ACCOUNT_READY"]')).toBeVisible({ timeout: 30_000 });
    expect(login).toBeDefined();
    expect(accountFromCredential(login!)).toBe(accountX);
    expect(accountFromCredential(registration!)).toBe(accountX);
    expect(await page.evaluate(() => Number(sessionStorage.getItem("__reachCreateCount") ?? "0"))).toBe(1);
    expect(await readPendingRecord(page)).toBeNull();
    expect(authEvents.filter(event => event === "request POST /auth/register")).toHaveLength(2);
    expect(authEvents).toContain("response 400 /auth/register");
    expect(authEvents).toContain("request POST /auth/register/reconcile");
    expect(authEvents).toContain("response 200 /auth/register/reconcile");
    expect(authEvents).toContain("response 200 /auth/login");
    await page.getByRole("button", { name: "Enter Reach" }).click();
    await expect(page).toHaveURL(/\/app\/home$/);
    await context.close();
  });

  test("server-not-committed retry reuses the exact completion and one create ceremony", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await installCreateCounter(page);
    await addVirtualAuthenticator(context, page);

    let registration: CredentialResult | undefined;
    let login: CredentialResult | undefined;
    let registerRequests = 0;
    await page.route("**/auth/register", async route => {
      registerRequests += 1;
      if (registerRequests === 1) {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "temporary completion failure" }) });
        return;
      }
      await route.continue();
    });
    page.on("response", async response => {
      if (response.status() === 200 && response.url().endsWith("/auth/register")) registration = await response.json().catch(() => undefined);
      if (response.status() === 200 && response.url().endsWith("/auth/login")) login = await response.json().catch(() => undefined);
    });

    await createAccount(page);
    await page.waitForTimeout(500);
    const pendingLocator = page.locator('[data-onboarding-stage="PASSKEY_CREATED_SETUP_INCOMPLETE"]');
    await expect(pendingLocator).toBeVisible({ timeout: 30_000 });
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator('[data-onboarding-stage="PASSKEY_CREATED_SETUP_INCOMPLETE"]')).toBeVisible();

    await page.getByRole("button", { name: "Finish setup" }).click();
    await expect(page.locator('[data-onboarding-stage="ACCOUNT_READY"]')).toBeVisible({ timeout: 30_000 });
    expect(registerRequests).toBe(2);
    expect(registration).toBeDefined();
    expect(login).toBeDefined();
    expect(accountFromCredential(login!)).toBe(accountFromCredential(registration!));
    expect(await page.evaluate(() => Number(sessionStorage.getItem("__reachCreateCount") ?? "0"))).toBe(1);
    expect(await readPendingRecord(page)).toBeNull();
    await page.getByRole("button", { name: "Enter Reach" }).click();
    await expect(page).toHaveURL(/\/app\/home$/);
    await context.close();
  });

  test("unknown passkey login is rejected without registration fallback", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await installCreateCounter(page);
    await addVirtualAuthenticator(context, page);

    let registerRequests = 0;
    const loginResponses: number[] = [];
    await page.route("**/auth/register", async route => {
      registerRequests += 1;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "registration deliberately not committed" }),
      });
    });
    page.on("response", response => {
      if (response.url().endsWith("/auth/login")) loginResponses.push(response.status());
    });

    await createAccount(page);
    await expect(page.locator('[data-onboarding-stage="PASSKEY_CREATED_SETUP_INCOMPLETE"]')).toBeVisible({ timeout: 30_000 });
    expect(registerRequests).toBe(1);
    expect(await page.evaluate(() => Number(sessionStorage.getItem("__reachCreateCount") ?? "0"))).toBe(1);

    await page.getByRole("button", { name: "Start over" }).click();
    await expect(page.locator('[data-onboarding-stage="ACCOUNT_GATEWAY"]')).toBeVisible();
    expect(await readPendingRecord(page)).toBeNull();

    await page.getByRole("button", { name: /Already have a Reach account/ }).click();
    await page.getByRole("button", { name: "Sign in with passkey" }).click();
    await expect(page.locator('[data-onboarding-stage="AUTH_FAILED"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "We couldn't finish signing you in." })).toBeVisible();
    expect(loginResponses).toContain(400);
    expect(registerRequests).toBe(1);
    expect(await page.evaluate(() => Number(sessionStorage.getItem("__reachCreateCount") ?? "0"))).toBe(1);
    await context.close();
  });

  test("expired pending records are removed and do not trigger registration", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/", { waitUntil: "networkidle" });
    const createdAt = Date.now() - PENDING_REGISTRATION_TTL_MS - 1;
    await seedPendingRecord(page, createdAt, createdAt + PENDING_REGISTRATION_TTL_MS);
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator('[data-onboarding-stage="ACCOUNT_GATEWAY"]')).not.toBeVisible();
    await expect(page.locator('[data-onboarding-stage="PASSKEY_CREATED_SETUP_INCOMPLETE"]')).not.toBeVisible();
    expect(await readPendingRecord(page)).toBeNull();
    await context.close();
  });
});
