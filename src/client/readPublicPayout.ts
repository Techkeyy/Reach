import { parsePayoutId, PayoutReadError, payoutFromContractResult, serializePayout, vaultAbi } from "../shared/reach";
import { withTimeout } from "./authFlow";
import type { Address } from "viem";

/** Viem decodes multiple ABI outputs as a tuple, not named object properties. */
export async function readPublicPayout(reader: { readContract: (args: any) => Promise<unknown> }, vault: Address, id: string) {
  const payoutId = parsePayoutId(id);
  let result: unknown;
  try {
    result = await withTimeout(reader.readContract({
      address: vault, abi: vaultAbi, functionName: "getPayout", args: [payoutId],
    }), 10_000);
  } catch { throw new PayoutReadError("READ_UNAVAILABLE"); }
  return serializePayout(payoutFromContractResult(result, payoutId));
}

/** Only /api/payout/:id has this contract: server performs a fresh validated
 * vault read. Never use this parser to promote /api/payouts discovery metadata. */
export async function readCurrentPayoutApi(id: string, fetchImpl: typeof fetch = fetch) {
  parsePayoutId(id);
  let response: Response;
  try { response = await fetchImpl(`/api/payout/${id}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) }); }
  catch { throw new PayoutReadError("READ_UNAVAILABLE"); }
  if (response.status === 404) throw new PayoutReadError("NOT_FOUND");
  if (!response.ok) throw new PayoutReadError("READ_UNAVAILABLE");
  let data: unknown;
  try { data = await response.json(); } catch { throw new PayoutReadError("DECODE_FAILURE"); }
  return serializePayout(payoutFromContractResult(data, id));
}
