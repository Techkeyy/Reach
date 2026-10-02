import type { Address } from "viem";

export type WalletTransferRecord = {
  operationId: string;
  sender: Address;
  recipient: Address;
  amount: string;
  createdAt: string;
  txHash?: string;
  state: "CONFIRMED" | "FAILED" | "FAILED_BEFORE_SUBMISSION" | "SUBMISSION_UNCERTAIN";
  failureMessage?: string;
  actualFeeAmount?: string;
  actualFeeToken?: Address;
  actualFeeSymbol?: string;
  actualFeeDecimals?: number;
  actualRemainingBalance?: string;
};

const STORAGE_KEY = "reach.wallet.transfers";

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage ?? window.sessionStorage; } catch { return null; }
}

function readRaw(): WalletTransferRecord[] {
  const value = storage()?.getItem(STORAGE_KEY);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((record): record is WalletTransferRecord => Boolean(record && typeof record === "object" && typeof (record as WalletTransferRecord).operationId === "string")) : [];
  } catch {
    return [];
  }
}

function write(records: WalletTransferRecord[]): void {
  storage()?.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, 500)));
}

export function readWalletTransfers(sender?: string): WalletTransferRecord[] {
  const records = readRaw();
  if (!sender) return records;
  return records.filter((record) => record.sender.toLowerCase() === sender.toLowerCase());
}

export function rememberWalletTransfer(record: WalletTransferRecord): WalletTransferRecord {
  write([record, ...readRaw().filter((existing) => existing.operationId !== record.operationId)]);
  return record;
}
