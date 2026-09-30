import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Outputs filenames/rule names only, never matching credential text.
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const rules = [
  ["operator-key-literal", /(?:TEMPO_DEPLOYER_PRIVATE_KEY|REACH_FEE_PAYER_PRIVATE_KEY)\s*[:=]\s*["']?(?:0x)?[a-fA-F0-9]{64}\b/],
  ["private-key-pem", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["literal-bearer-url", /\/c\/[1-9][0-9]*#(?:cap=)?[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/],
];
const hits = [];
for (const file of files) {
  const bytes = readFileSync(file);
  if (bytes.includes(0)) continue;
  const text = bytes.toString("utf8");
  for (const [rule, pattern] of rules) if (pattern.test(text)) hits.push({ file, rule });
  if (/(^|\/)\.uat\//.test(file) || /(^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith(".env.example")) hits.push({ file, rule: "tracked-secret-storage" });
}
console.log(JSON.stringify({ scannedTrackedFiles: files.length, findings: hits }));
if (hits.length) process.exitCode = 1;
