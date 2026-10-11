import React, { useEffect, useState } from "react";
import {
  ArrowRightIcon,
  ChevronDownIcon,
  ClockIcon,
  DatabaseIcon,
  ExternalLinkIcon,
  FingerprintIcon,
  GlobeIcon,
  KeyIcon,
  LinkIcon,
  LockIcon,
  ReachLogo,
  ShieldCheckIcon,
  WalletIcon,
  ZapIcon,
} from "./components/Icons";

type LandingHeroProps = {
  onStartSend: () => void;
  isConnected: boolean;
  connectedAddress?: string;
};

const navItems = [
  { label: "Payments", target: "payments" },
  { label: "How it works", target: "how-it-works" },
  { label: "Trust", target: "trust" },
  { label: "FAQ", target: "faq" },
];

const faqs = [
  {
    q: "What is Reach?",
    a: "Reach is a passkey-powered human-payments application for sending pathUSD on Tempo Moderato. Create a payout, share a private claim link, and let the recipient set up or use a device-secured account when they claim.",
  },
  {
    q: "How does a recipient claim without an existing wallet?",
    a: "The recipient opens the private link and uses a device passkey such as Face ID, Touch ID, Windows Hello, or another supported authenticator. Reach creates or opens the recipient account through the normal WebAuthn flow.",
  },
  {
    q: "Who pays the claim transaction fee?",
    a: "Reach sponsors the recipient claim transaction on Tempo when the configured relay is available. The recipient does not need to buy or hold a gas token to use the claim flow.",
  },
  {
    q: "What is a protected payment?",
    a: "Protected Payments add an extra recipient-verification step to a payout. The sender chooses an available verification channel in the payment flow, and the recipient completes that check before claiming.",
  },
  {
    q: "Can I send to more than one recipient?",
    a: "Yes. Batch Payments let you prepare multiple human payouts together, review the batch, and keep each recipient claim link separate. The batch flow preserves individual payout status and recovery paths.",
  },
  {
    q: "What happens if a payout expires?",
    a: "An unclaimed payout remains in the Reach vault until its expiry. After expiry, the original sender can use Activity to verify the authoritative state and return eligible funds to the sender account.",
  },
  {
    q: "Which network and token does Reach support?",
    a: "The current testnet application uses Tempo Moderato, Chain ID 42431, and pathUSD. The app labels the network and reads balances from the configured chain rather than inventing a local balance.",
  },
  {
    q: "How does Reach keep payments under my control?",
    a: "Reach is non-custodial software. Sender principal is deposited into the Reach payout vault, the recipient claim is authorized by a private link capability, and the contract determines whether a payout is claimable or eligible for return.",
  },
  {
    q: "What if I lose my passkey or claim link?",
    a: "Use the account recovery options supported by your device and browser for a returning passkey session. A claim link is a private bearer capability: if it is genuinely lost, Reach cannot recreate it. The sender can still return an eligible expired payout through the sender-only Activity flow.",
  },
];

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function LandingHero({ onStartSend, isConnected, connectedAddress }: LandingHeroProps) {
  const [activeFaq, setActiveFaq] = useState<number | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const goTo = (target: string) => {
    setMobileMenuOpen(false);
    scrollToSection(target);
  };

  return (
    <div className="landing-container ux14-landing" id="top">
      <header className={`ux14-nav ${isScrolled ? "is-scrolled" : ""}`}>
        <div className="ux14-nav-inner">
          <button type="button" className="ux14-brand" onClick={() => goTo("top")} aria-label="Back to Reach home">
            <ReachLogo size={25} />
            <span>reach<span className="ux14-brand-dot">.</span></span>
          </button>

          <nav className="ux14-nav-links" aria-label="Reach overview navigation">
            {navItems.map((item) => (
              <button key={item.target} type="button" onClick={() => goTo(item.target)}>
                {item.label}
              </button>
            ))}
          </nav>

          <div className="ux14-nav-actions">
            <span className="ux14-network-pill" title="Tempo Moderato testnet">
              <span className="ux14-network-dot" />
              Tempo testnet
            </span>
            {isConnected ? (
              <button type="button" className="ux14-nav-account" onClick={onStartSend}>
                <span className="ux14-account-dot" />
                {connectedAddress ? `${connectedAddress.slice(0, 6)}...${connectedAddress.slice(-4)}` : "Open app"}
              </button>
            ) : null}
            <button type="button" className="ux14-nav-cta" onClick={onStartSend}>
              Get started <ArrowRightIcon size={15} />
            </button>
            <button
              type="button"
              className="ux14-menu-toggle"
              aria-label={mobileMenuOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={mobileMenuOpen}
              onClick={() => setMobileMenuOpen((open) => !open)}
            >
              <span /><span />
            </button>
          </div>
        </div>

        {mobileMenuOpen ? (
          <nav className="ux14-mobile-menu" aria-label="Mobile navigation">
            {navItems.map((item) => (
              <button key={item.target} type="button" onClick={() => goTo(item.target)}>
                <span>{item.label}</span><ArrowRightIcon size={16} />
              </button>
            ))}
            <button type="button" className="ux14-mobile-menu-cta" onClick={onStartSend}>
              <span>{isConnected ? "Open your account" : "Create your account"}</span><ArrowRightIcon size={16} />
            </button>
          </nav>
        ) : null}
      </header>

      <main>
        <section className="ux14-hero" id="overview" aria-labelledby="ux14-hero-title">
          <div className="ux14-hero-copy">
            <p className="ux14-kicker ux14-stagger-1"><span className="ux14-kicker-mark" /> Human payments on Tempo</p>
            <h1 id="ux14-hero-title" className="ux14-display ux14-hero-title ux14-stagger-2">
              Send money to <em>people,</em><br />
              not wallet addresses.
            </h1>
            <p className="ux14-hero-lede ux14-stagger-3">
              Reach turns a payment into a private, passkey-ready handoff. Fund once, share a link, and let the right person claim.
            </p>
            <div className="ux14-hero-actions ux14-stagger-4">
              <button type="button" className="ux14-button ux14-button-dark" onClick={onStartSend}>
                {isConnected ? "Open Reach" : "Get started"} <ArrowRightIcon size={17} />
              </button>
              <button type="button" className="ux14-text-link" onClick={() => goTo("how-it-works")}>
                See how it works <span aria-hidden="true">↘</span>
              </button>
            </div>
            <div className="ux14-hero-footnote ux14-stagger-5">
              <span className="ux14-footnote-dot" />
              <span>Testnet application</span>
              <span className="ux14-footnote-separator">/</span>
              <span>Tempo Moderato · 42431</span>
            </div>
          </div>

          <div className="ux14-hero-art" aria-label="A sender and recipient connected by a private Reach payment link">
            <div className="ux14-art-caption">
              <span>PRIVATE HANDOFF</span>
              <span className="ux14-tabular">01 / 03</span>
            </div>
            <div className="ux14-art-canvas">
              <div className="ux14-orbit ux14-orbit-one" />
              <div className="ux14-orbit ux14-orbit-two" />
              <div className="ux14-art-cross ux14-cross-one" />
              <div className="ux14-art-cross ux14-cross-two" />
              <div className="ux14-art-node ux14-node-sender">
                <span className="ux14-node-label">Sender</span>
                <WalletIcon size={19} />
                <span className="ux14-node-sub">funds a payout</span>
              </div>
              <div className="ux14-art-connector">
                <span className="ux14-connector-line" />
                <span className="ux14-connector-packet" />
                <span className="ux14-connector-label"><LinkIcon size={13} /> private link</span>
              </div>
              <div className="ux14-art-node ux14-node-recipient">
                <span className="ux14-node-label">Recipient</span>
                <FingerprintIcon size={20} />
                <span className="ux14-node-sub">claims with a passkey</span>
              </div>
              <div className="ux14-art-note ux14-note-top">no address exchange</div>
              <div className="ux14-art-note ux14-note-bottom">claim fee sponsored</div>
            </div>
            <div className="ux14-art-bottomline">
              <span>Human custody</span><span>Device-secured</span><span>Onchain settlement</span>
            </div>
          </div>
        </section>

        <section className="ux14-intro ux14-scroll-reveal" aria-labelledby="ux14-intro-title">
          <div className="ux14-intro-index ux14-tabular">01 / THE IDEA</div>
          <div className="ux14-intro-copy">
            <h2 id="ux14-intro-title" className="ux14-display">A calmer way to move value.</h2>
            <p>
              A payment should not begin with a wallet address, a network tutorial, or a gas-token request. Reach gives the sender a clear review, the recipient a private link, and both sides an honest record of what happened.
            </p>
            <p className="ux14-muted-copy">Built for people sending money to people.</p>
          </div>
        </section>

        <section className="ux14-payments-section ux14-scroll-reveal" id="payments" aria-labelledby="ux14-payments-title">
          <div className="ux14-section-heading">
            <div>
              <p className="ux14-kicker">One account, three useful paths</p>
              <h2 id="ux14-payments-title" className="ux14-display">The payment, <em>made human.</em></h2>
            </div>
            <p className="ux14-section-aside">Every primary action opens the real Reach flow. No sample balances. No simulated transfers.</p>
          </div>

          <div className="ux14-payment-list">
            <article className="ux14-payment-row ux14-payment-row-fast">
              <div className="ux14-payment-number ux14-tabular">01</div>
              <div className="ux14-payment-icon"><ZapIcon size={20} /></div>
              <div className="ux14-payment-copy"><h3>Fast Payments</h3><p>Send pathUSD without collecting a wallet address first. The sender reviews the amount, expiry, and recipient handoff before signing.</p></div>
              <button type="button" className="ux14-row-link" onClick={onStartSend} aria-label="Start a Fast Payment">Start a payment <ArrowRightIcon size={16} /></button>
            </article>
            <article className="ux14-payment-row ux14-payment-row-protected">
              <div className="ux14-payment-number ux14-tabular">02</div>
              <div className="ux14-payment-icon"><ShieldCheckIcon size={20} /></div>
              <div className="ux14-payment-copy"><h3>Protected Payments</h3><p>Add recipient verification to a payment when the handoff needs another layer of confidence. The claim stays inside the supported Reach flow.</p></div>
              <button type="button" className="ux14-row-link" onClick={onStartSend} aria-label="Start a Protected Payment">Protect a payment <ArrowRightIcon size={16} /></button>
            </article>
            <article className="ux14-payment-row ux14-payment-row-batch">
              <div className="ux14-payment-number ux14-tabular">03</div>
              <div className="ux14-payment-icon"><LinkIcon size={20} /></div>
              <div className="ux14-payment-copy"><h3>Batch Payments</h3><p>Prepare multiple human payouts together, keep each claim link distinct, and return to Activity for an authoritative record of every payout.</p></div>
              <button type="button" className="ux14-row-link" onClick={onStartSend} aria-label="Start Batch Payments">Build a batch <ArrowRightIcon size={16} /></button>
            </article>
          </div>
        </section>

        <section className="ux14-how-section ux14-scroll-reveal" id="how-it-works" aria-labelledby="ux14-how-title">
          <div className="ux14-section-heading ux14-section-heading-light">
            <div><p className="ux14-kicker">A visible handoff</p><h2 id="ux14-how-title" className="ux14-display">Four moments. <em>One clear record.</em></h2></div>
            <p className="ux14-section-aside">Reach keeps the sender, recipient, and vault state legible from setup through settlement.</p>
          </div>
          <div className="ux14-how-rail">
            <div className="ux14-rail-line" />
            {[
              ["01", "Open", "Create or return to a passkey account."],
              ["02", "Fund", "Review the real balance and sign the payout."],
              ["03", "Share", "Send one private claim link to the recipient."],
              ["04", "Settle", "Claim, activity, expiry, and return stay visible."],
            ].map(([number, title, copy]) => (
              <div className="ux14-how-step" key={number}><span className="ux14-how-dot" /><span className="ux14-how-number ux14-tabular">{number}</span><h3>{title}</h3><p>{copy}</p></div>
            ))}
          </div>
        </section>

        <section className="ux14-trust-section ux14-scroll-reveal" id="trust" aria-labelledby="ux14-trust-title">
          <div className="ux14-trust-intro"><p className="ux14-kicker">The rails underneath</p><h2 id="ux14-trust-title" className="ux14-display">Quietly serious about the <em>details.</em></h2><p>Reach makes the financial boundary explicit. Your device opens the account, the chain records the payout, and Activity helps you recover from uncertainty.</p></div>
          <div className="ux14-trust-grid">
            <div className="ux14-trust-item"><GlobeIcon size={19} /><div><strong>Tempo Moderato</strong><span>Testnet · Chain ID 42431</span></div></div>
            <div className="ux14-trust-item"><FingerprintIcon size={19} /><div><strong>Passkey account</strong><span>WebAuthn device authentication</span></div></div>
            <div className="ux14-trust-item"><DatabaseIcon size={19} /><div><strong>Reach vault</strong><span>Non-custodial payout settlement</span></div></div>
            <div className="ux14-trust-item"><LockIcon size={19} /><div><strong>Private claim</strong><span>Bearer capability stays in the link</span></div></div>
            <div className="ux14-trust-item"><ClockIcon size={19} /><div><strong>Expiry and return</strong><span>Sender-controlled recovery path</span></div></div>
            <div className="ux14-trust-item"><KeyIcon size={19} /><div><strong>Activity record</strong><span>Authoritative state before action</span></div></div>
          </div>
        </section>

        <section className="ux14-faq-section ux14-scroll-reveal" id="faq" aria-labelledby="ux14-faq-title">
          <div className="ux14-faq-heading"><p className="ux14-kicker">Questions, answered plainly</p><h2 id="ux14-faq-title" className="ux14-display">Before you <em>send.</em></h2><p>Reach is intentionally specific about what is on testnet, what your device does, and what the payment contract decides.</p></div>
          <div className="ux14-faq-list">
            {faqs.map((item, index) => {
              const isOpen = activeFaq === index;
              const answerId = `reach-faq-answer-${index}`;
              return <div className={`ux14-faq-item ${isOpen ? "is-open" : ""}`} key={item.q}>
                <button type="button" className="ux14-faq-question" aria-expanded={isOpen} aria-controls={answerId} onClick={() => setActiveFaq(isOpen ? null : index)}>
                  <span className="ux14-faq-number ux14-tabular">{String(index + 1).padStart(2, "0")}</span><span>{item.q}</span><ChevronDownIcon size={17} className="ux14-faq-chevron" />
                </button>
                <div id={answerId} className="ux14-faq-answer" aria-hidden={!isOpen}><p>{item.a}</p></div>
              </div>;
            })}
          </div>
        </section>

        <section className="ux14-final-section ux14-scroll-reveal" aria-labelledby="ux14-final-title">
          <div className="ux14-final-rule" /><p className="ux14-kicker">Start with a human payment</p><h2 id="ux14-final-title" className="ux14-display">Make the next handoff <em>feel simple.</em></h2>
          <button type="button" className="ux14-button ux14-button-dark" onClick={onStartSend}>{isConnected ? "Open Reach" : "Create your account"} <ArrowRightIcon size={17} /></button>
        </section>
      </main>

      <footer className="ux14-footer">
        <div className="ux14-footer-top">
          <div className="ux14-footer-brand"><button type="button" className="ux14-brand" onClick={() => goTo("top")} aria-label="Back to Reach home"><ReachLogo size={25} /><span>reach<span className="ux14-brand-dot">.</span></span></button><p>Passkey-powered human payments on Tempo.</p></div>
          <div className="ux14-footer-links">
            <div><span className="ux14-footer-label">Explore</span><button type="button" onClick={() => goTo("payments")}>Payments</button><button type="button" onClick={() => goTo("how-it-works")}>How it works</button><button type="button" onClick={() => goTo("faq")}>FAQ</button></div>
            <div><span className="ux14-footer-label">Account</span><button type="button" onClick={onStartSend}>Open Reach</button><button type="button" onClick={() => goTo("trust")}>Trust and custody</button><a href="https://github.com/Techkeyy/Reach" target="_blank" rel="noreferrer">Source <ExternalLinkIcon size={13} /></a></div>
          </div>
        </div>
        <div className="ux14-footer-bottom"><span>Tempo Moderato testnet · Chain ID 42431</span><span>Reach · human payments, made simple</span></div>
      </footer>
    </div>
  );
}
