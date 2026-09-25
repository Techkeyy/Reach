import { useState } from "react";
import { CopyIcon, EyeIcon, EyeOffIcon, CheckIcon, ShieldCheckIcon } from "./components/Icons";

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
        setTimeout(() => setCopied(false), 3000);
      })
      .catch(() => setCopied(false));
  };

  return (
    <div className="claim-link-panel">
      <div className="claim-link-header">
        <div className="claim-link-title-row">
          <ShieldCheckIcon size={18} className="text-mint" />
          <span className="field-label">Claim link ready</span>
        </div>
        <span className="status-pill status-pill-success">Ready to share</span>
      </div>

      <div className="claim-link-box">
        <code data-testid="claim-link-display">{visible}</code>
      </div>

      <div className="claim-link-actions">
        <button className="claim-button compact-claim-btn" type="button" onClick={copy}>
          {copied ? (
            <>
              <span>Copied to clipboard</span>
              <CheckIcon size={18} />
            </>
          ) : (
            <>
              <span>Copy claim link</span>
              <CopyIcon size={18} />
            </>
          )}
        </button>
        <button
          className="secondary-button compact-btn"
          type="button"
          onClick={() => setRevealed((value) => !value)}
        >
          {revealed ? (
            <>
              <EyeOffIcon size={16} />
              <span>Hide link</span>
            </>
          ) : (
            <>
              <EyeIcon size={16} />
              <span>Reveal link</span>
            </>
          )}
        </button>
      </div>

      <div className="claim-link-warnings">
        <div className="warning-callout">
          <p className="form-hint">
            Anyone with this link can claim the payout. Share it only with the intended recipient.
          </p>
        </div>
        <p className="form-hint security-note">
          Save or share this link now. Reach cannot recreate it later.
        </p>
      </div>
    </div>
  );
}
