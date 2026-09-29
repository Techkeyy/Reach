import React from "react";
import { authFailureCopy, type AuthFailureKind } from "./authFlow";
import {
  ArrowRightIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  FingerprintIcon,
  PasskeyIcon,
  ReachLogo,
  ShieldCheckIcon,
} from "./components/Icons";

export type AccountOnboardingStage =
  | "ACCOUNT_GATEWAY"
  | "CREATE_EXPLAINER"
  | "REGISTERING_PASSKEY"
  | "CREATING_ACCOUNT"
  | "PASSKEY_CREATED_SETUP_INCOMPLETE"
  | "FINISHING_SETUP"
  | "ACCOUNT_READY"
  | "LOGIN"
  | "AUTHENTICATING"
  | "RESOLVING_ACCOUNT"
  | "SESSION_READY"
  | "RESTORING_SESSION"
  | "AUTH_FAILED";

export type AccountAuthFlow = "register" | "login";

type AccountGatewayProps = {
  stage: AccountOnboardingStage;
  authFlow: AccountAuthFlow;
  accountAddress?: string;
  errorMessage?: string | null;
  failureKind?: AuthFailureKind;
  onCreateAccount: () => void;
  onSignIn: () => void;
  onCreatePasskey: () => void;
  onFinishSetup: () => void;
  onSignInWithPasskey: () => void;
  onUseAnotherPasskey: () => void;
  onRetry: () => void;
  onStartOver: () => void;
  onEnterReach: () => void;
};

function shortAddress(address?: string) {
  return address ? address.slice(0, 6) + "..." + address.slice(-4) : "Available after setup";
}

function GatewayHeader({ onStartOver }: { onStartOver: () => void }) {
  return (
    <header className="account-gateway-header">
      <button type="button" className="account-gateway-brand" onClick={onStartOver} aria-label="Back to Reach home">
        <ReachLogo size={32} />
        <span className="brand-title">
          reach<span className="brand-dot">.</span>
        </span>
      </button>
      <span className="account-gateway-network">
        <span className="network-live-dot" />
        Tempo Moderato
      </span>
    </header>
  );
}

function GatewayShell({
  stage,
  children,
  onStartOver,
}: {
  stage: AccountOnboardingStage;
  children: React.ReactNode;
  onStartOver: () => void;
}) {
  return (
    <div className="account-gateway-shell" data-onboarding-stage={stage}>
      <GatewayHeader onStartOver={onStartOver} />
      {children}
      <footer className="account-gateway-footer">
        <ShieldCheckIcon size={16} />
        <span>Your Reach account stays secured by your device.</span>
      </footer>
    </div>
  );
}

export default function AccountGateway({
  stage,
  authFlow,
  accountAddress,
  errorMessage,
  failureKind = "COMPLETE_FAILED",
  onCreateAccount,
  onSignIn,
  onCreatePasskey,
  onFinishSetup,
  onSignInWithPasskey,
  onUseAnotherPasskey,
  onRetry,
  onStartOver,
  onEnterReach,
}: AccountGatewayProps) {
  if (stage === "ACCOUNT_GATEWAY") {
    return (
      <GatewayShell stage={stage} onStartOver={onStartOver}>
        <main className="account-gateway-main" aria-labelledby="account-gateway-title">
          <section className="account-gateway-intro">
            <span className="account-gateway-eyebrow">REACH ACCOUNT</span>
            <h1 id="account-gateway-title">Welcome to Reach</h1>
            <p className="account-gateway-lead">Pay people, not wallet addresses.</p>
            <p className="account-gateway-copy">
              Create an account to send money, receive payments, and manage payouts.
            </p>
            <div className="account-gateway-promise-list" aria-label="Reach account benefits">
              <span>No wallet extension</span>
              <span>No seed phrase</span>
              <span>Use your device security</span>
            </div>
          </section>

          <section className="account-gateway-panel" aria-label="Choose how to enter Reach">
            <div className="account-gateway-panel-icon">
              <FingerprintIcon size={24} />
            </div>
            <h2>Start with your Reach account</h2>
            <p>Choose an option below. Your device will only ask for approval after you choose.</p>
            <div className="account-gateway-actions">
              <button type="button" className="btn-primary btn-large btn-full" onClick={onCreateAccount}>
                Create Reach account
                <ArrowRightIcon size={18} />
              </button>
              <button type="button" className="account-gateway-secondary-action" onClick={onSignIn}>
                Already have a Reach account? <span>Sign in</span>
              </button>
            </div>
          </section>
        </main>
      </GatewayShell>
    );
  }

  if (stage === "CREATE_EXPLAINER") {
    return (
      <GatewayShell stage={stage} onStartOver={onStartOver}>
        <main className="account-gateway-main account-gateway-main-centered" aria-labelledby="account-gateway-title">
          <section className="account-gateway-panel account-gateway-panel-wide">
            <span className="account-gateway-eyebrow">CREATE YOUR ACCOUNT</span>
            <h1 id="account-gateway-title">Secure your Reach account</h1>
            <p className="account-gateway-copy">
              Your device will ask you to create a passkey.
            </p>
            <div className="account-gateway-explainer-list">
              <div>
                <FingerprintIcon size={20} />
                <p>A passkey lets you approve actions using your fingerprint, face, PIN, or device security.</p>
              </div>
              <div>
                <ShieldCheckIcon size={20} />
                <p>Reach never receives your fingerprint.</p>
              </div>
              <div>
                <CheckCircleIcon size={20} />
                <p>No password or seed phrase to save.</p>
              </div>
            </div>
            <div className="account-gateway-actions">
              <button type="button" className="btn-primary btn-large btn-full" onClick={onCreatePasskey}>
                Create passkey
                <PasskeyIcon size={19} />
              </button>
              <button type="button" className="account-gateway-back" onClick={onStartOver}>
                Back
              </button>
            </div>
          </section>
        </main>
      </GatewayShell>
    );
  }

  if (stage === "LOGIN") {
    return (
      <GatewayShell stage={stage} onStartOver={onStartOver}>
        <main className="account-gateway-main account-gateway-main-centered" aria-labelledby="account-gateway-title">
          <section className="account-gateway-panel account-gateway-panel-wide">
            <span className="account-gateway-eyebrow">REACH ACCOUNT</span>
            <h1 id="account-gateway-title">Welcome back</h1>
            <p className="account-gateway-copy">Use your passkey to open your Reach account.</p>
            <div className="account-gateway-actions">
              <button type="button" className="btn-primary btn-large btn-full" onClick={onSignInWithPasskey}>
                Sign in with passkey
                <ArrowRightIcon size={18} />
              </button>
              <button type="button" className="account-gateway-secondary-action" onClick={onUseAnotherPasskey}>
                Use another passkey
              </button>
              <button type="button" className="account-gateway-back" onClick={onStartOver}>
                Back
              </button>
            </div>
          </section>
        </main>
      </GatewayShell>
    );
  }

  if (stage === "ACCOUNT_READY") {
    return (
      <GatewayShell stage={stage} onStartOver={onStartOver}>
        <main className="account-gateway-main account-gateway-main-centered" aria-labelledby="account-gateway-title">
          <section className="account-gateway-panel account-gateway-panel-wide account-gateway-success">
            <div className="account-gateway-success-icon">
              <CheckCircleIcon size={28} />
            </div>
            <span className="account-gateway-eyebrow">ACCOUNT READY</span>
            <h1 id="account-gateway-title">Your Reach account is ready</h1>
            <p className="account-gateway-copy">Secured with passkey.</p>
            <details className="account-gateway-details">
              <summary>
                <span>Technical details</span>
                <ChevronDownIcon size={16} />
              </summary>
              <div className="account-gateway-detail-list">
                <div>
                  <span>Network</span>
                  <strong>Tempo Moderato</strong>
                </div>
                <div>
                  <span>Account address</span>
                  <code>{shortAddress(accountAddress)}</code>
                </div>
              </div>
            </details>
            <button type="button" className="btn-primary btn-large btn-full" onClick={onEnterReach}>
              Enter Reach
              <ArrowRightIcon size={18} />
            </button>
          </section>
        </main>
      </GatewayShell>
    );
  }

  if (stage === "PASSKEY_CREATED_SETUP_INCOMPLETE") {
    return (
      <GatewayShell stage={stage} onStartOver={onStartOver}>
        <main className="account-gateway-main account-gateway-main-centered" aria-labelledby="account-gateway-title">
          <section className="account-gateway-panel account-gateway-panel-wide account-gateway-error">
            <div className="account-gateway-error-mark" aria-hidden="true" />
            <span className="account-gateway-eyebrow">FINISH SETUP</span>
            <h1 id="account-gateway-title">Your passkey was created, but Reach couldn't finish setting up your account.</h1>
            <p className="account-gateway-copy">Your passkey is still available on this device. Finish setup to use it without creating another passkey.</p>
            <details className="account-gateway-details account-gateway-error-details">
              <summary>
                <span>Technical details</span>
                <ChevronDownIcon size={16} />
              </summary>
              <p>{errorMessage || "The registration completion can be retried."}</p>
            </details>
            <div className="account-gateway-actions">
              <button type="button" className="btn-primary btn-large btn-full" onClick={onFinishSetup}>
                Finish setup
              </button>
              <button type="button" className="account-gateway-back" onClick={onStartOver}>
                Start over
              </button>
            </div>
          </section>
        </main>
      </GatewayShell>
    );
  }

  if (stage === "AUTH_FAILED") {
    const { title, summary } = authFailureCopy(authFlow, failureKind);

    return (
      <GatewayShell stage={stage} onStartOver={onStartOver}>
        <main className="account-gateway-main account-gateway-main-centered" aria-labelledby="account-gateway-title">
          <section className="account-gateway-panel account-gateway-panel-wide account-gateway-error">
            <div className="account-gateway-error-mark" aria-hidden="true" />
            <span className="account-gateway-eyebrow">TRY AGAIN</span>
            <h1 id="account-gateway-title">{title}</h1>
            <div className="account-gateway-alert" role="alert" aria-live="assertive">
              <strong>{title}</strong>
              <span>{summary}</span>
            </div>
            <details className="account-gateway-details account-gateway-error-details">
              <summary>
                <span>Technical details</span>
                <ChevronDownIcon size={16} />
              </summary>
              <p>{errorMessage || "No additional details were provided."}</p>
            </details>
            <div className="account-gateway-actions">
              <button type="button" className="btn-primary btn-large btn-full" onClick={onRetry}>
                Try again
              </button>
              {authFlow === "login" ? (
                <button type="button" className="btn-secondary btn-large btn-full" onClick={onUseAnotherPasskey}>
                  Use another passkey
                </button>
              ) : null}
              <button type="button" className="account-gateway-back" onClick={onStartOver}>
                Start over
              </button>
            </div>
          </section>
        </main>
      </GatewayShell>
    );
  }

  const loadingCopy: Record<AccountOnboardingStage, { title: string; body: string }> = {
    ACCOUNT_GATEWAY: { title: "Welcome to Reach", body: "" },
    CREATE_EXPLAINER: { title: "Secure your Reach account", body: "" },
    REGISTERING_PASSKEY: {
      title: "Creating your passkey",
      body: "Your device will ask you to approve this with your fingerprint, face, PIN, or device security.",
    },
    CREATING_ACCOUNT: {
      title: "Setting up your Reach account",
      body: "Finishing your account setup now.",
    },
    PASSKEY_CREATED_SETUP_INCOMPLETE: {
      title: "Your passkey was created",
      body: "Reach couldn't finish setting up your account.",
    },
    FINISHING_SETUP: {
      title: "Finishing your account setup",
      body: "Using the passkey you already created.",
    },
    ACCOUNT_READY: { title: "Your Reach account is ready", body: "" },
    LOGIN: { title: "Welcome back", body: "" },
    AUTHENTICATING: {
      title: "Opening your Reach account...",
      body: "Confirm with your device when it asks.",
    },
    RESOLVING_ACCOUNT: {
      title: "Opening your Reach account...",
      body: "Finding your Reach account.",
    },
    SESSION_READY: {
      title: "Opening Reach...",
      body: "Your account is ready.",
    },
    RESTORING_SESSION: {
      title: "Opening Reach...",
      body: "Checking for your existing session.",
    },
    AUTH_FAILED: { title: "Try again", body: "" },
  };
  const copy = loadingCopy[stage];

  return (
    <GatewayShell stage={stage} onStartOver={onStartOver}>
      <main className="account-gateway-main account-gateway-main-centered" aria-labelledby="account-gateway-title">
        <section className="account-gateway-panel account-gateway-panel-wide account-gateway-processing" aria-live="polite">
          <div className="account-gateway-spinner" aria-hidden="true" />
          <span className="account-gateway-eyebrow">REACH ACCOUNT</span>
          <h1 id="account-gateway-title">{copy.title}</h1>
          <p className="account-gateway-copy">{copy.body}</p>
          {stage === "RESTORING_SESSION" ? (
            <button type="button" className="account-gateway-back" onClick={onStartOver}>
              Choose an account
            </button>
          ) : null}
        </section>
      </main>
    </GatewayShell>
  );
}
