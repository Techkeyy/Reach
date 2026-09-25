import React, { useState } from "react";
import { CopyIcon, CheckIcon, EyeIcon, EyeOffIcon, LockIcon, AlertCircleIcon } from "./components/Icons";

export type SenderClaimLinkProps = {
  url: string;
  onCopy: (url: string) => Promise<void>;
};

export function maskClaimLink(url: string): string {
  const fragmentStart = url.indexOf("#");
  return `${fragmentStart >= 0 ? url.slice(0, fragmentStart) : url}#[REDACTED]`;
}

export function visibleClaimLink(url: string, revealed: boolean): string {
  return revealed ? url : maskClaimLink(url);
}

export function claimLinkForClipboard(url: string): string {
  return url;
}

export default function SenderClaimLink({ url, onCopy }: SenderClaimLinkProps) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const visible = visibleClaimLink(url, revealed);

  const copy = () => {
    setCopied(false);
    void onCopy(claimLinkForClipboard(url))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      })
      .catch(() => setCopied(false));
  };

  return (
    <div className="claim-link-box">
      <div className="claim-link-header">
        <div className="claim-link-title">
          <LockIcon size={16} />
          <span>Private Claim Link</span>
        </div>
        <button
          type="button"
          className="link-toggle-btn"
          onClick={() => setRevealed((prev) => !prev)}
          aria-label={revealed ? "Hide full link" : "Reveal full link"}
        >
          {revealed ? <EyeOffIcon size={14} /> : <EyeIcon size={14} />}
          <span>{revealed ? "Hide" : "Reveal"}</span>
        </button>
      </div>

      <div className="claim-link-display-row">
        <code className="claim-link-code" data-testid="claim-link-display">
          {visible}
        </code>
        <button
          type="button"
          className={`btn-copy ${copied ? "btn-copied" : "btn-primary"}`}
          onClick={copy}
        >
          {copied ? (
            <>
              <CheckIcon size={16} />
              <span>Copied</span>
            </>
          ) : (
            <>
              <CopyIcon size={16} />
              <span>Copy link</span>
            </>
          )}
        </button>
      </div>

      <div className="claim-link-warnings">
        <div className="warning-row">
          <AlertCircleIcon size={15} className="warning-icon" />
          <span>Anyone with this link can claim the payout. Share it only with the intended recipient.</span>
        </div>
        <div className="warning-row">
          <AlertCircleIcon size={15} className="warning-icon" />
          <span>Save or share this link now. Reach cannot recreate it later.</span>
        </div>
      </div>
    </div>
  );
}
