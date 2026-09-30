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
  createdAt?: string;
  createdBlock?: string;
};

export function mergeSenderPayouts(local: SenderPayoutRecord[], discovered: DiscoveredSenderPayout[]): SenderPayoutRecord[] {
  const discoveredIds = new Set(discovered.map((payout) => payout.id));
  const recovered = discovered.map((payout) => {
    const existing = local.find((record) => record.id === payout.id);
    const authoritativeResolution = payout.status === payoutStatus.FUNDED || payout.status === payoutStatus.CLAIMED || payout.status === payoutStatus.RECLAIMED;
    return {
      id: payout.id,
      amount: payout.amount,
      expiresAt: payout.expiresAt,
      claimSigner: payout.claimSigner,
      ...(existing?.label ? { label: existing.label } : {}),
      ...(payout.fundingTxHash ? { fundingTxHash: payout.fundingTxHash } : existing?.fundingTxHash ? { fundingTxHash: existing.fundingTxHash } : {}),
      ...(authoritativeResolution
        ? { submissionState: "CONFIRMED" as const }
        : existing?.submissionState
          ? { submissionState: existing.submissionState }
          : { submissionState: "CONFIRMED" as const }),
      ...(authoritativeResolution ? {} : existing?.outcome ? { outcome: existing.outcome } : {}),
      ...(authoritativeResolution ? {} : existing?.failureMessage ? { failureMessage: existing.failureMessage } : {}),
      createdAt: payout.createdAt ?? existing?.createdAt ?? new Date(0).toISOString(),
    };
  });
  return [...recovered, ...local.filter((record) => !discoveredIds.has(record.id))];
}
