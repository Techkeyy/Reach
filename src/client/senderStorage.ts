export type SenderPayoutRecord = {
  id: string;
  amount: string;
  expiresAt: string;
  claimSigner: string;
  label?: string;
  fundingTxHash?: string;
  claimTxHash?: string;
  reclaimTxHash?: string;
  protection?: {
    mode: "INSTANT" | "PROTECTED";
    channel?: "EMAIL" | "SMS";
    maskedRecipient?: string;
  };
  createdAt: string;
  submissionState?: "SUBMITTING" | "HASH_RECEIVED" | "SUBMITTED_WITH_HASH" | "CONFIRMING_RECEIPT" | "READING_PAYOUT" | "CONFIRMED" | "FAILED" | "SUBMISSION_UNCERTAIN";
  reclaimState?: "SUBMITTING" | "SUBMISSION_UNCERTAIN" | "CONFIRMED";
  outcome?: "FAILED" | "RECOVERY_REQUIRED";
  failureMessage?: string;
  actualFeeAmount?: string;
  actualFeeToken?: string;
  actualFeeSymbol?: string;
  actualFeeDecimals?: number;
  actualRemainingBalance?: string;
};

const STORAGE_KEY = "reach.sender.payouts";

function storage() {
  if (typeof window === "undefined") return null;
  try {
    // Public payout metadata is intentionally durable across a browser restart.
    // Bearer capabilities remain in claimCapability.ts and are never copied here.
    return window.localStorage ?? window.sessionStorage;
  } catch {
    try { return window.sessionStorage; } catch { return null; }
  }
}

export function readSenderPayouts(): SenderPayoutRecord[] {
  let value = storage()?.getItem(STORAGE_KEY);
  // Preserve compatibility with an existing session-only public index while
  // migrating new writes to durable storage.
  if (!value && typeof window !== "undefined") {
    try { value = window.sessionStorage?.getItem(STORAGE_KEY); } catch { /* unavailable */ }
  }
  if (!value) return [];
  try {
    const records = JSON.parse(value) as unknown;
    if (!Array.isArray(records)) return [];
    return records.filter((record): record is SenderPayoutRecord => Boolean(record && typeof record === "object" && typeof (record as SenderPayoutRecord).id === "string" && typeof (record as SenderPayoutRecord).amount === "string" && typeof (record as SenderPayoutRecord).expiresAt === "string" && typeof (record as SenderPayoutRecord).claimSigner === "string" && typeof (record as SenderPayoutRecord).createdAt === "string"));
  } catch { return []; }
}

function write(records: SenderPayoutRecord[]) {
  const safeRecords = records.map((record) => {
    const safe: SenderPayoutRecord = {
      id: record.id,
      amount: record.amount,
      expiresAt: record.expiresAt,
      claimSigner: record.claimSigner,
      createdAt: record.createdAt,
    };
    for (const key of ["label", "fundingTxHash", "claimTxHash", "reclaimTxHash", "protection", "submissionState", "reclaimState", "outcome", "failureMessage", "actualFeeAmount", "actualFeeToken", "actualFeeSymbol", "actualFeeDecimals", "actualRemainingBalance"] as const) {
      const value = record[key];
      if (value !== undefined) (safe as Record<string, unknown>)[key] = value;
    }
    return safe;
  });
  storage()?.setItem(STORAGE_KEY, JSON.stringify(safeRecords));
}

export function rememberSenderPayout(record: SenderPayoutRecord) { write([record, ...readSenderPayouts().filter((existing) => existing.id !== record.id)]); }

export function updateSenderPayout(id: string, update: Partial<SenderPayoutRecord>) { write(readSenderPayouts().map((record) => record.id === id ? { ...record, ...update } : record)); }

export function removeSenderPayout(id: string) { write(readSenderPayouts().filter((record) => record.id !== id)); }
