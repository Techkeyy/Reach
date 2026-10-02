export type FinancialErrorCode =
  | "INVALID_RECIPIENT"
  | "SELF_TRANSFER"
  | "INVALID_AMOUNT"
  | "INSUFFICIENT_TRANSFER_BALANCE"
  | "INSUFFICIENT_FEE_BALANCE"
  | "FEE_ESTIMATE_UNAVAILABLE"
  | "NETWORK_UNAVAILABLE"
  | "USER_CANCELLED"
  | "FAILED_BEFORE_SUBMISSION"
  | "SUBMISSION_UNCERTAIN"
  | "TRANSACTION_REVERTED"
  | "FEE_ESTIMATE_CHANGED";

export const FINANCIAL_ERROR_MESSAGES: Record<FinancialErrorCode, string> = {
  INVALID_RECIPIENT: "That isn't a valid Tempo wallet address.",
  SELF_TRANSFER: "That's your own Reach address.",
  INVALID_AMOUNT: "Enter an amount greater than 0 pathUSD.",
  INSUFFICIENT_TRANSFER_BALANCE: "You don't have enough pathUSD for this payment.",
  INSUFFICIENT_FEE_BALANCE: "You have enough for the payment, but not enough to cover the estimated network fee.",
  FEE_ESTIMATE_UNAVAILABLE: "We couldn't calculate the network fee right now. Nothing has been submitted.",
  NETWORK_UNAVAILABLE: "Tempo is unavailable right now. Nothing has been submitted.",
  USER_CANCELLED: "You cancelled the confirmation. Nothing was sent.",
  FAILED_BEFORE_SUBMISSION: "We couldn't submit this transaction. Your funds were not moved.",
  SUBMISSION_UNCERTAIN: "We couldn't confirm this transaction yet. Don't send again while we check Activity.",
  TRANSACTION_REVERTED: "The transaction was reverted. Your funds were not moved.",
  FEE_ESTIMATE_CHANGED: "The estimated network fee changed. Review the updated total before confirming.",
};

export class FinancialError extends Error {
  readonly code: FinancialErrorCode;

  constructor(code: FinancialErrorCode, message = FINANCIAL_ERROR_MESSAGES[code]) {
    super(message);
    this.name = "FinancialError";
    this.code = code;
  }
}

export function isUserCancellation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /user rejected|user denied|user cancelled|user canceled|request rejected|cancelled by user|canceled by user/i.test(message)
    || (typeof error === "object" && error !== null && "code" in error && [4001, "4001", "ACTION_REJECTED"].includes((error as { code?: unknown }).code as never));
}
