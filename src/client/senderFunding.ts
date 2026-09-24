import { numberToHex, type Address, type Hex } from "viem";
import { TEMPO_MODERATO_CHAIN_ID } from "../shared/reach";

export type FundingFillCall = {
  to: Address;
  data: Hex;
  value: Hex;
};

export type FundingFillRequest = {
  from: Address;
  chainId: Hex;
  calls: readonly FundingFillCall[];
  feePayer: false;
  keyType: "webAuthn";
};

export type FundingFillClient = {
  request(args: { method: string; params: readonly unknown[] }): Promise<unknown>;
};

export type FundingPreflightResult =
  | { ok: true; response: unknown }
  | { ok: false; message: string };

export type ExpectedPayout = {
  sender: string;
  amount: string;
  expiresAt: string;
  claimSigner: string;
};

export type AuthoritativePayout = ExpectedPayout & {
  status: number;
};

export type FundingResolution = "FUNDED" | "FAILED_RETRYABLE" | "RECOVERY_REQUIRED";

export function toFundingFillRequest(address: Address, calls: readonly { to: Address; data: Hex; value: bigint }[]): FundingFillRequest {
  return {
    from: address,
    chainId: numberToHex(TEMPO_MODERATO_CHAIN_ID),
    calls: calls.map((call) => ({ ...call, value: numberToHex(call.value) })),
    feePayer: false,
    keyType: "webAuthn",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function isFilledTransactionResponse(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.tx)) return false;
  const tx = value.tx;
  return typeof tx.type === "string" && Array.isArray(tx.calls);
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (isRecord(error) && typeof error.message === "string") return error.message;
  return "";
}

export function preflightFailureMessage(error: unknown): string {
  const text = errorText(error).toLowerCase();
  if (text.includes("insufficient") || text.includes("balance") || text.includes("045c4b02") || text.includes("tokentransferfailed")) {
    return "This payout plus its network fee exceeds your available balance.";
  }
  return "Funding preflight failed. Leave some pathUSD for the network fee, then retry.";
}

export async function preflightFunding(client: FundingFillClient | undefined, request: FundingFillRequest): Promise<FundingPreflightResult> {
  if (!client) return { ok: false, message: "Tempo transaction preflight is unavailable. Reconnect your sender account and retry." };
  try {
    const response = await client.request({ method: "eth_fillTransaction", params: [request] });
    if (!isFilledTransactionResponse(response)) return { ok: false, message: "Funding preflight returned no usable transaction. Retry before signing." };
    return { ok: true, response };
  } catch (error) {
    return { ok: false, message: preflightFailureMessage(error) };
  }
}

export function payoutMatchesExpected(payout: AuthoritativePayout | undefined, expected: ExpectedPayout): boolean {
  if (!payout || payout.status !== 1) return false;
  return payout.sender.toLowerCase() === expected.sender.toLowerCase()
    && payout.amount === expected.amount
    && payout.expiresAt === expected.expiresAt
    && payout.claimSigner.toLowerCase() === expected.claimSigner.toLowerCase();
}

export function resolveFundingReceipt(options: { receiptStatus: "success" | "reverted"; payout?: AuthoritativePayout; expected: ExpectedPayout }): FundingResolution {
  if (options.receiptStatus === "reverted") return "FAILED_RETRYABLE";
  return payoutMatchesExpected(options.payout, options.expected) ? "FUNDED" : "RECOVERY_REQUIRED";
}

export function failedArtifactMessage(): string {
  return "Funding failed. No payout was created.";
}

