import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { useConnectorClient, usePublicClient } from "wagmi";
import { DEFAULT_VAULT_ADDRESS, PATH_USD_ADDRESS, TEMPO_MODERATO_CHAIN_ID } from "../shared/reach";
import { expiryFromChainTimestamp, readChainTimestamp } from "./chainTime";
import { formatPathUsd, parsePathUsdAmount } from "./senderFlow";
import { AlertCircleIcon, CheckCircleIcon, KeyIcon, RefreshIcon, ShieldCheckIcon, TerminalIcon } from "./components/Icons";

type AgentPolicy = {
  id: string;
  ownerAddress: Address;
  agentAddress: Address;
  chainId: number;
  currency: Address;
  maxPerPaymentRaw: string;
  cumulativeBudgetRaw: string;
  reservedRaw: string;
  spentRaw: string;
  expiryTimestamp: number;
  allowedDestinations: Address[] | null;
  allowedOrigins: string[] | null;
  purpose: "VAULT_PAYOUT" | "MPP_DIRECT" | "MPP_SESSION";
  status: "PENDING" | "ACTIVE" | "REVOKED" | "EXPIRED";
  createdAt: string;
  updatedAt: string;
  remainingRaw: string;
};

type MppPayment = {
  id: string;
  idempotencyKey: string;
  mode: "charge" | "session";
  amountRaw: string;
  recipient: Address;
  endpointOrigin: string;
  state: "RESERVED" | "CONFIRMED" | "FAILED" | "UNKNOWN";
  reference?: string;
  receipt?: { status?: string; method?: string; reference?: string };
  responseStatus?: number;
  responseBody?: string;
  responseContentType?: string;
  error?: string;
  updatedAt: string;
};

type HealthState = { mpp?: { configured: boolean; recipient?: Address; price?: string; chainId?: number } };

type AutomationExperienceProps = {
  connectedAddress?: Address;
  pathUsdBalance?: string;
  onDone: () => void;
  sessionFixture?: boolean;
};

const storagePrefix = "reach.agent.session.v1:";
const defaultVaultAddress = ((typeof import.meta !== "undefined" && import.meta.env?.VITE_REACH_VAULT_ADDRESS) || DEFAULT_VAULT_ADDRESS) as Address;

function amount(raw: string | undefined): string {
  try { return formatPathUsd(BigInt(raw ?? "0")); } catch { return "0.00"; }
}

function short(value: string | undefined): string {
  return value ? `${value.slice(0, 8)}...${value.slice(-6)}` : "not available";
}

function prettyBody(body: string | undefined): string {
  if (!body) return "No service body was recorded.";
  try { return JSON.stringify(JSON.parse(body), null, 2); } catch { return body; }
}

function originFromUrl(value: string): string { return new URL(value).origin.toLowerCase(); }

export default function AutomationExperience({ connectedAddress, pathUsdBalance, onDone, sessionFixture = false }: AutomationExperienceProps) {
  const publicClient = usePublicClient();
  const { data: connectorClient } = useConnectorClient();
  const [health, setHealth] = useState<HealthState | null>(null);
  const [policies, setPolicies] = useState<AgentPolicy[]>([]);
  const [selectedPolicyId, setSelectedPolicyId] = useState<string | null>(null);
  const [mppPayments, setMppPayments] = useState<MppPayment[]>([]);
  const [payoutPayments, setPayoutPayments] = useState<unknown[]>([]);
  const [mode, setMode] = useState<"charge" | "session">("charge");
  const [budgetInput, setBudgetInput] = useState("1.00");
  const [expiryDays, setExpiryDays] = useState(7);
  const [serviceUrl, setServiceUrl] = useState(() => `${window.location.origin}/api/mpp/agent-service`);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [latestResult, setLatestResult] = useState<{ payment?: MppPayment; response?: { status?: number; body?: string; contentType?: string } } | null>(null);
  const [sessionClosed, setSessionClosed] = useState(false);

  const selectedPolicy = useMemo(() => policies.find((policy) => policy.id === selectedPolicyId) ?? null, [policies, selectedPolicyId]);
  const tokenKey = connectedAddress ? `${storagePrefix}${connectedAddress.toLowerCase()}` : null;
  const [agentToken, setAgentToken] = useState<string | null>(null);
  const tokenReady = Boolean(agentToken && selectedPolicy?.status === "ACTIVE");
  const recipient = health?.mpp?.recipient;
  const mppConfigured = Boolean(health?.mpp?.configured && recipient);
  const selectedMode = selectedPolicy?.purpose === "MPP_SESSION" ? "session" : "charge";

  const loadHealth = useCallback(async () => {
    const response = await fetch("/health", { credentials: "include", cache: "no-store" });
    if (!response.ok) throw new Error("Reach service status is unavailable");
    setHealth(await response.json() as HealthState);
  }, []);

  const loadPayments = useCallback(async (policyId: string) => {
    const response = await fetch(`/api/agent/authorizations/${policyId}/payments`, { credentials: "include", cache: "no-store" });
    if (response.status === 404) { setMppPayments([]); setPayoutPayments([]); return; }
    const data = await response.json().catch(() => ({})) as { mppPayments?: MppPayment[]; payments?: unknown[]; error?: string };
    if (!response.ok) throw new Error(data.error ?? "Payment records are unavailable");
    setMppPayments(data.mppPayments ?? []);
    setPayoutPayments(data.payments ?? []);
  }, []);

  const loadPolicies = useCallback(async () => {
    if (!connectedAddress) return;
    const response = await fetch("/api/agent/authorizations", { credentials: "include", cache: "no-store" });
    const data = await response.json().catch(() => ({})) as { policies?: AgentPolicy[]; error?: string };
    if (!response.ok) throw new Error(data.error ?? "Agent authorizations are unavailable");
    const nextPolicies = data.policies ?? [];
    setPolicies(nextPolicies);
    const remembered = tokenKey ? sessionStorage.getItem(tokenKey) : null;
    setAgentToken(remembered);
    setSelectedPolicyId((current) => current && nextPolicies.some((policy) => policy.id === current)
      ? current
      : (remembered ? nextPolicies.find((policy) => policy.status === "ACTIVE")?.id : undefined) ?? nextPolicies[0]?.id ?? null);
  }, [connectedAddress, tokenKey]);

  const refresh = useCallback(async (quiet = false) => {
    if (!connectedAddress) return;
    if (!quiet) setRefreshing(true);
    setError(null);
    try { await Promise.all([loadHealth(), loadPolicies()]); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Agent records are unavailable"); }
    finally { if (!quiet) setRefreshing(false); }
  }, [connectedAddress, loadHealth, loadPolicies]);

  useEffect(() => { void refresh(true); }, [refresh]);

  useEffect(() => {
    if (!selectedPolicyId) { setMppPayments([]); setPayoutPayments([]); return; }
    void loadPayments(selectedPolicyId).catch((caught) => setError(caught instanceof Error ? caught.message : "Payment records are unavailable"));
  }, [loadPayments, selectedPolicyId]);

  useEffect(() => {
    const onFocus = () => { void refresh(true); };
    const onVisibility = () => { if (document.visibilityState === "visible") void refresh(true); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => { window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onVisibility); };
  }, [refresh]);

  const createAndApprove = async () => {
    if (!connectedAddress || !connectorClient || !recipient) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const budgetRaw = parsePathUsdAmount(budgetInput);
      const endpointOrigin = originFromUrl(serviceUrl);
      const expiryTimestamp = publicClient
        ? Number(expiryFromChainTimestamp(await readChainTimestamp(publicClient as any), expiryDays * 24 * 60 * 60))
        : Math.floor(Date.now() / 1000) + expiryDays * 24 * 60 * 60;
      const createdResponse = await fetch("/api/agent/authorizations", {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({ maxPerPaymentRaw: budgetRaw.toString(), cumulativeBudgetRaw: budgetRaw.toString(), expiryTimestamp, purpose: mode === "charge" ? "MPP_DIRECT" : "MPP_SESSION", allowedDestinations: [recipient], allowedOrigins: [endpointOrigin] }),
      });
      const created = await createdResponse.json().catch(() => ({})) as { policy?: AgentPolicy; token?: string; authorization?: unknown; error?: string };
      if (!createdResponse.ok || !created.policy || !created.token || !created.authorization) throw new Error(created.error ?? "Could not create the owner approval request");
      const approved = await (connectorClient as any).request({ method: "wallet_authorizeAccessKey", params: [created.authorization] }) as { keyAuthorization?: unknown; rootAddress?: string };
      if (!approved.keyAuthorization || approved.rootAddress?.toLowerCase() !== connectedAddress.toLowerCase()) throw new Error("Owner approval did not return the expected account");
      const activatedResponse = await fetch(`/api/agent/authorizations/${created.policy.id}/activate`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ rootAddress: approved.rootAddress, keyAuthorization: approved.keyAuthorization }) });
      const activated = await activatedResponse.json().catch(() => ({})) as { policy?: AgentPolicy; error?: string };
      if (!activatedResponse.ok || !activated.policy) throw new Error(activated.error ?? "Could not activate the owner-approved authorization");
      sessionStorage.setItem(`${storagePrefix}${connectedAddress.toLowerCase()}`, created.token);
      setAgentToken(created.token); setSelectedPolicyId(activated.policy.id);
      setPolicies((current) => [activated.policy!, ...current.filter((policy) => policy.id !== activated.policy!.id)]);
      setNotice("Owner approval is active in this browser session. No configuration file or CLI step is required.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Owner approval failed"); }
    finally { setBusy(false); }
  };

  const requestService = async (session: boolean) => {
    if (!agentToken || !selectedPolicy || !serviceUrl) return;
    setBusy(true); setError(null); setNotice(null); setSessionClosed(false);
    const idempotencyKey = `ui-${Date.now().toString(36)}`;
    try {
      const response = await fetch(session ? "/api/mpp/payer/session" : "/api/mpp/payer/request", { method: "POST", credentials: "include", headers: { "content-type": "application/json", authorization: `Bearer ${agentToken}` }, body: JSON.stringify({ url: serviceUrl, method: "GET", idempotencyKey }) });
      const data = await response.json().catch(() => ({})) as { payment?: MppPayment; response?: { status?: number; body?: string; contentType?: string }; error?: string; code?: string };
      if (!response.ok) throw new Error(data.error ?? (data.code === "UNKNOWN_SETTLEMENT" ? "Payment is UNKNOWN. Reconcile it before retrying." : "Paid service request failed"));
      setLatestResult(data); setNotice(`Paid ${session ? "session" : "service"} request returned an actual service response (${data.response?.status ?? "unknown"}).`);
      await loadPayments(selectedPolicy.id); await refresh(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Paid service request failed"); await loadPayments(selectedPolicy.id).catch(() => undefined); }
    finally { setBusy(false); }
  };

  const closeSession = async () => {
    if (!agentToken || !selectedPolicy || selectedPolicy.purpose !== "MPP_SESSION") return;
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/mpp/payer/session/close", { method: "POST", credentials: "include", headers: { "content-type": "application/json", authorization: `Bearer ${agentToken}` }, body: JSON.stringify({ url: serviceUrl, method: "HEAD", idempotencyKey: `close-${Date.now().toString(36)}` }) });
      const data = await response.json().catch(() => ({})) as { status?: string; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Session close failed");
      setSessionClosed(true); setNotice("The MPP session was closed and the settlement result was returned.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Session close failed"); }
    finally { setBusy(false); }
  };

  const reconcile = async (payment: MppPayment) => {
    if (!agentToken) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/mpp/payer/${encodeURIComponent(payment.idempotencyKey)}/reconcile`, { method: "POST", credentials: "include", headers: { authorization: `Bearer ${agentToken}` } });
      const data = await response.json().catch(() => ({})) as { payment?: MppPayment; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Payment is not authoritative yet");
      setNotice("The authoritative payment record is now confirmed."); if (selectedPolicyId) await loadPayments(selectedPolicyId); setLatestResult(data);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Payment reconciliation failed"); }
    finally { setBusy(false); }
  };

  const revoke = async () => {
    if (!selectedPolicy || !connectedAddress || (!connectorClient && !sessionFixture)) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/agent/authorizations/${selectedPolicy.id}/revoke`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: "{}" });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not revoke the authorization");
      if (connectorClient) await (connectorClient as any).request({ method: "wallet_revokeAccessKey", params: [{ address: connectedAddress, accessKeyAddress: selectedPolicy.agentAddress }] });
      if (tokenKey) sessionStorage.removeItem(tokenKey);
      setAgentToken(null); setNotice(sessionFixture ? "Server authorization revoked in the deterministic browser fixture." : "Authorization revoked. The server is closed first, then the owner access key is revoked."); await refresh(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Revocation failed"); }
    finally { setBusy(false); }
  };

  if (!connectedAddress) return <div className="send-card-composer" style={{ maxWidth: 760, margin: "0 auto", padding: 24 }}><h2>Connect your passkey account</h2><p>Agent payments are owner-controlled. Open a passkey account before approving a service budget.</p></div>;

  return (
    <div className="send-experience-layout" style={{ maxWidth: "900px", margin: "0 auto", padding: "16px" }}>
      <div className="send-header" style={{ marginBottom: "20px" }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}><div style={{ display: "flex", alignItems: "center", gap: "10px" }}><div style={{ padding: "10px", background: "var(--bg-subtle)", borderRadius: "var(--radius-md)", color: "var(--primary)" }}><TerminalIcon size={24} /></div><div><h1 style={{ fontSize: "22px", fontWeight: 800, margin: 0, color: "var(--ink-primary)" }}>Agent payments</h1><p style={{ fontSize: "13px", color: "var(--ink-muted)", margin: "4px 0 0" }}>Approve a bounded service, pay it from Reach, see the output, and close access when you are done.</p></div></div><button className="btn-secondary" type="button" onClick={() => void refresh()} disabled={refreshing}><RefreshIcon size={15} /> {refreshing ? "Refreshing" : "Refresh"}</button></div></div>
      <div className="send-card-composer" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ background: "var(--bg-subtle)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-lg)", padding: "16px 20px" }}><div style={{ display: "flex", alignItems: "center", gap: 8 }}><ShieldCheckIcon size={18} style={{ color: "var(--primary)" }} /><strong>Passkey owner boundary</strong></div><p style={{ fontSize: 13, color: "var(--ink-secondary)", margin: "8px 0 0", lineHeight: 1.5 }}>Reach keeps the agent signer server-side. Your passkey approves the exact pathUSD limit, recipient, service origin, purpose, and expiry. The bearer session token stays in this browser session and is never downloaded.</p></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 14 }}><div className="input-group"><label style={{ display: "block" }}>Owner account</label><input className="text-input" readOnly value={`${short(connectedAddress)} passkey session`} style={{ fontFamily: "monospace" }} /><small style={{ color: "var(--ink-muted)" }}>Funding balance: {pathUsdBalance ?? "checking"} pathUSD</small></div><div className="input-group"><label style={{ display: "block" }}>Reach MPP service</label><input className="text-input" value={serviceUrl} onChange={(event) => setServiceUrl(event.target.value)} /><small style={{ color: "var(--ink-muted)" }}>{mppConfigured ? `Recipient ${short(recipient)} at ${health?.mpp?.price ?? "configured price"}` : "Local payee is not configured in this environment"}</small></div></div>
        {!selectedPolicy && <div style={{ border: "1px solid var(--border-default)", borderRadius: "var(--radius-lg)", padding: 18 }}><div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}><KeyIcon size={18} style={{ color: "var(--primary)" }} /><strong>Authorize an agent service</strong></div><div style={{ display: "flex", gap: 8, marginBottom: 14 }}><button className={mode === "charge" ? "btn-primary" : "btn-secondary"} type="button" onClick={() => { setMode("charge"); setServiceUrl(`${window.location.origin}/api/mpp/agent-service`); }}>One request</button><button className={mode === "session" ? "btn-primary" : "btn-secondary"} type="button" onClick={() => { setMode("session"); setServiceUrl(`${window.location.origin}/api/mpp/agent-session`); }}>Metered session</button></div><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}><div className="input-group"><label>Maximum service spend</label><input className="text-input" type="number" min="0.000001" step="0.01" value={budgetInput} onChange={(event) => setBudgetInput(event.target.value)} /><small style={{ color: "var(--ink-muted)" }}>This is both the per-request and cumulative limit.</small></div><div className="input-group"><label>Approval expiry</label><select className="text-input" value={expiryDays} onChange={(event) => setExpiryDays(Number(event.target.value))}><option value={1}>24 hours</option><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option></select></div></div><button className="btn-primary" type="button" onClick={() => void createAndApprove()} disabled={busy || !connectorClient || !mppConfigured}>{busy ? "Waiting for owner approval" : "Approve this service"}</button>{!connectorClient && <p style={{ color: "var(--ink-muted)", fontSize: 12, margin: "10px 0 0" }}>Reconnect the passkey wallet to approve a new service.</p>}{!mppConfigured && <p style={{ color: "var(--ink-muted)", fontSize: 12, margin: "10px 0 0" }}>This environment has no MPP recipient configured. The live Tempo Moderato gate remains separate from this UI.</p>}</div>}
        {selectedPolicy && <><div style={{ border: "1px solid var(--border-default)", borderRadius: "var(--radius-lg)", padding: 18 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}><div><div style={{ display: "flex", alignItems: "center", gap: 8 }}><CheckCircleIcon size={18} style={{ color: selectedPolicy.status === "ACTIVE" ? "var(--success)" : "var(--ink-muted)" }} /><strong>{selectedPolicy.status === "ACTIVE" ? "Owner-approved service" : `Authorization ${selectedPolicy.status.toLowerCase()}`}</strong></div><small style={{ color: "var(--ink-muted)" }}>Purpose: {selectedPolicy.purpose} · Agent {short(selectedPolicy.agentAddress)}</small></div><div style={{ display: "flex", gap: 8 }}><button className="btn-secondary" type="button" onClick={() => void revoke()} disabled={busy || selectedPolicy.status === "REVOKED"}>{selectedPolicy.status === "REVOKED" ? "Revoked" : "Revoke access"}</button>{policies.length > 1 && <select className="text-input" value={selectedPolicy.id} onChange={(event) => { setSelectedPolicyId(event.target.value); setLatestResult(null); }}><option value={selectedPolicy.id}>{short(selectedPolicy.id)}</option>{policies.filter((policy) => policy.id !== selectedPolicy.id).map((policy) => <option key={policy.id} value={policy.id}>{short(policy.id)} ({policy.status})</option>)}</select>}</div></div><div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginTop: 16 }}><div><small>Spent</small><strong style={{ display: "block" }}>{amount(selectedPolicy.spentRaw)} pathUSD</strong></div><div><small>Reserved</small><strong style={{ display: "block" }}>{amount(selectedPolicy.reservedRaw)} pathUSD</strong></div><div><small>Remaining</small><strong style={{ display: "block" }}>{amount(selectedPolicy.remainingRaw)} pathUSD</strong></div><div><small>Expires</small><strong style={{ display: "block" }}>{new Date(selectedPolicy.expiryTimestamp * 1000).toLocaleDateString()}</strong></div></div>{!tokenReady && selectedPolicy.status === "ACTIVE" && <p style={{ color: "var(--ink-muted)", fontSize: 12, margin: "14px 0 0" }}>This browser no longer has the agent session credential. Revoke this authorization or approve a new service to reconnect safely.</p>}</div>{tokenReady && selectedPolicy.status === "ACTIVE" && <div style={{ border: "1px solid var(--border-default)", borderRadius: "var(--radius-lg)", padding: 18 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}><div><strong>Run the paid service</strong><p style={{ color: "var(--ink-muted)", fontSize: 12, margin: "5px 0 0" }}>The response below is the actual service body returned after MPP receipt verification.</p></div><span className="status-chip">{selectedMode === "session" ? "MPP session" : "MPP direct"}</span></div><div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}><button className="btn-primary" type="button" onClick={() => void requestService(selectedMode === "session")} disabled={busy || !mppConfigured}>{busy ? "Paying and waiting" : selectedMode === "session" ? "Request metered result" : "Pay for service"}</button>{selectedMode === "session" && <button className="btn-secondary" type="button" onClick={() => void closeSession()} disabled={busy}>Close session</button>}</div>{sessionClosed && <p style={{ color: "var(--success)", fontSize: 13 }}>Session closed. The settlement response was recorded.</p>}{latestResult?.response && <div style={{ marginTop: 16, background: "var(--bg-subtle)", borderRadius: "var(--radius-md)", padding: 14 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><strong>Actual service output</strong><span>HTTP {latestResult.response.status}</span></div><pre style={{ whiteSpace: "pre-wrap", fontSize: 12, margin: "10px 0 0", color: "var(--ink-secondary)" }}>{prettyBody(latestResult.response.body)}</pre>{latestResult.payment?.receipt?.reference && <small style={{ display: "block", marginTop: 10, color: "var(--ink-muted)", wordBreak: "break-all" }}>Verified Tempo reference: {latestResult.payment.receipt.reference}</small>}</div>}</div>}</>}
        {selectedPolicy && <div style={{ border: "1px solid var(--border-default)", borderRadius: "var(--radius-lg)", padding: 18 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><div><strong>Financial record</strong><p style={{ color: "var(--ink-muted)", fontSize: 12, margin: "5px 0 0" }}>Authenticated records are reread after refresh and reconnection.</p></div><span style={{ color: "var(--ink-muted)", fontSize: 12 }}>{mppPayments.length} MPP payment{mppPayments.length === 1 ? "" : "s"}</span></div>{mppPayments.length === 0 ? <p style={{ color: "var(--ink-muted)", fontSize: 13 }}>No service payment has been recorded yet.</p> : <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>{mppPayments.map((payment) => <div key={payment.id} style={{ border: "1px solid var(--border-default)", borderRadius: "var(--radius-md)", padding: 12 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><strong>{amount(payment.amountRaw)} pathUSD · {payment.mode}</strong><span style={{ color: payment.state === "CONFIRMED" ? "var(--success)" : payment.state === "UNKNOWN" ? "var(--warning)" : "var(--ink-muted)" }}>{payment.state}</span></div><small style={{ color: "var(--ink-muted)", display: "block", marginTop: 5 }}>Request {payment.idempotencyKey} · {new Date(payment.updatedAt).toLocaleString()}</small>{payment.receipt?.reference && <small style={{ color: "var(--ink-muted)", display: "block", wordBreak: "break-all" }}>Receipt {payment.receipt.reference}</small>}{payment.responseBody && <pre style={{ whiteSpace: "pre-wrap", fontSize: 11, margin: "8px 0 0" }}>{prettyBody(payment.responseBody)}</pre>}{payment.error && <small style={{ color: "var(--danger)", display: "block", marginTop: 8 }}>{payment.error}</small>}{payment.state === "UNKNOWN" && <button className="btn-secondary" type="button" onClick={() => void reconcile(payment)} disabled={busy} style={{ marginTop: 9 }}>Reconcile authoritative state</button>}</div>)}</div>}{payoutPayments.length > 0 && <small style={{ color: "var(--ink-muted)", display: "block", marginTop: 12 }}>This authorization also has {payoutPayments.length} vault payout record{payoutPayments.length === 1 ? "" : "s"}.</small>}</div>}
        {notice && <div style={{ display: "flex", gap: 8, alignItems: "flex-start", color: "var(--success)", fontSize: 13 }}><CheckCircleIcon size={17} /> <span>{notice}</span></div>}
        {error && <div style={{ display: "flex", gap: 8, alignItems: "flex-start", color: "var(--danger)", fontSize: 13 }}><AlertCircleIcon size={17} /> <span>{error}</span></div>}
        <button className="btn-secondary" type="button" onClick={onDone}>Back to home</button>
      </div>
      <small style={{ display: "block", color: "var(--ink-muted)", marginTop: 14 }}>Chain boundary: Tempo Moderato ({health?.mpp?.chainId ?? TEMPO_MODERATO_CHAIN_ID}) · Currency: pathUSD ({short(PATH_USD_ADDRESS)}) · Vault payout scope remains {short(defaultVaultAddress)}.</small>
    </div>
  );
}
