import React from "react";
import { SendIcon, ChevronRightIcon, RefreshIcon, ClockIcon, CheckCircleIcon, AlertCircleIcon, PlusIcon } from "./components/Icons";
import { BalanceSkeleton } from "./components/Skeleton";
import { formatPathUsd, type BalanceState } from "./senderFlow";
import type { SenderPayoutRecord } from "./senderStorage";

type HomeDashboardProps = {
  balanceState: BalanceState;
  payouts: SenderPayoutRecord[];
  payoutStatuses: Record<string, { status: number; expiresAt: bigint; claimant?: string }>;
  onStartSend: () => void;
  onSelectPayout: (id: string) => void;
  onViewAllActivity: () => void;
  onRefreshBalance: () => void;
  refreshing: boolean;
};

export function getFriendlyStatus(
  record: SenderPayoutRecord,
  live?: { status: number; expiresAt: bigint; claimant?: string }
): { label: string; tone: "funded" | "claimed" | "expired" | "returned" | "failed" } {
  if (record.outcome === "FAILED") {
    return { label: "Payout failed", tone: "failed" };
  }

  const status = live ? live.status : 1;
  const expiresAt = live ? live.expiresAt : BigInt(record.expiresAt || "0");
  const now = BigInt(Math.floor(Date.now() / 1000));

  if (status === 2) {
    return { label: "Claimed by recipient", tone: "claimed" };
  }
  if (status === 3) {
    return { label: "Returned to you", tone: "returned" };
  }
  if (status === 1) {
    if (now >= expiresAt && expiresAt > 0n) {
      return { label: "Expired · Ready to return", tone: "expired" };
    }
    return { label: "Funded · Waiting for recipient", tone: "funded" };
  }
  return { label: "Processing", tone: "funded" };
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

export default function HomeDashboard({
  balanceState,
  payouts,
  payoutStatuses,
  onStartSend,
  onSelectPayout,
  onViewAllActivity,
  onRefreshBalance,
  refreshing,
}: HomeDashboardProps) {
  const recentPayouts = payouts.slice(0, 5);

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
          <button type="button" className="btn-primary btn-large btn-send-cta" onClick={onStartSend}>
            <SendIcon size={18} />
            <span>Send money</span>
          </button>
        </div>
      </section>

      {/* Summary Metric Stats Grid (Real Sender Data Only) */}
      <section className="dashboard-stats-grid" aria-label="Payout summary statistics">
        <div className="stat-card">
          <div className="stat-label">Active Payouts</div>
          <div className="stat-number">
            {payouts.filter((p) => {
              const live = payoutStatuses[p.id];
              const st = live ? live.status : 1;
              return st === 1 && p.outcome !== "FAILED";
            }).length}
          </div>
          <div className="stat-sub">Waiting to be claimed</div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Claimed</div>
          <div className="stat-number">
            {payouts.filter((p) => {
              const live = payoutStatuses[p.id];
              return live && live.status === 2;
            }).length}
          </div>
          <div className="stat-sub">Settled to recipients</div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Returned</div>
          <div className="stat-number">
            {payouts.filter((p) => {
              const live = payoutStatuses[p.id];
              return live && live.status === 3;
            }).length}
          </div>
          <div className="stat-sub">Reclaimed after expiry</div>
        </div>
      </section>

      {/* Recent Activity Section */}
      <section className="recent-activity-section">
        <div className="activity-section-header">
          <h2 className="activity-section-title">Recent activity</h2>
          {payouts.length > 5 && (
            <button type="button" className="btn-text-action" onClick={onViewAllActivity}>
              <span>View all</span>
              <ChevronRightIcon size={16} />
            </button>
          )}
        </div>

        {recentPayouts.length === 0 ? (
          <div className="empty-activity-card">
            <div className="empty-icon-circle">
              <SendIcon size={24} />
            </div>
            <h3>No payouts yet</h3>
            <p>Send money to anyone with a secure, private bearer claim link.</p>
            <button type="button" className="btn-secondary" onClick={onStartSend}>
              <PlusIcon size={16} />
              <span>Create first payout</span>
            </button>
          </div>
        ) : (
          <div className="activity-list" role="list">
            {recentPayouts.map((record) => {
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
      </section>
    </div>
  );
}
