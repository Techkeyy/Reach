import { useState } from "react";

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
    void onCopy(claimLinkForClipboard(url)).then(() => setCopied(true)).catch(() => setCopied(false));
  };

  return (
    <div className="claim-link-panel">
      <span className="field-label">Claim link ready</span>
      <code data-testid="claim-link-display">{visible}</code>
      <div className="claim-link-actions">
        <button className="secondary-button" type="button" onClick={copy}>{copied ? "Copied" : "Copy claim link"}</button>
        <button className="secondary-button" type="button" onClick={() => setRevealed((value) => !value)}>{revealed ? "Hide link" : "Reveal link"}</button>
      </div>
      <p className="form-hint">Anyone with this link can claim the payout. Share it only with the intended recipient.</p>
    </div>
  );
}
