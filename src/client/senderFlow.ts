import { payoutStatus, PATH_USD_DECIMALS, type PayoutStatus } from "../shared/reach";

export type SenderStage = "REVIEW" | "PREFLIGHTING" | "READY_TO_SIGN" | "SIGNING" | "SUBMITTED" | "CONFIRMING" | "FUNDED" | "FAILED_RETRYABLE" | "RECOVERY_REQUIRED";
export type FundingSubmissionState = "NOT_SUBMITTED" | "SUBMITTING" | "HASH_RECEIVED" | "SUBMITTED_WITH_HASH" | "CONFIRMING_RECEIPT" | "READING_PAYOUT" | "CONFIRMING" | "CONFIRMED" | "FAILED" | "FAILED_BEFORE_SUBMISSION" | "SUBMISSION_UNCERTAIN";
export type BalanceStatus = "LOADING" | "READY" | "ERROR";
export type BalanceState = {
  status: BalanceStatus;
  balance: string | null;
  error: string | null;
  httpStatus?: number;
};

export const loadingBalance = (): BalanceState => ({ status: "LOADING", balance: null, error: null });
export const readyBalance = (balance: string): BalanceState => ({ status: "READY", balance: parseAuthoritativeBalance({ balance }), error: null });
export const failedBalance = (error: string, httpStatus?: number): BalanceState => ({ status: "ERROR", balance: null, error, ...(httpStatus === undefined ? {} : { httpStatus }) });

export function parseAuthoritativeBalance(value: unknown): string {
  if (!value || typeof value !== "object") throw new Error("balance response malformed");
  const balance = (value as Record<string, unknown>).balance;
  if (typeof balance !== "string" || !/^(0|[1-9]\d*)$/.test(balance)) throw new Error("balance response malformed");
  return balance;
}

export function fundingAllowed(balance: BalanceState, requestedAmount: bigint): boolean {
  return balance.status === "READY" && balance.balance !== null && requestedAmount <= BigInt(balance.balance);
}

export function parsePathUsdAmount(input: string): bigint { if (input !== input.trim() || !/^\d+(?:\.\d{1,6})?$/.test(input)) throw new Error("amount must be a positive decimal with up to 6 places"); const [whole, fraction = ""] = input.split("."); const amount = BigInt(whole) * 10n ** BigInt(PATH_USD_DECIMALS) + BigInt(fraction.padEnd(PATH_USD_DECIMALS, "0") || "0"); if (amount <= 0n) throw new Error("amount must be greater than zero"); return amount; }
export function formatPathUsd(amount: bigint): string { const raw = amount.toString().padStart(PATH_USD_DECIMALS + 1, "0"); const whole = raw.slice(0, -PATH_USD_DECIMALS); const fraction = raw.slice(-PATH_USD_DECIMALS).replace(/0+$/, "").padEnd(2, "0"); return `${BigInt(whole).toLocaleString()}.${fraction}`; }
function secureRandom(bytes: Uint8Array) { (crypto.getRandomValues as unknown as (array: Uint8Array) => Uint8Array)(bytes); }
export function createPayoutId(randomize: (bytes: Uint8Array) => void = secureRandom): string { const bytes = new Uint8Array(32); randomize(bytes); const id = BigInt(`0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`); return (id === 0n ? 1n : id).toString(); }
export function expiryFromNow(nowSeconds: number, lifetimeSeconds: number): bigint { if (!Number.isSafeInteger(nowSeconds) || !Number.isSafeInteger(lifetimeSeconds) || lifetimeSeconds <= 0) throw new Error("invalid expiry"); return BigInt(nowSeconds + lifetimeSeconds); }
export function isReclaimEligible(status: PayoutStatus, expiresAt: bigint, nowSeconds: bigint, sender: string, connectedAddress: string | undefined): boolean { return status === payoutStatus.FUNDED && nowSeconds >= expiresAt && Boolean(connectedAddress) && sender.toLowerCase() === connectedAddress!.toLowerCase(); }
export function resolveFundingStage(options: { onchainStatus: PayoutStatus | undefined; transactionSubmitted: boolean; failed: boolean; recoveryRequired?: boolean }): SenderStage { if (options.recoveryRequired) return "RECOVERY_REQUIRED"; if (options.failed) return "FAILED_RETRYABLE"; if (options.onchainStatus === payoutStatus.FUNDED) return "FUNDED"; if (options.transactionSubmitted) return "CONFIRMING"; return "REVIEW"; }
export function canEnterFundingSigning(options: { stage: SenderStage; preflightChecking: boolean; preflightError: string | null; prepared: boolean; submissionState: FundingSubmissionState }): boolean {
  return options.prepared
    && options.stage === "READY_TO_SIGN"
    && options.submissionState === "NOT_SUBMITTED"
    && !options.preflightChecking
    && !options.preflightError;
}
export function publicStatusLabel(status: PayoutStatus, expiresAt: bigint, nowSeconds: bigint): string { if (status === payoutStatus.FUNDED && nowSeconds >= expiresAt) return "EXPIRED · RECLAIM AVAILABLE"; if (status === payoutStatus.FUNDED) return "FUNDED"; if (status === payoutStatus.CLAIMED) return "CLAIMED"; if (status === payoutStatus.RECLAIMED) return "RECLAIMED"; return "NOT FUNDED"; }
