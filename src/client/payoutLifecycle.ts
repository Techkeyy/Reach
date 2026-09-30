import { payoutStatus, type PayoutStatus } from "../shared/reach";

export type AuthoritativePayout = {
  id?: string;
  sender: string;
  amount: string;
  expiresAt: string;
  claimSigner: string;
  status: PayoutStatus;
  claimant: string;
};

export type OperationExecutionState =
  | "IDLE"
  | "PREPARED"
  | "CHECKING"
  | "AWAITING_SIGNATURE"
  | "SUBMISSION_ATTEMPTED"
  | "HASH_RECEIVED"
  | "CONFIRMING"
  | "RECOVERING"
  | "CONFIRMED"
  | "FAILED"
  | "FAILED_BEFORE_SUBMISSION"
  | "SUBMISSION_UNCERTAIN";

export type OperationType = "FUND" | "CLAIM" | "RECLAIM" | "BATCH_FUND" | "AGENT_FUND";

export type OperationJournalLike = {
  operationType?: OperationType;
  operationId?: string;
  payoutIds?: string[];
  expectedSender?: string;
  expectedRecipient?: string;
  expectedAmount?: string;
  expectedExpiry?: string;
  expectedClaimSigner?: string;
  createdAt?: string;
  submissionBoundaryReached?: boolean;
  transactionHash?: string;
  state?: OperationExecutionState;
  lastReconciliation?: string;
  submissionState?: string;
  outcome?: string;
  failureMessage?: string;
};

export type LifecycleFinancialState = "NONE" | "FUNDED" | "EXPIRED_FUNDED" | "CLAIMED" | "RECLAIMED" | "UNKNOWN";
export type LifecycleDisplayState = LifecycleFinancialState | "DISCOVERED" | "CHECKING" | "RECOVERING" | "FAILED";
export type LifecycleAction = "CLAIM" | "RECLAIM" | "REVEAL_CLAIM_LINK" | "CHECK_STATUS" | "RETRY";

export type PayoutLifecycleInput = {
  authoritativePayout?: AuthoritativePayout | null;
  authorityUnavailable?: boolean;
  chainTimestamp?: bigint;
  operationJournal?: OperationJournalLike | null;
  connectedAccount?: string;
  capabilityPresent?: boolean;
};

export type PayoutLifecycle = {
  financialState: LifecycleFinancialState;
  displayState: LifecycleDisplayState;
  isExpired: boolean;
  isClaimable: boolean;
  isReclaimable: boolean;
  canRevealClaimLink: boolean;
  allowedActions: LifecycleAction[];
  statusLabel: string;
  requiresRecovery: boolean;
  authoritative: boolean;
};

function sameAddress(left: string | undefined, right: string | undefined): boolean {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}
function pendingOperationState(operation?: OperationJournalLike | null): OperationExecutionState | undefined {
  if (!operation) return undefined;
  if (operation.state) return operation.state;
  if (operation.submissionState === "SUBMISSION_UNCERTAIN") return "SUBMISSION_UNCERTAIN";
  if (operation.submissionState === "SUBMITTING") return "SUBMISSION_ATTEMPTED";
  if (operation.outcome === "FAILED" || operation.outcome === "RECOVERY_REQUIRED") return "FAILED";
  return undefined;
}

/**
 * The only product-level interpretation of payout state. The vault status is
 * authoritative whenever it is present; local journal state can describe an
 * unresolved operation but cannot downgrade known chain truth.
 */
export function resolvePayoutLifecycle(input: PayoutLifecycleInput): PayoutLifecycle {
  const payout = input.authoritativePayout;
  const operationState = pendingOperationState(input.operationJournal);
  const hasAuthority = Boolean(payout) && !input.authorityUnavailable;
  const capability = Boolean(input.capabilityPresent);
  const sender = payout?.sender ?? input.operationJournal?.expectedSender;
  const expiresAt = payout ? BigInt(payout.expiresAt) : input.operationJournal?.expectedExpiry ? BigInt(input.operationJournal.expectedExpiry) : undefined;
  const senderIsConnected = sameAddress(sender, input.connectedAccount);
  const isExpired = Boolean(payout && input.chainTimestamp !== undefined && expiresAt !== undefined && input.chainTimestamp >= expiresAt);
  const canRevealClaimLink = capability && Boolean(payout && payout.status === payoutStatus.FUNDED);

  if (payout?.status === payoutStatus.CLAIMED) {
    return {
      financialState: "CLAIMED",
      displayState: "CLAIMED",
      isExpired: false,
      isClaimable: false,
      isReclaimable: false,
      canRevealClaimLink: false,
      allowedActions: [],
      statusLabel: "CLAIMED",
      requiresRecovery: false,
      authoritative: true,
    };
  }

  if (payout?.status === payoutStatus.RECLAIMED) {
    return {
      financialState: "RECLAIMED",
      displayState: "RECLAIMED",
      isExpired: true,
      isClaimable: false,
      isReclaimable: false,
      canRevealClaimLink: false,
      allowedActions: [],
      statusLabel: "RECLAIMED",
      requiresRecovery: false,
      authoritative: true,
    };
  }

  if (payout?.status === payoutStatus.FUNDED) {
    if (input.chainTimestamp === undefined || input.chainTimestamp === null) {
      return {
        financialState: "UNKNOWN", displayState: "CHECKING", isExpired: false,
        isClaimable: false, isReclaimable: false, canRevealClaimLink: false,
        allowedActions: ["CHECK_STATUS"], statusLabel: "Checking payout expiry",
        requiresRecovery: false, authoritative: false,
      };
    }
    const expired = isExpired;
    const reclaimable = expired && senderIsConnected;
    return {
      financialState: expired ? "EXPIRED_FUNDED" : "FUNDED",
      displayState: expired ? "EXPIRED_FUNDED" : "FUNDED",
      isExpired: expired,
      isClaimable: !expired,
      isReclaimable: reclaimable,
      canRevealClaimLink,
      allowedActions: [
        ...(expired ? (reclaimable ? ["RECLAIM" as const] : []) : ["CLAIM" as const]),
        ...(canRevealClaimLink ? ["REVEAL_CLAIM_LINK" as const] : []),
      ],
      statusLabel: expired ? "EXPIRED · RECLAIM AVAILABLE" : "FUNDED",
      requiresRecovery: false,
      authoritative: true,
    };
  }

  if (payout?.status === payoutStatus.NONE) {
    return {
      financialState: "NONE",
      displayState: operationState === "SUBMISSION_UNCERTAIN" || operationState === "RECOVERING" ? "RECOVERING" : "NONE",
      isExpired: false,
      isClaimable: false,
      isReclaimable: false,
      canRevealClaimLink: false,
      allowedActions: operationState === "SUBMISSION_UNCERTAIN" ? ["CHECK_STATUS"] : [],
      statusLabel: operationState === "SUBMISSION_UNCERTAIN" ? "SUBMISSION NEEDS REVIEW" : "NOT FUNDED",
      requiresRecovery: operationState === "SUBMISSION_UNCERTAIN" || operationState === "RECOVERING",
      authoritative: true,
    };
  }

  // A durable public record can keep a payout discoverable while the direct
  // authority read is unavailable. This is a display-only state: it never
  // grants claim/reclaim actions and never becomes financial truth.
  if (!payout && !input.authorityUnavailable && input.operationJournal?.submissionState === "CONFIRMED") {
    return {
      financialState: "UNKNOWN",
      displayState: "CHECKING",
      isExpired: false,
      isClaimable: false,
      isReclaimable: false,
      canRevealClaimLink: false,
      allowedActions: ["CHECK_STATUS"],
      statusLabel: "Checking payout status",
      requiresRecovery: false,
      authoritative: false,
    };
  }

  if (input.authorityUnavailable || !hasAuthority) {
    const recovering = operationState === "SUBMISSION_UNCERTAIN" || operationState === "RECOVERING" || operationState === "SUBMISSION_ATTEMPTED" || operationState === "CONFIRMING";
    return {
      financialState: "UNKNOWN",
      displayState: recovering ? "RECOVERING" : operationState === "FAILED" ? "FAILED" : "CHECKING",
      isExpired: false,
      isClaimable: false,
      isReclaimable: false,
      canRevealClaimLink: false,
      allowedActions: recovering ? ["CHECK_STATUS"] : operationState === "FAILED" ? ["RETRY"] : [],
      statusLabel: recovering ? "SUBMISSION NEEDS REVIEW" : operationState === "FAILED" ? "PAYOUT FAILED" : "CHECKING STATUS",
      requiresRecovery: recovering,
      authoritative: false,
    };
  }

  return {
    financialState: "UNKNOWN",
    displayState: "CHECKING",
    isExpired: false,
    isClaimable: false,
    isReclaimable: false,
    canRevealClaimLink: false,
    allowedActions: [],
    statusLabel: "CHECKING STATUS",
    requiresRecovery: false,
    authoritative: false,
  };
}

