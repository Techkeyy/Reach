import { payoutStatus, type PayoutStatus } from "../shared/reach";
import type { Address } from "viem";
import type { SenderPayoutRecord } from "./senderStorage";
import type { LivePayout } from "./payoutLifecycle";

export type ActivityDirection = "SENT" | "RECEIVED";
export type ActivityLifecycle = "NONE" | "CHECKING" | "FUNDED" | "EXPIRED_FUNDED" | "CLAIMED" | "RECLAIMED" | "FAILED";

export type ActivityRecord = {
  payoutId: string;
  direction: ActivityDirection;
  amount: string;
  lifecycle: ActivityLifecycle;
  sender: Address | string;
  claimant: Address | string;
  expiresAt: string;
  claimSigner?: Address | string;
  createdAt?: string;
  claimedAt?: string;
  txHash?: string;
  label?: string;
};

export type ActivityResponse = {
  address: Address | string;
  activities: ActivityRecord[];
};

export function lifecycleFromPayout(status: PayoutStatus, expiresAt: bigint, chainTimestamp?: bigint): ActivityLifecycle {
  if (status === payoutStatus.FUNDED && chainTimestamp === undefined) return "CHECKING";
  if (status === payoutStatus.FUNDED && chainTimestamp !== undefined && chainTimestamp >= expiresAt) return "EXPIRED_FUNDED";
  if (status === payoutStatus.FUNDED) return "FUNDED";
  if (status === payoutStatus.CLAIMED) return "CLAIMED";
  if (status === payoutStatus.RECLAIMED) return "RECLAIMED";
  return "NONE";
}

export function activityFromSenderRecord(record: SenderPayoutRecord, live?: LivePayout, chainTimestamp?: bigint): ActivityRecord {
  const status = live?.status ?? payoutStatus.NONE;
  const expiresAt = live?.expiresAt ?? BigInt(record.expiresAt);
  const lifecycle = record.outcome === "FAILED" || record.submissionState === "FAILED"
    ? "FAILED" as const
    : live ? lifecycleFromPayout(status, expiresAt, chainTimestamp) : "NONE" as const;
  return {
    payoutId: record.id,
    direction: "SENT",
    amount: live?.amount ?? record.amount,
    lifecycle,
    sender: live?.sender ?? "",
    claimant: live?.claimant ?? "0x0000000000000000000000000000000000000000",
    expiresAt: expiresAt.toString(),
    claimSigner: live?.claimSigner ?? record.claimSigner,
    createdAt: record.createdAt,
    txHash: record.fundingTxHash,
    label: record.label,
  };
}

export function activityLabel(activity: ActivityRecord): string {
  if (activity.direction === "RECEIVED") return "Received";
  if (activity.lifecycle === "CLAIMED") return "Claimed by recipient";
  if (activity.lifecycle === "RECLAIMED") return "Returned to you";
  if (activity.lifecycle === "EXPIRED_FUNDED") return "Expired · Ready to return";
  if (activity.lifecycle === "FUNDED") return "Funded · Waiting for recipient";
  if (activity.lifecycle === "CHECKING") return "Checking payout expiry";
  if (activity.lifecycle === "FAILED") return "Payout failed";
  return "Checking status";
}

export function livePayoutFromActivity(activity: ActivityRecord): LivePayout {
  const status = activity.lifecycle === "CLAIMED"
    ? payoutStatus.CLAIMED
    : activity.lifecycle === "RECLAIMED"
      ? payoutStatus.RECLAIMED
      : activity.lifecycle === "FUNDED" || activity.lifecycle === "EXPIRED_FUNDED" || activity.lifecycle === "CHECKING"
        ? payoutStatus.FUNDED
        : payoutStatus.NONE;
  return {
    sender: activity.sender as Address,
    amount: activity.amount,
    expiresAt: BigInt(activity.expiresAt),
    claimSigner: (activity.claimSigner ?? "0x0000000000000000000000000000000000000000") as Address,
    status,
    claimant: activity.claimant as Address,
  };
}

export function activityToSenderRecord(activity: ActivityRecord): SenderPayoutRecord {
  return {
    id: activity.payoutId,
    amount: activity.amount,
    expiresAt: activity.expiresAt,
    claimSigner: activity.claimSigner ?? "0x0000000000000000000000000000000000000000000000000000000000000000",
    createdAt: activity.createdAt ?? activity.claimedAt ?? new Date(0).toISOString(),
    ...(activity.txHash ? { fundingTxHash: activity.txHash } : {}),
    submissionState: "CONFIRMED",
  };
}
