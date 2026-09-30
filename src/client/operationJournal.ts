import type { OperationExecutionState, OperationJournalLike, OperationType } from "./payoutLifecycle";

export type OperationJournalEntry = OperationJournalLike & {
  operationType: OperationType;
  operationId: string;
  payoutIds: string[];
  createdAt: string;
  submissionBoundaryReached: boolean;
  state: OperationExecutionState;
};

export const OPERATION_JOURNAL_KEY = "reach.operation.journal";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? window.sessionStorage;
  } catch {
    return window.sessionStorage;
  }
}
function readRaw(): OperationJournalEntry[] {
  const raw = storage()?.getItem(OPERATION_JOURNAL_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is OperationJournalEntry => Boolean(entry && typeof entry === "object" && typeof (entry as OperationJournalEntry).operationId === "string" && Array.isArray((entry as OperationJournalEntry).payoutIds)));
  } catch {
    return [];
  }
}

function write(entries: OperationJournalEntry[]): void {
  const safeEntries = entries.slice(0, 500).map((entry) => {
    const safe: OperationJournalEntry = {
      operationType: entry.operationType,
      operationId: entry.operationId,
      payoutIds: [...entry.payoutIds],
      createdAt: entry.createdAt,
      submissionBoundaryReached: Boolean(entry.submissionBoundaryReached),
      state: entry.state,
    };
    for (const key of ["expectedSender", "expectedRecipient", "expectedAmount", "expectedExpiry", "expectedClaimSigner", "transactionHash", "lastReconciliation", "submissionState", "outcome", "failureMessage"] as const) {
      const value = entry[key];
      if (value !== undefined) safe[key] = value;
    }
    return safe;
  });
  storage()?.setItem(OPERATION_JOURNAL_KEY, JSON.stringify(safeEntries));
}

export function readOperationJournal(): OperationJournalEntry[] {
  return readRaw();
}

export function readOperation(operationId: string): OperationJournalEntry | undefined {
  return readRaw().find((entry) => entry.operationId === operationId);
}

export function upsertOperation(entry: OperationJournalEntry): OperationJournalEntry {
  const entries = readRaw().filter((existing) => existing.operationId !== entry.operationId);
  write([entry, ...entries]);
  return entry;
}

export function updateOperation(operationId: string, update: Partial<OperationJournalEntry>): OperationJournalEntry | undefined {
  const current = readRaw().find((entry) => entry.operationId === operationId);
  if (!current) return undefined;
  const next = { ...current, ...update, operationId: current.operationId, payoutIds: current.payoutIds };
  upsertOperation(next);
  return next;
}

export function operationsForPayout(payoutId: string): OperationJournalEntry[] {
  return readRaw().filter((entry) => entry.payoutIds.includes(payoutId));
}

export function latestOperationForPayout(payoutId: string): OperationJournalEntry | undefined {
  return operationsForPayout(payoutId).sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

export function clearOperation(operationId: string): void {
  write(readRaw().filter((entry) => entry.operationId !== operationId));
}

