import { withTimeout } from "./authFlow";
import {
  type AuthoritativePayout,
  type OperationExecutionState,
  type OperationJournalLike,
} from "./payoutLifecycle";

export const SUBMIT_TIMEOUT_MS = 30_000;
export const RECEIPT_TIMEOUT_MS = 30_000;
export const RECONCILE_TIMEOUT_MS = 30_000;
export const RECONCILE_ATTEMPTS = 5;
export const RECONCILE_DELAY_MS = 1_200;

export type SubmissionOutcome = "CONFIRMED" | "FAILED_BEFORE_SUBMISSION" | "FAILED" | "SUBMISSION_UNCERTAIN";

export type SubmissionResult<T> = {
  outcome: SubmissionOutcome;
  operation: OperationJournalLike;
  authoritative?: T;
  transactionHash?: string;
  message?: string;
};

export type SubmitAndReconcileOptions<T> = {
  operation: OperationJournalLike & { operationId: string; payoutIds: string[]; state?: OperationExecutionState };
  prepare?: () => void | Promise<void>;
  submit: () => Promise<unknown>;
  readAuthoritativeState: () => Promise<T | null | undefined>;
  successPredicate: (value: T) => boolean;
  failedPredicate?: (value: T) => boolean;
  extractHash?: (value: unknown) => string | undefined;
  waitForReceipt?: (hash: string) => Promise<{ status: "success" | "reverted" }>;
  onState?: (state: OperationExecutionState, message?: string) => void;
  persist?: (update: Partial<OperationJournalLike>) => void;
  sleep?: (delayMs: number) => Promise<void>;
  submitTimeoutMs?: number;
  receiptTimeoutMs?: number;
  reconcileTimeoutMs?: number;
  reconcileAttempts?: number;
  reconcileDelayMs?: number;
  messages?: { failedBeforeSubmission?: string; failed?: string; uncertain?: string };
};

const hashFromValue = (value: unknown): string | undefined => {
  if (typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value)) return value;
  if (value && typeof value === "object" && "hash" in value && typeof (value as { hash?: unknown }).hash === "string") return (value as { hash: string }).hash;
  return undefined;
};

function state(options: SubmitAndReconcileOptions<unknown>, next: OperationExecutionState, message?: string): void {
  options.persist?.({ state: next, ...(message ? { failureMessage: message } : {}) });
  options.onState?.(next, message);
}
async function reconcile<T>(options: SubmitAndReconcileOptions<T>): Promise<{ value?: T; failed: boolean }> {
  const sleep = options.sleep ?? ((delay: number) => new Promise<void>((resolve) => setTimeout(resolve, delay)));
  let last: T | undefined;
  const attempts = options.reconcileAttempts ?? RECONCILE_ATTEMPTS;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const value = await withTimeout(options.readAuthoritativeState(), options.reconcileTimeoutMs ?? RECONCILE_TIMEOUT_MS);
      if (value !== null && value !== undefined) {
        last = value;
        if (options.successPredicate(value)) return { value, failed: false };
        if (options.failedPredicate?.(value)) return { value, failed: true };
      }
    } catch {
      // Unavailable authority remains unresolved; never downgrade to failure.
    }
    if (attempt + 1 < attempts) await sleep(options.reconcileDelayMs ?? RECONCILE_DELAY_MS);
  }
  return { value: last, failed: false };
}

/** Shared bounded submit/reconcile boundary for all financial operations. */
export async function submitAndReconcile<T>(options: SubmitAndReconcileOptions<T>): Promise<SubmissionResult<T>> {
  const operation = options.operation;
  const failedBefore = options.messages?.failedBeforeSubmission ?? "We couldn't prepare this operation. No transaction was submitted. Try again.";
  const failed = options.messages?.failed ?? "The operation failed. No funds were moved.";
  const uncertain = options.messages?.uncertain ?? "We couldn't confirm whether this operation completed. Check Activity before retrying.";

  state(options as SubmitAndReconcileOptions<unknown>, "PREPARED");
  try {
    await withTimeout(Promise.resolve(options.prepare?.()), options.submitTimeoutMs ?? SUBMIT_TIMEOUT_MS);
  } catch {
    state(options as SubmitAndReconcileOptions<unknown>, "FAILED_BEFORE_SUBMISSION", failedBefore);
    return { outcome: "FAILED_BEFORE_SUBMISSION", operation, message: failedBefore };
  }

  state(options as SubmitAndReconcileOptions<unknown>, "AWAITING_SIGNATURE");
  options.persist?.({ submissionBoundaryReached: true, state: "SUBMISSION_ATTEMPTED" });
  state(options as SubmitAndReconcileOptions<unknown>, "SUBMISSION_ATTEMPTED");

  let submittedValue: unknown;
  let transactionHash: string | undefined;
  try {
    submittedValue = await withTimeout(options.submit(), options.submitTimeoutMs ?? SUBMIT_TIMEOUT_MS);
    transactionHash = options.extractHash?.(submittedValue) ?? hashFromValue(submittedValue);
    if (transactionHash) {
      options.persist?.({ transactionHash });
      state(options as SubmitAndReconcileOptions<unknown>, "HASH_RECEIVED");
    }
  } catch {
    state(options as SubmitAndReconcileOptions<unknown>, "RECOVERING");
  }

  if (transactionHash && options.waitForReceipt) {
    try {
      const receipt = await withTimeout(options.waitForReceipt(transactionHash), options.receiptTimeoutMs ?? RECEIPT_TIMEOUT_MS);
      if (receipt.status === "reverted") {
        state(options as SubmitAndReconcileOptions<unknown>, "FAILED", failed);
        return { outcome: "FAILED", operation, transactionHash, message: failed };
      }
    } catch {
      state(options as SubmitAndReconcileOptions<unknown>, "RECOVERING");
    }
  }

  state(options as SubmitAndReconcileOptions<unknown>, "CONFIRMING");
  const resolution = await reconcile(options);
  if (resolution.value !== undefined && options.successPredicate(resolution.value)) {
    state(options as SubmitAndReconcileOptions<unknown>, "CONFIRMED");
    return { outcome: "CONFIRMED", operation, authoritative: resolution.value, ...(transactionHash ? { transactionHash } : {}) };
  }
  if (resolution.failed) {
    state(options as SubmitAndReconcileOptions<unknown>, "FAILED", failed);
    return { outcome: "FAILED", operation, ...(resolution.value === undefined ? {} : { authoritative: resolution.value }), ...(transactionHash ? { transactionHash } : {}), message: failed };
  }

  state(options as SubmitAndReconcileOptions<unknown>, "SUBMISSION_UNCERTAIN", uncertain);
  return { outcome: "SUBMISSION_UNCERTAIN", operation, ...(resolution.value === undefined ? {} : { authoritative: resolution.value }), ...(transactionHash ? { transactionHash } : {}), message: uncertain };
}

