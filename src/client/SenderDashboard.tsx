import { useCallback, useEffect, useMemo, useState } from "react";
import { encodeFunctionData, type Address, type Hex } from "viem";
import { useConnection, useConnect, useConnectorClient, useConnectors, usePublicClient, useSendTransaction } from "wagmi";
import { DEFAULT_VAULT_ADDRESS, PATH_USD_ADDRESS, payoutStatus, TEMPO_MODERATO_CHAIN_ID, vaultAbi, pathUsdAbi } from "../shared/reach";
import { claimSignerForCapability, clearCapability, createClaimCapability, hasCapability, rememberCapability } from "./claimCapability";
import { createPayoutId, expiryFromNow, failedBalance, formatPathUsd, fundingAllowed, isReclaimEligible, loadingBalance, parseAuthoritativeBalance, parsePathUsdAmount, publicStatusLabel, readyBalance, type BalanceState, type SenderStage } from "./senderFlow";
import { mergeSenderPayouts, type DiscoveredSenderPayout } from "./senderRecovery";
import { readSenderPayouts, rememberSenderPayout, removeSenderPayout, updateSenderPayout, type SenderPayoutRecord } from "./senderStorage";
import { failedArtifactMessage, preflightFunding, resolveFundingReceipt, toFundingFillRequest, type FundingFillClient } from "./senderFunding";
import SenderClaimLink from "./SenderClaimLink";

type PublicPayout = { sender: Address; amount: string; expiresAt: string; claimSigner: Address; status: 0 | 1 | 2 | 3; claimant: Address };
type DiscoveredResponse = { address: Address; payouts: DiscoveredSenderPayout[] };
type Draft = { amount: bigint; amountText: string; label: string; expiresAt: bigint; expiryLabel: string };
type SenderCall = { to: Address; data: `0x${string}`; value: bigint };
type PreparedFunding = { payoutId: string; capability: ReturnType<typeof createClaimCapability>; claimSigner: Address; calls: SenderCall[]; record: SenderPayoutRecord };
const vaultAddress = (import.meta.env.VITE_REACH_VAULT_ADDRESS ?? DEFAULT_VAULT_ADDRESS) as Address;
const expiryOptions = [{ seconds: 3600, label: "1 hour" }, { seconds: 86400, label: "24 hours" }, { seconds: 259200, label: "3 days" }];

class BalanceReadFailure extends Error {
  constructor(public readonly httpStatus: number) {
    super("balance request failed");
    this.name = "BalanceReadFailure";
  }
}

function hashOf(value: unknown): string | undefined { if (typeof value === "string") return value; if (!value || typeof value !== "object") return undefined; const record = value as Record<string, unknown>; if (typeof record.transactionHash === "string") return record.transactionHash; if (typeof record.hash === "string") return record.hash; return hashOf(record.receipt); }
function shortAddress(value: string) { return `${value.slice(0, 7)}…${value.slice(-5)}`; }
function delay(milliseconds: number) { return new Promise((resolve) => window.setTimeout(resolve, milliseconds)); }
function senderRequest(calls: readonly SenderCall[]) { return { chainId: TEMPO_MODERATO_CHAIN_ID, calls, feePayer: false } as never; }
function fundingCalls(payoutId: string, amount: bigint, claimSigner: Address, expiresAt: bigint): SenderCall[] {
  return [
    { to: PATH_USD_ADDRESS, data: encodeFunctionData({ abi: pathUsdAbi, functionName: "approve", args: [vaultAddress, amount] }), value: 0n },
    { to: vaultAddress, data: encodeFunctionData({ abi: vaultAbi, functionName: "createPayout", args: [BigInt(payoutId), amount, claimSigner, expiresAt] }), value: 0n },
  ];
}

function failedRecord(record: SenderPayoutRecord, fundingTxHash?: string): SenderPayoutRecord {
  return { ...record, ...(fundingTxHash ? { fundingTxHash } : {}), outcome: "FAILED", failureMessage: failedArtifactMessage() };
}

export default function SenderDashboard() {
  const { address } = useConnection();
  const { data: connectorClient } = useConnectorClient();
  const publicClient = usePublicClient({ chainId: TEMPO_MODERATO_CHAIN_ID });
  const connectors = useConnectors();
  const { connectAsync } = useConnect();
  const { mutateAsync: sendTransactionAsync, isPending: transactionPending } = useSendTransaction();
  const [records, setRecords] = useState<SenderPayoutRecord[]>([]);
  const [publicStates, setPublicStates] = useState<Record<string, PublicPayout>>({});
  const [balanceState, setBalanceState] = useState<BalanceState>(loadingBalance());
  const [balanceRetry, setBalanceRetry] = useState(0);
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const [expirySeconds, setExpirySeconds] = useState("86400");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [preparedFunding, setPreparedFunding] = useState<PreparedFunding | null>(null);
  const [flow, setFlow] = useState<SenderStage>("REVIEW");
  const [flowError, setFlowError] = useState("");
  const [activeLink, setActiveLink] = useState<{ id: string; url: string } | null>(null);
  const [reclaimStages, setReclaimStages] = useState<Record<string, SenderStage>>({});
  const [reclaimErrors, setReclaimErrors] = useState<Record<string, string>>({});
  const [discoveryError, setDiscoveryError] = useState("");
  const [clock, setClock] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => { setRecords(readSenderPayouts()); const timer = window.setInterval(() => setClock(Math.floor(Date.now() / 1000)), 30000); return () => window.clearInterval(timer); }, []);

  const readPublicPayout = useCallback(async (id: string): Promise<PublicPayout | null> => {
    const response = await fetch(`/api/payout/${id}`, { headers: { accept: "application/json" } });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("payout read failed");
    return (await response.json()) as PublicPayout;
  }, []);
  const readFundingReceipt = useCallback(async (hash: string) => {
    if (!publicClient) return null;
    try { return await publicClient.getTransactionReceipt({ hash: hash as Hex }); } catch { return null; }
  }, [publicClient]);

  const readDiscoveredPayouts = useCallback(async (sender: Address): Promise<DiscoveredSenderPayout[]> => {
    const response = await fetch(`/api/payouts/${sender}`, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error("payout discovery failed");
    const body = (await response.json()) as DiscoveredResponse;
    return Array.isArray(body.payouts) ? body.payouts : [];
  }, []);

  const refreshStatuses = useCallback(async (nextRecords?: SenderPayoutRecord[]) => {
    const localRecords = nextRecords ?? readSenderPayouts();
    let discovered: DiscoveredSenderPayout[] = [];
    if (address) {
      try {
        discovered = await readDiscoveredPayouts(address);
        setDiscoveryError("");
      } catch {
        setDiscoveryError("We couldn't rediscover your payouts from Tempo. Refresh to try again.");
      }
    } else {
      setDiscoveryError("");
    }
    const sourceRecords = mergeSenderPayouts(localRecords, discovered);
    const discoveredStates = Object.fromEntries(discovered.map((payout) => [payout.id, payout as PublicPayout])) as Record<string, PublicPayout>;
    const entries = await Promise.all(sourceRecords.map(async (record) => {
      if (record.outcome === "FAILED") return [record.id, null] as const;
      if (discoveredStates[record.id]) return [record.id, discoveredStates[record.id]] as const;
      const current = await readPublicPayout(record.id);
      if (record.fundingTxHash && current?.status === payoutStatus.NONE) {
        const receipt = await readFundingReceipt(record.fundingTxHash);
        if (receipt?.status === "reverted") {
          clearCapability(record.id);
          updateSenderPayout(record.id, { outcome: "FAILED", failureMessage: failedArtifactMessage() });
          return [record.id, null] as const;
        }
      }
      return [record.id, current] as const;
    }));
    setPublicStates(Object.fromEntries(entries.filter((entry): entry is [string, PublicPayout] => Boolean(entry[1]))));
    setRecords(mergeSenderPayouts(readSenderPayouts(), discovered));
  }, [address, readDiscoveredPayouts, readFundingReceipt, readPublicPayout]);

  useEffect(() => { void refreshStatuses(); }, [refreshStatuses]);

  useEffect(() => {
    if (!address) { setBalanceState(loadingBalance()); return; }
    let cancelled = false;
    const controller = new AbortController();
    setBalanceState(loadingBalance());
    void (async () => {
      let httpStatus: number | undefined;
      try {
        const response = await fetch(`/api/balance/${address}`, { headers: { accept: "application/json" }, signal: controller.signal });
        httpStatus = response.status;
        if (!response.ok) throw new BalanceReadFailure(response.status);
        const raw = parseAuthoritativeBalance(await response.json());
        if (!cancelled) setBalanceState(readyBalance(raw));
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === "AbortError")) return;
        const safeDiagnostic = error instanceof BalanceReadFailure ? error.message : "network or malformed response";
        if (import.meta.env.DEV) console.warn("[BALANCE_READ]", { stage: "BALANCE_READ", httpStatus, error: safeDiagnostic });
        if (!cancelled) setBalanceState(failedBalance("We couldn't read your Tempo balance.", httpStatus));
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [address, balanceRetry]);

  const connectSender = useCallback(async () => {
    const connector = connectors[0];
    if (!connector) { setFlowError("The Tempo passkey connector is unavailable."); return; }
    setFlowError("");
    try { await connectAsync({ connector, capabilities: { method: "register" as const, name: "Reach sender" } }); } catch { setFlowError("Passkey account setup was cancelled or unavailable."); }
  }, [connectAsync, connectors]);

  const reviewPayout = useCallback(() => {
    setFlowError(""); setActiveLink(null); setPreparedFunding(null); setFlow("REVIEW");
    try {
      if (balanceState.status !== "READY" || balanceState.balance === null) throw new Error("Balance unavailable. Retry the balance check before funding.");
      const parsedAmount = parsePathUsdAmount(amount);
      if (parsedAmount > BigInt(balanceState.balance)) throw new Error("Requested amount exceeds your available pathUSD balance.");
      const option = expiryOptions.find((candidate) => String(candidate.seconds) === expirySeconds);
      if (!option) throw new Error("choose an expiry");
      setDraft({ amount: parsedAmount, amountText: formatPathUsd(parsedAmount), label: label.trim(), expiresAt: expiryFromNow(Math.floor(Date.now() / 1000), option.seconds), expiryLabel: option.label });
    } catch (error) { setFlowError(error instanceof Error ? error.message : "Enter a valid payout amount and expiry."); }
  }, [amount, balanceState, expirySeconds, label]);

  const preflightPayout = useCallback(async () => {
    if (!address || !draft || transactionPending || flow !== "REVIEW") return;
    if (!fundingAllowed(balanceState, draft.amount)) { setFlowError(balanceState.status === "READY" ? "Requested amount exceeds your available pathUSD balance." : "Balance unavailable. Retry the balance check before funding."); return; }
    setFlowError(""); setPreparedFunding(null); setFlow("PREFLIGHTING");
    try {
      const payoutId = createPayoutId();
      const capability = createClaimCapability();
      const claimSigner = claimSignerForCapability(capability.privateKey) as Address;
      const calls = fundingCalls(payoutId, draft.amount, claimSigner, draft.expiresAt);
      const record: SenderPayoutRecord = { id: payoutId, amount: draft.amount.toString(), expiresAt: draft.expiresAt.toString(), claimSigner, ...(draft.label ? { label: draft.label } : {}), createdAt: new Date().toISOString() };
      const result = await preflightFunding(connectorClient as unknown as FundingFillClient | undefined, toFundingFillRequest(address, calls));
      if (!result.ok) { setFlow("REVIEW"); setFlowError("message" in result ? result.message : "Funding preflight failed. Retry before signing."); return; }
      setPreparedFunding({ payoutId, capability, claimSigner, calls, record });
      setFlow("READY_TO_SIGN");
    } catch (error) {
      setFlow("REVIEW"); setFlowError(error instanceof Error ? error.message : "Funding preflight failed. Retry before signing.");
    }
  }, [address, balanceState, connectorClient, draft, flow, transactionPending]);

  const waitForStatus = useCallback(async (id: string, expected: 1 | 3) => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const current = await readPublicPayout(id);
      if (current) { setPublicStates((previous) => ({ ...previous, [id]: current })); if (current.status === expected) return current; }
      await delay(1000);
    }
    return null;
  }, [readPublicPayout]);

  const fundPayout = useCallback(async () => {
    if (!address || !draft || !preparedFunding || flow !== "READY_TO_SIGN" || transactionPending) return;
    if (!fundingAllowed(balanceState, draft.amount)) { setFlowError(balanceState.status === "READY" ? "Requested amount exceeds your available pathUSD balance." : "Balance unavailable. Retry the balance check before funding."); return; }
    const prepared = preparedFunding;
    let hash: string | undefined;
    const markRecovery = (message: string) => {
      updateSenderPayout(prepared.payoutId, { ...(hash ? { fundingTxHash: hash } : {}), outcome: "RECOVERY_REQUIRED", failureMessage: message });
      setRecords(readSenderPayouts()); setPreparedFunding(null); setFlow("RECOVERY_REQUIRED"); setFlowError(message);
    };
    setFlowError(""); setFlow("SIGNING");
    rememberCapability(prepared.payoutId, prepared.capability.raw);
    rememberSenderPayout(prepared.record);
    setRecords(readSenderPayouts());
    try {
      const result = await sendTransactionAsync(senderRequest(prepared.calls));
      hash = hashOf(result);
      if (!hash) throw new Error("Funding transaction hash was not returned.");
      updateSenderPayout(prepared.payoutId, { fundingTxHash: hash });
      setRecords(readSenderPayouts()); setFlow("SUBMITTED"); setFlow("CONFIRMING");
      let receipt;
      try {
        if (!publicClient) throw new Error("Tempo receipt client unavailable.");
        receipt = await publicClient.waitForTransactionReceipt({ hash: hash as Hex });
      } catch {
        markRecovery("Funding status is unknown. Refresh to reconcile the authoritative vault state.");
        return;
      }
      if (receipt.status === "reverted") {
        clearCapability(prepared.payoutId); rememberSenderPayout(failedRecord(prepared.record, hash)); setRecords(readSenderPayouts()); setPreparedFunding(null); setDraft(null); setFlow("FAILED_RETRYABLE"); setFlowError(failedArtifactMessage()); return;
      }
      let funded: PublicPayout | null;
      try { funded = await waitForStatus(prepared.payoutId, payoutStatus.FUNDED); } catch { markRecovery("Funding receipt succeeded, but the vault state could not be read. Refresh to reconcile."); return; }
      const resolution = resolveFundingReceipt({ receiptStatus: "success", payout: funded ?? undefined, expected: { sender: address, amount: prepared.record.amount, expiresAt: prepared.record.expiresAt, claimSigner: prepared.claimSigner } });
      if (resolution === "RECOVERY_REQUIRED") { markRecovery("Funding receipt succeeded, but the vault state needs recovery. No claim link was revealed."); return; }
      rememberSenderPayout({ ...prepared.record, fundingTxHash: hash });
      setFlow("FUNDED"); setActiveLink({ id: prepared.payoutId, url: `${window.location.origin}/c/${prepared.payoutId}#${prepared.capability.raw}` }); setDraft(null); setAmount(""); setLabel(""); setPreparedFunding(null); await refreshStatuses(readSenderPayouts());
    } catch {
      if (hash) { markRecovery("Funding status is unknown. Refresh to reconcile the authoritative vault state."); return; }
      clearCapability(prepared.payoutId); removeSenderPayout(prepared.payoutId); setRecords(readSenderPayouts()); setPreparedFunding(null); setDraft(null); setFlow("FAILED_RETRYABLE"); setFlowError("Funding was not submitted or was rejected. No payout is shown as funded.");
    }
  }, [address, balanceState, draft, flow, preparedFunding, publicClient, refreshStatuses, sendTransactionAsync, transactionPending, waitForStatus]);

  const reclaim = useCallback(async (record: SenderPayoutRecord) => {
    const current = publicStates[record.id];
    if (!address || !current || !isReclaimEligible(current.status, BigInt(current.expiresAt), BigInt(clock), current.sender, address)) return;
    setReclaimErrors((previous) => ({ ...previous, [record.id]: "" })); setReclaimStages((previous) => ({ ...previous, [record.id]: "SIGNING" }));
    try {
      const result = await sendTransactionAsync(senderRequest([{ to: vaultAddress, data: encodeFunctionData({ abi: vaultAbi, functionName: "reclaim", args: [BigInt(record.id)] }), value: 0n }]));
      const hash = hashOf(result); if (hash) updateSenderPayout(record.id, { reclaimTxHash: hash });
      setReclaimStages((previous) => ({ ...previous, [record.id]: "SUBMITTED" })); setReclaimStages((previous) => ({ ...previous, [record.id]: "CONFIRMING" }));
      const reclaimed = await waitForStatus(record.id, payoutStatus.RECLAIMED);
      if (!reclaimed) { setReclaimErrors((previous) => ({ ...previous, [record.id]: "Reclaim was submitted but is not confirmed in the vault yet." })); return; }
      setReclaimStages((previous) => ({ ...previous, [record.id]: "FUNDED" })); setRecords(readSenderPayouts());
    } catch { setReclaimStages((previous) => ({ ...previous, [record.id]: "FAILED_RETRYABLE" })); setReclaimErrors((previous) => ({ ...previous, [record.id]: "Reclaim was not submitted or was rejected." })); }
  }, [address, clock, publicStates, sendTransactionAsync, waitForStatus]);

  const accountText = useMemo(() => address ? shortAddress(address) : "No Tempo account connected", [address]);
  const stateTitle = flow === "FUNDED" ? "Payout funded" : flow === "FAILED_RETRYABLE" ? "Funding needs another try" : flow === "RECOVERY_REQUIRED" ? "Funding needs recovery" : flow === "PREFLIGHTING" ? "Checking funding readiness" : flow === "READY_TO_SIGN" ? "Ready to sign" : flow === "SIGNING" ? "Signing funding transaction" : flow === "SUBMITTED" || flow === "CONFIRMING" ? "Confirming funding" : flow;
  const stateCopy = flow === "FUNDED" ? "The vault confirmed the sender-funded payout." : flow === "PREFLIGHTING" ? "Tempo is checking the exact transaction and fee affordability. No signature has been requested." : flow === "READY_TO_SIGN" ? "The exact transaction passed preflight. Review the details, then approve with your Tempo passkey." : flow === "SIGNING" ? "Approve the transaction with your Tempo passkey." : flow === "SUBMITTED" || flow === "CONFIRMING" ? "Waiting for a successful receipt and an exact vault reread." : flow === "FAILED_RETRYABLE" ? "Funding failed. No payout was created." : flow === "RECOVERY_REQUIRED" ? "The receipt succeeded or status became uncertain, but the authoritative payout state needs reconciliation. No claim link was revealed." : "";
  const balanceDisplay = balanceState.status === "LOADING" ? "Checking…" : balanceState.status === "READY" && balanceState.balance !== null ? `${formatPathUsd(BigInt(balanceState.balance))} pathUSD` : "Unavailable";
  return (
    <main className="app-shell sender-shell">
      <div className="topbar"><div className="brand-mark" aria-label="Reach home">reach<span>•</span></div><div className="network-chip"><i /> Tempo testnet</div></div>
      <section className="sender-card" aria-live="polite">
        <div className="sender-hero"><div className="eyebrow">Send from your own account</div><h1>Reach</h1><p className="context-copy">Create a walletless pathUSD payout. Your Tempo passkey signs the funding transaction; Reach never holds the sender key.</p></div>
        <div className="account-row"><div><span className="field-label">Tempo account</span><strong>{accountText}</strong></div>{!address && <button className="secondary-button compact-button" type="button" onClick={() => void connectSender()}>Create sender account</button>}</div>
        {address && <div className="balance-row"><div><span>Available pathUSD</span><strong>{balanceDisplay}</strong>{balanceState.status === "ERROR" && <p className="error-copy">We couldn't read your Tempo balance.</p>}</div>{balanceState.status === "ERROR" && <button className="secondary-button compact-button" type="button" onClick={() => setBalanceRetry((value) => value + 1)}>Retry</button>}</div>}
        {flow === "REVIEW" && !draft && <div className="sender-form"><label><span className="field-label">Amount</span><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" aria-label="payout amount" /></label><label><span className="field-label">Recipient note <em>optional, local only</em></span><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. Alice" aria-label="recipient note" /></label><label><span className="field-label">Claim window</span><select value={expirySeconds} onChange={(event) => setExpirySeconds(event.target.value)} aria-label="claim expiry">{expiryOptions.map((option) => <option key={option.seconds} value={option.seconds}>{option.label}</option>)}</select></label><button className="claim-button sender-action" type="button" onClick={reviewPayout} disabled={!address || balanceState.status !== "READY"}>Review payout <span aria-hidden="true">→</span></button>{!address && <p className="form-hint">Connect a Tempo passkey account to begin.</p>}{address && balanceState.status === "LOADING" && <p className="form-hint">Checking your authoritative Tempo balance before enabling funding.</p>}{address && balanceState.status === "ERROR" && <p className="form-hint">Retry the balance check before reviewing a payout.</p>}</div>}
        {draft && (flow === "REVIEW" || flow === "PREFLIGHTING" || flow === "READY_TO_SIGN") && <div className="review-panel"><span className="field-label">Review before signing</span><h2>{draft.amountText} pathUSD</h2><dl><div><dt>Claim window</dt><dd>{draft.expiryLabel}</dd></div><div><dt>Expires</dt><dd>{new Date(Number(draft.expiresAt) * 1000).toLocaleString()}</dd></div>{draft.label && <div><dt>Local note</dt><dd>{draft.label}</dd></div>}</dl><p className="form-hint">First check the exact approve + createPayout transaction. Reach will not request a passkey signature unless Tempo accepts the fee-aware preflight.</p>{flow === "REVIEW" && <button className="claim-button sender-action" type="button" onClick={() => void preflightPayout()} disabled={!fundingAllowed(balanceState, draft.amount) || transactionPending}>Check funding readiness <span aria-hidden="true">→</span></button>}{flow === "PREFLIGHTING" && <button className="claim-button sender-action" type="button" disabled>Checking funding…</button>}{flow === "READY_TO_SIGN" && <button className="claim-button sender-action" type="button" onClick={() => void fundPayout()} disabled={transactionPending}>Sign &amp; fund payout <span aria-hidden="true">→</span></button>}<button className="secondary-button" type="button" disabled={flow === "PREFLIGHTING"} onClick={() => { setDraft(null); setPreparedFunding(null); setFlow("REVIEW"); setFlowError(""); }}>Edit</button></div>}
        {flow !== "REVIEW" && <div className={`state-panel state-${flow.toLowerCase()}`}><div className="state-dot" aria-hidden="true" /><div><strong>{stateTitle}</strong><span>{stateCopy}</span>{flow === "FAILED_RETRYABLE" && <button className="secondary-button" type="button" onClick={() => { setFlow("REVIEW"); setFlowError(""); }}>Try again</button>}{flow === "RECOVERY_REQUIRED" && <button className="secondary-button" type="button" onClick={() => void refreshStatuses()}>Refresh authoritative state</button>}</div></div>}
        {flow === "FUNDED" && activeLink && <SenderClaimLink key={activeLink.id} url={activeLink.url} onCopy={async (url) => { if (!navigator.clipboard) throw new Error("clipboard unavailable"); await navigator.clipboard.writeText(url); }} />}
        {flowError && <p className="error-copy">{flowError}</p>}
        {discoveryError && <p className="error-copy">{discoveryError}</p>}
      </section>
      <section className="sender-card payout-list"><div className="list-heading"><div><div className="eyebrow">Sender dashboard</div><h2>Your payouts</h2></div><button className="secondary-button compact-button" type="button" onClick={() => void refreshStatuses()}>Refresh</button></div>{records.length === 0 && <p className="empty-copy">Payout attempts will appear here with public onchain status.</p>}{records.map((record) => { const current = publicStates[record.id]; const reclaimStage = reclaimStages[record.id]; const reclaimable = Boolean(!record.outcome && address && current && isReclaimEligible(current.status, BigInt(current.expiresAt), BigInt(clock), current.sender, address)); const claimLinkAvailable = typeof window !== "undefined" && hasCapability(record.id); const statusText = record.outcome === "FAILED" ? "FAILED — No payout was created." : record.outcome === "RECOVERY_REQUIRED" ? "RECOVERY REQUIRED — verify authoritative state" : current ? publicStatusLabel(current.status, BigInt(current.expiresAt), BigInt(clock)) : "Loading public status…"; return <article className="payout-row" key={record.id}><div className="payout-row-main"><strong>{formatPathUsd(BigInt(record.amount))} pathUSD</strong><span>{statusText}</span></div><dl><div><dt>Payout ID</dt><dd>{record.id}</dd></div><div><dt>Expires</dt><dd>{new Date(Number(record.expiresAt) * 1000).toLocaleString()}</dd></div>{record.label && <div><dt>Note</dt><dd>{record.label}</dd></div>}{record.fundingTxHash && <div><dt>Funding tx</dt><dd>{shortAddress(record.fundingTxHash)}</dd></div>}</dl>{current?.status === payoutStatus.FUNDED && <p className="form-hint">{claimLinkAvailable ? "Claim link available on this device/session." : "Claim link unavailable on this device/session. Reach cannot recreate a lost claim link."}</p>}{record.failureMessage && <p className="error-copy">{record.failureMessage}</p>}{reclaimable && <button className="secondary-button" type="button" disabled={Boolean(reclaimStage && reclaimStage !== "FAILED_RETRYABLE") || transactionPending} onClick={() => void reclaim(record)}>{reclaimStage === "CONFIRMING" ? "Confirming reclaim…" : reclaimStage === "SIGNING" ? "Sign reclaim…" : "Reclaim"}</button>}{reclaimErrors[record.id] && <p className="error-copy">{reclaimErrors[record.id]}</p>}</article>; })}</section>
      <footer><span>Sender signs directly on Tempo.</span><span className="footer-separator">·</span><span>Tempo Moderato</span></footer>
    </main>
  );
}
