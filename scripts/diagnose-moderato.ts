import { readFileSync } from "node:fs";
import { createPublicClient, http, recoverTypedDataAddress, parseAbi, type Address, type Hex } from "viem";
import { tempoModerato } from "viem/chains";
import { payoutFromContractResult } from "../src/shared/reach";

const rpcUrl = process.env.TEMPO_MODERATO_RPC_URL ?? "https://rpc.moderato.tempo.xyz";
const vault = process.env.REACH_VAULT_ADDRESS as Address;
const token = (process.env.TEMPO_PAYOUT_TOKEN ?? "0x20c0000000000000000000000000000000000000") as Address;
const payoutId = BigInt(process.env.REACH_PAYOUT_ID ?? "0");
const recipient = process.env.REACH_RECIPIENT as Address;
const signature = process.env.REACH_CLAIM_SIGNATURE as Hex;
const artifact = JSON.parse(readFileSync(new URL("../artifacts/contracts/ReachPayoutVault.sol/ReachPayoutVault.json", import.meta.url), "utf8"));
const client = createPublicClient({ chain: tempoModerato, transport: http(rpcUrl) });
const tip20Abi = parseAbi(["function balanceOf(address) view returns (uint256)", "function transferWithMemo(address,uint256,bytes32) returns (bool)"]);

const [chainId, payout, digest, action, vaultToken, vaultBalance] = await Promise.all([
  client.getChainId(),
  client.readContract({ address: vault, abi: artifact.abi, functionName: "getPayout", args: [payoutId] }).then(result => payoutFromContractResult(result, payoutId)),
  client.readContract({ address: vault, abi: artifact.abi, functionName: "hashClaimAuthorization", args: [payoutId, recipient] }),
  client.readContract({ address: vault, abi: artifact.abi, functionName: "CLAIM_ACTION" }),
  client.readContract({ address: vault, abi: artifact.abi, functionName: "token" }),
  client.readContract({ address: token, abi: tip20Abi, functionName: "balanceOf", args: [vault] }),
]);

let recovered: Address | null = null;
try {
  recovered = await recoverTypedDataAddress({
    domain: { name: "Reach Payout Vault", version: "1", chainId, verifyingContract: vault },
    types: { Claim: [
      { name: "payoutId", type: "uint256" },
      { name: "recipient", type: "address" },
      { name: "action", type: "bytes32" },
      { name: "version", type: "uint256" },
    ] },
    primaryType: "Claim",
    message: { payoutId, recipient, action: action as Hex, version: 1n },
    signature,
  });
} catch {}

let transferSimulation: unknown = null;
try {
  transferSimulation = await client.simulateContract({
    address: token,
    abi: tip20Abi,
    functionName: "transferWithMemo",
    args: [recipient, payout.amount, `0x${payoutId.toString(16).padStart(64, "0")}`],
    account: vault,
  });
} catch (error) {
  transferSimulation = String(error);
}

console.log(JSON.stringify({ chainId, vault, vaultToken, payout, digest, action, recovered, expectedClaimSigner: payout.claimSigner, vaultBalance, transferSimulation }, (_, value) => typeof value === "bigint" ? value.toString() : value, 2));
