import { payoutStatus, type PayoutStatus } from "../shared/reach";
import type { Address } from "viem";
import type { SenderPayoutRecord } from "./senderStorage";
import type { LivePayout } from "./payoutLifecycle";
import type { WalletTransferRecord } from "./walletTransferStorage";

export type ActivityDirection = "SENT" | "RECEIVED";
export type ActivityKind = "PAYOUT" | "WALLET_TRANSFER";
export type ActivityLifecycle = "NONE" | "CHECKING" | "FUNDED" | "EXPIRED_FUNDED" | "CLAIMED" | "RECLAIMED" | "FAILED" | "TRANSFER_CONFIRMED" | "TRANSFER_RECOVERING" | "TRANSFER_FAILED";

export type ActivityRecord = {
  payoutId: string;
  kind?: ActivityKind;
  direction: ActivityDirection;
  amount: string;
  lifecycle: ActivityLifecycle;
  sender: Address | string;
  claimant: Address | string;
  recipient?: Address | string;
  expiresAt: string;
  claimSigner?: Address | string;
  createdAt?: string;
  claimedAt?: string;
  txHash?: string;
  fundingTxHash?: string;
  claimTxHash?: string;
  reclaimTxHash?: string;
  protection?: SenderPayoutRecord["protection"];
  label?: string;
  actualFeeAmount?: string;
  actualFeeToken?: Address | string;
  actualFeeSymbol?: string;
  actualFeeDecimals?: number;
  actualRemainingBalance?: string;
  /** True when the row is retained but vault or chain authority could not be read. */
  authorityUnavailable?: boolean;
};

export type ActivityResponse = {
  address: Address | string;
  activities: ActivityRecord[];
  authorityComplete?: boolean;
  authorityIncomplete?: boolean;
  unresolvedCount?: number;
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
    kind: "PAYOUT",
    direction: "SENT",
    amount: live?.amount ?? record.amount,
    lifecycle,
    sender: live?.sender ?? "",
    claimant: live?.claimant ?? "0x0000000000000000000000000000000000000000",
    expiresAt: expiresAt.toString(),
    claimSigner: live?.claimSigner ?? record.claimSigner,
    createdAt: record.createdAt,
    txHash: record.fundingTxHash,
    ...(record.fundingTxHash ? { fundingTxHash: record.fundingTxHash } : {}),
    ...(record.claimTxHash ? { claimTxHash: record.claimTxHash } : {}),
    ...(record.reclaimTxHash ? { reclaimTxHash: record.reclaimTxHash } : {}),
    ...(record.protection ? { protection: record.protection } : {}),
    label: record.label,
    ...(record.actualFeeAmount ? { actualFeeAmount: record.actualFeeAmount, actualFeeToken: record.actualFeeToken, actualFeeSymbol: record.actualFeeSymbol, actualFeeDecimals: record.actualFeeDecimals, actualRemainingBalance: record.actualRemainingBalance } : {}),
  };
}

/** Discovery absence is meaningful only when the server explicitly completed authority. */
export function mergeActivityDiscovery(localRecords: SenderPayoutRecord[], response?: ActivityResponse): ActivityRecord[] {
  const localById = new Map(localRecords.map(record => [record.id, record]));
  const merged = new Map<string, ActivityRecord>();
  for (const activity of response?.activities ?? []) {
    const local = localById.get(activity.payoutId);
    const recovered = local?.actualFeeAmount ? {
      ...activity,
      actualFeeAmount: local.actualFeeAmount,
      actualFeeToken: local.actualFeeToken,
      actualFeeSymbol: local.actualFeeSymbol,
      actualFeeDecimals: local.actualFeeDecimals,
      actualRemainingBalance: local.actualRemainingBalance,
      claimTxHash: local.claimTxHash,
      reclaimTxHash: local.reclaimTxHash,
    } : activity;
    merged.set(activity.payoutId, activity.authorityUnavailable
      ? { ...recovered, lifecycle: "CHECKING" }
      : recovered);
  }
  if (response?.authorityComplete !== true || response.authorityIncomplete === true) {
    for (const record of localRecords) {
      if (!merged.has(record.id)) merged.set(record.id, {
        ...activityFromSenderRecord(record),
        lifecycle: "CHECKING",
        authorityUnavailable: true,
      });
    }
  }
  return [...merged.values()];
}

export function activityFromWalletTransfer(record: WalletTransferRecord): ActivityRecord {
  const lifecycle = record.state === "CONFIRMED"
    ? "TRANSFER_CONFIRMED"
    : record.state === "SUBMISSION_UNCERTAIN"
      ? "TRANSFER_RECOVERING"
      : "TRANSFER_FAILED";
  return {
    payoutId: record.operationId,
    kind: "WALLET_TRANSFER",
    direction: "SENT",
    amount: record.amount,
    lifecycle,
    sender: record.sender,
    claimant: ZERO_ADDRESS,
    recipient: record.recipient,
    expiresAt: "0",
    createdAt: record.createdAt,
    ...(record.txHash ? { txHash: record.txHash } : {}),
    ...(record.actualFeeAmount ? { actualFeeAmount: record.actualFeeAmount, actualFeeToken: record.actualFeeToken, actualFeeSymbol: record.actualFeeSymbol, actualFeeDecimals: record.actualFeeDecimals, actualRemainingBalance: record.actualRemainingBalance } : {}),
  };
}

export function activityLabel(activity: ActivityRecord): string {
  if (activity.kind === "WALLET_TRANSFER") {
    if (activity.lifecycle === "TRANSFER_CONFIRMED") return "Sent to wallet";
    if (activity.lifecycle === "TRANSFER_RECOVERING") return "Transfer needs review";
    return "Wallet transfer failed";
  }
  if (activity.authorityUnavailable) return "Checking payout status";
  if (activity.direction === "RECEIVED") return "Received";
  if (activity.lifecycle === "CLAIMED") return "Claimed by recipient";
  if (activity.lifecycle === "RECLAIMED") return "Returned to you";
  if (activity.lifecycle === "EXPIRED_FUNDED") return "Expired · Ready to return";
  if (activity.lifecycle === "FUNDED") return "Funded · Waiting for recipient";
  if (activity.lifecycle === "CHECKING") return "Checking payout expiry";
  if (activity.lifecycle === "FAILED") return "Payout failed";
  return "Checking status";
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export function livePayoutFromActivity(activity: ActivityRecord): LivePayout | undefined {
  if (activity.authorityUnavailable) return undefined;
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
    ...(activity.fundingTxHash ? { fundingTxHash: activity.fundingTxHash } : {}),
    ...(activity.claimTxHash ? { claimTxHash: activity.claimTxHash } : {}),
    ...(activity.reclaimTxHash ? { reclaimTxHash: activity.reclaimTxHash } : {}),
    ...(activity.protection ? { protection: activity.protection } : {}),
    ...(activity.actualFeeAmount ? { actualFeeAmount: activity.actualFeeAmount, actualFeeToken: activity.actualFeeToken, actualFeeSymbol: activity.actualFeeSymbol, actualFeeDecimals: activity.actualFeeDecimals, actualRemainingBalance: activity.actualRemainingBalance } : {}),
    submissionState: "CONFIRMED",
  };
}
