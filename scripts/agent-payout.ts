#!/usr/bin/env tsx
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseUnits } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { compactPayoutId } from "../src/shared/reach";

type AgentConfigFile = {
  version: number;
  chainId: number;
  ownerAddress: string;
  agentAddress: string;
  authorizationId: string;
  token: string;
  baseUrl: string;
  vaultAddress: string;
  pathUsdAddress: string;
  budgetLimitPathUsd: string;
  budgetLimitRaw: string;
  expiryTimestamp: number;
};

function parseArgs() {
  const args = process.argv.slice(2);
  const options: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        options[key] = next;
        i++;
      } else {
        options[key] = "true";
      }
    }
  }

  return options;
}

export function createClaimCapability() {
  const privateKey = generatePrivateKey();
  const raw = privateKey.replace(/^0x/, "");
  return { raw, privateKey };
}

export function createPayoutId(): string {
  // Generate random 256-bit unsigned integer ID
  const randHex = generatePrivateKey();
  return BigInt(randHex).toString();
}

async function main() {
  const args = parseArgs();
  const configPath = args.config || process.env.REACH_AGENT_CONFIG;

  if (!configPath) {
    console.error("Error: --config <path_to_agent_config.json> is required.");
    console.log("Usage: pnpm tsx scripts/agent-payout.ts --config ./reach-agent-config.json --amount 10.00 --name 'Contractor Alice' --note 'Task Reward'");
    process.exit(1);
  }

  const amountStr = args.amount;
  if (!amountStr || isNaN(Number(amountStr)) || Number(amountStr) <= 0) {
    console.error("Error: --amount <positive_number> is required (e.g. --amount 10.50).");
    process.exit(1);
  }

  const recipientName = args.name || "Recipient";
  const note = args.note || "Automated Agent Payout";
  const claimOutputPath = args["claim-output"];

  // Require a private delivery boundary before any financial side effect.
  // Bearer links are never printed, serialized to stdout, or logged.
  if (!claimOutputPath) {
    console.error("Error: --claim-output <private_path> is required before funding.");
    process.exit(1);
  }

  let config: AgentConfigFile;
  try {
    const raw = readFileSync(resolve(process.cwd(), configPath), "utf-8");
    config = JSON.parse(raw);
  } catch (err: any) {
    console.error(`Failed to read agent config from ${configPath}: ${err.message}`);
    process.exit(1);
  }

  if (typeof config.token !== "string" || !config.token || typeof config.authorizationId !== "string" || !config.authorizationId) {
    console.error("Error: This config does not contain an owner-approved Reach agent credential.");
    process.exit(1);
  }

  const amountRaw = parseUnits(amountStr, 6);
  const budgetRaw = BigInt(config.budgetLimitRaw || "0");

  if (amountRaw > budgetRaw) {
    console.error(`Error: Requested amount ($${amountStr} pathUSD) exceeds agent budget limit ($${config.budgetLimitPathUsd} pathUSD).`);
    process.exit(1);
  }

  const baseUrl = args["base-url"] || config.baseUrl;
  if (typeof baseUrl !== "string" || !/^https?:\/\//i.test(baseUrl)) {
    console.error("Error: agent config baseUrl must be an https:// or http:// URL.");
    process.exit(1);
  }

  console.log(`\n🤖 Reach Agent Automation executing payout:`);
  console.log(`- Agent Authorization: ${config.authorizationId}`);
  console.log(`- Owner / Funder: ${config.ownerAddress}`);
  console.log(`- Recipient Name: ${recipientName}`);
  console.log(`- Amount: $${amountStr} pathUSD (${amountRaw.toString()} base units)`);
  console.log(`- Note: ${note}`);

  const payoutId = createPayoutId();
  const cap = createClaimCapability();
  const claimSignerAccount = privateKeyToAccount(cap.privateKey);
  const expiresAt = BigInt(config.expiryTimestamp);

  const claimUrl = `${baseUrl.replace(/\/$/, "")}/c/${compactPayoutId(payoutId)}#cap=${cap.raw}`;

  try {
    writeFileSync(resolve(process.cwd(), claimOutputPath), `${claimUrl}\n`, { encoding: "utf8", mode: 0o600 });
  } catch (error: any) {
    console.error(`Error: Could not write the private claim-link handoff: ${error.message}`);
    process.exit(1);
  }

  console.log(`\nGenerated Payout ID: ${payoutId}`);
  console.log(`Derived Claim Signer: ${claimSignerAccount.address}`);
  console.log(`Claim link written to the requested private handoff path.`);

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/agent/payments`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify({
        amountRaw: amountRaw.toString(),
        destination: claimSignerAccount.address,
        claimSigner: claimSignerAccount.address,
        idempotencyKey: args["idempotency-key"] || payoutId,
        payoutExpiresAt: expiresAt.toString(),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const result = await response.json().catch(() => ({})) as { payment?: { state?: string; payoutId?: string; createTxHash?: string; error?: string }; error?: string; code?: string };
    if (!response.ok) {
      if (result.code === "UNKNOWN_SETTLEMENT") {
        console.error("Payment submission is uncertain. Do not retry this idempotency key; reconcile it first.");
      } else {
        console.error(result.error || "Agent payment failed.");
      }
      process.exit(1);
    }
    const payment = result.payment;

    console.log(`\n✅ Payout created successfully!`);
    console.log(`------------------------------------------------------------`);
    console.log(`Recipient: ${recipientName}`);
    console.log(`Amount: $${amountStr} pathUSD`);
    console.log(`Claim Link: [REDACTED — see the requested private handoff file]`);
    console.log(`------------------------------------------------------------\n`);

    // Output JSON for bots and caller scripts
    const output = {
      status: "SUCCESS",
      payoutId: payment?.payoutId ?? payoutId,
      recipientName,
      amountPathUsd: amountStr,
      amountRaw: amountRaw.toString(),
      claimLinkFile: resolve(process.cwd(), claimOutputPath),
      claimSigner: claimSignerAccount.address,
      expiresAt: expiresAt.toString(),
      txHash: payment?.createTxHash,
    };
    console.log(JSON.stringify(output));
  } catch (err: any) {
    console.error(`\n❌ Agent payment request failed: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith("agent-payout.ts")) {
  void main();
}
