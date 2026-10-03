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
import AccountAddress from "./AccountAddress";
import WalletTransferExperience, { type WalletTransferUiState } from "./WalletTransferExperience";
import { formatPathUsd, parsePathUsdAmount, type BalanceState, type FundingSubmissionState, type SenderStage } from "./senderFlow";
import type { SenderPayoutRecord } from "./senderStorage";
import { formatPayoutExpiry, localTimeZoneLabel, PAYOUT_EXPIRY_PRESETS, type PayoutExpirySelection } from "./expiry";
import { formatFinancialAmount, type FinancialQuote } from "./financialQuote";
import type { ClaimProtection, ClaimProtectionChannel } from "../shared/claimProtection";
import { maskProtectedRecipient } from "./protectedClaims";

type SendExperienceProps = {
  connectedAddress?: string;
  balanceState: BalanceState;
  onCancel: () => void;
  onInitiateReview: (amountInput: string, expiry: PayoutExpirySelection, label: string, protection: ClaimProtection) => Promise<boolean>;
  onSignAndFund: () => Promise<void>;
  onRevalidateFunding: () => Promise<boolean>;
  onReset: () => void;
  onViewActivity: () => void;
  stage: SenderStage;
  fundedRecord: SenderPayoutRecord | null;
  claimUrl: string | null;
  onCopyClaimLink: (url: string) => Promise<void>;
  preflightError?: string | null;
  preflightChecking: boolean;
  fundingQuote: FinancialQuote | null;
  submissionState: FundingSubmissionState;
  walletTransferState: WalletTransferUiState;
  walletTransferError: string | null;
  walletTransferQuote: FinancialQuote | null;
  walletTransferPreparing: boolean;
  walletTransferReceipt: { actualFeeAmount?: string; actualFeeSymbol?: string; actualFeeDecimals?: number; remainingBalance?: string; txHash?: string } | null;
  onPrepareWalletTransfer: (recipient: `0x${string}`, amount: string) => Promise<boolean>;
  onWalletTransfer: (recipient: `0x${string}`, amount: string) => Promise<void>;
  onResetWalletTransfer: () => void;
};

type ClaimProtectionMode = ClaimProtection["mode"];

export default function SendExperience({
  connectedAddress,
  balanceState,
  onCancel,
  onInitiateReview,
  onSignAndFund,
  onRevalidateFunding,
  onReset,
  onViewActivity,
  stage,
  fundedRecord,
  claimUrl,
  onCopyClaimLink,
  preflightError,
  preflightChecking,
  fundingQuote,
  submissionState,
  walletTransferState,
  walletTransferError,
  walletTransferQuote,
  walletTransferPreparing,
  walletTransferReceipt,
  onPrepareWalletTransfer,
  onWalletTransfer,
  onResetWalletTransfer,
}: SendExperienceProps) {
  const [step, setStep] = useState<"AMOUNT" | "REVIEW" | "SIGNING">("AMOUNT");
  const [sendMode, setSendMode] = useState<"REACH" | "WALLET">("REACH");
  const [amountInput, setAmountInput] = useState("");
  const [selectedExpiry, setSelectedExpiry] = useState<PayoutExpirySelection>({ kind: "PRESET", seconds: 86400 });
  const [customExpiry, setCustomExpiry] = useState("");
  const [note, setNote] = useState("");
  const [protectionMode, setProtectionMode] = useState<ClaimProtectionMode>("INSTANT");
  const [protectionChannel, setProtectionChannel] = useState<ClaimProtectionChannel>("EMAIL");
  const [protectionRecipient, setProtectionRecipient] = useState("");
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
        setInputError(`You only have ${availableFormatted} pathUSD available.`);
        return;
      }
      const expiry = selectedExpiry.kind === "CUSTOM" ? { kind: "CUSTOM" as const, localDateTime: customExpiry } : selectedExpiry;
      const protection: ClaimProtection = protectionMode === "PROTECTED"
        ? { mode: "PROTECTED", channel: protectionChannel, recipient: protectionRecipient.trim() }
        : { mode: "INSTANT" };
      if (protection.mode === "PROTECTED" && !protection.recipient) {
        setInputError(`Enter the recipient ${protection.channel === "EMAIL" ? "email" : "phone number"}.`);
        return;
      }
      const ok = await onInitiateReview(amountInput, expiry, note.trim(), protection);
      if (ok) {
        setStep("REVIEW");
      }
    } catch (err: any) {
      setInputError(err?.message || "Invalid amount format");
    }
  };

  const handleStartPreflightAndSign = async () => {
    if (stage !== "READY_TO_SIGN" || submissionState !== "NOT_SUBMITTED" || preflightChecking || preflightError) return;
    if (!await onRevalidateFunding()) return;
    setStep("SIGNING");
  };

  const handleConfirmSign = async () => {
    await onSignAndFund();
  };

  const actualPayoutFee = fundedRecord?.actualFeeAmount
    ? { amount: BigInt(fundedRecord.actualFeeAmount), decimals: fundedRecord.actualFeeDecimals ?? 6, symbol: fundedRecord.actualFeeSymbol ?? "fee token", ...(fundedRecord.actualFeeToken ? { token: fundedRecord.actualFeeToken as `0x${string}` } : {}) }
    : null;
  const payoutTotalDeducted = actualPayoutFee?.token?.toLowerCase() === "0x20c0000000000000000000000000000000000000"
    ? formatFinancialAmount({ amount: BigInt(fundedRecord?.amount ?? "0") + actualPayoutFee.amount, decimals: 6, symbol: "pathUSD" }) + " pathUSD"
    : actualPayoutFee
      ? `${formatFinancialAmount({ amount: BigInt(fundedRecord?.amount ?? "0"), decimals: 6, symbol: "pathUSD" })} pathUSD + ${formatFinancialAmount(actualPayoutFee)} ${actualPayoutFee.symbol}`
      : "Available after receipt evidence";

  // If already funded, show dedicated success stage
  if (stage === "FUNDED" && claimUrl) {
    return (
      <div className="send-screen-layout">
        <AccountAddress address={connectedAddress} />
        <div className="send-flow-container">
        <div className="funded-success-card">
          <div className="success-icon-animated">
            <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
              <circle cx="32" cy="32" r="30" stroke="var(--success)" strokeWidth="4" className="success-circle-stroke" />
              <path d="M20 33l8 8 16-16" stroke="var(--success)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" className="success-check-stroke" />
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

          <div className="success-breakdown" aria-label="Confirmed payout details">
            <div><span>Recipient gets</span><strong>${amountInput || (fundedRecord ? formatPathUsd(BigInt(fundedRecord.amount)) : "0.00")} pathUSD</strong></div>
            <div><span>Actual network fee</span><strong>{actualPayoutFee ? `${formatFinancialAmount(actualPayoutFee)} ${actualPayoutFee.symbol}` : "Fee details are temporarily unavailable."}</strong></div>
            <div><span>Total deducted</span><strong>{payoutTotalDeducted}</strong></div>
            {fundedRecord?.actualRemainingBalance && <div><span>Remaining balance</span><strong>{formatPathUsd(BigInt(fundedRecord.actualRemainingBalance))} pathUSD</strong></div>}
            <div><span>Expires</span><strong>{fundedRecord?.expiresAt ? formatPayoutExpiry(fundedRecord.expiresAt) : "Configured claim window"}</strong></div>
          </div>

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
      </div>
    );
  }

  return (
    <div className="send-screen-layout">
      <AccountAddress address={connectedAddress} />
      <div className="send-flow-container">
      <div className="send-mode-selector" role="group" aria-label="How do you want to send?">
        <div className="send-mode-selector-heading">
          <span className="balance-eyebrow">How do you want to send?</span>
        </div>
        <div className="send-mode-options">
          <button type="button" className={`send-mode-option ${sendMode === "REACH" ? "selected" : ""}`} onClick={() => setSendMode("REACH")}>
            <strong>Pay with Reach</strong>
            <span>Send money without asking for a wallet address.</span>
          </button>
          <button type="button" className={`send-mode-option ${sendMode === "WALLET" ? "selected" : ""}`} onClick={() => setSendMode("WALLET")}>
            <strong>Send to wallet</strong>
            <span>Send pathUSD directly to a Tempo address.</span>
          </button>
        </div>
      </div>

      {sendMode === "WALLET" && (
        <WalletTransferExperience
          connectedAddress={connectedAddress}
          balanceState={balanceState}
          transferState={walletTransferState}
          transferError={walletTransferError}
          quote={walletTransferQuote}
          preparingQuote={walletTransferPreparing}
          receipt={walletTransferReceipt}
          onPrepare={onPrepareWalletTransfer}
          onConfirm={onWalletTransfer}
          onStartOver={onResetWalletTransfer}
          onViewAccount={onCancel}
        />
      )}

      <div className="payout-send-flow" hidden={sendMode === "WALLET"}>
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

            {(inputError || preflightError) && (
              <div className="amount-error-inline" role="alert">
                <AlertCircleIcon size={16} />
                <span>{inputError || preflightError}</span>
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
                {PAYOUT_EXPIRY_PRESETS.map((opt) => (
                  <button
                    key={opt.seconds}
                    type="button"
                    className={`expiry-pill ${selectedExpiry.kind === "PRESET" && selectedExpiry.seconds === opt.seconds ? "pill-selected" : ""}`}
                    onClick={() => setSelectedExpiry({ kind: "PRESET", seconds: opt.seconds })}
                  >
                    {opt.label}
                  </button>
                ))}
                <button
                  type="button"
                  className={`expiry-pill ${selectedExpiry.kind === "CUSTOM" ? "pill-selected" : ""}`}
                  onClick={() => setSelectedExpiry({ kind: "CUSTOM", localDateTime: customExpiry })}
                >
                  Custom
                </button>
              </div>
              {selectedExpiry.kind === "CUSTOM" && (
                <div className="custom-expiry-fields">
                  <label className="option-label" htmlFor="custom-expiry">Expiration date and time ({localTimeZoneLabel()})</label>
                  <input
                    id="custom-expiry"
                    type="datetime-local"
                    className="note-text-input"
                    value={customExpiry}
                    onChange={(event) => { setCustomExpiry(event.target.value); setSelectedExpiry({ kind: "CUSTOM", localDateTime: event.target.value }); }}
                  />
                </div>
              )}
            </div>

            <div className="option-group" aria-label="Claim protection">
              <span className="option-label"><LockIcon size={16} /><span>Claim protection</span></span>
              <div className="send-mode-options">
                <button type="button" className={`send-mode-option ${protectionMode === "INSTANT" ? "selected" : ""}`} onClick={() => setProtectionMode("INSTANT")}>
                  <strong>Instant</strong>
                  <span>Anyone with the private link can claim.</span>
                </button>
                <button type="button" className={`send-mode-option ${protectionMode === "PROTECTED" ? "selected" : ""}`} onClick={() => setProtectionMode("PROTECTED")}>
                  <strong>Protected</strong>
                  <span>Require recipient verification before claiming.</span>
                </button>
              </div>
              {protectionMode === "PROTECTED" && (
                <div className="protected-recipient-fields">
                  <div className="expiry-pill-selector" aria-label="Verification channel">
                    <button type="button" className={`expiry-pill ${protectionChannel === "EMAIL" ? "pill-selected" : ""}`} onClick={() => setProtectionChannel("EMAIL")}>Email</button>
                    <button type="button" className={`expiry-pill ${protectionChannel === "SMS" ? "pill-selected" : ""}`} onClick={() => setProtectionChannel("SMS")}>Phone</button>
                  </div>
                  <input
                    id="protected-recipient"
                    type={protectionChannel === "EMAIL" ? "email" : "tel"}
                    className="note-text-input"
                    placeholder={protectionChannel === "EMAIL" ? "recipient@example.com" : "+15551234567"}
                    value={protectionRecipient}
                    onChange={(event) => setProtectionRecipient(event.target.value)}
                    autoComplete="off"
                  />
                  <span className="option-help">The recipient will need both the private claim link and access to this {protectionChannel === "EMAIL" ? "email" : "phone"}.</span>
                </div>
              )}
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
              <span className="review-label">Available</span>
              <span className="review-value font-tabular">{formatFinancialAmount(fundingQuote?.availableBalance)} pathUSD</span>
            </div>

            <div className="review-row">
              <span className="review-label">Recipient</span>
              <span className="review-value">{protectionMode === "PROTECTED" ? maskProtectedRecipient(protectionChannel, protectionRecipient) : "Anyone holding the private claim link"}</span>
            </div>

            <div className="review-row">
              <span className="review-label">Protection</span>
              <span className="review-value">{protectionMode === "PROTECTED" ? "Protected" : "Instant"}</span>
            </div>

            {protectionMode === "PROTECTED" && (
              <div className="review-row">
                <span className="review-label">Verification</span>
                <span className="review-value">{protectionChannel === "EMAIL" ? "Email" : "Phone"}</span>
              </div>
            )}

            <div className="review-row">
              <span className="review-label">Claim window</span>
              <span className="review-value">
                {fundedRecord?.expiresAt ? formatPayoutExpiry(fundedRecord.expiresAt) : selectedExpiry.kind === "CUSTOM" ? "Custom time" : PAYOUT_EXPIRY_PRESETS.find((o) => o.seconds === selectedExpiry.seconds)?.label || "24 hours"}
              </span>
            </div>

            <div className="review-row">
              <span className="review-label">Payout type</span>
              <span className="review-value">Pay with Reach · private claim link</span>
            </div>

            <div className="review-row">
              <span className="review-label">Recipient gets</span>
              <span className="review-value font-tabular">{formatFinancialAmount(fundingQuote?.recipientAmount)} pathUSD</span>
            </div>

            <div className="review-row">
              <span className="review-label">Estimated network fee</span>
              <span className="review-value fee-sender-note">{fundingQuote?.estimatedFeeAmount ? `${formatFinancialAmount(fundingQuote.estimatedFeeAmount)} ${fundingQuote.estimatedFeeAmount.symbol}` : "Unavailable"}</span>
            </div>

            <div className="review-row">
              <span className="review-label">Estimated total deducted</span>
              <span className="review-value font-tabular">{fundingQuote?.estimatedTotalDebit.map((item) => `${formatFinancialAmount(item)} ${item.symbol}`).join(" + ") || "Unavailable"}</span>
            </div>

            <div className="review-row">
              <span className="review-label">Estimated balance after</span>
              <span className="review-value font-tabular">{fundingQuote?.estimatedRemainingBalance ? `${formatFinancialAmount(fundingQuote.estimatedRemainingBalance)} ${fundingQuote.estimatedRemainingBalance.symbol}` : "Unavailable"}</span>
            </div>

            {fundingQuote?.amountShortfall && <div className="review-row"><span className="review-label">Amount short</span><span className="review-value fee-sender-note">{formatFinancialAmount(fundingQuote.amountShortfall)} pathUSD</span></div>}

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
              onClick={() => void handleStartPreflightAndSign()}
              disabled={stage !== "READY_TO_SIGN" || submissionState !== "NOT_SUBMITTED" || preflightChecking || Boolean(preflightError)}
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
              ) : submissionState === "SUBMITTING" || submissionState === "HASH_RECEIVED" || submissionState === "SUBMITTED_WITH_HASH" || submissionState === "CONFIRMING_RECEIPT" || submissionState === "READING_PAYOUT" || submissionState === "CONFIRMING" || stage === "SIGNING" || stage === "CONFIRMING" ? (
                <div className="signing-status-row">
                  <div className="signing-spinner" />
                  <span>{submissionState === "CONFIRMING_RECEIPT" || stage === "CONFIRMING" ? "Confirming on Tempo..." : submissionState === "SUBMITTING" || submissionState === "HASH_RECEIVED" ? "Submitting..." : "Waiting for passkey..."}</span>
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
                    disabled={submissionState !== "NOT_SUBMITTED" || stage === "SIGNING" || stage === "CONFIRMING"}
                  >
                    <span>Cancel</span>
                  </button>
                  <button
                    type="button"
                    className="btn-primary btn-large btn-sign"
                    onClick={handleConfirmSign}
                    disabled={submissionState !== "NOT_SUBMITTED" || stage === "SIGNING" || stage === "CONFIRMING" || preflightChecking}
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
      </div>
    </div>
  );
}
