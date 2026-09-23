import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { config as loadEnv } from "dotenv";
import { createPublicClient, createWalletClient, http, parseAbi, parseUnits, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { tempoModerato } from "viem/chains";
import { DEFAULT_VAULT_ADDRESS, PATH_USD_ADDRESS, payoutFromContractResult, payoutStatus, TEMPO_MODERATO_RPC_URL, vaultAbi } from "../src/shared/reach";

loadEnv({ path: process.env.REACH_ENV_FILE ?? ".env.local" });

const RPC_URL = process.env.REACH_RPC_URL ?? TEMPO_MODERATO_RPC_URL;
const VAULT_ADDRESS = (process.env.REACH_VAULT_ADDRESS ?? DEFAULT_VAULT_ADDRESS) as Address;
const ORIGIN = process.env.REACH_ORIGIN ?? "http://localhost:5173";
const AMOUNT = parseUnits(process.env.REACH_DEMO_AMOUNT ?? "1", 6);
const TOKEN_ABI = parseAbi(["function approve(address spender,uint256 amount) returns (bool)"]);
const CREATE_ABI = parseAbi(["function createPayout(uint256 payoutId,uint256 amount,address claimSigner,uint64 expiresAt)"]);
const TOTAL_ABI = parseAbi(["function totalFundedAmount() view returns (uint256)"]);
const NEUTRAL_CLIPBOARD = "Reach clipboard neutral";
const SET_CLIPBOARD_COMMAND = "[Console]::In.ReadToEnd() | Set-Clipboard";
const READ_CLIPBOARD_COMMAND = "$value = Get-Clipboard -Raw; if ($null -ne $value) { [Console]::Out.Write($value) }";

type PowerShellResult = { stdout: string; code: number | null };

function runPowerShell(command: string, stdin?: string): Promise<PowerShellResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-Command", command], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.on("error", () => reject(new Error("clipboard helper unavailable")));
    child.on("close", (code) => resolve({ stdout, code }));
    child.stdin.end(stdin ?? "", "utf8");
  });
}

async function setClipboard(value: string) {
  const result = await runPowerShell(SET_CLIPBOARD_COMMAND, value);
  if (result.code !== 0) throw new Error("clipboard write failed");
}

async function readClipboard() {
  const result = await runPowerShell(READ_CLIPBOARD_COMMAND);
  if (result.code !== 0) throw new Error("clipboard read failed");
  return result.stdout;
}

async function neutralizeClipboard() {
  try { await setClipboard(NEUTRAL_CLIPBOARD); } catch { /* best effort after a failed preparation */ }
}

async function clipboardPreflight() {
  const sentinel = `REACH_CLIPBOARD_TEST_${randomBytes(12).toString("hex")}`;
  await setClipboard(sentinel);
  const echoed = await readClipboard();
  if (echoed !== sentinel) throw new Error("clipboard sentinel mismatch");
  await setClipboard(NEUTRAL_CLIPBOARD);
}

function capabilityFromFragment(fragment: string): Hex {
  if (!/^[A-Za-z0-9_-]+$/.test(fragment)) throw new Error("invalid capability encoding");
  const bytes = Buffer.from(fragment, "base64url");
  if (bytes.length !== 32 || bytes.toString("base64url") !== fragment) throw new Error("invalid capability length");
  return `0x${bytes.toString("hex")}` as Hex;
}

function validateClaimUrl(url: string, payoutId: bigint, expectedCapability: Hex, expectedClaimSigner: Address) {
  const parsed = new URL(url);
  if (parsed.origin !== ORIGIN || parsed.pathname !== `/c/${payoutId.toString()}`) throw new Error("claim URL path mismatch");
  if (!parsed.hash.startsWith("#") || parsed.hash.length <= 1) throw new Error("claim URL fragment missing");
  const capability = capabilityFromFragment(parsed.hash.slice(1));
  if (capability.toLowerCase() !== expectedCapability.toLowerCase()) throw new Error("claim capability mismatch");
  if (privateKeyToAccount(capability).address.toLowerCase() !== expectedClaimSigner.toLowerCase()) throw new Error("claim signer mismatch");
}

async function main() {
  await clipboardPreflight();
  if (process.argv.includes("--clipboard-preflight-only")) {
    console.log(JSON.stringify({ clipboardPreflight: "PASS" }));
    return;
  }

  const senderKey = process.env.TEMPO_DEPLOYER_PRIVATE_KEY as Hex | undefined;
  if (!senderKey) throw new Error("sender credential unavailable");
  const sender = privateKeyToAccount(senderKey);
  const claimPrivateKey = generatePrivateKey();
  const claimSigner = privateKeyToAccount(claimPrivateKey);
  const claimCapability = claimPrivateKey;
  const payoutId = BigInt(process.env.REACH_PAYOUT_ID ?? Date.now());
  const publicClient = createPublicClient({ chain: tempoModerato, transport: http(RPC_URL) }) as any;
  const walletClient = createWalletClient({ account: sender, chain: tempoModerato, transport: http(RPC_URL) }) as any;
  const latest = await publicClient.getBlock({ blockTag: "latest" });
  const expiresAt = latest.timestamp + BigInt(process.env.REACH_CLAIM_TTL_SECONDS ?? 86_400);
  const capabilityFragment = Buffer.from(claimPrivateKey.slice(2), "hex").toString("base64url");
  const claimUrl = `${ORIGIN}/c/${payoutId.toString()}#${capabilityFragment}`;
  validateClaimUrl(claimUrl, payoutId, claimCapability, claimSigner.address);

  try {
    await setClipboard(claimUrl);
    validateClaimUrl(await readClipboard(), payoutId, claimCapability, claimSigner.address);
  } catch {
    await neutralizeClipboard();
    throw new Error("claim URL clipboard verification failed before funding");
  }

  let fundingTransactionHash: Hex;
  try {
    const beforeTotal = await publicClient.readContract({ address: VAULT_ADDRESS, abi: TOTAL_ABI, functionName: "totalFundedAmount" });
    const approvalHash = await walletClient.writeContract({ address: PATH_USD_ADDRESS, abi: TOKEN_ABI, functionName: "approve", args: [VAULT_ADDRESS, AMOUNT] });
    await publicClient.waitForTransactionReceipt({ hash: approvalHash });
    fundingTransactionHash = await walletClient.writeContract({ address: VAULT_ADDRESS, abi: CREATE_ABI, functionName: "createPayout", args: [payoutId, AMOUNT, claimSigner.address, expiresAt] });
    await publicClient.waitForTransactionReceipt({ hash: fundingTransactionHash });
    const afterTotal = await publicClient.readContract({ address: VAULT_ADDRESS, abi: TOTAL_ABI, functionName: "totalFundedAmount" });
    if (BigInt(afterTotal) !== BigInt(beforeTotal) + AMOUNT) throw new Error("vault accounting mismatch");
  } catch {
    await neutralizeClipboard();
    throw new Error("payout funding failed");
  }

  try {
    const result = await publicClient.readContract({ address: VAULT_ADDRESS, abi: vaultAbi, functionName: "getPayout", args: [payoutId] });
    const payout = payoutFromContractResult(result);
    if (payout.status !== payoutStatus.FUNDED || payout.amount !== AMOUNT || payout.sender.toLowerCase() !== sender.address.toLowerCase() || payout.claimSigner.toLowerCase() !== claimSigner.address.toLowerCase() || payout.expiresAt !== expiresAt) throw new Error("funded payout verification failed");
    const currentBlock = await publicClient.getBlock({ blockTag: "latest" });
    if (currentBlock.timestamp >= payout.expiresAt) throw new Error("payout unexpectedly expired");
    validateClaimUrl(await readClipboard(), payoutId, claimCapability, claimSigner.address);
  } catch {
    await neutralizeClipboard();
    throw new Error("funded payout or clipboard recheck failed");
  }

  console.log(JSON.stringify({ network: "Tempo Testnet (Moderato)", chainId: tempoModerato.id, vault: VAULT_ADDRESS, token: PATH_USD_ADDRESS, sender: sender.address, payoutId: payoutId.toString(), amount: AMOUNT.toString(), expiresAt: expiresAt.toString(), claimSigner: claimSigner.address, createFundTx: fundingTransactionHash, redactedClaimUrl: `${ORIGIN}/c/${payoutId.toString()}#[REDACTED]`, clipboardVerified: true, clipboardStillExactAfterFunding: true }, null, 2));
}

main().catch(() => { console.error("claim-link preparation failed"); process.exitCode = 1; });
