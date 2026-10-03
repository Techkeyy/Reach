import React, { useState } from "react";
import {
  CheckCircleIcon,
  ClockIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  CopyIcon,
  CheckIcon,
  ArrowRightIcon,
  AlertCircleIcon,
} from "./components/Icons";
import { formatPathUsd } from "./senderFlow";
import { getFriendlyStatus } from "./HomeDashboard";
import type { SenderPayoutRecord } from "./senderStorage";
import type { ReclaimUiState } from "./reclaimFlow";
import { resolvePayoutLifecycle, type LivePayout } from "./payoutLifecycle";
import { formatFinancialAmount } from "./financialQuote";
import { PATH_USD_ADDRESS } from "../shared/reach";

type PayoutDetailProps = {
  record: SenderPayoutRecord;
  live?: LivePayout;
  connectedAddress?: string;
  capabilityAvailable?: boolean;
  onBack: () => void;
  onReturnFunds: (id: string) => Promise<void>;
  returningFunds: boolean;
  reclaimState?: ReclaimUiState;
  reclaimError?: string | null;
};

function TransactionRow({ label, hash }: { label: string; hash: string }) {
  return (
    <div className="meta-row">
      <span className="meta-label">{label}</span>
      <a
        href={`https://moderato.tempo.xyz/tx/${hash}`}
        target="_blank"
        rel="noreferrer"
        className="meta-link"
      >
        <span>{`${hash.slice(0, 8)}...${hash.slice(-6)}`}</span>
        <ExternalLinkIcon size={14} />
      </a>
    </div>
  );
}

export default function PayoutDetail({
  record,
  live,
  connectedAddress,
  capabilityAvailable = false,
  onBack,
  onReturnFunds,
  returningFunds,
  reclaimState = "IDLE",
  reclaimError = null,
}: PayoutDetailProps) {
  const [showTechnical, setShowTechnical] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const friendly = getFriendlyStatus(record, live);
  const lifecycle = resolvePayoutLifecycle({
    authoritativePayout: live ? {
      ...live,
      expiresAt: live.expiresAt.toString(),
    } : undefined,
    operationJournal: record,
    chainTimestamp: live?.chainTimestamp,
    connectedAccount: connectedAddress,
    capabilityPresent: capabilityAvailable,
  });
  const amountFormatted = `$${formatPathUsd(BigInt(record.amount))}`;
  const awaitingSubmissionResolution = lifecycle.requiresRecovery || (!live && (record.submissionState === "SUBMITTING" || record.submissionState === "SUBMISSION_UNCERTAIN"));
  const expiresAt = live?.expiresAt ?? BigInt(record.expiresAt || "0");
  const isExpired = lifecycle.isExpired;
  const reclaimPending = returningFunds || reclaimState === "CHECKING" || reclaimState === "AWAITING_SIGNATURE" || reclaimState === "SUBMITTING" || reclaimState === "CONFIRMING" || reclaimState === "RECOVERING" || reclaimState === "SUBMISSION_UNCERTAIN" || record.reclaimState === "SUBMITTING" || record.reclaimState === "SUBMISSION_UNCERTAIN";
  const isReclaimable = lifecycle.isReclaimable && !reclaimPending;

  const copyText = (key: string, text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedField(key);
      setTimeout(() => setCopiedField(null), 2000);
    });
  };

  const createdDate = new Date(record.createdAt);
  const createdFormatted = isNaN(createdDate.getTime()) ? "Recently" : createdDate.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const expiresDate = expiresAt > 0n ? new Date(Number(expiresAt) * 1000) : null;
  const expiresFormatted = expiresDate
    ? expiresDate.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "24 hours from creation";
  const actualPayoutFee = record.actualFeeAmount ? {
    amount: BigInt(record.actualFeeAmount),
    decimals: record.actualFeeDecimals ?? 6,
    symbol: record.actualFeeSymbol ?? "fee token",
    ...(record.actualFeeToken ? { token: record.actualFeeToken as `0x${string}` } : {}),
  } : null;
  const actualTotalDeducted = actualPayoutFee
    ? actualPayoutFee.token?.toLowerCase() === PATH_USD_ADDRESS.toLowerCase()
      ? `${formatFinancialAmount({ amount: BigInt(record.amount) + actualPayoutFee.amount, decimals: 6, symbol: "pathUSD" })} pathUSD`
      : `${formatFinancialAmount({ amount: BigInt(record.amount), decimals: 6, symbol: "pathUSD" })} pathUSD + ${formatFinancialAmount(actualPayoutFee)} ${actualPayoutFee.symbol}`
    : null;

  return (
    <div className="payout-detail-layout">
      {/* Back button bar */}
      <div className="detail-topbar">
        <button type="button" className="btn-back-link" onClick={onBack}>
          <ChevronRightIcon size={16} style={{ transform: "rotate(180deg)" }} />
          <span>Back to activity</span>
        </button>
      </div>

      {/* Main Payout Card */}
      <div className="detail-card">
        <div className="detail-header">
          <div className="detail-amount-display">
            <span className="detail-amount-number">{amountFormatted}</span>
            <span className="detail-token">pathUSD</span>
          </div>

          <div className={`detail-status-badge tone-${friendly.tone}`}>
            <span className="status-dot-indicator" />
            <span>{friendly.label}</span>
          </div>

          {record.label && <div className="detail-memo-badge">Note: {record.label}</div>}
        </div>

        {lifecycle.financialState === "RECLAIMED" ? (
          <div className="detail-notice" role="status">
            Funds returned to your wallet.
          </div>
        ) : reclaimError ? (
          <div className="detail-notice" role="alert">
            {reclaimError}
          </div>
        ) : awaitingSubmissionResolution ? (
          <div className="detail-notice" role="status">
            Reach is reconciling this payout. Do not submit it again yet.
          </div>
        ) : reclaimPending ? (
          <div className="detail-notice" role="status">
            Reach is reconciling the return transaction. Do not submit it again yet.
          </div>
        ) : null}
        {lifecycle.capabilityState === "MISSING" && (
          <div className="detail-notice" role="status">
            Claim link unavailable on this device/session
          </div>
        )}

        {/* Payment Lifecycle Timeline */}
        <div className="timeline-section">
          <h3 className="timeline-heading">Payment timeline</h3>

          <div className="timeline-flow">
            {/* Stage 1: Funded */}
            <div className="timeline-step step-completed">
              <div className="timeline-marker">
                <CheckCircleIcon size={16} />
              </div>
              <div className="timeline-step-content">
                <div className="timeline-step-title">{lifecycle.historicalFunding ? "Funded by sender" : "Payout recorded"}</div>
                <div className="timeline-step-time">{createdFormatted}</div>
              </div>
            </div>

            {/* Line connector */}
            <div className="timeline-connector" />

            {/* Stage 2: Claim / Expired / Returned */}
            {lifecycle.financialState === "CLAIMED" ? (
              <div className="timeline-step step-completed">
                <div className="timeline-marker tone-claimed">
                  <CheckCircleIcon size={16} />
                </div>
                <div className="timeline-step-content">
                  <div className="timeline-step-title">Claimed by recipient</div>
                  <div className="timeline-step-sub">
                    {live?.claimant
                      ? `Transferred to ${live.claimant.slice(0, 6)}...${live.claimant.slice(-4)}`
                      : "Transferred via passkey authorization"}
                  </div>
                </div>
              </div>
            ) : lifecycle.financialState === "RECLAIMED" ? (
              <div className="timeline-step step-completed">
                <div className="timeline-marker tone-returned">
                  <CheckCircleIcon size={16} />
                </div>
                <div className="timeline-step-content">
                  <div className="timeline-step-title">Returned to sender</div>
                  <div className="timeline-step-sub">100% of funds returned to your wallet</div>
                </div>
              </div>
            ) : isExpired ? (
              <div className="timeline-step step-alert">
                <div className="timeline-marker tone-expired">
                  <ClockIcon size={16} />
                </div>
                <div className="timeline-step-content">
                  <div className="timeline-step-title">Expired · Ready to return</div>
                  <div className="timeline-step-sub">Claim window closed on {expiresFormatted}</div>
                </div>
              </div>
            ) : lifecycle.financialState === "FUNDED" ? (
              <div className="timeline-step step-pending">
                <div className="timeline-marker">
                  <ClockIcon size={16} />
                </div>
                <div className="timeline-step-content">
                  <div className="timeline-step-title">Waiting for recipient to claim</div>
                  <div className="timeline-step-sub">Active until {expiresFormatted}</div>
                </div>
              </div>
            ) : (
              <div className="timeline-step step-pending" role="status">
                <div className="timeline-marker"><ClockIcon size={16} /></div>
                <div className="timeline-step-content">
                  <div className="timeline-step-title">Verifying payout status</div>
                  <div className="timeline-step-sub">Waiting for current chain data. Status will update automatically.</div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Expired Action: Return Funds */}
        {isReclaimable && (
          <div className="return-funds-box">
            <div className="return-funds-content">
              <AlertCircleIcon size={20} className="return-icon" />
              <div>
                <h4>Recipient did not claim this payout</h4>
                <p>The expiration window has closed. You can return all funds back to your wallet.</p>
              </div>
            </div>
            <button
              type="button"
              className="btn-primary btn-large btn-return"
              onClick={() => onReturnFunds(record.id)}
              disabled={returningFunds}
            >
              {returningFunds ? (
                <>
                  <div className="signing-spinner" />
                  <span>Returning funds...</span>
                </>
              ) : (
                <>
                  <ArrowRightIcon size={16} />
                  <span>Return funds to wallet</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* Overview rows */}
        <div className="detail-meta-table">
          <div className="meta-row">
            <span className="meta-label">Network</span>
            <span className="meta-val">Tempo Moderato (Chain ID 42431)</span>
          </div>

          <div className="meta-row">
            <span className="meta-label">Token</span>
            <span className="meta-val">pathUSD</span>
          </div>

          {record.protection?.mode === "PROTECTED" && (
            <>
              <div className="meta-row">
                <span className="meta-label">Protection</span>
                <span className="meta-val">Protected</span>
              </div>
              <div className="meta-row">
                <span className="meta-label">Verification</span>
                <span className="meta-val">{record.protection.channel === "EMAIL" ? "Email" : "Phone"}</span>
              </div>
              {record.protection.maskedRecipient && (
                <div className="meta-row">
                  <span className="meta-label">Recipient</span>
                  <span className="meta-val">{record.protection.maskedRecipient}</span>
                </div>
              )}
            </>
          )}

          {record.actualFeeAmount && (
            <div className="meta-row">
              <span className="meta-label">Actual network fee</span>
              <span className="meta-val">{formatFinancialAmount({ amount: BigInt(record.actualFeeAmount), decimals: record.actualFeeDecimals ?? 6, symbol: record.actualFeeSymbol ?? "fee token" })} {record.actualFeeSymbol ?? "fee token"}</span>
            </div>
          )}

          {!record.actualFeeAmount && record.fundingTxHash && (
            <div className="meta-row" role="status">
              <span className="meta-label">Network fee</span>
              <span className="meta-val">Fee details are temporarily unavailable.</span>
            </div>
          )}

          {actualTotalDeducted && (
            <div className="meta-row">
              <span className="meta-label">Actual total deducted</span>
              <span className="meta-val">{actualTotalDeducted}</span>
            </div>
          )}

          {record.actualRemainingBalance && (
            <div className="meta-row">
              <span className="meta-label">Remaining balance</span>
              <span className="meta-val">{formatPathUsd(BigInt(record.actualRemainingBalance))} pathUSD</span>
            </div>
          )}

          {live?.claimant && (
            <div className="meta-row">
              <span className="meta-label">Recipient address</span>
              <div className="meta-val-copy">
                <span>{`${live.claimant.slice(0, 6)}...${live.claimant.slice(-4)}`}</span>
                <button
                  type="button"
                  className="btn-inline-copy"
                  onClick={() => copyText("claimant", live.claimant!)}
                >
                  {copiedField === "claimant" ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
                </button>
              </div>
            </div>
          )}

          {record.fundingTxHash && <TransactionRow label="Funding transaction" hash={record.fundingTxHash} />}
          {record.claimTxHash && <TransactionRow label="Claim transaction" hash={record.claimTxHash} />}
          {record.reclaimTxHash && <TransactionRow label="Reclaim transaction" hash={record.reclaimTxHash} />}
        </div>

        {/* Collapsible Technical Details */}
        <div className="technical-accordion">
          <button
            type="button"
            className="accordion-toggle"
            onClick={() => setShowTechnical((prev) => !prev)}
            aria-expanded={showTechnical}
          >
            <span>Technical details</span>
            <ChevronDownIcon
              size={16}
              style={{ transform: showTechnical ? "rotate(180deg)" : "none", transition: "transform 200ms" }}
            />
          </button>

          {showTechnical && (
            <div className="technical-content">
              <div className="tech-row">
                <span className="tech-label">Payout ID</span>
                <div className="tech-val">
                  <code>{record.id}</code>
                  <button type="button" onClick={() => copyText("id", record.id)}>
                    {copiedField === "id" ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
                  </button>
                </div>
              </div>

              <div className="tech-row">
                <span className="tech-label">Claim Signer</span>
                <div className="tech-val">
                  <code>{record.claimSigner}</code>
                  <button type="button" onClick={() => copyText("signer", record.claimSigner)}>
                    {copiedField === "signer" ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
                  </button>
                </div>
              </div>

              <div className="tech-row">
                <span className="tech-label">Contract Status</span>
                <div className="tech-val">
                  <code>{lifecycle.financialState}</code>
                </div>
              </div>

              <div className="tech-row">
                <span className="tech-label">Smart Vault</span>
                <div className="tech-val">
                  <code>0x98262c02746f3b91342249159deeebe87a54266c</code>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
