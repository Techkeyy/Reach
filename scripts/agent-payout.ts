#!/usr/bin/env tsx
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createWalletClient, createPublicClient, http, encodeFunctionData, parseUnits, formatUnits, type Address, type Hex } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import {
  DEFAULT_VAULT_ADDRESS,
  PATH_USD_ADDRESS,
  TEMPO_MODERATO_CHAIN_ID,
  TEMPO_MODERATO_RPC_URL,
  pathUsdAbi,
  vaultAbi,
} from "../src/shared/reach";

type AgentConfigFile = {
  version: number;
  chainId: number;
  ownerAddress: string;
  agentAddress: string;
  agentPrivateKey?: string;
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
  const rpcUrl = args.rpc || TEMPO_MODERATO_RPC_URL;
  const baseUrl = args["base-url"] || "https://reach-seven-lemon.vercel.app";
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

  const agentPrivateKey = (config.agentPrivateKey || process.env.REACH_AGENT_PRIVATE_KEY) as Hex | undefined;
  if (!agentPrivateKey) {
    console.error("Error: Agent private key not found in config or REACH_AGENT_PRIVATE_KEY env.");
    process.exit(1);
  }

  const amountRaw = parseUnits(amountStr, 6);
  const budgetRaw = BigInt(config.budgetLimitRaw || "0");

  if (amountRaw > budgetRaw) {
    console.error(`Error: Requested amount ($${amountStr} pathUSD) exceeds agent budget limit ($${config.budgetLimitPathUsd} pathUSD).`);
    process.exit(1);
  }

  const publicClient = createPublicClient({ transport: http(rpcUrl) });
  const latestBlock = await publicClient.getBlock({ blockTag: "latest" });
  const chainTimestamp = BigInt(latestBlock.timestamp);
  if (config.expiryTimestamp && chainTimestamp >= BigInt(config.expiryTimestamp)) {
    console.error(`Error: Agent authorization expired at ${new Date(config.expiryTimestamp * 1000).toISOString()}.`);
    process.exit(1);
  }

  const agentAccount = privateKeyToAccount(agentPrivateKey);
  const vaultAddress = (config.vaultAddress || DEFAULT_VAULT_ADDRESS) as Address;
  const pathUsdAddress = (config.pathUsdAddress || PATH_USD_ADDRESS) as Address;

  console.log(`\n🤖 Reach Agent Automation executing payout:`);
  console.log(`- Agent Signer: ${agentAccount.address}`);
  console.log(`- Owner / Funder: ${config.ownerAddress}`);
  console.log(`- Recipient Name: ${recipientName}`);
  console.log(`- Amount: $${amountStr} pathUSD (${amountRaw.toString()} base units)`);
  console.log(`- Note: ${note}`);

  const payoutId = createPayoutId();
  const cap = createClaimCapability();
  const claimSignerAccount = privateKeyToAccount(cap.privateKey);
  const expiresAt = chainTimestamp + 7n * 24n * 3600n; // 7 days from chain time

  const claimUrl = `${baseUrl}/c/${payoutId}#cap=${cap.raw}`;

  try {
    writeFileSync(resolve(process.cwd(), claimOutputPath), `${claimUrl}\n`, { encoding: "utf8", mode: 0o600 });
  } catch (error: any) {
    console.error(`Error: Could not write the private claim-link handoff: ${error.message}`);
    process.exit(1);
  }

  console.log(`\nGenerated Payout ID: ${payoutId}`);
  console.log(`Derived Claim Signer: ${claimSignerAccount.address}`);
  console.log(`Claim link written to the requested private handoff path.`);

  // Construct calls
  const approveData = encodeFunctionData({
    abi: pathUsdAbi,
    functionName: "approve",
    args: [vaultAddress, amountRaw],
  });

  const createPayoutData = encodeFunctionData({
    abi: vaultAbi,
    functionName: "createPayout",
    args: [BigInt(payoutId), amountRaw, claimSignerAccount.address, expiresAt],
  });

  const walletClient = createWalletClient({
    account: agentAccount,
    transport: http(rpcUrl),
  });

  console.log("\n📡 Submitting payout creation to Tempo network...");

  try {
    // In live or test mode: execute multicall or approve + createPayout
    const approveTx = await walletClient.sendTransaction({
      to: pathUsdAddress,
      data: approveData,
      value: 0n,
    });
    console.log(`- Allowance tx: ${approveTx}`);

    const createTx = await walletClient.sendTransaction({
      to: vaultAddress,
      data: createPayoutData,
      value: 0n,
    });
    console.log(`- Payout creation tx: ${createTx}`);

    console.log(`\n✅ Payout created successfully!`);
    console.log(`------------------------------------------------------------`);
    console.log(`Recipient: ${recipientName}`);
    console.log(`Amount: $${amountStr} pathUSD`);
    console.log(`Claim Link: [REDACTED — see the requested private handoff file]`);
    console.log(`------------------------------------------------------------\n`);

    // Output JSON for bots and caller scripts
    const output = {
      status: "SUCCESS",
      payoutId,
      recipientName,
      amountPathUsd: amountStr,
      amountRaw: amountRaw.toString(),
      claimLinkFile: resolve(process.cwd(), claimOutputPath),
      claimSigner: claimSignerAccount.address,
      expiresAt: expiresAt.toString(),
      txHash: createTx,
    };
    console.log(JSON.stringify(output));
  } catch (err: any) {
    console.error(`\n❌ Failed to broadcast transaction: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith("agent-payout.ts")) {
  void main();
}
