import { createPublicClient, http, encodeFunctionData, parseUnits, toFunctionSelector, type Address, type Hex } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import {
  DEFAULT_VAULT_ADDRESS,
  PATH_USD_ADDRESS,
  TEMPO_MODERATO_CHAIN_ID,
  TEMPO_MODERATO_RPC_URL,
  pathUsdAbi,
  vaultAbi,
} from "../src/shared/reach";

async function run() {
  console.log("=== REACH PHASE 4 PROOF GATE RUNNER ===");
  const rpcUrl = TEMPO_MODERATO_RPC_URL;
  const publicClient = createPublicClient({
    transport: http(rpcUrl),
  });

  const chainId = await publicClient.getChainId();
  console.log(`Connected to Moderato RPC: ${rpcUrl} (Chain ID: ${chainId})`);

  // 1. Selector Computation
  const approveSelector = toFunctionSelector("approve(address,uint256)");
  const createPayoutSelector = toFunctionSelector("createPayout(uint256,uint256,address,uint64)");
  const transferSelector = toFunctionSelector("transfer(address,uint256)");
  const reclaimSelector = toFunctionSelector("reclaim(uint256)");

  console.log("\n--- Function Selectors ---");
  console.log(`pathUSD.approve: ${approveSelector}`);
  console.log(`vault.createPayout: ${createPayoutSelector}`);
  console.log(`pathUSD.transfer: ${transferSelector}`);
  console.log(`vault.reclaim: ${reclaimSelector}`);
}

void run();
