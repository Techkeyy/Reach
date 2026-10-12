import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";

const root = resolve(import.meta.dirname, "..");
const envPath = resolve(root, ".env.local");
const local = existsSync(envPath) ? parse(readFileSync(envPath)) : {};
const configured = (name) => Boolean(process.env[name] || local[name]);
let failures = 0;

function report(level, message) {
  console.log(`${level} ${message}`);
  if (level === "FAIL") failures++;
}

const [major, minor] = process.versions.node.split(".").map(Number);
report(major > 24 || (major === 24 && minor >= 14) ? "PASS" : "FAIL", "Node.js 24.14+ runtime");
report(existsSync(resolve(root, "node_modules/.bin/vite")) ? "PASS" : "FAIL", "Project dependencies installed");

if (!existsSync(envPath)) {
  report("WARN", ".env.local is absent; local test-only defaults are available, but protected delivery and sponsorship are not configured");
} else {
  report("PASS", "Local environment file found (values not displayed)");
}

if (configured("REACH_ORIGIN")) {
  try {
    const origin = new URL(process.env.REACH_ORIGIN || local.REACH_ORIGIN);
    const rpId = process.env.REACH_RP_ID || local.REACH_RP_ID;
    report(!rpId || rpId === origin.hostname ? "PASS" : "FAIL", "WebAuthn origin and RP ID agree");
  } catch {
    report("FAIL", "REACH_ORIGIN must be an absolute URL");
  }
} else {
  report("WARN", "REACH_ORIGIN is unset; configure it for a stable deployed passkey origin");
}

const kvUrl = configured("KV_REST_API_URL") || configured("UPSTASH_REDIS_REST_URL");
const kvToken = configured("KV_REST_API_TOKEN") || configured("UPSTASH_REDIS_REST_TOKEN");
report(kvUrl === kvToken ? (kvUrl ? "PASS" : "WARN") : "FAIL", kvUrl ? "Durable KV URL and token are paired" : "Durable KV is unavailable; local memory storage does not persist accounts across restarts");
report(configured("REACH_FEE_PAYER_PRIVATE_KEY") ? "PASS" : "WARN", "Server-side claim fee sponsor configuration");
report(configured("REACH_PROTECTED_CLAIMS_ENCRYPTION_KEY") ? "PASS" : "WARN", "Server-side protected-claim encryption configuration");

console.log(failures ? `Doctor found ${failures} blocking configuration issue(s).` : "Doctor found no blocking local setup issue. Warnings identify unavailable live features.");
process.exitCode = failures ? 1 : 0;
