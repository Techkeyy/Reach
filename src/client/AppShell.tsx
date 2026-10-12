import React from "react";
import {
  ReachLogo,
  HomeIcon,
  SendIcon,
  ActivityIcon,
  WalletIcon,
  LayersIcon,
} from "./components/Icons";

export type AppView = "landing" | "home" | "fund" | "send" | "batch" | "activity" | "payout-detail";

type AppShellProps = {
  currentView: AppView;
  onNavigate: (view: AppView) => void;
  isConnected: boolean;
  connectedAddress?: string;
  onConnectWallet: () => void;
  onSignOut: () => void;
  isSigningOut: boolean;
  pathUsdBalance?: string;
  children: React.ReactNode;
};

export default function AppShell({
  currentView,
  onNavigate,
  isConnected,
  connectedAddress,
  onConnectWallet,
  onSignOut,
  isSigningOut,
  pathUsdBalance,
  children,
}: AppShellProps) {
  const shortAddress = connectedAddress
    ? `${connectedAddress.slice(0, 6)}...${connectedAddress.slice(-4)}`
    : "";

  return (
    <div className="app-layout">
      {/* Desktop Left Rail Navigation */}
      <aside className="desktop-sidebar">
        <div className="sidebar-top">
          <a className="sidebar-brand" href="/" aria-label="Reach home" onClick={(event) => { event.preventDefault(); onNavigate("landing"); }}>
            <ReachLogo size={52} />
          </a>

          <nav className="sidebar-nav" aria-label="App Navigation">
            <button
              type="button"
              className={`sidebar-nav-item ${currentView === "home" ? "active" : ""}`}
              onClick={() => onNavigate("home")}
            >
              <HomeIcon size={18} />
              <span>Home</span>
            </button>

            <button
              type="button"
              className={`sidebar-nav-item ${currentView === "send" ? "active" : ""}`}
              onClick={() => onNavigate("send")}
            >
              <SendIcon size={18} />
              <span>Send</span>
            </button>

            <button
              type="button"
              className={`sidebar-nav-item ${currentView === "batch" ? "active" : ""}`}
              onClick={() => onNavigate("batch")}
            >
              <LayersIcon size={18} />
              <span>Batch</span>
            </button>

            <button
              type="button"
              className={`sidebar-nav-item ${currentView === "activity" || currentView === "payout-detail" ? "active" : ""}`}
              onClick={() => onNavigate("activity")}
            >
              <ActivityIcon size={18} />
              <span>Activity</span>
            </button>
          </nav>
        </div>

        <div className="sidebar-bottom">
          <div className="network-status-badge">
            <span className="network-live-dot" />
            <span>Tempo Moderato</span>
          </div>

          {isConnected || isSigningOut ? (
            <div className="account-card-sidebar">
              <div className="account-info">
                <span className="account-addr">{shortAddress}</span>
                <span className="account-bal">{pathUsdBalance ? `${pathUsdBalance} pathUSD` : "0.00 pathUSD"}</span>
              </div>
              <button
                type="button"
                className="btn-disconnect"
                onClick={onSignOut}
                disabled={isSigningOut}
                title={isSigningOut ? "Signing out" : "Sign out"}
              >
                {isSigningOut ? "Signing out…" : "Sign out"}
              </button>
            </div>
          ) : (
            <button type="button" className="btn-primary btn-connect-sidebar" onClick={onConnectWallet}>
              <WalletIcon size={16} />
              <span>Sign in</span>
            </button>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="app-main-area">
        {/* Mobile Top Header */}
        <header className="mobile-header">
          <a className="mobile-header-brand" href="/" aria-label="Reach home" onClick={(event) => { event.preventDefault(); onNavigate("landing"); }}>
            <ReachLogo size={44} />
          </a>

          <div className="mobile-header-actions">
            {isConnected || isSigningOut ? (
              <button type="button" className="mobile-account-chip" onClick={onSignOut} disabled={isSigningOut} aria-label={isSigningOut ? "Signing out" : "Sign out"}>
                <span className="connected-dot" />
                <span>{isSigningOut ? "Signing out…" : shortAddress}</span>
              </button>
            ) : (
              <button type="button" className="btn-primary btn-sm" onClick={onConnectWallet}>
                Sign in
              </button>
            )}
          </div>
        </header>

        {/* Page / View Content */}
        <main className="app-content-body">
          <p className="fund-network">TESTNET · Tempo Moderato</p>
          {children}
        </main>

        {/* Mobile Bottom Navigation Bar */}
        <nav className="mobile-bottom-nav" aria-label="Mobile Navigation">
          <button
            type="button"
            className={`bottom-nav-item ${currentView === "home" ? "active" : ""}`}
            onClick={() => onNavigate("home")}
          >
            <HomeIcon size={20} />
            <span>Home</span>
          </button>

          <button
            type="button"
            className={`bottom-nav-item ${currentView === "send" ? "active" : ""}`}
            onClick={() => onNavigate("send")}
          >
            <SendIcon size={20} />
            <span>Send</span>
          </button>

          <button
            type="button"
            className={`bottom-nav-item ${currentView === "batch" ? "active" : ""}`}
            onClick={() => onNavigate("batch")}
          >
            <LayersIcon size={20} />
            <span>Batch</span>
          </button>

          <button
            type="button"
            className={`bottom-nav-item ${currentView === "activity" || currentView === "payout-detail" ? "active" : ""}`}
            onClick={() => onNavigate("activity")}
          >
            <ActivityIcon size={20} />
            <span>Activity</span>
          </button>
        </nav>
      </div>
    </div>
  );
}
