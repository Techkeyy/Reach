import { isAddress, type Address, type Hex } from "viem";
import { parsePayoutId, PayoutReadError, payoutFromContractResult, serializePayout, vaultAbi } from "../shared/reach";
import type { AccountingAmount, ConfirmedPayoutAccounting } from "../shared/transactionAccounting";
import { withTimeout } from "./authFlow";

export type CurrentPayoutApi = ReturnType<typeof serializePayout> & {
  id?: string;
  fundingTxHash?: Hex;
  createdAt?: string;
  createdBlock?: string;
  accounting?: ConfirmedPayoutAccounting | null;
};

function decimalString(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value);
}

function parseAccountingAmount(value: unknown): AccountingAmount | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (!decimalString(item.amount) || !Number.isSafeInteger(item.decimals) || (item.decimals as number) < 0 || !isAddress(String(item.token))) return null;
  return {
    amount: item.amount,
    decimals: item.decimals as number,
    token: item.token as Address,
    ...(typeof item.symbol === "string" && item.symbol.length > 0 ? { symbol: item.symbol } : {}),
  };
}

export function parsePayoutAccounting(value: unknown): ConfirmedPayoutAccounting | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (item.receiptStatus !== "success" || typeof item.txHash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(item.txHash)) return null;
  if (!isAddress(String(item.feeToken)) || !decimalString(item.actualFeeAmount) || !decimalString(item.gasUsed) || !decimalString(item.effectiveGasPrice)) return null;
  if (!Number.isSafeInteger(item.feeTokenDecimals) || (item.feeTokenDecimals as number) < 0) return null;
  if (!Array.isArray(item.actualTotalDeducted)) return null;
  const actualTotalDeducted = item.actualTotalDeducted.map(parseAccountingAmount);
  if (actualTotalDeducted.some((entry) => entry === null)) return null;
  return {
    txHash: item.txHash as Hex,
    receiptStatus: "success",
    feeToken: item.feeToken as Address,
    feeTokenDecimals: item.feeTokenDecimals as number,
    ...(typeof item.feeTokenSymbol === "string" && item.feeTokenSymbol.length > 0 ? { feeTokenSymbol: item.feeTokenSymbol } : {}),
    actualFeeAmount: item.actualFeeAmount,
    gasUsed: item.gasUsed,
    effectiveGasPrice: item.effectiveGasPrice,
    actualTotalDeducted: actualTotalDeducted as AccountingAmount[],
  };
}
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
export async function readCurrentPayoutApi(id: string, fetchImpl: typeof fetch = fetch): Promise<CurrentPayoutApi> {
  parsePayoutId(id);
  let response: Response;
  try { response = await fetchImpl(`/api/payout/${id}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) }); }
  catch { throw new PayoutReadError("READ_UNAVAILABLE"); }
  if (response.status === 404) throw new PayoutReadError("NOT_FOUND");
  if (!response.ok) throw new PayoutReadError("READ_UNAVAILABLE");
  let data: unknown;
  try { data = await response.json(); } catch { throw new PayoutReadError("DECODE_FAILURE"); }
  const payout = serializePayout(payoutFromContractResult(data, id));
  if (!data || typeof data !== "object") return payout;
  const value = data as Record<string, unknown>;
  const fundingTxHash = typeof value.fundingTxHash === "string" && /^0x[a-fA-F0-9]{64}$/.test(value.fundingTxHash)
    ? value.fundingTxHash as Hex
    : undefined;
  const accounting = value.accounting === null ? null : parsePayoutAccounting(value.accounting);
  return {
    ...payout,
    ...(value.id === id ? { id } : {}),
    ...(fundingTxHash ? { fundingTxHash } : {}),
    ...(typeof value.createdAt === "string" ? { createdAt: value.createdAt } : {}),
    ...(typeof value.createdBlock === "string" ? { createdBlock: value.createdBlock } : {}),
    ...(value.accounting === null || accounting ? { accounting } : {}),
  } satisfies CurrentPayoutApi;
}
