import React, { useState } from "react";
import type { Address } from "viem";
import { ArrowRightIcon, CheckCircleIcon, InfoIcon, LockIcon, SendIcon, AlertCircleIcon } from "./components/Icons";
import { abbreviateAddress } from "./AccountAddress";
import { formatPathUsd, parsePathUsdAmount, type BalanceState } from "./senderFlow";
import { validateWalletTransferInput } from "./walletTransfer";

export type WalletTransferUiState =
  | "IDLE"
  | "AWAITING_SIGNATURE"
  | "SUBMISSION_ATTEMPTED"
  | "CONFIRMING"
  | "RECOVERING"
  | "CONFIRMED"
  | "FAILED_BEFORE_SUBMISSION"
  | "SUBMISSION_UNCERTAIN"
  | "FAILED";

type WalletTransferExperienceProps = {
  connectedAddress?: string;
  balanceState: BalanceState;
  transferState: WalletTransferUiState;
  transferError: string | null;
  onConfirm: (recipient: Address, amount: string) => Promise<void>;
  onStartOver: () => void;
  onViewAccount: () => void;
};

export default function WalletTransferExperience({
  connectedAddress,
  balanceState,
  transferState,
  transferError,
  onConfirm,
  onStartOver,
  onViewAccount,
}: WalletTransferExperienceProps) {
  const [step, setStep] = useState<"FORM" | "REVIEW">("FORM");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const availableBalance = balanceState.status === "READY" ? BigInt(balanceState.balance || "0") : 0n;
  const amountBase = (() => {
    try { return parsePathUsdAmount(amount); } catch { return 0n; }
  })();
  const busy = transferState === "AWAITING_SIGNATURE" || transferState === "SUBMISSION_ATTEMPTED" || transferState === "CONFIRMING" || transferState === "RECOVERING";

  const review = () => {
    if (!connectedAddress) {
      setInputError("Connect your Reach account before sending to a wallet.");
      return;
    }
    try {
      validateWalletTransferInput({ sender: connectedAddress, recipient, amount, balance: availableBalance.toString() });
      setInputError(null);
      setStep("REVIEW");
    } catch (error) {
      setInputError(error instanceof Error ? error.message : "Check the recipient and amount.");
    }
  };

  const startOver = () => {
    setStep("FORM");
    setInputError(null);
    onStartOver();
  };

  if (transferState === "CONFIRMED") {
    return (
      <section className="wallet-transfer-success" aria-live="polite">
        <div className="success-icon-animated"><CheckCircleIcon size={48} /></div>
        <span className="success-eyebrow">Sent successfully</span>
        <h2 className="success-headline">${formatPathUsd(amountBase)} pathUSD</h2>
        <p className="success-subhead">to {abbreviateAddress(recipient)}</p>
        <div className="success-actions">
          <button type="button" className="btn-primary btn-large" onClick={onViewAccount}>View account</button>
          <button type="button" className="btn-secondary btn-large" onClick={startOver}><SendIcon size={18} /><span>Send again</span></button>
        </div>
      </section>
    );
  }

  return (
    <section className="wallet-transfer-card" aria-label="Send to wallet">
      <div className="wallet-transfer-heading">
        <span className="review-eyebrow">Direct transfer</span>
        <h2>Send to wallet</h2>
        <p>Send pathUSD directly to a Tempo wallet address.</p>
      </div>

      {step === "FORM" ? (
        <>
          <div className="wallet-transfer-fields">
            <label className="option-label" htmlFor="wallet-recipient">Recipient wallet address</label>
            <input
              id="wallet-recipient"
              type="text"
              inputMode="text"
              autoComplete="off"
              className="note-text-input"
              placeholder="0x..."
              value={recipient}
              onChange={(event) => { setRecipient(event.target.value); setInputError(null); }}
            />
            <label className="option-label" htmlFor="wallet-amount">Amount</label>
            <div className="wallet-amount-input">
              <span>$</span>
              <input
                id="wallet-amount"
                type="text"
                inputMode="decimal"
                className="amount-input-compact"
                placeholder="0.00"
                value={amount}
                onChange={(event) => { setAmount(event.target.value); setInputError(null); }}
              />
              <span>pathUSD</span>
            </div>
            <div className="available-balance-indicator">
              <span>Available {balanceState.status === "READY" ? `${formatPathUsd(availableBalance)} pathUSD` : "Checking..."}</span>
            </div>
          </div>

          <div className="review-notice-box">
            <InfoIcon size={16} className="notice-icon" />
            <span>Tempo network fees are paid by your Reach account. This transfer does not create a Reach payout or claim link.</span>
          </div>

          {inputError && <div className="amount-error-inline" role="alert"><AlertCircleIcon size={16} /><span>{inputError}</span></div>}
          <button type="button" className="btn-primary btn-large btn-full" onClick={review} disabled={balanceState.status !== "READY"}>
            <span>Review transfer</span><ArrowRightIcon size={18} />
          </button>
        </>
      ) : (
        <>
          <div className="review-breakdown-table">
            <div className="review-row"><span className="review-label">Amount</span><span className="review-value font-tabular">${formatPathUsd(amountBase)} pathUSD</span></div>
            <div className="review-row"><span className="review-label">To</span><span className="review-value"><code title={recipient}>{abbreviateAddress(recipient)}</code></span></div>
            <div className="review-row"><span className="review-label">Network</span><span className="review-value">Tempo Moderato</span></div>
            <div className="review-row"><span className="review-label">Payout type</span><span className="review-value">Direct wallet transfer</span></div>
            <div className="review-row"><span className="review-label">Network fee</span><span className="review-value fee-sender-note">Paid by your Reach account</span></div>
          </div>

          {transferError && <div className="preflight-error-banner" role="alert"><AlertCircleIcon size={18} /><span>{transferError}</span></div>}
          {transferState === "SUBMISSION_UNCERTAIN" && <p className="wallet-transfer-recovery">Check Activity before retrying. Reach will not blindly submit a duplicate transfer.</p>}
          {transferState === "FAILED_BEFORE_SUBMISSION" && <p className="wallet-transfer-recovery">No transfer was submitted. Your funds were not moved.</p>}

          <div className="review-cta-bar">
            <button type="button" className="btn-secondary btn-large" onClick={() => { setStep("FORM"); setInputError(null); }} disabled={busy}><span>Back</span></button>
            <button type="button" className="btn-primary btn-large" onClick={() => void onConfirm(recipient as Address, amount)} disabled={busy || transferState !== "IDLE"}>
              <LockIcon size={18} /><span>{busy ? "Confirming..." : "Confirm with passkey"}</span>
            </button>
          </div>
          {(transferState === "FAILED" || transferState === "FAILED_BEFORE_SUBMISSION" || transferState === "SUBMISSION_UNCERTAIN") && (
            <button type="button" className="btn-text-action" onClick={startOver}>Start over</button>
          )}
        </>
      )}
    </section>
  );
}
