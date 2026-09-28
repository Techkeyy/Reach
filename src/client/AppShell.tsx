import React from "react";
import {
  ReachLogo,
  HomeIcon,
  SendIcon,
  ActivityIcon,
  WalletIcon,
  LayersIcon,
  TerminalIcon,
} from "./components/Icons";

export type AppView = "landing" | "home" | "fund" | "send" | "batch" | "automation" | "activity" | "payout-detail";

type AppShellProps = {
  currentView: AppView;
  onNavigate: (view: AppView) => void;
  isConnected: boolean;
  connectedAddress?: string;
  onConnectWallet: () => void;
  onDisconnectWallet: () => void;
  pathUsdBalance?: string;
  children: React.ReactNode;
};

export default function AppShell({
  currentView,
  onNavigate,
  isConnected,
  connectedAddress,
  onConnectWallet,
  onDisconnectWallet,
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
          <div className="sidebar-brand" onClick={() => onNavigate(isConnected ? "home" : "landing")}>
            <ReachLogo size={28} />
            <span className="brand-title">reach<span className="brand-dot">.</span></span>
          </div>

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
              className={`sidebar-nav-item ${currentView === "automation" ? "active" : ""}`}
              onClick={() => onNavigate("automation")}
            >
              <TerminalIcon size={18} />
              <span>Agents</span>
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

          {isConnected ? (
            <div className="account-card-sidebar">
              <div className="account-info">
                <span className="account-addr">{shortAddress}</span>
                <span className="account-bal">{pathUsdBalance ? `${pathUsdBalance} pathUSD` : "0.00 pathUSD"}</span>
              </div>
              <button
                type="button"
                className="btn-disconnect"
                onClick={onDisconnectWallet}
                title="Disconnect wallet"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button type="button" className="btn-primary btn-connect-sidebar" onClick={onConnectWallet}>
              <WalletIcon size={16} />
              <span>Connect Wallet</span>
            </button>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="app-main-area">
        {/* Mobile Top Header */}
        <header className="mobile-header">
          <div className="mobile-header-brand" onClick={() => onNavigate(isConnected ? "home" : "landing")}>
            <ReachLogo size={24} />
            <span className="brand-title">reach<span className="brand-dot">.</span></span>
          </div>

          <div className="mobile-header-actions">
            {isConnected ? (
              <button type="button" className="mobile-account-chip" onClick={onDisconnectWallet}>
                <span className="connected-dot" />
                <span>{shortAddress}</span>
              </button>
            ) : (
              <button type="button" className="btn-primary btn-sm" onClick={onConnectWallet}>
                Connect
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
            className={`bottom-nav-item ${currentView === "automation" ? "active" : ""}`}
            onClick={() => onNavigate("automation")}
          >
            <TerminalIcon size={20} />
            <span>Agents</span>
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
