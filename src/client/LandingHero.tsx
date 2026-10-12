import React, { useEffect, useState } from "react";
import { ArrowRightIcon, ChevronDownIcon, ClockIcon, DatabaseIcon, ExternalLinkIcon, FingerprintIcon, GlobeIcon, KeyIcon, LinkIcon, LockIcon, ReachLogo, ShieldCheckIcon, WalletIcon, ZapIcon } from "./components/Icons";
import HeroHandoffScene from "./components/HeroHandoffScene";

type Props = { onStartSend: () => void; isConnected: boolean; connectedAddress?: string };
const navItems = [{ label: "Payments", target: "payments" }, { label: "How it works", target: "how-it-works" }, { label: "Trust", target: "trust" }, { label: "FAQ", target: "faq" }];
const faqs = [
  { q: "What is Reach?", a: "Reach is a passkey-powered app for sending test tokens to people. Create a payment, share a private claim link, and let the recipient create or open a device-secured account when they claim." },
  { q: "How does a recipient claim without an existing wallet?", a: "The recipient opens the private link and uses a device passkey such as Face ID, Touch ID, or Windows Hello. Reach creates or opens their account through the normal sign-in flow." },
  { q: "Who pays the claim transaction fee?", a: "Reach covers the recipient's claim fee when its sponsorship service is available. The recipient does not need to obtain a separate token just to claim." },
  { q: "What is a protected payment?", a: "Protected Payments add an extra recipient-verification step to a payout. The sender chooses an available verification channel in the payment flow, and the recipient completes that check before claiming." },
  { q: "Can I send to more than one recipient?", a: "Yes. Batch Payments let you prepare multiple human payouts together, review the batch, and keep each recipient claim link separate. The batch flow preserves individual payout status and recovery paths." },
  { q: "What happens if a payout expires?", a: "An unclaimed payment remains reserved until it expires. After expiry, the original sender can check its latest status in Activity and reclaim eligible funds." },
  { q: "Does Reach use real money?", a: "No. Reach currently uses test tokens, not real money. The app shows the supported token and network when you fund or confirm a payment, and reads your balance from that network." },
  { q: "How does Reach keep payments under my control?", a: "Reach is non-custodial software. Your payment follows clear claim and expiry rules: the recipient needs the private link to claim, and the sender can reclaim eligible unclaimed funds after expiry." },
  { q: "What if I lose my passkey or claim link?", a: "Use the account recovery options supported by your device and browser to return with your passkey. A private claim link cannot be recreated if it is genuinely lost. The sender can still reclaim an eligible expired payment through Activity." },
];
const steps = [
  { n: "01", title: "Open", text: "Create or return to your passkey-secured Reach account.", Icon: FingerprintIcon },
  { n: "02", title: "Fund", text: "Check your available balance, then review and approve a payment.", Icon: WalletIcon },
  { n: "03", title: "Share", text: "Send the private claim link to the intended recipient.", Icon: LinkIcon },
  { n: "04", title: "Settle", text: "Follow claiming, expiry and eligible returns in Activity.", Icon: ShieldCheckIcon },
];

export default function LandingHero({ onStartSend, isConnected, connectedAddress }: Props) {
  const [activeFaq, setActiveFaq] = useState<number | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 12);
    onScroll(); window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (!("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (entry.isIntersecting) { entry.target.classList.add("is-in-view"); observer.unobserve(entry.target); }
    }), { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    document.querySelectorAll(".ux15-animate").forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);
  const goTo = (target: string) => { setMobileMenuOpen(false); document.getElementById(target)?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }); };
  const start = () => { setMobileMenuOpen(false); onStartSend(); };
  const brand = <><span className="ux15-brand-mark"><ReachLogo size={19} /></span><span>reach<span className="ux15-brand-period">.</span></span></>;

  return <div className="landing-container ux15-landing" id="top">
    <header className={`ux15-header ${isScrolled ? "is-scrolled" : ""}`}><div className="ux15-header-inner">
      <button type="button" className="ux15-brand" onClick={() => goTo("top")} aria-label="Back to Reach home">{brand}</button>
      <nav className="ux15-nav" aria-label="Reach overview navigation">{navItems.map((item) => <button type="button" key={item.target} onClick={() => goTo(item.target)}>{item.label}</button>)}</nav>
      <div className="ux15-header-actions">{isConnected && <button type="button" className="ux15-account" onClick={start} aria-label="Open your Reach account">{connectedAddress ? `${connectedAddress.slice(0, 6)}...${connectedAddress.slice(-4)}` : "Open app"}</button>}
        <button type="button" className="ux15-button ux15-button-primary ux15-header-cta" onClick={start}>Get started <ArrowRightIcon size={15} /></button>
        <button type="button" className="ux15-menu-toggle" onClick={() => setMobileMenuOpen((open) => !open)} aria-label={mobileMenuOpen ? "Close navigation" : "Open navigation"} aria-expanded={mobileMenuOpen} aria-controls="ux15-mobile-nav"><span /><span /></button>
      </div></div>
      <nav id="ux15-mobile-nav" className={`ux15-mobile-nav ${mobileMenuOpen ? "is-open" : ""}`} aria-label="Mobile navigation" inert={!mobileMenuOpen}>{navItems.map((item) => <button type="button" key={item.target} onClick={() => goTo(item.target)}>{item.label}<ArrowRightIcon size={15} /></button>)}<button type="button" onClick={start}>{isConnected ? "Open your account" : "Create your account"}<ArrowRightIcon size={15} /></button></nav>
    </header>
    <main>
      <section className="ux15-hero ux15-shell" aria-labelledby="ux15-hero-title"><div className="ux15-hero-inner"><div className="ux15-hero-content">
        <p className="ux15-eyebrow ux15-hero-enter" style={{ animationDelay: "60ms" }}><span className="ux15-eyebrow-dot" /> PAYMENTS MADE PERSONAL</p>
        <h1 id="ux15-hero-title" className="ux15-hero-title ux15-hero-enter" style={{ animationDelay: "150ms" }}>Send money to people.<br /><span>Not wallet addresses.</span></h1>
        <p className="ux15-hero-copy ux15-hero-enter" style={{ animationDelay: "270ms" }}>Reach turns a payment into a private, passkey-ready handoff. Fund once, share a link, and let the right person claim.</p>
        <div className="ux15-hero-actions ux15-hero-enter" style={{ animationDelay: "390ms" }}><button type="button" className="ux15-button ux15-button-primary" onClick={start}>{isConnected ? "Open Reach" : "Get started"}<ArrowRightIcon size={17} /></button><button type="button" className="ux15-button ux15-button-outline" onClick={() => goTo("how-it-works")}>How it works<ArrowRightIcon size={17} /></button></div>
        <p className="ux15-hero-note ux15-hero-enter" style={{ animationDelay: "510ms" }}>Reach currently uses test tokens, not real money.</p>
      </div><HeroHandoffScene /></div></section>

      <section className="ux15-intro ux15-animate" aria-labelledby="ux15-intro-title"><div className="ux15-shell ux15-intro-grid"><p className="ux15-index">01 / THE IDEA</p><div><h2 id="ux15-intro-title">A calmer way to<br />move value.</h2><p>A payment should not begin with a wallet address or a technical setup guide. Reach gives the sender a clear review, the recipient a private link, and both sides an honest record of what happened.</p><span className="ux15-intro-tag">Built for people sending money to people.</span></div></div></section>

      <section className="ux15-process ux15-section ux15-animate" id="how-it-works" aria-labelledby="ux15-process-title"><div className="ux15-shell"><div className="ux15-section-head ux15-section-head-centered"><p className="ux15-eyebrow">A VISIBLE HANDOFF</p><h2 id="ux15-process-title">How Reach works</h2><p>Four moments from account to outcome, with the state of each payout available in the app.</p></div><div className="ux15-steps">{steps.map(({ n, title, text, Icon }) => <article className="ux15-step" key={n}><span className="ux15-step-number">{n}</span><Icon size={21} /><h3>{title}</h3><p>{text}</p></article>)}</div><p className="ux15-process-note">Already have a passkey account? Return to the same account to see your balance and Activity.</p></div></section>

      <section className="ux15-payments ux15-section ux15-animate" id="payments" aria-labelledby="ux15-payments-title"><div className="ux15-shell"><div className="ux15-section-head ux15-section-head-centered"><p className="ux15-eyebrow">THREE WAYS TO SEND</p><h2 id="ux15-payments-title">The right way for each payment.</h2><p>Choose a straightforward handoff, add recipient verification, or prepare several payouts together.</p></div><div className="ux15-payment-grid">
        <article className="ux15-payment-card"><span className="ux15-card-icon"><ZapIcon size={22} /></span><span className="ux15-card-index">01 / FAST</span><h3>Fast Payments</h3><p>Send test tokens without collecting a wallet address first. Review the amount, expiry, and recipient handoff before approving.</p><button type="button" onClick={start}>Start a payment <ArrowRightIcon size={17} /></button></article>
        <article className="ux15-payment-card"><span className="ux15-card-icon"><ShieldCheckIcon size={22} /></span><span className="ux15-card-index">02 / PROTECTED</span><h3>Protected Payments</h3><p>Add recipient verification when a handoff needs another layer of confidence. The recipient completes the selected check before claiming.</p><button type="button" onClick={start}>Protect a payment <ArrowRightIcon size={17} /></button></article>
        <article className="ux15-payment-card"><span className="ux15-card-icon"><LinkIcon size={22} /></span><span className="ux15-card-index">03 / BATCH</span><h3>Batch Payments</h3><p>Prepare multiple human payouts together. Keep each claim link distinct and follow every payout separately in Activity.</p><button type="button" onClick={start}>Build a batch <ArrowRightIcon size={17} /></button></article>
      </div></div></section>

      <section className="ux15-handoff ux15-section ux15-animate" aria-labelledby="ux15-handoff-title"><div className="ux15-shell ux15-handoff-grid"><div className="ux15-handoff-copy"><p className="ux15-eyebrow">PRIVATE BY DESIGN</p><h2 id="ux15-handoff-title">A link for the right person.<br />A record for both sides.</h2><p>The sender creates and funds a payment, then shares a private claim link. The recipient can open a Reach account with a device passkey and claim through the normal flow. The link grants access to claim: share it only with the intended person.</p><button type="button" className="ux15-button ux15-button-light" onClick={start}>Explore Reach <ArrowRightIcon size={17} /></button></div><div className="ux15-handoff-art" aria-hidden="true"><div className="ux15-orbit ux15-orbit-one" /><div className="ux15-orbit ux15-orbit-two" /><div className="ux15-beam ux15-beam-one" /><div className="ux15-beam ux15-beam-two" /><div className="ux15-beam ux15-beam-three" /><div className="ux15-handoff-center"><span className="ux15-handoff-glyph"><LinkIcon size={30} /></span><span>PRIVATE HANDOFF</span></div><span className="ux15-orbit-dot ux15-orbit-dot-one" /><span className="ux15-orbit-dot ux15-orbit-dot-two" /></div></div></section>

      <section className="ux15-confidence ux15-section ux15-animate" aria-labelledby="ux15-confidence-title"><div className="ux15-shell ux15-confidence-grid"><div className="ux15-confidence-copy"><p className="ux15-eyebrow">BEYOND THE SEND BUTTON</p><h2 id="ux15-confidence-title">Clear from funding to recovery.</h2><p>Reach shows your balance from the payment network and lets you review a payment before you approve it. If it is not claimed, Activity is where you check its latest status and reclaim eligible funds after expiry.</p><button type="button" className="ux15-button ux15-button-outline" onClick={start}>Open your account <ArrowRightIcon size={17} /></button></div><div className="ux15-confidence-list"><div><span>01</span><strong>Funding & balance</strong><p>Use Funding to prepare your account, then see your test-token balance in Reach.</p></div><div><span>02</span><strong>Recipient claiming</strong><p>A private link opens the claim flow. Reach covers the recipient's claim fee when its sponsorship service is available.</p></div><div><span>03</span><strong>Activity & return</strong><p>Check payment status, expiry and the sender-only path to reclaim eligible unclaimed funds.</p></div></div></div></section>

      <section className="ux15-trust ux15-section ux15-animate" id="trust" aria-labelledby="ux15-trust-title"><div className="ux15-shell"><div className="ux15-section-head ux15-section-head-centered"><p className="ux15-eyebrow">BUILT FOR CLARITY</p><h2 id="ux15-trust-title">The details should be visible.</h2><p>Your device opens the account, the payment has clear rules, and Reach helps you recover from uncertainty.</p></div><div className="ux15-trust-grid"><div><GlobeIcon size={20} /><strong>Test tokens</strong><span>For trying Reach, not real money</span></div><div><FingerprintIcon size={20} /><strong>Passkey account</strong><span>Sign in with your device's security</span></div><div><DatabaseIcon size={20} /><strong>Payment protection</strong><span>Clear rules for claiming or reclaiming</span></div><div><LockIcon size={20} /><strong>Private claim</strong><span>Share the link only with your recipient</span></div><div><ClockIcon size={20} /><strong>Expiry and reclaim</strong><span>Recover eligible unclaimed payments</span></div><div><KeyIcon size={20} /><strong>Activity record</strong><span>Check the latest status before acting</span></div></div></div></section>

      <section className="ux15-faq ux15-section ux15-animate" id="faq" aria-labelledby="ux15-faq-title"><div className="ux15-shell ux15-faq-grid"><div className="ux15-faq-intro"><p className="ux15-eyebrow">GOOD TO KNOW</p><h2 id="ux15-faq-title">Questions,<br />answered plainly.</h2><p>What your passkey does, how claiming works, and what happens when a payment expires.</p></div><div className="ux15-faq-list">{faqs.map((item, index) => { const isOpen = activeFaq === index; const answerId = `reach-faq-answer-${index}`; return <div className={`ux15-faq-item ${isOpen ? "is-open" : ""}`} key={item.q}><button type="button" aria-expanded={isOpen} aria-controls={answerId} onClick={() => setActiveFaq(isOpen ? null : index)}><span className="ux15-faq-number">{String(index + 1).padStart(2, "0")}</span><span>{item.q}</span><ChevronDownIcon size={17} /></button><div id={answerId} className="ux15-faq-answer" aria-hidden={!isOpen}><p>{item.a}</p></div></div>; })}</div></div></section>

      <section className="ux15-final ux15-section ux15-animate" aria-labelledby="ux15-final-title"><div className="ux15-shell ux15-final-inner"><p className="ux15-eyebrow">START WITH A HUMAN PAYMENT</p><h2 id="ux15-final-title">A simpler handoff starts here.</h2><p>Create a passkey account, add test tokens, and send with a clear path from creation to claim.</p><button type="button" className="ux15-button ux15-button-primary" onClick={start}>{isConnected ? "Open Reach" : "Create your account"}<ArrowRightIcon size={17} /></button></div></section>
    </main>
    <footer className="ux15-footer"><div className="ux15-shell"><div className="ux15-footer-top"><div><button type="button" className="ux15-brand" onClick={() => goTo("top")} aria-label="Back to Reach home">{brand}</button><p>Passkey-powered payments between people.</p></div><div className="ux15-footer-links"><div><span>Explore</span><button type="button" onClick={() => goTo("payments")}>Payments</button><button type="button" onClick={() => goTo("how-it-works")}>How it works</button><button type="button" onClick={() => goTo("faq")}>FAQ</button></div><div><span>Reach</span><button type="button" onClick={start}>Open app</button><button type="button" onClick={() => goTo("trust")}>Trust & custody</button><a href="https://github.com/Techkeyy/Reach" target="_blank" rel="noreferrer">Source <ExternalLinkIcon size={13} /></a></div></div></div><div className="ux15-footer-bottom"><span>Using test tokens, not real money</span><span>Reach · human payments, made simple</span></div></div></footer>
  </div>;
}
