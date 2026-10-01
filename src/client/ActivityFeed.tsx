import React, { useState } from "react";
import {
  SendIcon,
  CheckCircleIcon,
  ClockIcon,
  ChevronRightIcon,
  RefreshIcon,
  PlusIcon,
  AlertCircleIcon,
} from "./components/Icons";
import { formatPathUsd } from "./senderFlow";
import { formatTimeAgo } from "./HomeDashboard";
import type { SenderPayoutRecord } from "./senderStorage";
import type { LivePayout } from "./payoutLifecycle";
import { activityFromSenderRecord, activityLabel, type ActivityRecord } from "./activity";

type ActivityFeedProps = {
  payouts: SenderPayoutRecord[];
  payoutStatuses: Record<string, LivePayout>;
  onSelectPayout: (id: string) => void;
  onStartSend: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  activities?: ActivityRecord[];
};

export default function ActivityFeed({
  payouts,
  payoutStatuses,
  onSelectPayout,
  onStartSend,
  onRefresh,
  refreshing,
  activities: activityRecords,
}: ActivityFeedProps) {
  const [filter, setFilter] = useState<"ALL" | "SENT" | "RECEIVED">("ALL");

  const activities = activityRecords ?? payouts.map((record) => activityFromSenderRecord(record, payoutStatuses[record.id], payoutStatuses[record.id]?.chainTimestamp));

  const filteredActivities = activities.filter((activity) => filter === "ALL" || activity.direction === filter);

  return (
    <div className="activity-feed-layout">
      {/* Activity Header */}
      <div className="activity-feed-header">
        <div>
          <h1 className="activity-feed-title">Activity</h1>
          <p className="activity-feed-subtitle">Every payout sent and payment received by this account</p>
        </div>

        <div className="activity-header-actions">
          <button
            type="button"
            className={`btn-secondary btn-icon-only ${refreshing ? "spinning" : ""}`}
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Refresh activity"
          >
            <RefreshIcon size={16} />
          </button>
          <button type="button" className="btn-primary" onClick={onStartSend}>
            <PlusIcon size={16} />
            <span>New payout</span>
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="activity-filter-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={filter === "ALL"}
          className={`filter-tab ${filter === "ALL" ? "tab-active" : ""}`}
          onClick={() => setFilter("ALL")}
        >
          All ({activities.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={filter === "SENT"}
          className={`filter-tab ${filter === "SENT" ? "tab-active" : ""}`}
          onClick={() => setFilter("SENT")}
        >
          Sent ({activities.filter((activity) => activity.direction === "SENT").length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={filter === "RECEIVED"}
          className={`filter-tab ${filter === "RECEIVED" ? "tab-active" : ""}`}
          onClick={() => setFilter("RECEIVED")}
        >
          Received ({activities.filter((activity) => activity.direction === "RECEIVED").length})
        </button>
      </div>

      {/* Payouts List */}
      {filteredActivities.length === 0 ? (
        <div className="empty-activity-card">
          <div className="empty-icon-circle">
            <ClockIcon size={24} />
          </div>
          <h3>No transactions in this view</h3>
          <p>When you fund a payout, it will appear here in your transaction timeline.</p>
          {filter !== "ALL" ? (
            <button type="button" className="btn-secondary" onClick={() => setFilter("ALL")}>
              Show all payouts
            </button>
          ) : (
            <button type="button" className="btn-primary" onClick={onStartSend}>
              <PlusIcon size={16} />
              <span>Send money</span>
            </button>
          )}
        </div>
      ) : (
        <div className="activity-list" role="list">
          {filteredActivities.map((activity) => {
            const amountFormatted = `$${formatPathUsd(BigInt(activity.amount))}`;
            const label = activityLabel(activity);
            const tone = activity.direction === "RECEIVED" ? "claimed" : activity.lifecycle === "RECLAIMED" ? "returned" : activity.lifecycle === "EXPIRED_FUNDED" ? "expired" : activity.lifecycle === "CLAIMED" || activity.lifecycle === "TRANSFER_CONFIRMED" ? "claimed" : activity.lifecycle === "FUNDED" ? "funded" : activity.lifecycle === "FAILED" || activity.lifecycle === "TRANSFER_FAILED" ? "failed" : "checking";
            const isWalletTransfer = activity.kind === "WALLET_TRANSFER";

            return (
              <div
                key={`${activity.direction}:${activity.payoutId}`}
                className="activity-row"
                role="listitem"
                onClick={isWalletTransfer ? undefined : () => onSelectPayout(activity.payoutId)}
                tabIndex={isWalletTransfer ? undefined : 0}
                onKeyDown={(e) => {
                  if (isWalletTransfer) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectPayout(activity.payoutId);
                  }
                }}
              >
                <div className="activity-row-left">
                    <div className={`status-circle tone-${tone}`}>
                    {tone === "claimed" ? (
                      <CheckCircleIcon size={18} />
                    ) : tone === "expired" ? (
                      <ClockIcon size={18} />
                    ) : tone === "failed" ? (
                      <AlertCircleIcon size={18} />
                    ) : (
                      <SendIcon size={18} />
                    )}
                  </div>
                  <div className="activity-details">
                    <div className="activity-main-line">
                      <span className="activity-amount">{amountFormatted}</span>
                        {activity.label && <span className="activity-memo">· {activity.label}</span>}
                    </div>
                    <div className="activity-sub-line">
                      <span className={`status-text tone-${tone}`}>{activity.direction === "RECEIVED" ? "Received" : label}</span>
                      {isWalletTransfer && activity.recipient && <span className="activity-wallet-recipient">to {activity.recipient.slice(0, 6)}...{activity.recipient.slice(-4)}</span>}
                    </div>
                  </div>
                </div>

                <div className="activity-row-right">
                  <span className="activity-date">{formatTimeAgo(activity.claimedAt ?? activity.createdAt ?? "")}</span>
                  <ChevronRightIcon size={16} className="chevron-icon" />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
