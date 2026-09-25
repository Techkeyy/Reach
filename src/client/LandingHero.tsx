import React from "react";
import { PasskeyIcon, LinkIcon, ShieldCheckIcon, SendIcon, WalletIcon, SparklesIcon } from "./components/Icons";

type LandingHeroProps = {
  onStartSend: () => void;
};

export default function LandingHero({ onStartSend }: LandingHeroProps) {
  return (
    <section className="landing-section" aria-label="Reach Overview">
      <div className="landing-hero-content">
        <div className="hero-pill-badge">
          <SparklesIcon size={14} className="hero-badge-icon" />
          <span>Walletless Payout Infrastructure on Tempo</span>
        </div>
        
        <h1 className="hero-headline">
          Pay people, not <span className="text-gradient-mint">wallet addresses</span>.
        </h1>
        
        <p className="hero-subhead">
          Send pathUSD to anyone with a simple link. The recipient claims in seconds with a device passkey. Zero gas fees, zero browser extensions, zero private key management.
        </p>
        
        <div className="hero-cta-group">
          <button className="claim-button hero-cta-btn" type="button" onClick={onStartSend}>
            <span>Create a payout</span>
            <SendIcon size={18} />
          </button>
        </div>
      </div>

      <div className="flow-steps-grid">
        <div className="flow-step-card">
          <div className="step-number-badge">1</div>
          <div className="step-icon-wrapper">
            <WalletIcon size={22} />
          </div>
          <h3>Fund with your passkey</h3>
          <p>
            Approve the payout amount directly from your Tempo passkey account. Reach never touches your sender keys.
          </p>
        </div>

        <div className="flow-step-card">
          <div className="step-number-badge">2</div>
          <div className="step-icon-wrapper">
            <LinkIcon size={22} />
          </div>
          <h3>Share the private link</h3>
          <p>
            Get a secure, single-use claim link containing the encrypted claim capability in the URL fragment.
          </p>
        </div>

        <div className="flow-step-card">
          <div className="step-number-badge">3</div>
          <div className="step-icon-wrapper">
            <PasskeyIcon size={22} />
          </div>
          <h3>Instant recipient claim</h3>
          <p>
            Recipient taps claim with Touch ID, Face ID, or Windows Hello. Reach sponsors the gas transaction on Tempo.
          </p>
        </div>
      </div>

      <div className="trust-banner">
        <div className="trust-item">
          <ShieldCheckIcon size={20} className="trust-icon" />
          <div>
            <strong>Non-Custodial Escrow</strong>
            <span>Funds stay locked in the smart contract vault until claimed or reclaimed.</span>
          </div>
        </div>
        <div className="trust-item">
          <PasskeyIcon size={20} className="trust-icon" />
          <div>
            <strong>Native WebAuthn</strong>
            <span>Hardware-grade passkey security powered by Tempo Moderato account abstraction.</span>
          </div>
        </div>
      </div>
    </section>
  );
}
