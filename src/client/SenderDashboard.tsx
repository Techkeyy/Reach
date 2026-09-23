import { useCallback, useEffect, useMemo, useState } from "react";
import { encodeFunctionData, type Address } from "viem";
import { useConnection, useConnect, useConnectors, useSendTransaction } from "wagmi";
import { DEFAULT_VAULT_ADDRESS, PATH_USD_ADDRESS, payoutStatus, TEMPO_MODERATO_CHAIN_ID, vaultAbi, pathUsdAbi } from "../shared/reach";
import { claimSignerForCapability, clearCapability, createClaimCapability, rememberCapability } from "./claimCapability";
import { createPayoutId, expiryFromNow, failedBalance, formatPathUsd, fundingAllowed, isReclaimEligible, loadingBalance, parseAuthoritativeBalance, parsePathUsdAmount, publicStatusLabel, readyBalance, type BalanceState, type SenderStage } from "./senderFlow";
import { readSenderPayouts, rememberSenderPayout, removeSenderPayout, updateSenderPayout, type SenderPayoutRecord } from "./senderStorage";

type PublicPayout = { sender: Address; amount: string; expiresAt: string; claimSigner: Address; status: 0 | 1 | 2 | 3; claimant: Address };
type Draft = { amount: bigint; amountText: string; label: string; expiresAt: bigint; expiryLabel: string };
type SenderCall = { to: Address; data: `0x${string}`; value: bigint };
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

export default function SenderDashboard() {
  const { address } = useConnection();
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
  const [flow, setFlow] = useState<SenderStage>("REVIEW");
  const [flowError, setFlowError] = useState("");
  const [activeLink, setActiveLink] = useState<{ id: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [reclaimStages, setReclaimStages] = useState<Record<string, SenderStage>>({});
  const [reclaimErrors, setReclaimErrors] = useState<Record<string, string>>({});
  const [clock, setClock] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => { setRecords(readSenderPayouts()); const timer = window.setInterval(() => setClock(Math.floor(Date.now() / 1000)), 30000); return () => window.clearInterval(timer); }, []);

  const readPublicPayout = useCallback(async (id: string): Promise<PublicPayout | null> => {
    const response = await fetch(`/api/payout/${id}`, { headers: { accept: "application/json" } });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("payout read failed");
    return (await response.json()) as PublicPayout;
  }, []);

  const refreshStatuses = useCallback(async (nextRecords = records) => {
    const entries = await Promise.all(nextRecords.map(async (record) => [record.id, await readPublicPayout(record.id)] as const));
    setPublicStates(Object.fromEntries(entries.filter((entry): entry is [string, PublicPayout] => Boolean(entry[1]))));
  }, [readPublicPayout, records]);

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
    setFlowError(""); setActiveLink(null);
    try {
      if (balanceState.status !== "READY" || balanceState.balance === null) throw new Error("Balance unavailable. Retry the balance check before funding.");
      const parsedAmount = parsePathUsdAmount(amount);
      if (parsedAmount > BigInt(balanceState.balance)) throw new Error("Requested amount exceeds your available pathUSD balance.");
      const option = expiryOptions.find((candidate) => String(candidate.seconds) === expirySeconds);
      if (!option) throw new Error("choose an expiry");
      setDraft({ amount: parsedAmount, amountText: formatPathUsd(parsedAmount), label: label.trim(), expiresAt: expiryFromNow(Math.floor(Date.now() / 1000), option.seconds), expiryLabel: option.label });
    } catch (error) { setFlowError(error instanceof Error ? error.message : "Enter a valid payout amount and expiry."); }
  }, [amount, balanceState, expirySeconds, label]);

  const waitForStatus = useCallback(async (id: string, expected: 1 | 3) => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const current = await readPublicPayout(id);
      if (current) { setPublicStates((previous) => ({ ...previous, [id]: current })); if (current.status === expected) return current; }
      await delay(1000);
    }
    return null;
  }, [readPublicPayout]);

  const fundPayout = useCallback(async () => {
    if (!address || !draft || transactionPending) return;
    if (!fundingAllowed(balanceState, draft.amount)) { setFlowError(balanceState.status === "READY" ? "Requested amount exceeds your available pathUSD balance." : "Balance unavailable. Retry the balance check before funding."); return; }
    setFlowError(""); setFlow("SIGNING");
    let payoutId: string | undefined;
    try {
      payoutId = createPayoutId();
      const capability = createClaimCapability();
      const claimSigner = claimSignerForCapability(capability.privateKey) as Address;
      const record: SenderPayoutRecord = { id: payoutId, amount: draft.amount.toString(), expiresAt: draft.expiresAt.toString(), claimSigner, ...(draft.label ? { label: draft.label } : {}), createdAt: new Date().toISOString() };
      rememberCapability(payoutId, capability.raw);
      rememberSenderPayout(record);
      setRecords(readSenderPayouts());
      const calls: SenderCall[] = [
        { to: PATH_USD_ADDRESS, data: encodeFunctionData({ abi: pathUsdAbi, functionName: "approve", args: [vaultAddress, draft.amount] }), value: 0n },
        { to: vaultAddress, data: encodeFunctionData({ abi: vaultAbi, functionName: "createPayout", args: [BigInt(payoutId), draft.amount, claimSigner, draft.expiresAt] }), value: 0n },
      ];
      const result = await sendTransactionAsync(senderRequest(calls));
      const hash = hashOf(result);
      if (hash) updateSenderPayout(payoutId, { fundingTxHash: hash });
      setRecords(readSenderPayouts()); setFlow("SUBMITTED"); setFlow("CONFIRMING");
      const funded = await waitForStatus(payoutId, payoutStatus.FUNDED);
      if (!funded || funded.sender.toLowerCase() !== address.toLowerCase() || funded.claimSigner.toLowerCase() !== claimSigner.toLowerCase()) { setFlowError("The funding transaction was submitted, but the vault has not confirmed the expected payout yet. Refresh to recover its authoritative state."); return; }
      setFlow("FUNDED"); setActiveLink({ id: payoutId, url: `${window.location.origin}/c/${payoutId}#${capability.raw}` }); setDraft(null); setAmount(""); setLabel(""); await refreshStatuses(readSenderPayouts());
    } catch { if (payoutId) { clearCapability(payoutId); removeSenderPayout(payoutId); } setRecords(readSenderPayouts()); setFlow("FAILED_RETRYABLE"); setFlowError("Funding was not submitted or was rejected. No payout is shown as funded."); }
  }, [address, balanceState, draft, refreshStatuses, sendTransactionAsync, transactionPending, waitForStatus]);

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
  const activeStatus = flow === "FUNDED" ? "FUNDED" : flow;
  const balanceDisplay = balanceState.status === "LOADING" ? "Checking…" : balanceState.status === "READY" && balanceState.balance !== null ? `${formatPathUsd(BigInt(balanceState.balance))} pathUSD` : "Unavailable";
  return <main className="app-shell sender-shell"><div className="topbar"><div className="brand-mark" aria-label="Reach home">reach<span>•</span></div><div className="network-chip"><i /> Tempo testnet</div></div><section className="sender-card" aria-live="polite"><div className="sender-hero"><div className="eyebrow">Send from your own account</div><h1>Reach</h1><p className="context-copy">Create a walletless pathUSD payout. Your Tempo passkey signs the funding transaction; Reach never holds the sender key.</p></div><div className="account-row"><div><span className="field-label">Tempo account</span><strong>{accountText}</strong></div>{!address && <button className="secondary-button compact-button" type="button" onClick={() => void connectSender()}>Create sender account</button>}</div>{address && <div className="balance-row"><div><span>Available pathUSD</span><strong>{balanceDisplay}</strong>{balanceState.status === "ERROR" && <p className="error-copy">We couldn't read your Tempo balance.</p>}</div>{balanceState.status === "ERROR" && <button className="secondary-button compact-button" type="button" onClick={() => setBalanceRetry((value) => value + 1)}>Retry</button>}</div>}{flow === "REVIEW" && !draft && <div className="sender-form"><label><span className="field-label">Amount</span><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" aria-label="payout amount" /></label><label><span className="field-label">Recipient note <em>optional, local only</em></span><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. Alice" aria-label="recipient note" /></label><label><span className="field-label">Claim window</span><select value={expirySeconds} onChange={(event) => setExpirySeconds(event.target.value)} aria-label="claim expiry">{expiryOptions.map((option) => <option key={option.seconds} value={option.seconds}>{option.label}</option>)}</select></label><button className="claim-button sender-action" type="button" onClick={reviewPayout} disabled={!address || balanceState.status !== "READY"}>Review payout <span aria-hidden="true">→</span></button>{!address && <p className="form-hint">Connect a Tempo passkey account to begin.</p>}{address && balanceState.status === "LOADING" && <p className="form-hint">Checking your authoritative Tempo balance before enabling funding.</p>}{address && balanceState.status === "ERROR" && <p className="form-hint">Retry the balance check before reviewing a payout.</p>}</div>}{draft && flow === "REVIEW" && <div className="review-panel"><span className="field-label">Review before signing</span><h2>{draft.amountText} pathUSD</h2><dl><div><dt>Claim window</dt><dd>{draft.expiryLabel}</dd></div><div><dt>Expires</dt><dd>{new Date(Number(draft.expiresAt) * 1000).toLocaleString()}</dd></div>{draft.label && <div><dt>Local note</dt><dd>{draft.label}</dd></div>}</dl><p className="form-hint">The note stays in this browser and is not written onchain.</p><button className="claim-button sender-action" type="button" onClick={() => void fundPayout()} disabled={!fundingAllowed(balanceState, draft.amount) || transactionPending}>Sign &amp; fund payout <span aria-hidden="true">→</span></button><button className="secondary-button" type="button" onClick={() => setDraft(null)}>Edit</button></div>}{flow !== "REVIEW" && <div className={`state-panel state-${flow.toLowerCase()}`}><div className="state-dot" aria-hidden="true" /><div><strong>{activeStatus === "FUNDED" ? "Payout funded" : activeStatus === "FAILED_RETRYABLE" ? "Funding needs another try" : activeStatus}</strong><span>{flow === "FUNDED" ? " The vault confirmed the sender-funded payout." : flow === "SIGNING" ? " Approve the transaction with your Tempo passkey." : flow === "SUBMITTED" || flow === "CONFIRMING" ? " Checking the vault before showing the claim link." : " Nothing is shown as funded."}</span></div></div>}{flow === "FUNDED" && activeLink && <div className="claim-link-panel"><span className="field-label">Your claim link — save it now</span><code>{activeLink.url}</code><button className="secondary-button" type="button" onClick={() => { void navigator.clipboard?.writeText(activeLink.url).then(() => setCopied(true)).catch(() => setCopied(false)); }}>{copied ? "Copied" : "Copy claim link"}</button><p className="form-hint">Reach keeps the bearer capability only for this active browser session. If you lose the link later, the public payout remains visible, but Reach cannot manufacture another credential.</p></div>}{flowError && <p className="error-copy">{flowError}</p>}</section><section className="sender-card payout-list"><div className="list-heading"><div><div className="eyebrow">Sender dashboard</div><h2>Your payouts</h2></div><button className="secondary-button compact-button" type="button" onClick={() => void refreshStatuses()}>Refresh</button></div>{records.length === 0 && <p className="empty-copy">Funded payouts will appear here with public onchain status.</p>}{records.map((record) => { const current = publicStates[record.id]; const reclaimStage = reclaimStages[record.id]; const reclaimable = Boolean(address && current && isReclaimEligible(current.status, BigInt(current.expiresAt), BigInt(clock), current.sender, address)); return <article className="payout-row" key={record.id}><div className="payout-row-main"><strong>{formatPathUsd(BigInt(record.amount))} pathUSD</strong><span>{current ? publicStatusLabel(current.status, BigInt(current.expiresAt), BigInt(clock)) : "Loading public status…"}</span></div><dl><div><dt>Payout ID</dt><dd>{record.id}</dd></div><div><dt>Expires</dt><dd>{new Date(Number(record.expiresAt) * 1000).toLocaleString()}</dd></div>{record.label && <div><dt>Note</dt><dd>{record.label}</dd></div>}{record.fundingTxHash && <div><dt>Funding tx</dt><dd>{shortAddress(record.fundingTxHash)}</dd></div>}</dl>{reclaimable && <button className="secondary-button" type="button" disabled={Boolean(reclaimStage && reclaimStage !== "FAILED_RETRYABLE") || transactionPending} onClick={() => void reclaim(record)}>{reclaimStage === "CONFIRMING" ? "Confirming reclaim…" : reclaimStage === "SIGNING" ? "Sign reclaim…" : "Reclaim"}</button>}{reclaimErrors[record.id] && <p className="error-copy">{reclaimErrors[record.id]}</p>}</article>; })}</section><footer><span>Sender signs directly on Tempo.</span><span className="footer-separator">·</span><span>Tempo Moderato</span></footer></main>;
}
