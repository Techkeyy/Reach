import React, { useState } from "react";
import { CheckIcon, CloseIcon, CopyIcon, FingerprintIcon, GlobeIcon, KeyIcon, SettingsIcon, ShieldCheckIcon, TerminalIcon } from "./components/Icons";

type SettingsExperienceProps = {
  connectedAddress?: string;
  pathUsdBalance?: string;
  onOpenAgents: () => void;
  onOpenFunding: () => void;
  onSignOut: () => void;
  isSigningOut: boolean;
};

function shortAddress(address?: string) {
  return address ? `${address.slice(0, 8)}…${address.slice(-6)}` : "Not connected";
}

export default function SettingsExperience({
  connectedAddress,
  pathUsdBalance,
  onOpenAgents,
  onOpenFunding,
  onSignOut,
  isSigningOut,
}: SettingsExperienceProps) {
  const [copied, setCopied] = useState(false);

  const copyAddress = async () => {
    if (!connectedAddress) return;
    await navigator.clipboard.writeText(connectedAddress);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="settings-experience">
      <header className="page-heading settings-heading">
        <div>
          <p className="page-kicker">Account</p>
          <h1>Settings</h1>
          <p>Review your passkey account, network and payment permissions.</p>
        </div>
        <div className="page-heading-icon" aria-hidden="true"><SettingsIcon size={22} /></div>
      </header>

      <section className="settings-card account-settings-card" aria-labelledby="account-settings-title">
        <div className="settings-card-heading">
          <div className="settings-icon-tile"><FingerprintIcon size={20} /></div>
          <div>
            <h2 id="account-settings-title">Passkey account</h2>
            <p>Your Reach account is controlled by your passkey. No seed phrase or wallet extension is required.</p>
          </div>
        </div>

        <div className="settings-detail-row">
          <span className="settings-detail-label">Account address</span>
          <div className="settings-address-value">
            <code title={connectedAddress}>{shortAddress(connectedAddress)}</code>
            <button type="button" className="icon-button" onClick={copyAddress} disabled={!connectedAddress} aria-label="Copy account address">
              {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
            </button>
          </div>
        </div>
        <div className="settings-detail-row">
          <span className="settings-detail-label">Available balance</span>
          <strong>{pathUsdBalance ? `$${pathUsdBalance} pathUSD` : "Balance unavailable"}</strong>
        </div>
        <div className="settings-detail-row">
          <span className="settings-detail-label">Authentication</span>
          <span className="settings-status"><span className="settings-status-dot" /> Passkey active</span>
        </div>
      </section>

      <section className="settings-card" aria-labelledby="network-settings-title">
        <div className="settings-card-heading">
          <div className="settings-icon-tile"><GlobeIcon size={20} /></div>
          <div>
            <h2 id="network-settings-title">Network</h2>
            <p>Reach is currently connected to the Tempo Moderato testnet.</p>
          </div>
        </div>
        <div className="settings-network-callout">
          <span className="network-dot" />
          <div><strong>Tempo Moderato</strong><span>Testnet · play money only</span></div>
        </div>
        <button type="button" className="settings-link-row" onClick={onOpenFunding}>
          <span><KeyIcon size={17} /><span>Manage funding</span></span>
          <span aria-hidden="true">→</span>
        </button>
      </section>

      <section className="settings-card" aria-labelledby="permissions-settings-title">
        <div className="settings-card-heading">
          <div className="settings-icon-tile"><ShieldCheckIcon size={20} /></div>
          <div>
            <h2 id="permissions-settings-title">Permissions</h2>
            <p>Agent approvals are scoped, visible and revocable from the Agents screen.</p>
          </div>
        </div>
        <button type="button" className="settings-link-row" onClick={onOpenAgents}>
          <span><TerminalIcon size={17} /><span>Review agent access</span></span>
          <span aria-hidden="true">→</span>
        </button>
      </section>

      <section className="settings-card settings-signout-card" aria-labelledby="session-settings-title">
        <div className="settings-card-heading">
          <div className="settings-icon-tile"><CloseIcon size={20} /></div>
          <div>
            <h2 id="session-settings-title">End session</h2>
            <p>Sign out of this Reach session on the current device. Your account and records remain recoverable with your passkey.</p>
          </div>
        </div>
        <button type="button" className="btn-secondary settings-signout-button" onClick={onSignOut} disabled={isSigningOut}>
          {isSigningOut ? "Signing out…" : "Sign out"}
        </button>
      </section>
    </div>
  );
}
