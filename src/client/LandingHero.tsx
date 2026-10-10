import React from "react";
import {
  ActivityIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  FingerprintIcon,
  LinkIcon,
  ReachLogo,
  SendIcon,
  ShieldCheckIcon,
  TerminalIcon,
  WalletIcon,
} from "./components/Icons";

type LandingHeroProps = {
  onStartSend: () => void;
  isConnected: boolean;
  connectedAddress?: string;
};

const benefits = [
  {
    icon: <SendIcon size={19} />,
    title: "Send without wallet addresses",
    body: "Create a secure claim link and let the recipient finish with their own passkey.",
  },
  {
    icon: <ActivityIcon size={19} />,
    title: "Know what settled",
    body: "See balances, fees, claims, returns and payment status in one authenticated activity view.",
  },
  {
    icon: <TerminalIcon size={19} />,
    title: "Approve agents with limits",
    body: "Authorize a service, review every paid result and revoke access whenever you choose.",
  },
];

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function LandingHero({ onStartSend, isConnected }: LandingHeroProps) {
  return (
    <div className="landing-v2">
      <header className="landing-v2-nav">
        <a className="landing-v2-brand" href="/" aria-label="Reach home">
          <ReachLogo size={30} />
          <span>reach<span className="brand-dot">.</span></span>
        </a>
        <nav className="landing-v2-links" aria-label="Reach information">
          <button type="button" onClick={() => scrollToSection("landing-how-it-works")}>How it works</button>
          <button type="button" onClick={() => scrollToSection("landing-security")}>Security</button>
          <button type="button" onClick={() => scrollToSection("landing-testnet")}>Testnet</button>
        </nav>
        <button type="button" className="btn-primary landing-v2-nav-cta" onClick={onStartSend}>
          {isConnected ? "Open dashboard" : "Get started"}
          <ArrowRightIcon size={16} />
        </button>
      </header>

      <main>
        <section className="landing-v2-hero" aria-labelledby="landing-title">
          <div className="landing-v2-hero-copy">
            <div className="landing-v2-eyebrow"><span className="landing-v2-live-dot" /> Passkey payments on Tempo testnet</div>
            <h1 id="landing-title">Payments that start with a passkey.</h1>
            <p className="landing-v2-lede">Reach makes it simple to send, receive and approve agent payments without handing your money or your workflow to a wallet address.</p>
            <div className="landing-v2-actions">
              <button type="button" className="btn-primary btn-large" onClick={onStartSend}>
                <FingerprintIcon size={18} />
                <span>{isConnected ? "Open your account" : "Get started with a passkey"}</span>
                <ArrowRightIcon size={17} />
              </button>
              <button type="button" className="landing-v2-text-action" onClick={() => scrollToSection("landing-how-it-works")}>
                See how Reach works <ArrowRightIcon size={15} />
              </button>
            </div>
            <p className="landing-v2-trust-line"><ShieldCheckIcon size={15} /> You approve every sensitive action. No seed phrase, CLI or preassigned wallet.</p>
          </div>

          <aside className="landing-v2-hero-note" aria-label="Reach product promise">
            <div className="landing-v2-note-mark"><ReachLogo size={24} /></div>
            <p className="landing-v2-note-kicker">One account. Clear control.</p>
            <h2>Move money with context.</h2>
            <p>Every core action is visible in Reach: who can spend, what was paid, what settled and what you can revoke.</p>
            <div className="landing-v2-note-list">
              <span><CheckCircleIcon size={16} /> Passkey-first account</span>
              <span><CheckCircleIcon size={16} /> Authenticated payment history</span>
              <span><CheckCircleIcon size={16} /> Recoverable pending states</span>
            </div>
          </aside>
        </section>

        <section className="landing-v2-benefits" aria-label="Reach benefits">
          {benefits.map((benefit) => (
            <article className="landing-v2-benefit" key={benefit.title}>
              <div className="landing-v2-benefit-icon">{benefit.icon}</div>
              <h2>{benefit.title}</h2>
              <p>{benefit.body}</p>
            </article>
          ))}
        </section>

        <section className="landing-v2-section" id="landing-how-it-works" aria-labelledby="landing-how-title">
          <div className="landing-v2-section-heading">
            <p className="landing-v2-eyebrow">The normal flow</p>
            <h2 id="landing-how-title">From passkey to paid result.</h2>
            <p>Reach keeps the user journey short while preserving the evidence behind each financial state.</p>
          </div>
          <div className="landing-v2-flow">
            <div className="landing-v2-flow-step"><span>01</span><FingerprintIcon size={20} /><strong>Create or sign in</strong><p>Your passkey opens an authenticated Reach account.</p></div>
            <div className="landing-v2-flow-step"><span>02</span><WalletIcon size={20} /><strong>Fund and approve</strong><p>Add test funds or set an agent allowance with a clear limit.</p></div>
            <div className="landing-v2-flow-step"><span>03</span><SendIcon size={20} /><strong>Pay and receive</strong><p>Send a claim link or pay a service from the Reach interface.</p></div>
            <div className="landing-v2-flow-step"><span>04</span><ActivityIcon size={20} /><strong>Verify and recover</strong><p>Review the actual service result, receipt and settlement state.</p></div>
          </div>
        </section>

        <section className="landing-v2-security" id="landing-security" aria-labelledby="landing-security-title">
          <div className="landing-v2-security-icon"><ShieldCheckIcon size={26} /></div>
          <div>
            <p className="landing-v2-eyebrow">Designed for confidence</p>
            <h2 id="landing-security-title">The interface explains what the backend proves.</h2>
            <p>Reach separates deterministic local payment evidence from live network settlement evidence. Pending, unknown and revoked states stay visible instead of disappearing behind a success toast.</p>
          </div>
          <div className="landing-v2-security-points">
            <span><CheckCircleIcon size={16} /> Authenticated balances</span>
            <span><CheckCircleIcon size={16} /> Scoped agent permissions</span>
            <span><CheckCircleIcon size={16} /> Claim links remain accessible</span>
          </div>
        </section>

        <section className="landing-v2-testnet" id="landing-testnet" aria-labelledby="landing-testnet-title">
          <div>
            <p className="landing-v2-eyebrow">Network disclosure</p>
            <h2 id="landing-testnet-title">Tempo Moderato testnet</h2>
            <p>Reach is in local implementation and testnet release hold. Test funds are play money only. Do not use production keys or real financial funds.</p>
          </div>
          <div className="landing-v2-testnet-badge"><span className="landing-v2-live-dot" /> Testnet · play money only</div>
        </section>

        <section className="landing-v2-final-cta" aria-labelledby="landing-final-title">
          <div>
            <h2 id="landing-final-title">Ready when you are.</h2>
            <p>Open Reach with your passkey and take the next payment step from one place.</p>
          </div>
          <button type="button" className="btn-primary btn-large" onClick={onStartSend}>Get started <ArrowRightIcon size={17} /></button>
        </section>
      </main>

      <footer className="landing-v2-footer">
        <span className="landing-v2-footer-brand"><ReachLogo size={20} /> reach<span className="brand-dot">.</span></span>
        <span>Passkey payments with visible control.</span>
        <span className="landing-v2-footer-claim"><LinkIcon size={15} /> Claim links stay accessible to recipients.</span>
      </footer>
    </div>
  );
}
