import { numberToHex, type Address, type Hex } from "viem";
import { PATH_USD_ADDRESS, TEMPO_MODERATO_CHAIN_ID } from "../shared/reach";
import { resolvePayoutLifecycle, type AuthoritativePayout } from "./payoutLifecycle";
import { buildFinancialQuote, parsePreflightFeeEvidence, requireAffordableQuote, type FinancialQuote } from "./financialQuote";
import { FinancialError, FINANCIAL_ERROR_MESSAGES, isUserCancellation } from "./financialErrors";
export type { AuthoritativePayout } from "./payoutLifecycle";

export type FundingFillCall = {
  to: Address;
  data: Hex;
  value: Hex;
};

export type SenderFundingCall = {
  to: Address;
  data: Hex;
  value: bigint;
};

export type SenderFundingRequest = {
  chainId: typeof TEMPO_MODERATO_CHAIN_ID;
  calls: readonly SenderFundingCall[];
  feePayer: false;
};

export type FundingFillRequest = {
  from: Address;
  chainId: Hex;
  calls: readonly FundingFillCall[];
  feePayer: false;
  feeToken: Address;
  keyType: "webAuthn";
  capabilities?: { balanceDiffs?: boolean; errors?: boolean };
};

export type FundingFillClient = {
  request(args: { method: string; params: readonly unknown[] }): Promise<unknown>;
};

export type FundingPreflightResult =
  | { ok: true; response: unknown }
  | { ok: false; message: string; code?: "INSUFFICIENT_TRANSFER_BALANCE" | "INSUFFICIENT_FEE_BALANCE" | "FEE_ESTIMATE_UNAVAILABLE" };

export type FundingPreflightContext = {
  availableBalance?: bigint;
  sendAmount?: bigint;
};

export const SAFE_PRE_SIGNING_FAILURE = "We couldn't prepare this payout. Your funds were not moved.";
export const SAFE_SUBMISSION_UNCERTAIN = "We couldn't confirm whether this payout was submitted. Check Activity before retrying.";
export const SAFE_SUBMISSION_FAILED = "We couldn't submit this payout. Your funds were not moved.";

export type ExpectedPayout = {
  sender: string;
  amount: string;
  expiresAt: string;
  claimSigner: string;
};

export type FundingResolution = "FUNDED" | "FAILED_RETRYABLE" | "RECOVERY_REQUIRED";

export type FundingReconciliationResult = {
  resolution: "FUNDED" | "FAILED_RETRYABLE" | "SUBMISSION_UNCERTAIN";
  receiptStatus?: "success" | "reverted";
  payout?: AuthoritativePayout;
};

export type FundingReconciliationOptions = {
  expected: ExpectedPayout;
  waitForReceipt: () => Promise<{ status: "success" | "reverted"; receipt?: unknown }>;
  readPayout: () => Promise<AuthoritativePayout | undefined | null>;
  attempts?: number;
  delayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
  onReceipt?: (status: "success" | "reverted") => void;
};

export type ReclaimReconciliationResult = "RECLAIMED" | "SUBMISSION_UNCERTAIN";

export type ReclaimReconciliationOptions = {
  readPayout: () => Promise<AuthoritativePayout | undefined | null>;
  attempts?: number;
  delayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
};

/**
 * Reconcile a submitted funding hash against authoritative chain state.
 * Receipt success is necessary, but the vault read is the business-state
 * authority. The caller retains the public record and capability throughout
 * an unresolved result so a later refresh can recover without a duplicate.
 */
export async function reconcileFundingSubmission(options: FundingReconciliationOptions): Promise<FundingReconciliationResult> {
  let receipt: { status: "success" | "reverted" };
  try {
    receipt = await options.waitForReceipt();
  } catch {
    return { resolution: "SUBMISSION_UNCERTAIN" };
  }

  if (receipt.status === "reverted") {
    options.onReceipt?.("reverted");
    return { resolution: "FAILED_RETRYABLE", receiptStatus: "reverted" };
  }

  options.onReceipt?.("success");

  const attempts = options.attempts ?? 25;
  const delayMs = options.delayMs ?? 1200;
  const sleep = options.sleep ?? ((delay: number) => new Promise<void>((resolve) => setTimeout(resolve, delay)));
  let lastPayout: AuthoritativePayout | undefined;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const payout = await options.readPayout();
      if (payout) {
        lastPayout = payout;
        if (payoutMatchesExpected(payout, options.expected)) {
          return { resolution: "FUNDED", receiptStatus: "success", payout };
        }
      }
    } catch {
      // A transient direct-read failure is unresolved, not a failed send.
    }

    if (attempt + 1 < attempts) await sleep(delayMs);
  }

  return { resolution: "SUBMISSION_UNCERTAIN", receiptStatus: "success", ...(lastPayout ? { payout: lastPayout } : {}) };
}

export async function reconcileReclaimSubmission(options: ReclaimReconciliationOptions): Promise<ReclaimReconciliationResult> {
  const attempts = options.attempts ?? 20;
  const delayMs = options.delayMs ?? 1200;
  const sleep = options.sleep ?? ((delay: number) => new Promise<void>((resolve) => setTimeout(resolve, delay)));

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const payout = await options.readPayout();
      if (resolvePayoutLifecycle({ authoritativePayout: payout }).financialState === "RECLAIMED") return "RECLAIMED";
    } catch {
      // A transient direct-read failure is unresolved, not proof that reclaim failed.
    }

    if (attempt + 1 < attempts) await sleep(delayMs);
  }

  return "SUBMISSION_UNCERTAIN";
}

export function senderFundingRequest(calls: readonly SenderFundingCall[]): SenderFundingRequest {
  return {
    chainId: TEMPO_MODERATO_CHAIN_ID,
    calls,
    feePayer: false,
  };
}

export function toFundingFillRequest(address: Address, calls: readonly { to: Address; data: Hex; value: bigint }[]): FundingFillRequest {
  const request = senderFundingRequest(calls);
  return {
    from: address,
    chainId: numberToHex(request.chainId),
    calls: request.calls.map((call) => ({ ...call, value: numberToHex(call.value) })),
    feePayer: request.feePayer,
    // Reach sender operations are denominated in pathUSD and explicitly pay
    // their own fee in that same token. This makes the returned Tempo fill
    // envelope identify the fee token so a fee can be derived even when the
    // native sender-paid fill omits Accounts relay capabilities.
    feeToken: PATH_USD_ADDRESS,
    keyType: "webAuthn",
    capabilities: { balanceDiffs: true, errors: true },
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

export function preflightFailureMessage(_error: unknown): string {
  // Keep RPC/Viem details out of the consumer UI. The raw error is never
  // returned to the caller.
  return SAFE_PRE_SIGNING_FAILURE;
}

export function financialQuoteFromPreflight(response: unknown, availableBalance: bigint, sendAmount: bigint, feeTokenBalance?: bigint, fallbackFeeToken?: Address): FinancialQuote {
  return buildFinancialQuote({ availableBalance, sendAmount, fee: parsePreflightFeeEvidence(response, fallbackFeeToken), feeTokenBalance });
}

export function financialQuoteError(quote: FinancialQuote): string | null {
  if (quote.affordabilityStatus === "INSUFFICIENT_TRANSFER_BALANCE") return FINANCIAL_ERROR_MESSAGES.INSUFFICIENT_TRANSFER_BALANCE;
  if (quote.affordabilityStatus === "INSUFFICIENT_FEE_BALANCE") return FINANCIAL_ERROR_MESSAGES.INSUFFICIENT_FEE_BALANCE;
  if (quote.feeStatus === "UNAVAILABLE" || quote.affordabilityStatus === "UNKNOWN") return FINANCIAL_ERROR_MESSAGES.FEE_ESTIMATE_UNAVAILABLE;
  return null;
}

export function requireFinancialQuote(quote: FinancialQuote): FinancialQuote {
  try { return requireAffordableQuote(quote); } catch (error) { throw error instanceof FinancialError ? error : new FinancialError("FEE_ESTIMATE_UNAVAILABLE"); }
}

export { isUserCancellation };

function errorRecord(error: unknown): Record<string, unknown> | null {
  return error && typeof error === "object" && !Array.isArray(error) ? error as Record<string, unknown> : null;
}

function errorText(error: unknown): string {
  const root = errorRecord(error);
  const cause = errorRecord(root?.cause);
  return [
    error instanceof Error ? error.message : "",
    typeof root?.shortMessage === "string" ? root.shortMessage : "",
    typeof root?.details === "string" ? root.details : "",
    typeof root?.message === "string" ? root.message : "",
    typeof cause?.message === "string" ? cause.message : "",
  ].filter(Boolean).join(" ");
}

function insufficientBalanceCode(input: {
  errorName?: unknown;
  message?: unknown;
  token?: unknown;
  request: FundingFillRequest;
  context?: FundingPreflightContext;
}): "INSUFFICIENT_TRANSFER_BALANCE" | "INSUFFICIENT_FEE_BALANCE" | null {
  const text = `${String(input.errorName ?? "")} ${String(input.message ?? "")}`;
  if (!/insufficientbalance|insufficient balance|insufficient funds|insufficientfeetokenbalance|insufficient fee|tokentransferfailed/i.test(text)) return null;

  const available = input.context?.availableBalance;
  const sendAmount = input.context?.sendAmount;
  if (available !== undefined && sendAmount !== undefined && sendAmount > available) return "INSUFFICIENT_TRANSFER_BALANCE";

  // Once the requested transfer fits within the authoritative balance, an
  // SDK requireFunds/InsufficientBalance response is the fee-token leg of the
  // operation, even when Tempo selected a different fee token.
  if (available !== undefined && sendAmount !== undefined) return "INSUFFICIENT_FEE_BALANCE";

  const token = typeof input.token === "string" ? input.token.toLowerCase() : null;
  if (token && token === input.request.feeToken.toLowerCase()) return "INSUFFICIENT_FEE_BALANCE";
  if (/insufficientfeetokenbalance|insufficient fee/i.test(text)) return "INSUFFICIENT_FEE_BALANCE";
  return null;
}

function preflightResponseFailure(response: unknown, request: FundingFillRequest, context?: FundingPreflightContext): FundingPreflightResult | null {
  if (!response || typeof response !== "object") return null;
  const root = response as Record<string, unknown>;
  const capabilities = root.capabilities && typeof root.capabilities === "object" ? root.capabilities as Record<string, unknown> : null;
  const capabilityError = capabilities?.error && typeof capabilities.error === "object" ? capabilities.error as Record<string, unknown> : null;
  const requireFunds = capabilities?.requireFunds && typeof capabilities.requireFunds === "object" ? capabilities.requireFunds as Record<string, unknown> : null;
  if (!capabilityError && !requireFunds) return null;

  const code = insufficientBalanceCode({
    errorName: capabilityError?.errorName ?? (requireFunds ? "InsufficientBalance" : undefined),
    message: capabilityError?.message,
    token: requireFunds?.token,
    request,
    context,
  });
  return {
    ok: false,
    code: code ?? "FEE_ESTIMATE_UNAVAILABLE",
    message: code ? FINANCIAL_ERROR_MESSAGES[code] : SAFE_PRE_SIGNING_FAILURE,
  };
}

function preflightErrorCode(error: unknown, request: FundingFillRequest, context?: FundingPreflightContext): "INSUFFICIENT_TRANSFER_BALANCE" | "INSUFFICIENT_FEE_BALANCE" | null {
  const root = errorRecord(error);
  const cause = errorRecord(root?.cause);
  return insufficientBalanceCode({
    errorName: root?.errorName ?? cause?.errorName ?? root?.name ?? cause?.name,
    message: errorText(error),
    token: root?.token ?? cause?.token,
    request,
    context,
  });
}

export async function preflightFunding(client: FundingFillClient | undefined, request: FundingFillRequest, context?: FundingPreflightContext): Promise<FundingPreflightResult> {
  if (!client) return { ok: false, message: "Tempo transaction preflight is unavailable. Reconnect your sender account and retry." };
  try {
    const response = await client.request({ method: "eth_fillTransaction", params: [request] });
    const responseFailure = preflightResponseFailure(response, request, context);
    if (responseFailure) return responseFailure;
    if (!isFilledTransactionResponse(response)) return { ok: false, message: "Funding preflight returned no usable transaction. Retry before signing." };
    return { ok: true, response };
  } catch (error) {
    const code = preflightErrorCode(error, request, context);
    return { ok: false, ...(code ? { code } : {}), message: code ? FINANCIAL_ERROR_MESSAGES[code] : preflightFailureMessage(error) };
  }
}

export function payoutMatchesIdentity(payout: AuthoritativePayout | undefined, expected: ExpectedPayout): boolean {
  if (!payout) return false;
  return payout.sender.toLowerCase() === expected.sender.toLowerCase()
    && payout.amount === expected.amount
    && payout.expiresAt === expected.expiresAt
    && payout.claimSigner.toLowerCase() === expected.claimSigner.toLowerCase();
}

export function payoutMatchesExpected(payout: AuthoritativePayout | undefined, expected: ExpectedPayout): boolean {
  return resolvePayoutLifecycle({ authoritativePayout: payout }).vaultStatus === 1 && payoutMatchesIdentity(payout, expected);
}

export function resolveFundingReceipt(options: { receiptStatus: "success" | "reverted"; payout?: AuthoritativePayout; expected: ExpectedPayout }): FundingResolution {
  if (options.receiptStatus === "reverted") return "FAILED_RETRYABLE";
  return payoutMatchesExpected(options.payout, options.expected) ? "FUNDED" : "RECOVERY_REQUIRED";
}

export function failedArtifactMessage(): string {
  return "Funding failed. No payout was created.";
}

