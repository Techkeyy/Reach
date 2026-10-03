import type { Address } from "viem";
import type { SenderPayoutRecord } from "./senderStorage";
import { payoutStatus } from "../shared/reach";

export type DiscoveredSenderPayout = {
  id: string;
  sender: Address;
  amount: string;
  expiresAt: string;
  claimSigner: Address;
  status: 0 | 1 | 2 | 3;
  claimant: Address;
  fundingTxHash?: string;
  claimTxHash?: string;
  reclaimTxHash?: string;
  createdAt?: string;
  createdBlock?: string;
};

export function isAuthoritativePayoutStatus(status: number): boolean {
  return status === payoutStatus.FUNDED || status === payoutStatus.CLAIMED || status === payoutStatus.RECLAIMED;
}

export function promoteSenderPayoutRecord(record: SenderPayoutRecord, payout: Pick<DiscoveredSenderPayout, "status">): SenderPayoutRecord {
  if (!isAuthoritativePayoutStatus(payout.status)) return record;

  const { outcome: _outcome, failureMessage: _failureMessage, ...publicRecord } = record;
  return {
    ...publicRecord,
    submissionState: "CONFIRMED",
    ...(payout.status === payoutStatus.RECLAIMED ? { reclaimState: "CONFIRMED" as const } : {}),
  };
}

export function mergeSenderPayouts(local: SenderPayoutRecord[], discovered: DiscoveredSenderPayout[]): SenderPayoutRecord[] {
  const discoveredIds = new Set(discovered.map((payout) => payout.id));
  const recovered = discovered.map((payout) => {
    const existing = local.find((record) => record.id === payout.id);
    const authoritativeResolution = payout.status === payoutStatus.FUNDED || payout.status === payoutStatus.CLAIMED || payout.status === payoutStatus.RECLAIMED;
    const record = {
      id: payout.id,
      amount: payout.amount,
      expiresAt: payout.expiresAt,
      claimSigner: payout.claimSigner,
      ...(existing?.label ? { label: existing.label } : {}),
      ...(payout.fundingTxHash ? { fundingTxHash: payout.fundingTxHash } : existing?.fundingTxHash ? { fundingTxHash: existing.fundingTxHash } : {}),
      ...(payout.claimTxHash ? { claimTxHash: payout.claimTxHash } : existing?.claimTxHash ? { claimTxHash: existing.claimTxHash } : {}),
      ...(payout.reclaimTxHash ? { reclaimTxHash: payout.reclaimTxHash } : existing?.reclaimTxHash ? { reclaimTxHash: existing.reclaimTxHash } : {}),
      ...(authoritativeResolution
        ? { submissionState: "CONFIRMED" as const }
        : existing?.submissionState
          ? { submissionState: existing.submissionState }
          : { submissionState: "CONFIRMED" as const }),
      ...(existing?.reclaimState ? { reclaimState: existing.reclaimState } : {}),
      ...(authoritativeResolution ? {} : existing?.outcome ? { outcome: existing.outcome } : {}),
      ...(authoritativeResolution ? {} : existing?.failureMessage ? { failureMessage: existing.failureMessage } : {}),
      ...(existing?.actualFeeAmount ? {
        actualFeeAmount: existing.actualFeeAmount,
        actualFeeToken: existing.actualFeeToken,
        actualFeeSymbol: existing.actualFeeSymbol,
        actualFeeDecimals: existing.actualFeeDecimals,
        actualRemainingBalance: existing.actualRemainingBalance,
      } : {}),
      createdAt: payout.createdAt ?? existing?.createdAt ?? new Date(0).toISOString(),
    } satisfies SenderPayoutRecord;
    return authoritativeResolution ? promoteSenderPayoutRecord(record, payout) : record;
  });
  return [...recovered, ...local.filter((record) => !discoveredIds.has(record.id))];
}
