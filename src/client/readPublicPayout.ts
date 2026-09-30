import { payoutFromContractResult, serializePayout, vaultAbi } from "../shared/reach";
import { withTimeout } from "./authFlow";
import type { Address } from "viem";

/** Viem decodes multiple ABI outputs as a tuple, not named object properties. */
export async function readPublicPayout(reader: { readContract: (args: any) => Promise<unknown> }, vault: Address, id: string) {
  const result = await withTimeout(reader.readContract({
    address: vault, abi: vaultAbi, functionName: "getPayout", args: [BigInt(id)],
  }), 10_000);
  return serializePayout(payoutFromContractResult(result));
}
