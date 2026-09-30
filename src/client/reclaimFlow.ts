import { withTimeout } from "./authFlow";

export const RECLAIM_READ_TIMEOUT_MS = 10_000;
export const RECLAIM_RECONCILE_TIMEOUT_MS = 30_000;
export const SAFE_RECLAIM_READ_FAILURE = "We couldn't verify this payout right now. No transaction was submitted. Try again.";
export const SAFE_RECLAIM_NOT_EXPIRED = "This payout has not expired yet. No transaction was submitted.";
export const SAFE_RECLAIM_UNAUTHORIZED = "Only the sender can return this payout. No transaction was submitted.";
export const SAFE_RECLAIM_UNAVAILABLE = "This payout is no longer available. No transaction was submitted.";
export const SAFE_RECLAIM_PREPARATION_FAILURE = "We couldn't prepare the return transaction. No transaction was submitted. Try again.";
export const SAFE_RECLAIM_SUBMISSION_UNCERTAIN = "We couldn't confirm whether these funds were returned. Check Activity before retrying.";

export type ReclaimPayout = {
  status: number;
  sender: string;
  expiresAt: string;
  amount?: string;
  claimant?: string;
};

export type ReclaimUiState =
  | "IDLE"
  | "CHECKING"
  | "AWAITING_SIGNATURE"
  | "SUBMITTING"
  | "CONFIRMING"
  | "RECOVERING"
  | "RECLAIMED"
  | "FAILED_BEFORE_SUBMISSION"
  | "SUBMISSION_UNCERTAIN";

export type ReclaimFlowResult =
  | { outcome: "RECLAIMED"; payout: ReclaimPayout }
  | { outcome: "CLAIMED"; payout: ReclaimPayout }
  | { outcome: "FAILED_BEFORE_SUBMISSION"; message: string; payout?: ReclaimPayout }
  | { outcome: "SUBMISSION_UNCERTAIN"; message: string; payout: ReclaimPayout };

export type ReclaimFlowOptions = {
  connectedAddress?: string;
  readPayout: () => Promise<ReclaimPayout | null | undefined>;
  readChainTimestamp: () => Promise<bigint>;
  prepareSubmission?: () => void;
  submit: () => Promise<unknown>;
  reconcile: () => Promise<"RECLAIMED" | "SUBMISSION_UNCERTAIN">;
  onState: (state: ReclaimUiState, message?: string) => void;
  onPayout?: (payout: ReclaimPayout) => void;
};

function failedBeforeSubmission(options: ReclaimFlowOptions, message: string, payout?: ReclaimPayout): ReclaimFlowResult {
  options.onState("FAILED_BEFORE_SUBMISSION", message);
  return { outcome: "FAILED_BEFORE_SUBMISSION", message, ...(payout ? { payout } : {}) };
}

/**
 * Runs the sender reclaim state machine. The submission boundary is the line
 * immediately before submit(): every provider error after that boundary is
 * reconciled as potentially submitted and can never be downgraded to a safe
 * pre-submission failure.
 */
export async function runReclaimFlow(options: ReclaimFlowOptions): Promise<ReclaimFlowResult> {
  options.onState("CHECKING");

  let payout: ReclaimPayout | null | undefined;
  try {
    payout = await withTimeout(options.readPayout(), RECLAIM_READ_TIMEOUT_MS);
  } catch {
    return failedBeforeSubmission(options, SAFE_RECLAIM_READ_FAILURE);
  }

  if (!payout) return failedBeforeSubmission(options, SAFE_RECLAIM_READ_FAILURE);
  options.onPayout?.(payout);

  if (payout.status === 3) {
    options.onState("RECLAIMED");
    return { outcome: "RECLAIMED", payout };
  }

  if (payout.status === 2) {
    options.onState("IDLE");
    return { outcome: "CLAIMED", payout };
  }

  if (payout.status !== 1) return failedBeforeSubmission(options, SAFE_RECLAIM_UNAVAILABLE, payout);

  if (!options.connectedAddress || payout.sender.toLowerCase() !== options.connectedAddress.toLowerCase()) {
    return failedBeforeSubmission(options, SAFE_RECLAIM_UNAUTHORIZED, payout);
  }

  let chainTimestamp: bigint;
  try {
    chainTimestamp = await withTimeout(options.readChainTimestamp(), RECLAIM_READ_TIMEOUT_MS);
  } catch {
    return failedBeforeSubmission(options, SAFE_RECLAIM_READ_FAILURE, payout);
  }

  if (chainTimestamp < BigInt(payout.expiresAt)) {
    return failedBeforeSubmission(options, SAFE_RECLAIM_NOT_EXPIRED, payout);
  }

  try {
    options.prepareSubmission?.();
  } catch {
    return failedBeforeSubmission(options, SAFE_RECLAIM_PREPARATION_FAILURE, payout);
  }

  options.onState("AWAITING_SIGNATURE");

  // This is the submission boundary. A provider exception after this line
  // may mean the transaction was accepted even if no hash reached the UI.
  options.onState("SUBMITTING");
  try {
    await options.submit();
    options.onState("CONFIRMING");
  } catch {
    options.onState("RECOVERING");
  }

  try {
    const resolution = await withTimeout(options.reconcile(), RECLAIM_RECONCILE_TIMEOUT_MS);
    if (resolution === "RECLAIMED") {
      const reclaimed = { ...payout, status: 3 };
      options.onPayout?.(reclaimed);
      options.onState("RECLAIMED");
      return { outcome: "RECLAIMED", payout: reclaimed };
    }
  } catch {
    // A bounded reconciliation timeout is still ambiguous after submission.
  }

  options.onState("SUBMISSION_UNCERTAIN", SAFE_RECLAIM_SUBMISSION_UNCERTAIN);
  return { outcome: "SUBMISSION_UNCERTAIN", message: SAFE_RECLAIM_SUBMISSION_UNCERTAIN, payout };
}
