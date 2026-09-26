import React, { useCallback, useMemo, useState } from "react";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { type Address, type Hex } from "viem";
import {
  DEFAULT_VAULT_ADDRESS,
  PATH_USD_ADDRESS,
  TEMPO_MODERATO_CHAIN_ID,
} from "../shared/reach";
import { formatPathUsd, parsePathUsdAmount } from "./senderFlow";
import {
  TerminalIcon,
  KeyIcon,
  ShieldCheckIcon,
  CopyIcon,
  CheckCircleIcon,
  AlertCircleIcon,
  LockIcon,
  ExternalLinkIcon,
  PlusIcon,
  RefreshIcon,
} from "./components/Icons";

export type AgentConfig = {
  version: number;
  network: string;
  chainId: number;
  ownerAddress: string;
  agentAddress: string;
  agentPrivateKey?: string;
  vaultAddress: string;
  pathUsdAddress: string;
  budgetLimitPathUsd: string;
  budgetLimitRaw: string;
  expiryTimestamp: number;
  expiryIso: string;
  scopes: { address: string; description: string }[];
  createdAt: string;
};

type AutomationExperienceProps = {
  connectedAddress?: Address;
  pathUsdBalance?: string;
  onDone: () => void;
};

const vaultAddress = ((typeof import.meta !== "undefined" && import.meta.env?.VITE_REACH_VAULT_ADDRESS) || DEFAULT_VAULT_ADDRESS) as Address;

export default function AutomationExperience({
  connectedAddress,
  pathUsdBalance,
  onDone,
}: AutomationExperienceProps) {
  const [agentPrivateKey, setAgentPrivateKey] = useState<Hex>(() => generatePrivateKey());
  const [budgetInput, setBudgetInput] = useState("100");
  const [expiryDays, setExpiryDays] = useState(7);
  const [generatedConfig, setGeneratedConfig] = useState<AgentConfig | null>(null);
  const [copiedJson, setCopiedJson] = useState(false);
  const [copiedCli, setCopiedCli] = useState(false);

  const agentAccount = useMemo(() => {
    try {
      return privateKeyToAccount(agentPrivateKey);
    } catch {
      return null;
    }
  }, [agentPrivateKey]);

  const handleRegenerateKey = () => {
    setAgentPrivateKey(generatePrivateKey());
    setGeneratedConfig(null);
  };

  const handleGenerateConfig = () => {
    if (!connectedAddress || !agentAccount) return;

    const budgetRaw = parsePathUsdAmount(budgetInput) ?? 100_000_000n;
    const expiryTimestamp = Math.floor(Date.now() / 1000) + expiryDays * 24 * 3600;

    const config: AgentConfig = {
      version: 1,
      network: "Tempo Moderato",
      chainId: TEMPO_MODERATO_CHAIN_ID,
      ownerAddress: connectedAddress,
      agentAddress: agentAccount.address,
      agentPrivateKey: agentPrivateKey,
      vaultAddress,
      pathUsdAddress: PATH_USD_ADDRESS,
      budgetLimitPathUsd: budgetInput,
      budgetLimitRaw: budgetRaw.toString(),
      expiryTimestamp,
      expiryIso: new Date(expiryTimestamp * 1000).toISOString(),
      scopes: [
        {
          address: PATH_USD_ADDRESS,
          description: "TIP-20 pathUSD: approve(address,uint256) [0x095ea7b3] only. Direct transfer is forbidden.",
        },
        {
          address: vaultAddress,
          description: "ReachPayoutVault: createPayout(...) [0x28e47b74] only. Reclaim is forbidden.",
        },
      ],
      createdAt: new Date().toISOString(),
    };

    setGeneratedConfig(config);
  };

  const downloadConfigJson = () => {
    if (!generatedConfig) return;
    const jsonStr = JSON.stringify(generatedConfig, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reach-agent-config-${generatedConfig.agentAddress.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyConfigJson = () => {
    if (!generatedConfig) return;
    void navigator.clipboard.writeText(JSON.stringify(generatedConfig, null, 2));
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
  };

  const cliExample = generatedConfig
    ? `pnpm tsx scripts/agent-payout.ts --config ./reach-agent-config.json --amount 10.00 --name "Contractor Alice" --note "API Grant"`
    : "";

  const copyCliCommand = () => {
    if (!cliExample) return;
    void navigator.clipboard.writeText(cliExample);
    setCopiedCli(true);
    setTimeout(() => setCopiedCli(false), 2000);
  };

  return (
    <div className="send-experience-layout" style={{ maxWidth: "760px", margin: "0 auto", padding: "16px" }}>
      {/* Header */}
      <div className="send-header" style={{ marginBottom: "20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ padding: "10px", background: "var(--bg-subtle)", borderRadius: "var(--radius-md)", color: "var(--primary)" }}>
            <TerminalIcon size={24} />
          </div>
          <div>
            <h1 style={{ fontSize: "22px", fontWeight: 800, margin: 0, color: "var(--ink-primary)" }}>
              Agent & Automation Payouts
            </h1>
            <p style={{ fontSize: "13px", color: "var(--ink-muted)", margin: "4px 0 0 0" }}>
              Authorize autonomous agents or backend bots to create Reach payouts within onchain spending limits.
            </p>
          </div>
        </div>
      </div>

      <div className="send-card-composer" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        {/* Architecture Explanation Banner */}
        <div
          style={{
            background: "var(--bg-subtle)",
            border: "1px solid var(--border-default)",
            borderRadius: "var(--radius-lg)",
            padding: "16px 20px",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <ShieldCheckIcon size={18} style={{ color: "var(--primary)" }} />
            <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--ink-primary)" }}>
              Native Tempo Scoped Access Keys
            </span>
          </div>
          <p style={{ fontSize: "13px", color: "var(--ink-secondary)", margin: 0, lineHeight: 1.5 }}>
            Reach leverages Tempo’s native <strong>AccountKeychain</strong> permissions. An agent key is cryptographically restricted onchain: it can only spend up to its allocated pathUSD budget, expires automatically at the set timestamp, and cannot interact with arbitrary smart contracts.
          </p>
        </div>

        {/* Configuration Form */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* Agent Keypair Box */}
          <div className="input-group">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--ink-muted)" }}>
                Agent Key Address (Signer)
              </label>
              <button
                type="button"
                className="btn-text-action"
                onClick={handleRegenerateKey}
                style={{ fontSize: "12px", display: "flex", alignItems: "center", gap: 4 }}
              >
                <RefreshIcon size={12} />
                <span>Generate New Keypair</span>
              </button>
            </div>
            <input
              type="text"
              readOnly
              className="text-input"
              value={agentAccount?.address ?? ""}
              style={{ fontFamily: "monospace", fontSize: "13px" }}
            />
          </div>

          {/* Budget Limit & Expiry Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <div className="input-group">
              <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--ink-muted)" }}>
                Max pathUSD Budget Limit
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <input
                  type="number"
                  step="any"
                  min="1"
                  className="text-input"
                  value={budgetInput}
                  onChange={(e) => setBudgetInput(e.target.value)}
                  style={{ fontSize: "14px", fontWeight: 600 }}
                />
                <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--ink-muted)" }}>pathUSD</span>
              </div>
            </div>

            <div className="input-group">
              <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--ink-muted)" }}>
                Expiration Window
              </label>
              <select
                className="text-input"
                value={expiryDays}
                onChange={(e) => setExpiryDays(Number(e.target.value))}
                style={{ fontSize: "13px" }}
              >
                <option value={1}>24 Hours</option>
                <option value={7}>7 Days</option>
                <option value={30}>30 Days</option>
                <option value={90}>90 Days</option>
              </select>
            </div>
          </div>

          {/* Scopes Overview */}
          <div
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-default)",
              borderRadius: "var(--radius-md)",
              padding: "12px 16px",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--ink-muted)" }}>
              Enforced Target & Selector Scopes (Onchain)
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "monospace" }}>
                <span style={{ color: "var(--ink-secondary)" }}>pathUSD Token:</span>
                <span style={{ color: "var(--ink-primary)" }}>{PATH_USD_ADDRESS} (approve only)</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "monospace" }}>
                <span style={{ color: "var(--ink-secondary)" }}>ReachPayoutVault:</span>
                <span style={{ color: "var(--ink-primary)" }}>{vaultAddress} (createPayout only)</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "monospace" }}>
                <span style={{ color: "var(--ink-secondary)" }}>Forbidden:</span>
                <span style={{ color: "var(--danger)" }}>transfer(), reclaim(), arbitrary calls</span>
              </div>
            </div>
          </div>

          {/* Action Trigger */}
          <button
            type="button"
            className="btn-primary btn-large btn-full"
            onClick={handleGenerateConfig}
            disabled={!connectedAddress}
          >
            <KeyIcon size={18} />
            <span>Generate Scoped Agent Key Configuration</span>
          </button>
        </div>

        {/* Generated Config Output Screen */}
        {generatedConfig && (
          <div
            style={{
              background: "var(--bg-subtle)",
              border: "1px solid var(--border-default)",
              borderRadius: "var(--radius-lg)",
              padding: "20px",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <CheckCircleIcon size={20} style={{ color: "var(--success)" }} />
                <span style={{ fontSize: "15px", fontWeight: 700, color: "var(--ink-primary)" }}>
                  Agent Configuration Ready
                </span>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  className={`btn-copy ${copiedJson ? "btn-copied" : "btn-secondary"}`}
                  onClick={copyConfigJson}
                  style={{ minHeight: "32px", padding: "6px 12px", fontSize: "12px" }}
                >
                  <CopyIcon size={12} />
                  <span>{copiedJson ? "Copied" : "Copy JSON"}</span>
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={downloadConfigJson}
                  style={{ minHeight: "32px", padding: "6px 12px", fontSize: "12px" }}
                >
                  <span>Download JSON</span>
                </button>
              </div>
            </div>

            {/* Quick CLI Run Instructions */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--ink-muted)" }}>
                Run Automated Payout via Agent Script:
              </span>
              <div
                style={{
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border-default)",
                  borderRadius: "var(--radius-md)",
                  padding: "10px 14px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "10px",
                }}
              >
                <code style={{ fontSize: "12px", color: "var(--ink-primary)", overflowX: "auto" }}>
                  {cliExample}
                </code>
                <button
                  type="button"
                  className="btn-inline-copy"
                  onClick={copyCliCommand}
                  style={{ fontSize: "12px", color: "var(--primary)", flexShrink: 0 }}
                >
                  {copiedCli ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
