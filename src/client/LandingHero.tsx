import React, { useState } from "react";
import {
  ActivityIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  DatabaseIcon,
  ExternalLinkIcon,
  FingerprintIcon,
  GlobeIcon,
  KeyIcon,
  LinkIcon,
  LockIcon,
  PasskeyIcon,
  ReachLogo,
  SendIcon,
  ShieldCheckIcon,
  TerminalIcon,
  WalletIcon,
  ZapIcon,
} from "./components/Icons";
import { Reveal } from "./components/Reveal";

type LandingHeroProps = {
  onStartSend: () => void;
  isConnected: boolean;
  connectedAddress?: string;
};

const faqItems = [
  {
    id: "01",
    question: "How does a recipient claim money without an existing wallet?",
    answer:
      "When the recipient opens the private claim link, Reach prompts them to verify with Face ID, Touch ID, Windows Hello or another supported passkey. That creates an authenticated Reach account on the device. No wallet app, browser extension or pre-existing address is needed.",
  },
  {
    id: "02",
    question: "Who pays the fee when a recipient claims?",
    answer:
      "The sender funds the payout and the claim relay can sponsor the recipient-side claim on the configured Tempo testnet. The recipient does not need to acquire a native gas token to complete the supported claim flow. Network and relay availability remain visible in the application.",
  },
  {
    id: "03",
    question: "What happens if the recipient never claims before expiry?",
    answer:
      "An unclaimed payout remains visible in Activity. After its configured expiry, the sender can use Return funds to reclaim the principal through the existing recovery flow. Reach does not silently mark an unverified payout as complete.",
  },
  {
    id: "04",
    question: "Can anyone who receives the claim link use it?",
    answer:
      "The link is a private bearer capability. Treat it like cash and share it only with the intended recipient. The recipient must also complete the passkey ceremony, and the vault records the payout as claimed so the same payout cannot be claimed twice.",
  },
  {
    id: "05",
    question: "Is Reach a custodial service or escrow company?",
    answer:
      "Reach is non-custodial application software. Payout principal is placed in the Reach payout vault and the authenticated sender controls the supported send, activity and reclaim actions. Reach does not present itself as a bank or promise recovery of a lost private claim link.",
  },
  {
    id: "06",
    question: "Which network and token are supported?",
    answer:
      "The current implementation targets Tempo Moderato testnet, chain ID 42431, and pathUSD. The landing page and authenticated shell identify the testnet boundary clearly. Test funds are for testing only and are not real financial funds.",
  },
  {
    id: "07",
    question: "Can I send to several recipients at once?",
    answer:
      "Yes. Batch payments remain available from the Send area. Reach prepares each recipient claim capability and keeps member outcomes visible in Activity so a partial or interrupted response is not represented as an all-or-nothing success.",
  },
  {
    id: "08",
    question: "How do agent payments and MPP work?",
    answer:
      "An owner creates a narrowly scoped agent authorization from the Agents screen, including the exact purpose, recipient, origin, budget and expiry. After the owner approves it, the agent can make an MPP service request within that policy. Reach verifies the payment challenge and receipt before showing the actual service response and financial record.",
  },
  {
    id: "09",
    question: "What can I do if a payment is pending or unknown?",
    answer:
      "Reach keeps pending and UNKNOWN states visible. An uncertain direct payment is not retried blindly; the payment stays reserved until an authoritative receipt can be checked. Session payments can be recovered and closed from the authenticated application, with the settlement state shown to the owner.",
  },
  {
    id: "10",
    question: "How do I revoke an agent or close my session?",
    answer:
      "Use Agents to revoke the server authorization and complete the connected owner approval when required. Use Settings to close the authenticated session. After revocation, later agent requests are rejected by the server boundary rather than merely hidden from the interface.",
  },
];

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function LandingHero({ onStartSend, isConnected }: LandingHeroProps) {
  const [activeFaq, setActiveFaq] = useState<number | null>(null);

  return (
    <div className="landing-v2 landing-page">
      <header className="landing-v2-nav landing-page-nav">
        <a className="landing-v2-brand" href="/" aria-label="Reach home">
          <ReachLogo size={30} />
          <span>reach<span className="brand-dot">.</span></span>
        </a>
        <nav className="landing-v2-links" aria-label="Reach information">
          <button type="button" onClick={() => scrollToSection("landing-how-it-works")}>How it works</button>
          <button type="button" onClick={() => scrollToSection("landing-agents")}>Agents</button>
          <button type="button" onClick={() => scrollToSection("landing-security")}>Security</button>
          <button type="button" onClick={() => scrollToSection("landing-faq")}>FAQ</button>
        </nav>
        <button type="button" className="btn-primary landing-v2-nav-cta" onClick={onStartSend}>
          {isConnected ? "Open dashboard" : "Get started"}
          <ArrowRightIcon size={16} />
        </button>
      </header>

      <main>
        <section className="landing-v2-hero landing-page-hero" id="landing-overview" aria-labelledby="landing-title">
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

        <section className="landing-rich-manifesto" aria-label="Reach overview">
          <Reveal>
            <div className="landing-rich-manifesto-card">
              <p className="landing-rich-manifesto-muted">
                Most crypto payouts fail the usability test before they even start. They force senders to collect a 42-character address, verify supported networks and hope the recipient knows how to manage gas tokens.
              </p>
              <p className="landing-rich-manifesto-highlight">
                Reach reverses that model: fund a payout in seconds, share one private link and let the recipient claim with a passkey instead of a pre-existing wallet.
              </p>
            </div>
          </Reveal>
        </section>

        <section className="landing-rich-section landing-rich-problem" aria-labelledby="landing-problem-title">
          <div className="landing-rich-section-heading">
            <p className="landing-v2-eyebrow">The Reach difference</p>
            <h2 id="landing-problem-title">Payment infrastructure that starts with the person.</h2>
            <p>Reach is for people who need to move testnet value clearly: senders who do not want to collect addresses, recipients who want a simple claim, and teams that need payment state they can inspect.</p>
          </div>
          <div className="landing-rich-problem-list">
            <article className="landing-rich-problem-row">
              <div className="landing-rich-icon"><LinkIcon size={20} /></div>
              <div><h3>No address collection needed</h3><p>Send money without asking for a 42-character address beforehand. The recipient creates their account when they claim the link.</p></div>
              <ChevronRightIcon size={18} />
            </article>
            <article className="landing-rich-problem-row">
              <div className="landing-rich-icon"><FingerprintIcon size={20} /></div>
              <div><h3>Passkey account and claims</h3><p>Face ID, Touch ID, Windows Hello or another supported authenticator can open the account and authorize the claim without a seed phrase.</p></div>
              <ChevronRightIcon size={18} />
            </article>
            <article className="landing-rich-problem-row">
              <div className="landing-rich-icon"><ClockIcon size={20} /></div>
              <div><h3>Sender-controlled recovery</h3><p>If an unclaimed payout expires, Activity keeps the record available for the sender's existing Return funds flow. No successful state is invented from a missing receipt.</p></div>
              <ChevronRightIcon size={18} />
            </article>
          </div>
        </section>

        <section className="landing-rich-section landing-rich-capabilities" aria-labelledby="landing-capabilities-title">
          <div className="landing-rich-section-heading landing-rich-section-heading-wide">
            <p className="landing-v2-eyebrow">Useful from day one</p>
            <h2 id="landing-capabilities-title">A payment workspace for humans and agents.</h2>
            <p>The same account gives you a calm place to send, fund, review and govern payment activity. The interface stays readable while the underlying boundaries stay strict.</p>
          </div>
          <div className="landing-rich-capability-grid">
            <article className="landing-rich-capability-card landing-rich-capability-card-featured">
              <div className="landing-rich-card-topline"><SendIcon size={19} /><span>For senders</span></div>
              <h3>Send one person or a batch.</h3>
              <p>Create a payout, set a clear expiry, share the private claim link or prepare multiple recipients from Send. Activity keeps the resulting claims, returns and pending states together.</p>
              <button type="button" className="landing-rich-inline-action" onClick={onStartSend}>Open Reach <ArrowRightIcon size={15} /></button>
            </article>
            <article className="landing-rich-capability-card">
              <div className="landing-rich-card-topline"><WalletIcon size={19} /><span>For recipients</span></div>
              <h3>Claim without setting up first.</h3>
              <p>Open the link, use a device passkey and receive the value into an authenticated account. Claim links remain accessible at their existing `/c/` route.</p>
            </article>
            <article className="landing-rich-capability-card">
              <div className="landing-rich-card-topline"><ActivityIcon size={19} /><span>For teams</span></div>
              <h3>See what actually happened.</h3>
              <p>Balances, activity, reclaim, payment receipts and settlement states are presented as records, not optimistic toasts. Refresh and reconnect paths remain explicit.</p>
            </article>
            <article className="landing-rich-capability-card">
              <div className="landing-rich-card-topline"><TerminalIcon size={19} /><span>For agents</span></div>
              <h3>Approve service spend with limits.</h3>
              <p>Authorize a purpose, recipient, origin, budget and expiry. MPP requests stay within that policy and can be revoked from the authenticated Agents screen.</p>
            </article>
          </div>
        </section>

        <section className="landing-rich-section landing-rich-how" id="landing-how-it-works" aria-labelledby="landing-how-title">
          <div className="landing-rich-section-heading">
            <p className="landing-v2-eyebrow">The normal flow</p>
            <h2 id="landing-how-title">From passkey to paid result.</h2>
            <p>From deposit to recipient settlement, each stage has a visible user action and a checkable state.</p>
          </div>
          <div className="landing-rich-steps">
            <article className="landing-rich-step"><span>01</span><div className="landing-rich-step-icon"><FingerprintIcon size={21} /></div><h3>Create or sign in</h3><p>Your passkey opens an authenticated Reach account. Sensitive actions remain owner-approved.</p><small>Device-backed authentication</small></article>
            <article className="landing-rich-step"><span>02</span><div className="landing-rich-step-icon"><WalletIcon size={21} /></div><h3>Fund the account</h3><p>Add test funds through the Funding screen, then verify the balance before sending or authorizing spend.</p><small>Tempo Moderato testnet</small></article>
            <article className="landing-rich-step"><span>03</span><div className="landing-rich-step-icon"><LinkIcon size={21} /></div><h3>Send or approve</h3><p>Share a claim link, prepare a batch or create an agent policy with an exact scope and budget.</p><small>Human or delegated flow</small></article>
            <article className="landing-rich-step"><span>04</span><div className="landing-rich-step-icon"><CheckCircleIcon size={21} /></div><h3>Verify and recover</h3><p>Review the actual service result, receipt, settlement or reclaim state in Activity and Agents.</p><small>Evidence before completion</small></article>
          </div>
        </section>

        <section className="landing-rich-section landing-rich-agents" id="landing-agents" aria-labelledby="landing-agents-title">
          <div className="landing-rich-agents-copy">
            <p className="landing-v2-eyebrow">Agent payments</p>
            <h2 id="landing-agents-title">Let an agent pay for a service, with you in control.</h2>
            <p>Reach brings MPP into the same user journey as human payments. You approve the boundaries; the agent requests the service; Reach verifies the payment challenge and returns the actual response.</p>
            <ul className="landing-rich-check-list">
              <li><CheckCircleIcon size={17} /> Exact pathUSD budget, expiry and recipient</li>
              <li><CheckCircleIcon size={17} /> Separate direct and session payment purposes</li>
              <li><CheckCircleIcon size={17} /> Actual paid-service output alongside the receipt</li>
              <li><CheckCircleIcon size={17} /> UNKNOWN, session close and revocation remain visible</li>
            </ul>
            <button type="button" className="landing-rich-light-action" onClick={onStartSend}>Open Reach agents <ArrowRightIcon size={15} /></button>
          </div>
          <div className="landing-rich-agent-panel">
            <div className="landing-rich-agent-panel-label"><span className="landing-v2-live-dot" /> Owner-approved policy</div>
            <div className="landing-rich-agent-panel-row"><span>Purpose</span><strong>MPP service request</strong></div>
            <div className="landing-rich-agent-panel-row"><span>Spending limit</span><strong>Exact budget</strong></div>
            <div className="landing-rich-agent-panel-row"><span>Result</span><strong>Response + receipt</strong></div>
            <div className="landing-rich-agent-panel-row"><span>Afterward</span><strong>Review or revoke</strong></div>
            <p>Visual summary only. The real authorization and payment controls live behind the authenticated Agents screen.</p>
          </div>
        </section>

        <section className="landing-rich-section landing-rich-infrastructure" id="landing-built-on-tempo" aria-labelledby="landing-infrastructure-title">
          <div className="landing-rich-section-heading">
            <p className="landing-v2-eyebrow">Infrastructure disclosure</p>
            <h2 id="landing-infrastructure-title">Built on the testnet rails the interface names.</h2>
            <p>Reach keeps the network, token and account model visible so a user can tell what is local evidence and what still depends on configured staging infrastructure.</p>
          </div>
          <div className="landing-rich-stack-grid">
            <article className="landing-rich-stack-card"><div className="landing-rich-stack-icon"><GlobeIcon size={21} /></div><span className="landing-rich-stack-status">Network</span><h3>Tempo Moderato</h3><p>Current testnet target for Reach payment flows.</p><code>Chain ID 42431</code></article>
            <article className="landing-rich-stack-card"><div className="landing-rich-stack-icon"><ZapIcon size={21} /></div><span className="landing-rich-stack-status">Token</span><h3>pathUSD</h3><p>The configured test token used for payment and agent-budget examples.</p><code>Testnet only</code></article>
            <article className="landing-rich-stack-card"><div className="landing-rich-stack-icon"><DatabaseIcon size={21} /></div><span className="landing-rich-stack-status">Settlement</span><h3>Reach payout vault</h3><p>Sender principal remains in the supported vault lifecycle until claim or reclaim.</p><code>State is checkable</code></article>
            <article className="landing-rich-stack-card"><div className="landing-rich-stack-icon"><PasskeyIcon size={21} /></div><span className="landing-rich-stack-status">Access</span><h3>WebAuthn passkeys</h3><p>Device-backed authentication replaces seed-phrase onboarding in the normal flow.</p><code>W3C WebAuthn</code></article>
          </div>
        </section>

        <section className="landing-rich-section landing-rich-security" id="landing-security" aria-labelledby="landing-security-title">
          <div className="landing-rich-security-heading">
            <div className="landing-rich-security-icon"><ShieldCheckIcon size={25} /></div>
            <div><p className="landing-v2-eyebrow">Security and transparency</p><h2 id="landing-security-title">The interface explains what the backend can prove.</h2></div>
          </div>
          <div className="landing-rich-security-grid">
            <article><LockIcon size={19} /><div><h3>Non-custodial payout path</h3><p>Payout principal follows the vault lifecycle; application state does not replace authoritative financial reads.</p></div></article>
            <article><KeyIcon size={19} /><div><h3>Private claim capability</h3><p>The recipient link is private and bearer-based. Share it carefully and do not treat a public URL as proof of ownership.</p></div></article>
            <article><ActivityIcon size={19} /><div><h3>Visible payment states</h3><p>Pending, confirmed, failed, UNKNOWN, settlement and reclaim remain distinct in the authenticated product.</p></div></article>
            <article><ShieldCheckIcon size={19} /><div><h3>Scoped agent authority</h3><p>Agent discovery and mutation routes are owner-bound; revocation closes the server authorization before later use is accepted.</p></div></article>
          </div>
          <details className="landing-rich-details">
            <summary>Technical boundary and verification <ChevronDownIcon size={17} /></summary>
            <div className="landing-rich-details-body">
              <span><strong>Network:</strong> Tempo Moderato testnet, chain ID 42431</span>
              <span><strong>Onboarding:</strong> W3C WebAuthn passkey ceremony</span>
              <span><strong>Evidence:</strong> deterministic local tests are labeled separately from live Tempo settlement</span>
            </div>
          </details>
        </section>

        <section className="landing-rich-section landing-rich-status" aria-labelledby="landing-status-title">
          <div className="landing-rich-status-copy"><p className="landing-v2-eyebrow">Release disclosure</p><h2 id="landing-status-title">A clear testnet boundary is part of the product.</h2><p>Reach is under local implementation and testnet release hold. Test funds are play money only. Do not use production keys or real financial funds.</p></div>
          <div className="landing-rich-status-badge"><span className="landing-v2-live-dot" /> Tempo Moderato · testnet only</div>
        </section>

        <section className="landing-rich-section landing-rich-faq" id="landing-faq" aria-labelledby="landing-faq-title">
          <div className="landing-rich-section-heading">
            <p className="landing-v2-eyebrow">Clear answers</p>
            <h2 id="landing-faq-title">Frequently asked questions.</h2>
            <p>How the payment flows behave, what is supported today and where the testnet boundary still matters.</p>
          </div>
          <div className="landing-rich-faq-list">
            {faqItems.map((item, index) => {
              const isOpen = activeFaq === index;
              const answerId = `landing-faq-answer-${index}`;
              const questionId = `landing-faq-question-${index}`;
              return (
                <div className={`landing-rich-faq-item${isOpen ? " is-open" : ""}`} key={item.id}>
                  <button
                    id={questionId}
                    type="button"
                    className="landing-rich-faq-question"
                    onClick={() => setActiveFaq(isOpen ? null : index)}
                    aria-expanded={isOpen}
                    aria-controls={answerId}
                  >
                    <span className="landing-rich-faq-number">{item.id}</span>
                    <span>{item.question}</span>
                    <ChevronDownIcon size={18} aria-hidden="true" />
                  </button>
                  <div id={answerId} className="landing-rich-faq-answer" role="region" aria-labelledby={questionId} hidden={!isOpen}>
                    <p>{item.answer}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="landing-rich-cta" aria-labelledby="landing-final-title">
          <div><p className="landing-v2-eyebrow">Start with the useful part</p><h2 id="landing-final-title">Ready to send your first walletless payment?</h2><p>Open Reach with your passkey and take the next payment step from one place.</p></div>
          <button type="button" className="btn-primary btn-large landing-rich-cta-action" onClick={onStartSend}>Get started <ArrowRightIcon size={17} /></button>
        </section>
      </main>

      <footer className="landing-rich-footer">
        <div className="landing-rich-footer-brand"><ReachLogo size={24} /><div><span>reach<span className="brand-dot">.</span></span><p>Pay people, not wallet addresses.</p></div></div>
        <div className="landing-rich-footer-links">
          <div><strong>Explore</strong><button type="button" onClick={() => scrollToSection("landing-overview")}>Overview</button><button type="button" onClick={() => scrollToSection("landing-how-it-works")}>How it works</button><button type="button" onClick={() => scrollToSection("landing-built-on-tempo")}>Built on Tempo</button></div>
          <div><strong>Trust</strong><button type="button" onClick={() => scrollToSection("landing-security")}>Security</button><button type="button" onClick={() => scrollToSection("landing-faq")}>FAQ</button><button type="button" onClick={onStartSend}>Open Reach</button></div>
          <div><strong>Project</strong><a href="https://github.com/Techkeyy/Reach" target="_blank" rel="noreferrer">Source on GitHub <ExternalLinkIcon size={13} /></a><a href="https://reach-seven-lemon.vercel.app" target="_blank" rel="noreferrer">Preview environment <ExternalLinkIcon size={13} /></a></div>
        </div>
        <div className="landing-rich-footer-bottom"><span>Tempo Moderato testnet · chain ID 42431</span><span>Test funds only · release hold</span><span>© Reach</span></div>
      </footer>
    </div>
  );
}
