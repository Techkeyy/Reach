import React, { useEffect, useState } from "react";
import {
  ReachLogo,
  SendIcon,
  PasskeyIcon,
  LinkIcon,
  ShieldCheckIcon,
  CheckCircleIcon,
  ArrowRightIcon,
  ClockIcon,
  LockIcon,
  SparklesIcon,
  ExternalLinkIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ZapIcon,
  CrossIcon,
  FingerprintIcon,
  GlobeIcon,
  KeyIcon,
  DatabaseIcon,
} from "./components/Icons";
import { Reveal, RevealGroup } from "./components/Reveal";

type LandingHeroProps = {
  onStartSend: () => void;
  onConnectWallet: () => void;
  onRetryPasskey: () => void;
  onUseAnotherPasskey: () => void;
  isConnected: boolean;
  connectedAddress?: string;
  authBusy: boolean;
  authError: string | null;
};

export default function LandingHero({
  onStartSend,
  onConnectWallet,
  onRetryPasskey,
  onUseAnotherPasskey,
  isConnected,
  connectedAddress,
  authBusy,
  authError,
}: LandingHeroProps) {
  // Reactive Hero sequence animation state (0 to 4)
  const [heroStep, setHeroStep] = useState(0);
  const [activeFaq, setActiveFaq] = useState<number | null>(null);
  const [techOpen, setTechOpen] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setHeroStep(4);
      return;
    }

    const interval = setInterval(() => {
      setHeroStep((prev) => (prev + 1) % 5);
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
  };

  const toggleFaq = (index: number) => {
    setActiveFaq((prev) => (prev === index ? null : index));
  };

  return (
    <div className="landing-container">
      {/* Top Navigation */}
      <header className="landing-nav">
        <div className="landing-nav-inner">
          <div className="landing-brand" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
            <ReachLogo size={28} />
            <span className="brand-text">reach<span className="brand-dot">.</span></span>
          </div>

          <nav className="landing-nav-links" aria-label="Main Navigation">
            <button type="button" className="nav-link" onClick={() => scrollToSection("overview")}>
              Overview
            </button>
            <button type="button" className="nav-link" onClick={() => scrollToSection("how-it-works")}>
              How it works
            </button>
            <button type="button" className="nav-link" onClick={() => scrollToSection("built-on-tempo")}>
              Built on Tempo
            </button>
            <button type="button" className="nav-link" onClick={() => scrollToSection("security")}>
              Security
            </button>
            <button type="button" className="nav-link" onClick={() => scrollToSection("faq")}>
              FAQ
            </button>
          </nav>

          <div className="landing-nav-actions">
            <div className="nav-network-indicator" title="Connected to Tempo Moderato Testnet">
              <span className="network-live-pulse" />
              <span className="network-text">Tempo Moderato</span>
            </div>

            {isConnected ? (
              <button type="button" className="btn-secondary nav-btn" onClick={onStartSend}>
                <span className="connected-dot" />
                {connectedAddress ? `${connectedAddress.slice(0, 6)}...${connectedAddress.slice(-4)}` : "Open App"}
              </button>
            ) : null}

            <button type="button" className="btn-primary nav-btn" onClick={onStartSend} disabled={authBusy}>
              {authBusy ? "Signing in..." : "Launch Reach"} <ArrowRightIcon size={16} />
            </button>
          </div>
        </div>
      </header>

      {/* SECTION 1: 12-Column Desktop Product Dashboard Hero */}
      <section id="overview" className="hero-section">
        <div className="hero-layout">
          <div className="hero-content">
            <div className="hero-badge">
              <SparklesIcon size={14} className="hero-badge-icon" />
              <span>Walletless Payout Protocol</span>
            </div>

            <h1 className="hero-title">
              Pay people,<br />
              <span className="hero-title-highlight">not wallet addresses.</span>
            </h1>

            <p className="hero-description">
              Create a funded payout. Share one private link. They claim with a passkey. Recipient needs no existing wallet and pays zero gas.
            </p>

            <div className="hero-ctas">
              <button type="button" className="btn-primary btn-large" onClick={onStartSend} disabled={authBusy}>
                {authBusy ? "Signing in..." : "Launch Reach"} <ArrowRightIcon size={18} />
              </button>
              <button type="button" className="btn-secondary btn-large" onClick={() => scrollToSection("how-it-works")}>
                See how it works
              </button>
            </div>

            {authBusy ? (
              <div className="auth-progress" role="status" aria-live="polite">
                Signing you in with your passkey...
              </div>
            ) : null}

            {authError ? (
              <div className="auth-failure-card" role="alert" aria-live="assertive">
                <strong>{authError}</strong>
                <p>Nothing was changed. Try your passkey again or choose another one.</p>
                <div className="auth-failure-actions">
                  <button type="button" className="btn-primary btn-sm" onClick={onRetryPasskey}>
                    Try again
                  </button>
                  <button type="button" className="btn-secondary btn-sm" onClick={onUseAnotherPasskey}>
                    Use another passkey
                  </button>
                </div>
              </div>
            ) : null}

            {/* Fluenci-style System Proof Bar */}
            <div className="hero-proof-bar">
              <div className="proof-pill">
                <span className="proof-dot live-dot" />
                <span>Tempo Moderato</span>
              </div>
              <div className="proof-pill">
                <span className="proof-dot" />
                <span>pathUSD Token</span>
              </div>
              <div className="proof-pill">
                <span className="proof-dot" />
                <span>Sponsored Claim</span>
              </div>
              <div className="proof-pill">
                <span className="proof-dot" />
                <span>Non-Custodial Vault</span>
              </div>
            </div>
          </div>

          {/* Right Column: Layered Live Interactive Product Stage */}
          <div className="hero-visual" aria-hidden="true">
            <div className="interactive-hero-stage">
              <div className="stage-top-bar">
                <span className="stage-title">Product preview</span>
                <span className="stage-step-pill">
                  {heroStep === 0 && "1. Entering Amount"}
                  {heroStep === 1 && "2. Vault Funded"}
                  {heroStep === 2 && "3. Link Generated"}
                  {heroStep === 3 && "4. Recipient Ready"}
                  {heroStep === 4 && "5. Payout Settled"}
                </span>
              </div>

              {/* Sender Card */}
              <div className={`hero-card hero-sender-card ${heroStep >= 1 ? "card-completed" : "card-active"}`}>
                <div className="hero-card-header">
                  <div className="hero-card-label">
                    <SendIcon size={16} />
                    <span>Sender Payout</span>
                  </div>
                  <span className={`hero-status-pill ${heroStep >= 1 ? "status-funded" : ""}`}>
                    {heroStep >= 1 ? "Funded onchain" : "Ready to fund"}
                  </span>
                </div>
                <div className="hero-amount-box">
                  <span className="hero-currency">$</span>
                  <span className="hero-amount">250.00</span>
                  <span className="hero-token">pathUSD</span>
                </div>
                <div className="hero-sender-meta">
                  <div className="meta-row">
                    <span>Expiry window</span>
                    <span className="meta-value">24 hours</span>
                  </div>
                  <div className="meta-row">
                    <span>Vault</span>
                    <span className="meta-value">Non-Custodial</span>
                  </div>
                </div>
              </div>

              {/* Animated Link Connector Beam */}
              <div className={`hero-link-connector ${heroStep >= 2 ? "connector-active" : ""}`}>
                <div className="link-chip">
                  <LinkIcon size={14} />
                  <span>reach.link/c/1790060937954#[REDACTED]</span>
                </div>
              </div>

              {/* Recipient Claim Card */}
              <div className={`hero-card hero-recipient-card ${heroStep >= 3 ? (heroStep >= 4 ? "card-claimed" : "card-active") : "card-waiting"}`}>
                <div className="hero-card-header">
                  <div className="hero-card-label">
                    <PasskeyIcon size={16} />
                    <span>Recipient Claim</span>
                  </div>
                  <span className={`hero-status-pill ${heroStep >= 4 ? "status-success" : heroStep >= 3 ? "status-ready" : ""}`}>
                    {heroStep >= 4 ? "Settled" : heroStep >= 3 ? "Ready to claim" : "Awaiting link"}
                  </span>
                </div>

                <div className="hero-recipient-body">
                  <div className="recipient-prompt">
                    {heroStep >= 4 ? "$250.00 pathUSD Settled" : "You received $250.00"}
                  </div>
                  <div className="recipient-sub">
                    {heroStep >= 4 ? "Secured by device passkey on Tempo" : "No gas payment needed to claim"}
                  </div>

                  <div className="recipient-action-area">
                    {heroStep >= 4 ? (
                      <div className="recipient-done-badge">
                        <CheckCircleIcon size={16} />
                        <span>Claim Complete</span>
                      </div>
                    ) : (
                      <div className={`mock-claim-btn ${heroStep >= 3 ? "btn-pulse" : ""}`}>
                        <FingerprintIcon size={16} />
                        <span>Claim with Passkey</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Flow Stepper Navigation Dots */}
              <div className="hero-stepper">
                {[0, 1, 2, 3, 4].map((step) => (
                  <button
                    key={step}
                    type="button"
                    className={`stepper-dot ${heroStep === step ? "dot-active" : ""}`}
                    onClick={() => setHeroStep(step)}
                    aria-label={`View step ${step + 1}`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 2: Fluenci Dark Manifesto Section */}
      <section className="manifesto-section">
        <Reveal>
          <div className="manifesto-card">
            <p className="manifesto-text">
              Most crypto payouts fail the usability test before they even start.
              They force senders to collect a 42-character hex address, verify supported networks, and hope the recipient knows how to manage gas tokens.
            </p>
            <p className="manifesto-highlight">
              Reach reverses that entire model: fund a payout in seconds, share one private bearer link, and let the recipient claim directly into a passkey-secured account without ever touching gas.
            </p>
          </div>
        </Reveal>
      </section>

      {/* SECTION 3: What Web3 Payouts Get Wrong (Fluenci 2-Column Split) */}
      <section className="fixing-section">
        <div className="fixing-layout">
          <div className="fixing-left">
            <Reveal>
              <span className="section-eyebrow">The Core Problem</span>
              <h2 className="section-title">What Web3 Payouts Get Wrong</h2>
              <p className="section-subtitle">
                Three friction points break stablecoin payouts today: requiring pre-existing addresses, forcing recipients to hold gas tokens, and irreversible loss from mistyped destinations. Reach fixes all three on Tempo.
              </p>
            </Reveal>
          </div>

          <div className="fixing-right">
            <Reveal delayMs={0} className="problem-card">
              <div className="problem-icon-circle">
                <ShieldCheckIcon size={22} />
              </div>
              <div className="problem-card-content">
                <h3 className="problem-card-title">No Address Collection Needed</h3>
                <p className="problem-card-text">
                  Send money without asking for a 42-character address beforehand. The recipient creates their account instantly upon claiming the link.
                </p>
              </div>
            </Reveal>

            <Reveal delayMs={100} className="problem-card">
              <div className="problem-icon-circle">
                <ZapIcon size={22} />
              </div>
              <div className="problem-card-content">
                <h3 className="problem-card-title">Sponsored Recipient Claims</h3>
                <p className="problem-card-text">
                  Recipients authenticate with biometric hardware passkeys (Face ID, Touch ID, Windows Hello). Reach covers all transaction fees on Tempo.
                </p>
              </div>
            </Reveal>

            <Reveal delayMs={200} className="problem-card">
              <div className="problem-icon-circle">
                <ClockIcon size={22} />
              </div>
              <div className="problem-card-content">
                <h3 className="problem-card-title">Sender-Controlled Return of Expired Funds</h3>
                <p className="problem-card-text">
                  If an unclaimed payout expires, the sender retains 100% unilateral reclaim rights back to their vault balance. Zero lost transfers.
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* SECTION 4: How Reach Moves Money (4-Step Workflow) */}
      <section id="how-it-works" className="story-section">
        <div className="section-header">
          <Reveal>
            <span className="section-eyebrow">Protocol Architecture</span>
            <h2 className="section-title">How Reach moves money</h2>
            <p className="section-subtitle">
              From deposit to recipient settlement in four transparent, non-custodial stages.
            </p>
          </Reveal>
        </div>

        <div className="steps-grid-4">
          <Reveal delayMs={0} className="step-card">
            <div className="step-number">01</div>
            <div className="step-icon-box">
              <SendIcon size={22} />
            </div>
            <h3 className="step-title">Fund</h3>
            <p className="step-text">
              Sender deposits pathUSD into the non-custodial smart vault on Tempo. Preflight verifies network fees before wallet signing.
            </p>
            <div className="step-badge">Sender pays standard gas</div>
          </Reveal>

          <Reveal delayMs={80} className="step-card">
            <div className="step-number">02</div>
            <div className="step-icon-box">
              <LinkIcon size={22} />
            </div>
            <h3 className="step-title">Share</h3>
            <p className="step-text">
              Browser derives a private bearer claim capability. Share via WhatsApp, iMessage, SMS, or email. Only the link holder can claim.
            </p>
            <div className="step-badge">End-to-end private</div>
          </Reveal>

          <Reveal delayMs={160} className="step-card">
            <div className="step-number">03</div>
            <div className="step-icon-box">
              <PasskeyIcon size={22} />
            </div>
            <h3 className="step-title">Claim</h3>
            <p className="step-text">
              Recipient opens the link on phone or desktop. Authenticates with a device passkey in under five seconds.
            </p>
            <div className="step-badge">No gas payment needed</div>
          </Reveal>

          <Reveal delayMs={240} className="step-card">
            <div className="step-number">04</div>
            <div className="step-icon-box">
              <CheckCircleIcon size={22} />
            </div>
            <h3 className="step-title">Settle</h3>
            <p className="step-text">
              Reach relay executes the claim on Tempo. pathUSD transfers instantly into recipient custody, and sender sees live settlement.
            </p>
            <div className="step-badge">Instant finality</div>
          </Reveal>
        </div>
      </section>

      {/* SECTION 5: Built on Tempo Moderato (Fluenci-Style Modular Grid) */}
      <section id="built-on-tempo" className="modular-section">
        <div className="section-header">
          <Reveal>
            <span className="section-eyebrow">Infrastructure Stack</span>
            <h2 className="section-title">Built on Tempo Moderato</h2>
            <p className="section-subtitle">
              Reach combines sub-second financial rails with modern hardware cryptography for effortless payouts.
            </p>
          </Reveal>
        </div>

        <div className="modular-grid">
          <Reveal delayMs={0} className="modular-card">
            <div className="modular-card-header">
              <GlobeIcon size={24} className="modular-icon" />
              <span className="modular-status-pill">Integrated</span>
            </div>
            <h3 className="modular-title">Tempo Moderato</h3>
            <p className="modular-desc">
              High-throughput blockchain with sub-second finality (Chain ID 42431). Deterministic execution and ultra-low settlement latency.
            </p>
            <div className="modular-footer-code">
              <span>Chain ID</span>
              <code>42431</code>
            </div>
          </Reveal>

          <Reveal delayMs={80} className="modular-card">
            <div className="modular-card-header">
              <ZapIcon size={24} className="modular-icon" />
              <span className="modular-status-pill">Native Asset</span>
            </div>
            <h3 className="modular-title">pathUSD Stablecoin</h3>
            <p className="modular-desc">
              Stable digital currency backed by the Tempo ecosystem. Settles payouts in real-time to eliminate price volatility.
            </p>
            <div className="modular-footer-code">
              <span>Token</span>
              <code>0x20c0...0000</code>
            </div>
          </Reveal>

          <Reveal delayMs={160} className="modular-card">
            <div className="modular-card-header">
              <DatabaseIcon size={24} className="modular-icon" />
              <span className="modular-status-pill">Non-Custodial</span>
            </div>
            <h3 className="modular-title">Reach Smart Vault</h3>
            <p className="modular-desc">
              Audited vault contract holding sender principal. Funds remain immutable until claimed or unilaterally returned by the sender.
            </p>
            <div className="modular-footer-code">
              <span>Vault</span>
              <code>0x9826...266c</code>
            </div>
          </Reveal>

          <Reveal delayMs={240} className="modular-card">
            <div className="modular-card-header">
              <FingerprintIcon size={24} className="modular-icon" />
              <span className="modular-status-pill">Hardware Enclave</span>
            </div>
            <h3 className="modular-title">WebAuthn Passkeys</h3>
            <p className="modular-desc">
              Biometric onboarding via W3C WebAuthn standards. Private keys never leave the recipient device enclave. Zero seed phrase friction.
            </p>
            <div className="modular-footer-code">
              <span>Standard</span>
              <code>W3C FIDO2</code>
            </div>
          </Reveal>
        </div>
      </section>

      {/* SECTION 6: Comparison Matrix (Fluenci Style) */}
      <section className="matrix-section">
        <div className="section-header">
          <Reveal>
            <span className="section-eyebrow">Direct Comparison</span>
            <h2 className="section-title">Standard Crypto Transfers vs. Reach</h2>
            <p className="section-subtitle">
              The difference is whether your recipient has to struggle with wallet setup and gas before they can receive payment.
            </p>
          </Reveal>
        </div>

        <Reveal>
          <div className="matrix-table-container">
            <table className="matrix-table">
              <thead>
                <tr>
                  <th className="th-feature">Feature</th>
                  <th className="th-standard">Standard Crypto Transfer</th>
                  <th className="th-reach">Reach Payout</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="td-feature">Recipient Setup Needed</td>
                  <td className="td-standard">
                    <span className="matrix-cross"><CrossIcon size={14} /> Must install wallet app first</span>
                  </td>
                  <td className="td-reach">
                    <span className="matrix-check"><CheckCircleIcon size={16} /> No setup needed before receiving</span>
                  </td>
                </tr>
                <tr>
                  <td className="td-feature">Address Exchange</td>
                  <td className="td-standard">
                    <span className="matrix-cross"><CrossIcon size={14} /> Must collect 42-character address</span>
                  </td>
                  <td className="td-reach">
                    <span className="matrix-check"><CheckCircleIcon size={16} /> Zero address exchange needed</span>
                  </td>
                </tr>
                <tr>
                  <td className="td-feature">Claim Gas Payment</td>
                  <td className="td-standard">
                    <span className="matrix-cross"><CrossIcon size={14} /> Recipient must buy & hold gas</span>
                  </td>
                  <td className="td-reach">
                    <span className="matrix-check"><CheckCircleIcon size={16} /> No gas payment needed to claim</span>
                  </td>
                </tr>
                <tr>
                  <td className="td-feature">Unclaimed / Expired Funds</td>
                  <td className="td-standard">
                    <span className="matrix-cross"><CrossIcon size={14} /> Permanently lost if sent wrong</span>
                  </td>
                  <td className="td-reach">
                    <span className="matrix-check"><CheckCircleIcon size={16} /> Sender can reclaim 100% of funds</span>
                  </td>
                </tr>
                <tr>
                  <td className="td-feature">Authentication</td>
                  <td className="td-standard">
                    <span className="matrix-cross"><CrossIcon size={14} /> Seed phrases & browser extensions</span>
                  </td>
                  <td className="td-reach">
                    <span className="matrix-check"><CheckCircleIcon size={16} /> Hardware Passkey (Face ID / Touch ID)</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Reveal>
      </section>

      {/* SECTION 7: Security & Non-Custodial Control */}
      <section id="security" className="security-section">
        <Reveal>
          <div className="security-card">
            <div className="security-header">
              <div className="security-icon-circle">
                <ShieldCheckIcon size={28} />
              </div>
              <div>
                <h3 className="security-title">Your money stays under your control</h3>
                <p className="security-subtitle">
                  Reach never custodies your funds. All deposits, claims, and returns are enforced by smart contracts on Tempo.
                </p>
              </div>
            </div>

            <div className="security-features-grid">
              <div className="security-feature">
                <LockIcon size={20} className="feature-icon" />
                <div>
                  <h4>Non-Custodial Vault</h4>
                  <p>Funds remain locked in the payout vault until claimed. Reach cannot withdraw sender principal.</p>
                </div>
              </div>

              <div className="security-feature">
                <KeyIcon size={20} className="feature-icon" />
                <div>
                  <h4>Private Bearer Capability</h4>
                  <p>Only the recipient with the private claim link can authorize the withdrawal to their passkey address.</p>
                </div>
              </div>

              <div className="security-feature">
                <ClockIcon size={20} className="feature-icon" />
                <div>
                  <h4>Sender Return Rights</h4>
                  <p>Unclaimed payouts can be returned directly to the sender wallet at any time once the expiration window passes.</p>
                </div>
              </div>

              <div className="security-feature">
                <ZapIcon size={20} className="feature-icon" />
                <div>
                  <h4>Sponsored Relay Architecture</h4>
                  <p>Reach sponsors the recipient claim transaction through gas-guarded relays without modifying payout value.</p>
                </div>
              </div>
            </div>

            {/* Expandable Technical Proof Drawer */}
            <div className="technical-drawer">
              <button
                type="button"
                className="technical-drawer-toggle"
                onClick={() => setTechOpen(!techOpen)}
                aria-expanded={techOpen}
              >
                <span>Technical Specifications & Verification</span>
                <ChevronDownIcon size={16} className={`drawer-caret ${techOpen ? "caret-open" : ""}`} />
              </button>

              {techOpen && (
                <div className="technical-drawer-body">
                  <div className="tech-spec-row">
                    <span className="tech-label">Contract</span>
                    <span className="tech-val">ReachPayoutVault (v1.0.0)</span>
                  </div>
                  <div className="tech-spec-row">
                    <span className="tech-label">Vault Address</span>
                    <code>0x98262c02746f3b91342249159deeebe87a54266c</code>
                  </div>
                  <div className="tech-spec-row">
                    <span className="tech-label">Token Address</span>
                    <code>0x20c0000000000000000000000000000000000000</code>
                  </div>
                  <div className="tech-spec-row">
                    <span className="tech-label">Chain</span>
                    <span className="tech-val">Tempo Moderato (Chain ID 42431)</span>
                  </div>
                  <div className="tech-spec-row">
                    <span className="tech-label">Authorization Model</span>
                    <span className="tech-val">EIP-712 Typed Bearer Claim Capability</span>
                  </div>
                  <div className="tech-spec-row">
                    <span className="tech-label">Onboarding</span>
                    <span className="tech-val">W3C WebAuthn Hardware Authenticator</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </Reveal>
      </section>

      {/* SECTION 8: Frequently Asked Questions (Fluenci Accordion Style) */}
      <section id="faq" className="faq-section">
        <div className="section-header">
          <Reveal>
            <span className="section-eyebrow">Clear Answers</span>
            <h2 className="section-title">Frequently Asked Questions</h2>
            <p className="section-subtitle">
              How the protocol behaves, how funds are protected, and what to expect.
            </p>
          </Reveal>
        </div>

        <div className="faq-accordion-list">
          {[
            {
              id: "01",
              q: "How does a recipient claim money without an existing wallet?",
              a: "When the recipient opens the private claim link, Reach prompts them to verify with Face ID, Touch ID, or Windows Hello. This creates a secure passkey address in their device hardware enclave in seconds. No wallet app or extension is needed.",
            },
            {
              id: "02",
              q: "Who covers the transaction fee when claiming?",
              a: "Reach sponsors the recipient claim transaction fee on Tempo. The recipient does not need to hold or buy any native gas tokens. They receive 100% of the funded pathUSD amount.",
            },
            {
              id: "03",
              q: "What happens if the recipient never claims the link before it expires?",
              a: "When you create a payout, you specify an expiration window (such as 24 hours). If the payout remains unclaimed after that timestamp, you can click Return Funds in your Activity feed to return 100% of the principal directly back to your wallet.",
            },
            {
              id: "04",
              q: "Can anyone who gets the link claim the funds?",
              a: "The bearer link contains a private cryptographic secret in its URL fragment that authorizes the claim. Once claimed, the contract marks the payout as CLAIMED and transfers the funds immediately. Treat the claim link like cash and send it only to your intended recipient.",
            },
            {
              id: "05",
              q: "Is Reach a custodial service or escrow company?",
              a: "No. Reach is non-custodial software on Tempo. Payout funds are deposited directly into the open-source ReachPayoutVault smart contract. Reach operators cannot access, freeze, or redirect your deposits.",
            },
            {
              id: "06",
              q: "Which tokens and networks are supported?",
              a: "Reach currently operates on the Tempo Moderato network (Chain ID 42431) with pathUSD stablecoins.",
            },
          ].map((item, idx) => (
            <Reveal key={item.id} delayMs={idx * 40} className="faq-item">
              <button
                type="button"
                className="faq-question-btn"
                onClick={() => toggleFaq(idx)}
                aria-expanded={activeFaq === idx}
              >
                <span className="faq-number">{item.id}</span>
                <span className="faq-question-text">{item.q}</span>
                <ChevronDownIcon size={18} className={`faq-caret ${activeFaq === idx ? "caret-open" : ""}`} />
              </button>
              {activeFaq === idx && (
                <div className="faq-answer-body">
                  <p>{item.a}</p>
                </div>
              )}
            </Reveal>
          ))}
        </div>
      </section>

      {/* SECTION 9: Final Call to Action Banner */}
      <section className="cta-section">
        <Reveal>
          <div className="cta-box">
            <h2 className="cta-heading">Ready to send your first walletless payment?</h2>
            <p className="cta-subheading">
              Experience the new standard for stablecoin payouts on Tempo. Zero setup required for recipients.
            </p>
            <div className="cta-actions">
              <button type="button" className="btn-primary btn-large" onClick={onStartSend}>
                Launch Reach <ArrowRightIcon size={18} />
              </button>
            </div>
          </div>
        </Reveal>
      </section>

      {/* SECTION 10: Multi-Column Footer */}
      <footer className="landing-footer">
        <div className="footer-inner-grid">
          <div className="footer-col footer-col-brand">
            <div className="footer-brand-lockup">
              <ReachLogo size={28} />
              <span className="footer-brand-title">reach<span className="brand-dot">.</span></span>
            </div>
            <p className="footer-brand-desc">
              Walletless payout infrastructure on Tempo. Pay people, not wallet addresses.
            </p>
            <div className="footer-status-pill">
              <span className="status-dot live-dot" />
              <span>Tempo Moderato Testnet (Chain ID 42431)</span>
            </div>
          </div>

          <div className="footer-col">
            <h4 className="footer-col-title">Protocol</h4>
            <ul className="footer-link-list">
              <li>
                <button type="button" className="footer-text-btn" onClick={() => scrollToSection("overview")}>
                  Overview
                </button>
              </li>
              <li>
                <button type="button" className="footer-text-btn" onClick={() => scrollToSection("how-it-works")}>
                  How it works
                </button>
              </li>
              <li>
                <button type="button" className="footer-text-btn" onClick={() => scrollToSection("built-on-tempo")}>
                  Built on Tempo
                </button>
              </li>
              <li>
                <button type="button" className="footer-text-btn" onClick={onStartSend}>
                  Launch App
                </button>
              </li>
            </ul>
          </div>

          <div className="footer-col">
            <h4 className="footer-col-title">Security</h4>
            <ul className="footer-link-list">
              <li>
                <button type="button" className="footer-text-btn" onClick={() => scrollToSection("security")}>
                  Smart Vault
                </button>
              </li>
              <li>
                <button type="button" className="footer-text-btn" onClick={() => scrollToSection("security")}>
                  Passkey WebAuthn
                </button>
              </li>
              <li>
                <button type="button" className="footer-text-btn" onClick={() => scrollToSection("faq")}>
                  FAQ
                </button>
              </li>
            </ul>
          </div>

          <div className="footer-col">
            <h4 className="footer-col-title">Resources</h4>
            <ul className="footer-link-list">
              <li>
                <a href="https://github.com/Techkeyy/Reach" target="_blank" rel="noreferrer" className="footer-ext-link">
                  GitHub <ExternalLinkIcon size={12} />
                </a>
              </li>
              <li>
                <a href="https://reach-seven-lemon.vercel.app" target="_blank" rel="noreferrer" className="footer-ext-link">
                  Live Deployment <ExternalLinkIcon size={12} />
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="footer-bottom-bar">
          <p className="footer-copyright">
            © 2026 Reach Protocol. Built on Tempo Blockchain.
          </p>
        </div>
      </footer>
    </div>
  );
}
