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
import { getFriendlyStatus, formatTimeAgo } from "./HomeDashboard";
import type { SenderPayoutRecord } from "./senderStorage";
import type { LivePayout } from "./payoutLifecycle";

type ActivityFeedProps = {
  payouts: SenderPayoutRecord[];
  payoutStatuses: Record<string, LivePayout>;
  onSelectPayout: (id: string) => void;
  onStartSend: () => void;
  onRefresh: () => void;
  refreshing: boolean;
};

export default function ActivityFeed({
  payouts,
  payoutStatuses,
  onSelectPayout,
  onStartSend,
  onRefresh,
  refreshing,
}: ActivityFeedProps) {
  const [filter, setFilter] = useState<"ALL" | "ACTIVE" | "COMPLETED">("ALL");

  const filteredPayouts = payouts.filter((record) => {
    const live = payoutStatuses[record.id];
    const friendly = getFriendlyStatus(record, live);
    if (filter === "ACTIVE") {
      return friendly.tone === "funded" || friendly.tone === "expired";
    }
    if (filter === "COMPLETED") {
      return friendly.tone === "claimed" || friendly.tone === "returned" || friendly.tone === "failed";
    }
    return true;
  });

  return (
    <div className="activity-feed-layout">
      {/* Activity Header */}
      <div className="activity-feed-header">
        <div>
          <h1 className="activity-feed-title">Activity</h1>
          <p className="activity-feed-subtitle">History of all stablecoin payouts created from this wallet</p>
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
          All ({payouts.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={filter === "ACTIVE"}
          className={`filter-tab ${filter === "ACTIVE" ? "tab-active" : ""}`}
          onClick={() => setFilter("ACTIVE")}
        >
          Active
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={filter === "COMPLETED"}
          className={`filter-tab ${filter === "COMPLETED" ? "tab-active" : ""}`}
          onClick={() => setFilter("COMPLETED")}
        >
          Completed
        </button>
      </div>

      {/* Payouts List */}
      {filteredPayouts.length === 0 ? (
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
          {filteredPayouts.map((record) => {
            const live = payoutStatuses[record.id];
            const friendly = getFriendlyStatus(record, live);
            const amountFormatted = `$${formatPathUsd(BigInt(record.amount))}`;

            return (
              <div
                key={record.id}
                className="activity-row"
                role="listitem"
                onClick={() => onSelectPayout(record.id)}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectPayout(record.id);
                  }
                }}
              >
                <div className="activity-row-left">
                  <div className={`status-circle tone-${friendly.tone}`}>
                    {friendly.tone === "claimed" ? (
                      <CheckCircleIcon size={18} />
                    ) : friendly.tone === "expired" ? (
                      <ClockIcon size={18} />
                    ) : friendly.tone === "failed" ? (
                      <AlertCircleIcon size={18} />
                    ) : (
                      <SendIcon size={18} />
                    )}
                  </div>
                  <div className="activity-details">
                    <div className="activity-main-line">
                      <span className="activity-amount">{amountFormatted}</span>
                      {record.label && <span className="activity-memo">· {record.label}</span>}
                    </div>
                    <div className="activity-sub-line">
                      <span className={`status-text tone-${friendly.tone}`}>{friendly.label}</span>
                    </div>
                  </div>
                </div>

                <div className="activity-row-right">
                  <span className="activity-date">{formatTimeAgo(record.createdAt)}</span>
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
