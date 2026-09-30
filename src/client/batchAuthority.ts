import { payoutFromContractResult, serializePayout } from "../shared/reach";
import { resolvePayoutLifecycle, type AuthoritativePayout, type PayoutLifecycle } from "./payoutLifecycle";
import { rememberSenderPayout, readSenderPayouts, type SenderPayoutRecord } from "./senderStorage";

export type BatchExpected = { id: string; sender: string; amount: string; expiresAt: string; claimSigner: string };
export type BatchAuthority = { id: string; payout?: AuthoritativePayout; lifecycle: PayoutLifecycle; funded: boolean };

export function persistVerifiedBatchMembers(values: BatchAuthority[], records: SenderPayoutRecord[], confirmedIds: Set<string>) {
  for (const value of values) {
    const record = records.find(item => item.id === value.id);
    if (!record || !value.funded) continue;
    confirmedIds.add(value.id);
    const existing = readSenderPayouts().find(item => item.id === value.id);
    rememberSenderPayout({ ...record, ...existing, submissionState: "CONFIRMED", outcome: undefined, failureMessage: undefined });
  }
}

/** One unavailable member cannot discard another member's independently verified state. */
export async function readBatchAuthority(expected: BatchExpected[], read: (id: string) => Promise<unknown>, chainTimestamp?: bigint): Promise<BatchAuthority[]> {
  return Promise.all(expected.map(async item => {
    try {
      const payout = serializePayout(payoutFromContractResult(await read(item.id), item.id));
      const lifecycle = resolvePayoutLifecycle({ authoritativePayout: payout, chainTimestamp });
      const funded = (lifecycle.financialState === "FUNDED" || lifecycle.financialState === "EXPIRED_FUNDED")
        && payout.sender.toLowerCase() === item.sender.toLowerCase()
        && payout.amount === item.amount && payout.expiresAt === item.expiresAt
        && payout.claimSigner.toLowerCase() === item.claimSigner.toLowerCase();
      return { id: item.id, payout, lifecycle, funded };
    } catch {
      return { id: item.id, lifecycle: resolvePayoutLifecycle({ authorityUnavailable: true, operationJournal: { state: "RECOVERING" } }), funded: false };
    }
  }));
}
