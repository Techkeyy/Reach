import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { network } from "hardhat";
import { type Address } from "viem";

const TOKEN = (process.env.TEMPO_PAYOUT_TOKEN ?? "0x20c0000000000000000000000000000000000000") as Address;

const { viem } = await network.create();
const publicClient = await viem.getPublicClient();
const [deployer] = await viem.getWalletClients();
if (!deployer) throw new Error("TEMPO_DEPLOYER_PRIVATE_KEY is required for deploy-moderato");

const vault = await viem.deployContract("ReachPayoutVault", [TOKEN], {
  client: { public: publicClient, wallet: deployer },
});
const chainId = await publicClient.getChainId();
const blockNumber = await publicClient.getBlockNumber();
const evidence = {
  network: "Tempo Testnet (Moderato)",
  chainId,
  deployer: deployer.account.address,
  payoutToken: TOKEN,
  vault: vault.address,
  deploymentBlock: blockNumber.toString(),
  generatedAt: new Date().toISOString(),
};

mkdirSync("deployments", { recursive: true });
writeFileSync("deployments/moderato.json", `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
console.log(JSON.stringify(evidence, null, 2));
