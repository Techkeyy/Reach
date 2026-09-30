import { withTimeout } from "./authFlow";
import { submitAndReconcile } from "./submitAndReconcile";
import { payoutFromContractResult, serializePayout } from "../shared/reach";
import { reclaimReadiness, resolvePayoutLifecycle, type AuthoritativePayout } from "./payoutLifecycle";

export const RECLAIM_READ_TIMEOUT_MS = 10_000;
export const RECLAIM_RECONCILE_TIMEOUT_MS = 30_000;
export const SAFE_RECLAIM_READ_FAILURE = "We couldn't verify this payout right now. No transaction was submitted. Try again.";
export const SAFE_RECLAIM_NOT_EXPIRED = "This payout has not expired yet. No transaction was submitted.";
export const SAFE_RECLAIM_UNAUTHORIZED = "Only the sender can return this payout. No transaction was submitted.";
export const SAFE_RECLAIM_UNAVAILABLE = "This payout is no longer available. No transaction was submitted.";
export const SAFE_RECLAIM_PREPARATION_FAILURE = "We couldn't prepare the return transaction. No transaction was submitted. Try again.";
export const SAFE_RECLAIM_FAILED = "The return transaction failed. No funds were moved.";
export const SAFE_RECLAIM_SUBMISSION_UNCERTAIN = "We couldn't confirm whether these funds were returned. Check Activity before retrying.";

export type ReclaimPayout = AuthoritativePayout;

export type ReclaimUiState =
  | "IDLE"
  | "CHECKING"
  | "AWAITING_SIGNATURE"
  | "SUBMITTING"
  | "CONFIRMING"
  | "RECOVERING"
  | "RECLAIMED"
  | "FAILED"
  | "FAILED_BEFORE_SUBMISSION"
  | "SUBMISSION_UNCERTAIN";

export type ReclaimFlowResult =
  | { outcome: "RECLAIMED"; payout: ReclaimPayout }
  | { outcome: "CLAIMED"; payout: ReclaimPayout }
  | { outcome: "FAILED_BEFORE_SUBMISSION"; message: string; payout?: ReclaimPayout }
  | { outcome: "FAILED"; message: string; payout: ReclaimPayout }
  | { outcome: "SUBMISSION_UNCERTAIN"; message: string; payout: ReclaimPayout };

export type ReclaimFlowOptions = {
  connectedAddress?: string;
  readPayout: () => Promise<ReclaimPayout | null | undefined>;
  readChainTimestamp: () => Promise<bigint>;
  prepareSubmission?: () => void;
  submit: () => Promise<unknown>;
  reconcile: () => Promise<unknown>;
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
    payout = serializePayout(payoutFromContractResult(await withTimeout(options.readPayout(), RECLAIM_READ_TIMEOUT_MS)));
  } catch {
    return failedBeforeSubmission(options, SAFE_RECLAIM_READ_FAILURE);
  }

  if (!payout) return failedBeforeSubmission(options, SAFE_RECLAIM_READ_FAILURE);
  options.onPayout?.(payout);

  const initial = reclaimReadiness(payout, options.connectedAddress);
  if (initial === "RECLAIMED") {
    options.onState("RECLAIMED");
    return { outcome: "RECLAIMED", payout };
  }

  if (initial === "CLAIMED") {
    options.onState("IDLE");
    return { outcome: "CLAIMED", payout };
  }

  if (initial === "UNAVAILABLE") return failedBeforeSubmission(options, SAFE_RECLAIM_UNAVAILABLE, payout);

  if (initial === "UNAUTHORIZED") {
    return failedBeforeSubmission(options, SAFE_RECLAIM_UNAUTHORIZED, payout);
  }

  let chainTimestamp: bigint;
  try {
    chainTimestamp = await withTimeout(options.readChainTimestamp(), RECLAIM_READ_TIMEOUT_MS);
  } catch {
    return failedBeforeSubmission(options, SAFE_RECLAIM_READ_FAILURE, payout);
  }

  const ready = reclaimReadiness(payout, options.connectedAddress, chainTimestamp);
  if (ready !== "ELIGIBLE") return failedBeforeSubmission(options, ready === "NOT_EXPIRED" ? SAFE_RECLAIM_NOT_EXPIRED : SAFE_RECLAIM_READ_FAILURE, payout);

  try {
    options.prepareSubmission?.();
  } catch {
    return failedBeforeSubmission(options, SAFE_RECLAIM_PREPARATION_FAILURE, payout);
  }

  options.onState("AWAITING_SIGNATURE");

  const operationId = `reclaim:${payout.sender}:${payout.expiresAt}`;
  const result = await submitAndReconcile<ReclaimPayout>({
    operation: {
      operationType: "RECLAIM",
      operationId,
      payoutIds: [],
      expectedSender: payout.sender,
      expectedAmount: payout.amount,
      expectedExpiry: payout.expiresAt,
      createdAt: new Date().toISOString(),
      submissionBoundaryReached: false,
      state: "PREPARED",
    },
    submit: options.submit,
    readAuthoritativeState: async () => {
      const resolution = await withTimeout(options.reconcile(), RECLAIM_RECONCILE_TIMEOUT_MS);
      return serializePayout(payoutFromContractResult(resolution));
    },
    successPredicate: value => resolvePayoutLifecycle({ authoritativePayout: value }).financialState === "RECLAIMED",
    failedPredicate: value => resolvePayoutLifecycle({ authoritativePayout: value }).financialState === "CLAIMED",
    onState: (state, message) => {
      if (state === "AWAITING_SIGNATURE") options.onState("AWAITING_SIGNATURE", message);
      if (state === "SUBMISSION_ATTEMPTED") options.onState("SUBMITTING", message);
      if (state === "HASH_RECEIVED" || state === "CONFIRMING") options.onState("CONFIRMING", message);
      if (state === "RECOVERING") options.onState("RECOVERING", message);
      if (state === "FAILED") options.onState("FAILED", message ?? SAFE_RECLAIM_FAILED);
      if (state === "SUBMISSION_UNCERTAIN") options.onState("SUBMISSION_UNCERTAIN", message ?? SAFE_RECLAIM_SUBMISSION_UNCERTAIN);
      if (state === "CONFIRMED") options.onState("RECLAIMED", message);
    },
    messages: { failed: SAFE_RECLAIM_FAILED, uncertain: SAFE_RECLAIM_SUBMISSION_UNCERTAIN },
    reconcileAttempts: 1,
    reconcileDelayMs: 0,
  });

  if (result.outcome === "CONFIRMED") {
    const reclaimed = result.authoritative!;
    options.onPayout?.(reclaimed);
    options.onState("RECLAIMED");
    return { outcome: "RECLAIMED", payout: reclaimed };
  }
  if (result.outcome === "FAILED") {
    const message = result.message ?? SAFE_RECLAIM_FAILED;
    options.onState("FAILED", message);
    return { outcome: "FAILED", message, payout: result.authoritative ?? payout };
  }
  options.onState("SUBMISSION_UNCERTAIN", result.message ?? SAFE_RECLAIM_SUBMISSION_UNCERTAIN);
  return { outcome: "SUBMISSION_UNCERTAIN", message: result.message ?? SAFE_RECLAIM_SUBMISSION_UNCERTAIN, payout: result.authoritative ?? payout };
}
