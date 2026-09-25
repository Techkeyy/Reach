import React, { useState } from "react";
import {
  SendIcon,
  CloseIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  AlertCircleIcon,
  ClockIcon,
  LockIcon,
  ShieldCheckIcon,
  InfoIcon,
} from "./components/Icons";
import SenderClaimLink from "./SenderClaimLink";
import { formatPathUsd, parsePathUsdAmount, type BalanceState, type SenderStage } from "./senderFlow";
import type { SenderPayoutRecord } from "./senderStorage";

type SendExperienceProps = {
  balanceState: BalanceState;
  onCancel: () => void;
  onInitiateReview: (amountInput: string, expirySeconds: number, label: string) => Promise<boolean>;
  onSignAndFund: () => Promise<void>;
  onReset: () => void;
  onViewActivity: () => void;
  stage: SenderStage;
  fundedRecord: SenderPayoutRecord | null;
  claimUrl: string | null;
  onCopyClaimLink: (url: string) => Promise<void>;
  preflightError?: string | null;
  preflightChecking: boolean;
};

const EXPIRY_OPTIONS = [
  { seconds: 3600, label: "1 hour" },
  { seconds: 86400, label: "24 hours" },
  { seconds: 259200, label: "3 days" },
];

export default function SendExperience({
  balanceState,
  onCancel,
  onInitiateReview,
  onSignAndFund,
  onReset,
  onViewActivity,
  stage,
  fundedRecord,
  claimUrl,
  onCopyClaimLink,
  preflightError,
  preflightChecking,
}: SendExperienceProps) {
  const [step, setStep] = useState<"AMOUNT" | "REVIEW" | "SIGNING">("AMOUNT");
  const [amountInput, setAmountInput] = useState("");
  const [selectedExpiry, setSelectedExpiry] = useState(86400);
  const [note, setNote] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);

  const availableBase = BigInt(balanceState.balance || "0");
  const availableFormatted = formatPathUsd(availableBase);

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val === "" || /^\d*\.?\d{0,6}$/.test(val)) {
      setAmountInput(val);
      setInputError(null);
    }
  };

  const handleContinueToReview = async () => {
    if (!amountInput || parseFloat(amountInput) <= 0) {
      setInputError("Enter an amount greater than $0");
      return;
    }

    try {
      const parsedAmount = parsePathUsdAmount(amountInput);
      if (parsedAmount > availableBase) {
        setInputError(`Amount exceeds available balance of $${availableFormatted}`);
        return;
      }
      const ok = await onInitiateReview(amountInput, selectedExpiry, note.trim());
      if (ok) {
        setStep("REVIEW");
      }
    } catch (err: any) {
      setInputError(err?.message || "Invalid amount format");
    }
  };

  const handleStartPreflightAndSign = () => {
    setStep("SIGNING");
  };

  const handleConfirmSign = async () => {
    await onSignAndFund();
  };

  // If already funded, show dedicated success stage
  if (stage === "FUNDED" && claimUrl) {
    return (
      <div className="send-flow-container">
        <div className="funded-success-card">
          <div className="success-icon-animated">
            <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
              <circle cx="32" cy="32" r="30" stroke="#167B5A" strokeWidth="4" className="success-circle-stroke" />
              <path d="M20 33l8 8 16-16" stroke="#167B5A" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" className="success-check-stroke" />
            </svg>
          </div>

          <span className="success-eyebrow">Done</span>
          <h2 className="success-headline">
            ${amountInput || (fundedRecord ? formatPathUsd(BigInt(fundedRecord.amount)) : "0.00")} is ready to claim
          </h2>
          <p className="success-subhead">
            Your payout is funded in the smart vault. Share the private link below with your recipient.
          </p>

          <SenderClaimLink url={claimUrl} onCopy={onCopyClaimLink} />

          <div className="success-actions">
            <button type="button" className="btn-primary btn-large" onClick={onReset}>
              <SendIcon size={18} />
              <span>Send another payout</span>
            </button>
            <button type="button" className="btn-secondary btn-large" onClick={onViewActivity}>
              <span>View activity</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="send-flow-container">
      {/* Top Bar for Send Workflow */}
      <div className="send-flow-topbar">
        <button type="button" className="btn-cancel-flow" onClick={onCancel} aria-label="Cancel send">
          <CloseIcon size={20} />
          <span>Cancel</span>
        </button>
        <span className="flow-stage-title">
          {step === "AMOUNT" ? "Send money" : step === "REVIEW" ? "Review payout" : "Approve payout"}
        </span>
        <div style={{ width: 60 }} />
      </div>

      {step === "AMOUNT" && (
        <div className="send-amount-card">
          {/* Dominant Amount Input (Cash App Style) */}
          <div className="amount-input-stage">
            <div className="amount-input-row">
              <span className="amount-dollar-sign">$</span>
              <input
                type="text"
                inputMode="decimal"
                className="amount-huge-input"
                placeholder="0"
                value={amountInput}
                onChange={handleAmountChange}
                autoFocus
                aria-label="Amount in pathUSD"
              />
            </div>
            <div className="token-denomination">pathUSD</div>

            <div className="available-balance-indicator">
              <span>Available ${availableFormatted}</span>
            </div>

            {inputError && (
              <div className="amount-error-inline" role="alert">
                <AlertCircleIcon size={16} />
                <span>{inputError}</span>
              </div>
            )}
          </div>

          {/* Configuration Options */}
          <div className="send-options-section">
            <div className="option-group">
              <label className="option-label" htmlFor="expiry-select">
                <ClockIcon size={16} />
                <span>Claim window</span>
              </label>
              <div className="expiry-pill-selector" id="expiry-select">
                {EXPIRY_OPTIONS.map((opt) => (
                  <button
                    key={opt.seconds}
                    type="button"
                    className={`expiry-pill ${selectedExpiry === opt.seconds ? "pill-selected" : ""}`}
                    onClick={() => setSelectedExpiry(opt.seconds)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="option-group">
              <label className="option-label" htmlFor="note-input">
                <span>Add note (optional)</span>
              </label>
              <input
                id="note-input"
                type="text"
                className="note-text-input"
                placeholder="What is this payment for?"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={60}
              />
            </div>
          </div>

          <div className="send-cta-bar">
            <button
              type="button"
              className="btn-primary btn-large btn-full"
              onClick={handleContinueToReview}
              disabled={!amountInput || parseFloat(amountInput) <= 0}
            >
              <span>Continue</span>
              <ArrowRightIcon size={18} />
            </button>
          </div>
        </div>
      )}

      {step === "REVIEW" && (
        <div className="send-review-card">
          <div className="review-header">
            <span className="review-eyebrow">Review details</span>
            <div className="review-amount-box">
              <span className="review-amount-number">${amountInput}</span>
              <span className="review-amount-token">pathUSD</span>
            </div>
          </div>

          {/* Wise-Style Breakdown Table */}
          <div className="review-breakdown-table">
            <div className="review-row">
              <span className="review-label">You send</span>
              <span className="review-value font-tabular">${amountInput} pathUSD</span>
            </div>

            <div className="review-row">
              <span className="review-label">Recipient</span>
              <span className="review-value">Anyone holding the private claim link</span>
            </div>

            <div className="review-row">
              <span className="review-label">Claim window</span>
              <span className="review-value">
                {EXPIRY_OPTIONS.find((o) => o.seconds === selectedExpiry)?.label || "24 hours"}
              </span>
            </div>

            <div className="review-row">
              <span className="review-label">Tempo network fee</span>
              <span className="review-value fee-sender-note">
                Checked before signing (paid by sender)
              </span>
            </div>

            {note.trim() && (
              <div className="review-row">
                <span className="review-label">Note</span>
                <span className="review-value">{note.trim()}</span>
              </div>
            )}
          </div>

          <div className="review-notice-box">
            <InfoIcon size={16} className="notice-icon" />
            <span>
              Sender funding network fees are paid by your account. Recipient claims are 100% sponsored by Reach.
            </span>
          </div>

          {preflightError && (
            <div className="preflight-error-banner" role="alert">
              <AlertCircleIcon size={18} />
              <span>{preflightError}</span>
            </div>
          )}

          <div className="review-cta-bar">
            <button
              type="button"
              className="btn-secondary btn-large"
              onClick={() => setStep("AMOUNT")}
            >
              <span>Back</span>
            </button>
            <button
              type="button"
              className="btn-primary btn-large"
              onClick={handleStartPreflightAndSign}
            >
              <span>Check and continue</span>
              <ArrowRightIcon size={18} />
            </button>
          </div>
        </div>
      )}

      {step === "SIGNING" && (
        <div className="signing-overlay" role="dialog" aria-modal="true" aria-label="Approve payout">
          <div className="signing-sheet">
            <div className="signing-sheet-handle" aria-hidden="true" />
            <div className="signing-header">
              <div className="signing-icon-circle">
                <ShieldCheckIcon size={28} />
              </div>
              <h3>Approve payout</h3>
              <p>You are funding <strong>${amountInput} pathUSD</strong> on Tempo Moderato.</p>
            </div>

            <div className="signing-status-box">
              {preflightChecking ? (
                <div className="signing-status-row">
                  <div className="signing-spinner" />
                  <span>Checking payment preflight on Tempo...</span>
                </div>
              ) : stage === "CONFIRMING" ? (
                <div className="signing-status-row">
                  <div className="signing-spinner" />
                  <span>Submitting & confirming transaction...</span>
                </div>
              ) : preflightError ? (
                <div className="signing-error-row">
                  <AlertCircleIcon size={18} className="error-icon" />
                  <span>{preflightError}</span>
                </div>
              ) : (
                <div className="signing-ready-row">
                  <CheckCircleIcon size={18} className="ready-icon" />
                  <span>Ready to fund. Your wallet or passkey will ask you to approve this transaction.</span>
                </div>
              )}
            </div>

            <div className="signing-actions">
              {preflightError ? (
                <button
                  type="button"
                  className="btn-secondary btn-large btn-full"
                  onClick={() => setStep("REVIEW")}
                >
                  <span>Return to review</span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn-secondary btn-large"
                    onClick={() => setStep("REVIEW")}
                    disabled={stage === "CONFIRMING"}
                  >
                    <span>Cancel</span>
                  </button>
                  <button
                    type="button"
                    className="btn-primary btn-large btn-sign"
                    onClick={handleConfirmSign}
                    disabled={stage === "CONFIRMING" || preflightChecking}
                  >
                    <LockIcon size={18} />
                    <span>Sign and fund</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
