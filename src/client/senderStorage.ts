export type SenderPayoutRecord = {
  id: string;
  amount: string;
  expiresAt: string;
  claimSigner: string;
  label?: string;
  fundingTxHash?: string;
  reclaimTxHash?: string;
  createdAt: string;
  outcome?: "FAILED" | "RECOVERY_REQUIRED";
  failureMessage?: string;
};

const STORAGE_KEY = "reach.sender.payouts";

function storage() { return typeof window === "undefined" ? null : window.sessionStorage; }

export function readSenderPayouts(): SenderPayoutRecord[] {
  const value = storage()?.getItem(STORAGE_KEY);
  if (!value) return [];
  try {
    const records = JSON.parse(value) as unknown;
    if (!Array.isArray(records)) return [];
    return records.filter((record): record is SenderPayoutRecord => Boolean(record && typeof record === "object" && typeof (record as SenderPayoutRecord).id === "string" && typeof (record as SenderPayoutRecord).amount === "string" && typeof (record as SenderPayoutRecord).expiresAt === "string" && typeof (record as SenderPayoutRecord).claimSigner === "string" && typeof (record as SenderPayoutRecord).createdAt === "string"));
  } catch { return []; }
}

function write(records: SenderPayoutRecord[]) { storage()?.setItem(STORAGE_KEY, JSON.stringify(records)); }

export function rememberSenderPayout(record: SenderPayoutRecord) { write([record, ...readSenderPayouts().filter((existing) => existing.id !== record.id)]); }

export function updateSenderPayout(id: string, update: Partial<SenderPayoutRecord>) { write(readSenderPayouts().map((record) => record.id === id ? { ...record, ...update } : record)); }

export function removeSenderPayout(id: string) { write(readSenderPayouts().filter((record) => record.id !== id)); }
