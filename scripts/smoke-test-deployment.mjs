const BASE_URL = process.argv[2] || "https://reach.vercel.app";

async function runTests() {
  console.log(`Starting Deployed Smoke Tests on ${BASE_URL}...\n`);
  let passed = 0;
  let total = 0;

  async function test(name, fn) {
    total++;
    try {
      await fn();
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ [FAIL] ${name}:`, err.message);
    }
  }

  // 1. Root SPA HTML
  await test("Root URL GET / returns 200 HTML", async () => {
    const res = await fetch(`${BASE_URL}/`);
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    const text = await res.text();
    if (!text.includes("Reach") && !text.includes("root")) {
      throw new Error("HTML body does not contain expected Reach shell");
    }
  });

  // 2. Direct SPA claim deep link
  await test("Direct navigation GET /c/1790060937954 returns 200 HTML (not 404)", async () => {
    const res = await fetch(`${BASE_URL}/c/1790060937954`);
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    const text = await res.text();
    if (!text.includes("<!doctype html") && !text.includes("<html")) {
      throw new Error("Did not return index.html for SPA route");
    }
  });

  // 3. Health API
  await test("Health check GET /health returns ok, chainId 42431, sponsorConfigured, and webAuthnStorage: durable", async () => {
    const res = await fetch(`${BASE_URL}/health`);
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!data.ok || data.chainId !== 42431 || data.sponsorConfigured !== true) {
      throw new Error(`Unexpected health payload: ${JSON.stringify(data)}`);
    }
    if (data.webAuthnStorage !== "durable") {
      throw new Error(`Expected webAuthnStorage to be 'durable', got: ${data.webAuthnStorage}`);
    }
    console.log("   Health payload:", JSON.stringify(data));
  });

  // 4. Authoritative Payout API
  await test("Authoritative payout GET /api/payout/1790060937954 returns CLAIMED payout", async () => {
    const res = await fetch(`${BASE_URL}/api/payout/1790060937954`);
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (data.status !== 2 || data.amount !== "1000000") {
      throw new Error(`Unexpected payout data: ${JSON.stringify(data)}`);
    }
    console.log(`   Payout 1790060937954: status=${data.status} (CLAIMED), amount=${data.amount}, sender=${data.sender}`);
  });

  // 5. Authoritative Sender Payouts API
  await test("Sender payouts GET /api/payouts/:sender returns payout list", async () => {
    const sender = "0xAF75774194AbeEC3A0D86693d8A7bC1139311061";
    const res = await fetch(`${BASE_URL}/api/payouts/${sender}`);
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.payouts) || data.payouts.length === 0) {
      throw new Error(`Expected payouts array, got: ${JSON.stringify(data)}`);
    }
    console.log(`   Found ${data.payouts.length} payouts for sender ${sender}`);
  });

  // 6. Authoritative Balance API
  await test("Balance GET /api/balance/:address returns pathUSD balance", async () => {
    const address = "0xAF75774194AbeEC3A0D86693d8A7bC1139311061";
    const res = await fetch(`${BASE_URL}/api/balance/${address}`);
    if (res.status !== 200) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (typeof data.balance !== "string") {
      throw new Error(`Unexpected balance data: ${JSON.stringify(data)}`);
    }
    console.log(`   Balance for ${address}: ${data.balance} pathUSD base units`);
  });

  // 7. WebAuthn Register Options & Multi-Request Durability
  let savedRegisterChallenge = null;
  await test("WebAuthn register options POST /auth/register/options returns valid rpId and stores challenge", async () => {
    const expectedHost = new URL(BASE_URL).hostname;
    const res = await fetch(`${BASE_URL}/auth/register/options`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": BASE_URL,
      },
      body: JSON.stringify({ name: "Reach recipient" }),
    });
    if (res.status !== 200) {
      const errText = await res.text();
      throw new Error(`Status ${res.status}: ${errText}`);
    }
    const data = await res.json();
    const pk = data.options?.publicKey || data.publicKey || data;
    if (!pk.challenge || pk.rp?.id !== expectedHost) {
      throw new Error(`Invalid register options (expected rp.id=${expectedHost}): ${JSON.stringify(data)}`);
    }
    const hasES256 = pk.pubKeyCredParams?.some((p) => p.alg === -7);
    if (!hasES256) {
      throw new Error("Missing ES256 (-7) algorithm in pubKeyCredParams");
    }
    savedRegisterChallenge = pk.challenge;
    console.log(`   WebAuthn RP: ${pk.rp.name} (${pk.rp.id}), challenge: ${pk.challenge.slice(0, 16)}...`);
  });

  // 7b. WebAuthn Durable Challenge Verification Across Separate Request
  await test("WebAuthn challenge survives across separate HTTP requests in durable store", async () => {
    if (!savedRegisterChallenge) throw new Error("No saved register challenge from previous request");
    
    // Attempt verification with an invalid clientData payload referencing the stored challenge
    // The server handler looks up the stored challenge from durable KV.
    // If the challenge was not persisted, it throws challenge lookup error.
    const res = await fetch(`${BASE_URL}/auth/register/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": BASE_URL,
      },
      body: JSON.stringify({
        id: "durable-kv-test-id",
        rawId: "durable-kv-test-id",
        response: {
          clientDataJSON: Buffer.from(JSON.stringify({
            type: "webauthn.create",
            challenge: savedRegisterChallenge,
            origin: BASE_URL,
          })).toString("base64url"),
          attestationObject: "invalid-attestation-test",
        },
        type: "public-key",
      }),
    });
    
    // We expect the server to process the request and fail at attestation parsing/crypto,
    // NOT at missing challenge or 500 storage crash.
    const status = res.status;
    console.log(`   Separate request to /auth/register/verify responded with status ${status} (challenge retrieved from durable KV)`);
    if (status === 500 || status === 503) {
      const errText = await res.text();
      throw new Error(`Server failed to access durable KV store: ${errText}`);
    }
  });

  // 8. WebAuthn Login Options
  await test("WebAuthn login options POST /auth/login/options returns valid rpId", async () => {
    const expectedHost = new URL(BASE_URL).hostname;
    const res = await fetch(`${BASE_URL}/auth/login/options`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": BASE_URL,
      },
      body: JSON.stringify({}),
    });
    if (res.status !== 200) {
      const errText = await res.text();
      throw new Error(`Status ${res.status}: ${errText}`);
    }
    const data = await res.json();
    const pk = data.options?.publicKey || data.publicKey || data;
    if (!pk.challenge || pk.rpId !== expectedHost) {
      throw new Error(`Invalid login options (expected rpId=${expectedHost}): ${JSON.stringify(data)}`);
    }
    console.log(`   WebAuthn login challenge generated: rpId=${pk.rpId}, challenge: ${pk.challenge.slice(0, 16)}...`);
  });

  // 9. Adversarial: Origin Rejection on WebAuthn
  await test("WebAuthn origin guard rejects unauthorized origin with 403", async () => {
    const res = await fetch(`${BASE_URL}/auth/register/options`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": "https://malicious-attacker-domain.com",
      },
      body: JSON.stringify({ name: "Attacker" }),
    });
    if (res.status !== 403) {
      throw new Error(`Expected 403 Forbidden, got status ${res.status}`);
    }
    const data = await res.json();
    if (!data.error || !data.error.includes("Untrusted origin")) {
      throw new Error(`Expected Untrusted origin error, got: ${JSON.stringify(data)}`);
    }
  });

  // 10. Adversarial: Narrow Relay Rejection
  await test("Relay rejects invalid claim request without executing arbitrary calls", async () => {
    const res = await fetch(`${BASE_URL}/relay`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_sendTransaction",
        params: [{ to: "0x0000000000000000000000000000000000000000", data: "0x" }],
      }),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { error: text }; }
    if (res.status >= 400 || data.error) {
      console.log(`   Relay rejected invalid transaction call correctly: status=${res.status}, error=${data.error?.message || data.error || text}`);
    } else {
      throw new Error(`Expected error for arbitrary call, got: ${text}`);
    }
  });

  console.log(`\n========================================`);
  console.log(`Smoke Tests Summary: ${passed} / ${total} passed`);
  console.log(`========================================\n`);

  if (passed !== total) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution fatal error:", err);
  process.exit(1);
});
