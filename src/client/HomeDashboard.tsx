import React, { useState } from "react";
import { SendIcon, ChevronRightIcon, RefreshIcon, ClockIcon, CheckCircleIcon, AlertCircleIcon, PlusIcon } from "./components/Icons";
import { BalanceSkeleton } from "./components/Skeleton";
import { formatPathUsd, type BalanceState } from "./senderFlow";
import type { SenderPayoutRecord } from "./senderStorage";
import { resolvePayoutLifecycle, type LivePayout } from "./payoutLifecycle";
import { activityFromSenderRecord, activityLabel, type ActivityRecord } from "./activity";

type HomeDashboardProps = {
  balanceState: BalanceState;
  payouts: SenderPayoutRecord[];
  payoutStatuses: Record<string, LivePayout>;
  onStartSend: () => void;
  onAddTestFunds: () => void;
  onSelectPayout: (id: string) => void;
  onViewAllActivity: () => void;
  onRefreshBalance: () => void;
  refreshing: boolean;
  connectedAddress?: string;
  activities?: ActivityRecord[];
};

export function getFriendlyStatus(
  record: SenderPayoutRecord,
  live?: LivePayout
): { label: string; tone: "funded" | "claimed" | "expired" | "returned" | "failed" | "checking" } {
  const lifecycle = resolvePayoutLifecycle({
    authoritativePayout: live ? {
      ...live,
      expiresAt: live.expiresAt.toString(),
    } : undefined,
    operationJournal: {
      submissionState: record.submissionState,
      outcome: record.outcome,
      failureMessage: record.failureMessage,
      expectedExpiry: record.expiresAt,
    },
    chainTimestamp: live?.chainTimestamp,
  });
  if (lifecycle.displayState === "FAILED") return { label: "Payout failed", tone: "failed" };
  if (lifecycle.displayState === "RECOVERING") return { label: "Submission needs review", tone: "failed" };
  if (lifecycle.financialState === "CLAIMED") return { label: "Claimed by recipient", tone: "claimed" };
  if (lifecycle.financialState === "RECLAIMED") return { label: "Returned to you", tone: "returned" };
  if (lifecycle.financialState === "EXPIRED_FUNDED") return { label: "Expired · Ready to return", tone: "expired" };
  if (lifecycle.financialState === "FUNDED") return { label: "Funded · Waiting for recipient", tone: "funded" };
  return { label: lifecycle.statusLabel || "Checking status", tone: "checking" };
}

export function formatTimeAgo(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return "Recently";
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return "Just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "Recently";
  }
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default function HomeDashboard({
  balanceState,
  payouts,
  payoutStatuses,
  onStartSend,
  onAddTestFunds,
  onSelectPayout,
  onViewAllActivity,
  onRefreshBalance,
  refreshing,
  connectedAddress,
  activities,
}: HomeDashboardProps) {
  const [copiedAddress, setCopiedAddress] = useState(false);
  const allActivities = activities ?? payouts.map((record) => activityFromSenderRecord(record, payoutStatuses[record.id], payoutStatuses[record.id]?.chainTimestamp));
  const recentActivities = allActivities.slice(0, 5);
  const copyAddress = async () => {
    if (!connectedAddress) return;
    try {
      await navigator.clipboard.writeText(connectedAddress);
      setCopiedAddress(true);
      window.setTimeout(() => setCopiedAddress(false), 2000);
    } catch {
      setCopiedAddress(false);
    }
  };

  return (
    <div className="home-dashboard-layout">
      {/* Available Balance Hero Card */}
      <section className="balance-hero-card" aria-label="Available balance">
        <div className="balance-card-header">
          <div className="balance-label-row">
            <span className="balance-eyebrow">Available Balance</span>
            <button
              type="button"
              className={`btn-refresh-balance ${refreshing ? "spinning" : ""}`}
              onClick={onRefreshBalance}
              disabled={refreshing}
              aria-label="Refresh balance"
            >
              <RefreshIcon size={14} />
            </button>
          </div>
          <div className="network-pill-light">
            <span className="network-dot" />
            <span>Tempo Moderato</span>
          </div>
        </div>

        <div className="balance-amount-display">
          {balanceState.status === "LOADING" ? (
            <BalanceSkeleton />
          ) : balanceState.status === "ERROR" ? (
            <div className="balance-error-box">
              <AlertCircleIcon size={20} className="error-icon" />
              <span>{balanceState.error}</span>
              <button type="button" className="btn-retry-inline" onClick={onRefreshBalance}>
                Retry
              </button>
            </div>
          ) : (
            <div className="balance-figures">
              <div className="balance-primary">
                <span className="currency-symbol">$</span>
                <span className="amount-value">{formatPathUsd(BigInt(balanceState.balance || "0"))}</span>
              </div>
              <div className="balance-sub">
                <span>{Number(BigInt(balanceState.balance || "0")) / 1_000_000} pathUSD</span>
              </div>
            </div>
          )}
        </div>

        <div className="balance-card-actions">
          <button type="button" className="btn-secondary btn-large" onClick={onAddTestFunds}>Add test funds</button>
          <button type="button" className="btn-primary btn-large btn-send-cta" onClick={onStartSend}>
            <SendIcon size={18} />
            <span>Send money</span>
          </button>
        </div>
      </section>

      {connectedAddress && (
        <section className="account-address-card" aria-label="Your Reach address">
          <div>
            <span className="balance-eyebrow">Your Reach address</span>
            <code className="account-address-value" title={connectedAddress}>{shortAddress(connectedAddress)}</code>
          </div>
          <button type="button" className="btn-secondary" onClick={() => void copyAddress()}>
            {copiedAddress ? "Copied" : "Copy address"}
          </button>
        </section>
      )}

      {/* Summary Metric Stats Grid (Real Sender Data Only) */}
      <section className="dashboard-stats-grid" aria-label="Payout summary statistics">
        <div className="stat-card">
          <div className="stat-label">Active Payouts</div>
          <div className="stat-number">
            {payouts.filter((p) => {
              const live = payoutStatuses[p.id];
              const friendly = getFriendlyStatus(p, live);
              return friendly.tone === "funded";
            }).length}
          </div>
          <div className="stat-sub">Waiting to be claimed</div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Claimed</div>
          <div className="stat-number">
            {payouts.filter((p) => {
              const live = payoutStatuses[p.id];
              return getFriendlyStatus(p, live).tone === "claimed";
            }).length}
          </div>
          <div className="stat-sub">Settled to recipients</div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Returned</div>
          <div className="stat-number">
            {payouts.filter((p) => {
              const live = payoutStatuses[p.id];
              return getFriendlyStatus(p, live).tone === "returned";
            }).length}
          </div>
          <div className="stat-sub">Reclaimed after expiry</div>
        </div>
      </section>

      {/* Recent Activity Section */}
      <section className="recent-activity-section">
        <div className="activity-section-header">
          <h2 className="activity-section-title">Recent activity</h2>
          {allActivities.length > 5 && (
            <button type="button" className="btn-text-action" onClick={onViewAllActivity}>
              <span>View all</span>
              <ChevronRightIcon size={16} />
            </button>
          )}
        </div>

        {recentActivities.length === 0 ? (
          <div className="empty-activity-card">
            <div className="empty-icon-circle">
              <SendIcon size={24} />
            </div>
            <h3>No payouts yet</h3>
            <p>Send money or receive payments securely on Tempo.</p>
            <button type="button" className="btn-secondary" onClick={onStartSend}>
              <PlusIcon size={16} />
              <span>Create first payout</span>
            </button>
          </div>
        ) : (
          <div className="activity-list" role="list">
            {recentActivities.map((activity) => {
              const amountFormatted = `$${formatPathUsd(BigInt(activity.amount))}`;
              const label = activityLabel(activity);
              const tone = activity.direction === "RECEIVED" ? "claimed" : activity.lifecycle === "RECLAIMED" ? "returned" : activity.lifecycle === "EXPIRED_FUNDED" ? "expired" : activity.lifecycle === "CLAIMED" ? "claimed" : activity.lifecycle === "FUNDED" ? "funded" : activity.lifecycle === "FAILED" ? "failed" : "checking";

              return (
                <div
                  key={`${activity.direction}:${activity.payoutId}`}
                  className="activity-row"
                  role="listitem"
                  onClick={() => onSelectPayout(activity.payoutId)}
                  tabIndex={0}
                  onKeyDown={(e) => {
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
      </section>
    </div>
  );
}
