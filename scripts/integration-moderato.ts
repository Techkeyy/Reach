import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createPublicClient, createWalletClient, http, parseAbi, type Address, type Hex } from "viem";
import { tempoModerato } from "viem/chains";
import { payoutFromContractResult } from "../src/shared/reach";

const rpcUrl = process.env.TEMPO_MODERATO_RPC_URL ?? "https://rpc.moderato.tempo.xyz";
const token = (process.env.TEMPO_PAYOUT_TOKEN ?? "0x20c0000000000000000000000000000000000000") as Address;
const configuredVault = process.env.REACH_VAULT_ADDRESS as Address | undefined;
const artifact = JSON.parse(readFileSync(new URL("../artifacts/contracts/ReachPayoutVault.sol/ReachPayoutVault.json", import.meta.url), "utf8"));
const vaultAbi = artifact.abi;
const tip20Abi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "event TransferWithMemo(address indexed from,address indexed to,uint256 amount,bytes32 indexed memo)",
]);
const publicClient = createPublicClient({ chain: tempoModerato, transport: http(rpcUrl) });
const deployerKey = (process.env.TEMPO_DEPLOYER_PRIVATE_KEY as Hex | undefined) ?? generatePrivateKey();
const deployer = privateKeyToAccount(deployerKey);
const wallet = createWalletClient({ account: deployer, chain: tempoModerato, transport: http(rpcUrl) });
const recipient = privateKeyToAccount(generatePrivateKey());
const claimKey = privateKeyToAccount(generatePrivateKey());

async function wait(hash: Hex) {
  return publicClient.waitForTransactionReceipt({ hash });
}
async function faucet(address: Address) {
  return publicClient.request({ method: "tempo_fundAddress" as never, params: [address] as never });
}
async function waitForBalance(address: Address, minimum: bigint) {
  const started = Date.now();
  while (Date.now() - started < 45_000) {
    const value = await publicClient.readContract({ address: token, abi: tip20Abi, functionName: "balanceOf", args: [address] });
    if (value >= minimum) return value;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`faucet balance did not reach ${minimum}`);
}
async function waitForExpiry(target: bigint) {
  const started = Date.now();
  while (Date.now() - started < 45_000) {
    if ((await publicClient.getBlock()).timestamp >= target) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`chain timestamp did not reach ${target}`);
}
function json(value: unknown) {
  return JSON.stringify(value, (_, item) => (typeof item === "bigint" ? item.toString() : item), 2);
}

if (!process.env.TEMPO_DEPLOYER_PRIVATE_KEY) {
  console.log(`Using an in-memory disposable Moderato deployer: ${deployer.address}`);
  await faucet(deployer.address);
}
await waitForBalance(deployer.address, 2_000_000n);
await faucet(recipient.address);

let vault = configuredVault;
let deploymentTx: Hex | null = null;
if (!vault) {
  deploymentTx = await wallet.deployContract({ abi: vaultAbi, bytecode: artifact.bytecode, args: [token] });
  vault = (await wait(deploymentTx)).contractAddress as Address;
}
if (!vault) throw new Error("vault address is unavailable");

const chainId = await publicClient.getChainId();
const amount = 1_000_000n;
const payoutId = BigInt(Date.now());
const now = (await publicClient.getBlock()).timestamp;
const expiresAt = now + 3600n;
const tokenMetadata = {
  name: await publicClient.readContract({ address: token, abi: tip20Abi, functionName: "name" }),
  symbol: await publicClient.readContract({ address: token, abi: tip20Abi, functionName: "symbol" }),
  decimals: await publicClient.readContract({ address: token, abi: tip20Abi, functionName: "decimals" }),
};
const senderBalanceBefore = await publicClient.readContract({ address: token, abi: tip20Abi, functionName: "balanceOf", args: [deployer.address] });
const approveHash = await wallet.writeContract({ address: token, abi: tip20Abi, functionName: "approve", args: [vault, amount] });
await wait(approveHash);
const createHash = await wallet.writeContract({ address: vault, abi: vaultAbi, functionName: "createPayout", args: [payoutId, amount, claimKey.address, expiresAt] });
const createReceipt = await wait(createHash);
const vaultBalanceAfterFunding = await publicClient.readContract({ address: token, abi: tip20Abi, functionName: "balanceOf", args: [vault] });
const claimAction = (await publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "CLAIM_ACTION" })) as Hex;
const claimSignature = await claimKey.signTypedData({
  domain: { name: "Reach Payout Vault", version: "1", chainId, verifyingContract: vault },
  types: { Claim: [
    { name: "payoutId", type: "uint256" },
    { name: "recipient", type: "address" },
    { name: "action", type: "bytes32" },
    { name: "version", type: "uint256" },
  ] },
  primaryType: "Claim",
  message: { payoutId, recipient: recipient.address, action: claimAction, version: 1n },
});
const recipientBefore = await publicClient.readContract({ address: token, abi: tip20Abi, functionName: "balanceOf", args: [recipient.address] });
const claimHash = await wallet.writeContract({ address: vault, abi: vaultAbi, functionName: "claim", args: [payoutId, recipient.address, claimSignature] });
const claimReceipt = await wait(claimHash);
const recipientAfter = await publicClient.readContract({ address: token, abi: tip20Abi, functionName: "balanceOf", args: [recipient.address] });
const claimedPayout = payoutFromContractResult(await publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "getPayout", args: [payoutId] }), payoutId);

const reclaimPayoutId = payoutId + 1n;
const reclaimExpiry = (await publicClient.getBlock()).timestamp + 20n;
const reclaimSigner = privateKeyToAccount(generatePrivateKey());
const reclaimApprove = await wallet.writeContract({ address: token, abi: tip20Abi, functionName: "approve", args: [vault, amount] });
await wait(reclaimApprove);
const reclaimCreate = await wallet.writeContract({ address: vault, abi: vaultAbi, functionName: "createPayout", args: [reclaimPayoutId, amount, reclaimSigner.address, reclaimExpiry] });
await wait(reclaimCreate);
await waitForExpiry(reclaimExpiry);
const senderBeforeReclaim = await publicClient.readContract({ address: token, abi: tip20Abi, functionName: "balanceOf", args: [deployer.address] });
const reclaimHash = await wallet.writeContract({ address: vault, abi: vaultAbi, functionName: "reclaim", args: [reclaimPayoutId] });
const reclaimReceipt = await wait(reclaimHash);
const senderAfterReclaim = await publicClient.readContract({ address: token, abi: tip20Abi, functionName: "balanceOf", args: [deployer.address] });
const reclaimedPayout = payoutFromContractResult(await publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "getPayout", args: [reclaimPayoutId] }), reclaimPayoutId);
const memoEvents = await publicClient.getContractEvents({ address: token, abi: tip20Abi, eventName: "TransferWithMemo", fromBlock: createReceipt.blockNumber, toBlock: reclaimReceipt.blockNumber });

const evidence = {
  network: "Tempo Testnet (Moderato)", chainId, rpcUrl, deployer: deployer.address, payoutToken: token, tokenMetadata, vault,
  deploymentTx, payoutId: payoutId.toString(), createFundTx: createHash, claimTx: claimHash, recipient: recipient.address,
  recipientBalanceBefore: recipientBefore, recipientBalanceAfter: recipientAfter, vaultBalanceAfterFunding,
  claimedPayout, reclaimPayoutId: reclaimPayoutId.toString(), reclaimCreateTx: reclaimCreate, reclaimTx: reclaimHash,
  senderBalanceBefore, senderBeforeReclaim, senderAfterReclaim, reclaimedPayout, memoEvents,
  generatedAt: new Date().toISOString(),
};
mkdirSync("deployments", { recursive: true });
const evidenceFile = `deployments/moderato-integration-${Date.now()}.json`;
writeFileSync(evidenceFile, `${json(evidence)}\n`, { encoding: "utf8", flag: "wx" });
console.log(json({ evidenceFile, vault, createHash, claimHash, reclaimHash }));
