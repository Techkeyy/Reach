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
import LandingHero from "./LandingHero";
import { SendIcon, WalletIcon, PasskeyIcon, ClockIcon, RefreshIcon, CheckCircleIcon, AlertCircleIcon, ShieldCheckIcon, ChevronRightIcon, ExternalLinkIcon } from "./components/Icons";

type PublicPayout = { sender: Address; amount: string; expiresAt: string; claimSigner: Address; status: 0 | 1 | 2 | 3; claimant: Address };
type DiscoveredResponse = { address: Address; payouts: DiscoveredSenderPayout[] };
type Draft = { amount: bigint; amountText: string; label: string; expiresAt: bigint; expiryLabel: string };
type SenderCall = { to: Address; data: `0x${string}`; value: bigint };
type PreparedFunding = { payoutId: string; capability: ReturnType<typeof createClaimCapability>; claimSigner: Address; calls: SenderCall[]; record: SenderPayoutRecord };

const vaultAddress = (import.meta.env.VITE_REACH_VAULT_ADDRESS ?? DEFAULT_VAULT_ADDRESS) as Address;
const expiryOptions = [
  { seconds: 3600, label: "1 hour" },
  { seconds: 86400, label: "24 hours" },
  { seconds: 259200, label: "3 days" },
];

class BalanceReadFailure extends Error {
  constructor(public readonly httpStatus: number) {
    super("balance request failed");
    this.name = "BalanceReadFailure";
  }
}

function hashOf(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.transactionHash === "string") return record.transactionHash;
  if (typeof record.hash === "string") return record.hash;
  return hashOf(record.receipt);
}

function shortAddress(value: string) {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function delay(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function senderRequest(calls: readonly SenderCall[]) {
  return { chainId: TEMPO_MODERATO_CHAIN_ID, calls, feePayer: false } as never;
}

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
  const [showHowItWorks, setShowHowItWorks] = useState(false);

  useEffect(() => {
    setRecords(readSenderPayouts());
    const timer = window.setInterval(() => setClock(Math.floor(Date.now() / 1000)), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const readPublicPayout = useCallback(async (id: string): Promise<PublicPayout | null> => {
    const response = await fetch(`/api/payout/${id}`, { headers: { accept: "application/json" } });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("payout read failed");
    return (await response.json()) as PublicPayout;
  }, []);

  const readFundingReceipt = useCallback(async (hash: string) => {
    if (!publicClient) return null;
    try {
      return await publicClient.getTransactionReceipt({ hash: hash as Hex });
    } catch {
      return null;
    }
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
        setDiscoveryError("We could not rediscover your payouts from Tempo. Refresh to try again.");
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

  useEffect(() => {
    void refreshStatuses();
  }, [refreshStatuses]);

  useEffect(() => {
    if (!address) {
      setBalanceState(loadingBalance());
      return;
    }
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
        if (!cancelled) setBalanceState(failedBalance("We could not read your Tempo balance.", httpStatus));
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [address, balanceRetry]);

  const connectSender = useCallback(async () => {
    const connector = connectors[0];
    if (!connector) {
      setFlowError("The Tempo passkey connector is unavailable.");
      return;
    }
    setFlowError("");
    try {
      await connectAsync({ connector, capabilities: { method: "register" as const, name: "Reach sender" } });
    } catch {
      setFlowError("Passkey account setup was cancelled or unavailable.");
    }
  }, [connectAsync, connectors]);

  const reviewPayout = useCallback(() => {
    setFlowError("");
    setActiveLink(null);
    setPreparedFunding(null);
    setFlow("REVIEW");
    try {
      if (balanceState.status !== "READY" || balanceState.balance === null) {
        throw new Error("Balance unavailable. Retry the balance check before funding.");
      }
      const parsedAmount = parsePathUsdAmount(amount);
      if (parsedAmount > BigInt(balanceState.balance)) {
        throw new Error("Requested amount exceeds your available pathUSD balance.");
      }
      const option = expiryOptions.find((candidate) => String(candidate.seconds) === expirySeconds);
      if (!option) throw new Error("choose an expiry");
      setDraft({
        amount: parsedAmount,
        amountText: formatPathUsd(parsedAmount),
        label: label.trim(),
        expiresAt: expiryFromNow(Math.floor(Date.now() / 1000), option.seconds),
        expiryLabel: option.label,
      });
    } catch (error) {
      setFlowError(error instanceof Error ? error.message : "Enter a valid payout amount and expiry.");
    }
  }, [amount, balanceState, expirySeconds, label]);

  const preflightPayout = useCallback(async () => {
    if (!address || !draft || transactionPending || flow !== "REVIEW") return;
    if (!fundingAllowed(balanceState, draft.amount)) {
      setFlowError(balanceState.status === "READY" ? "Requested amount exceeds your available pathUSD balance." : "Balance unavailable. Retry the balance check before funding.");
      return;
    }
    setFlowError("");
    setPreparedFunding(null);
    setFlow("PREFLIGHTING");
    try {
      const payoutId = createPayoutId();
      const capability = createClaimCapability();
      const claimSigner = claimSignerForCapability(capability.privateKey) as Address;
      const calls = fundingCalls(payoutId, draft.amount, claimSigner, draft.expiresAt);
      const record: SenderPayoutRecord = {
        id: payoutId,
        amount: draft.amount.toString(),
        expiresAt: draft.expiresAt.toString(),
        claimSigner,
        ...(draft.label ? { label: draft.label } : {}),
        createdAt: new Date().toISOString(),
      };
      const result = await preflightFunding(connectorClient as unknown as FundingFillClient | undefined, toFundingFillRequest(address, calls));
      if (!result.ok) {
        setFlow("REVIEW");
        setFlowError("message" in result ? result.message : "Funding preflight failed. Retry before signing.");
        return;
      }
      setPreparedFunding({ payoutId, capability, claimSigner, calls, record });
      setFlow("READY_TO_SIGN");
    } catch (error) {
      setFlow("REVIEW");
      setFlowError(error instanceof Error ? error.message : "Funding preflight failed. Retry before signing.");
    }
  }, [address, balanceState, connectorClient, draft, flow, transactionPending]);

  const waitForStatus = useCallback(async (id: string, expected: 1 | 3) => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const current = await readPublicPayout(id);
      if (current) {
        setPublicStates((previous) => ({ ...previous, [id]: current }));
        if (current.status === expected) return current;
      }
      await delay(1000);
    }
    return null;
  }, [readPublicPayout]);

  const fundPayout = useCallback(async () => {
    if (!address || !draft || !preparedFunding || flow !== "READY_TO_SIGN" || transactionPending) return;
    if (!fundingAllowed(balanceState, draft.amount)) {
      setFlowError(balanceState.status === "READY" ? "Requested amount exceeds your available pathUSD balance." : "Balance unavailable. Retry the balance check before funding.");
      return;
    }
    const prepared = preparedFunding;
    let hash: string | undefined;
    const markRecovery = (message: string) => {
      updateSenderPayout(prepared.payoutId, { ...(hash ? { fundingTxHash: hash } : {}), outcome: "RECOVERY_REQUIRED", failureMessage: message });
      setRecords(readSenderPayouts());
      setPreparedFunding(null);
      setFlow("RECOVERY_REQUIRED");
      setFlowError(message);
    };
    setFlowError("");
    setFlow("SIGNING");
    rememberCapability(prepared.payoutId, prepared.capability.raw);
    rememberSenderPayout(prepared.record);
    setRecords(readSenderPayouts());
    try {
      const result = await sendTransactionAsync(senderRequest(prepared.calls));
      hash = hashOf(result);
      if (!hash) throw new Error("Funding transaction hash was not returned.");
      updateSenderPayout(prepared.payoutId, { fundingTxHash: hash });
      setRecords(readSenderPayouts());
      setFlow("SUBMITTED");
      setFlow("CONFIRMING");
      let receipt;
      try {
        if (!publicClient) throw new Error("Tempo receipt client unavailable.");
        receipt = await publicClient.waitForTransactionReceipt({ hash: hash as Hex });
      } catch {
        markRecovery("Funding status is unknown. Refresh to reconcile the authoritative vault state.");
        return;
      }
      if (receipt.status === "reverted") {
        clearCapability(prepared.payoutId);
        rememberSenderPayout(failedRecord(prepared.record, hash));
        setRecords(readSenderPayouts());
        setPreparedFunding(null);
        setDraft(null);
        setFlow("FAILED_RETRYABLE");
        setFlowError(failedArtifactMessage());
        return;
      }
      let funded: PublicPayout | null;
      try {
        funded = await waitForStatus(prepared.payoutId, payoutStatus.FUNDED);
      } catch {
        markRecovery("Funding receipt succeeded, but the vault state could not be read. Refresh to reconcile.");
        return;
      }
      const resolution = resolveFundingReceipt({
        receiptStatus: "success",
        payout: funded ?? undefined,
        expected: { sender: address, amount: prepared.record.amount, expiresAt: prepared.record.expiresAt, claimSigner: prepared.claimSigner },
      });
      if (resolution === "RECOVERY_REQUIRED") {
        markRecovery("Funding receipt succeeded, but the vault state needs recovery. No claim link was revealed.");
        return;
      }
      rememberSenderPayout({ ...prepared.record, fundingTxHash: hash });
      setFlow("FUNDED");
      setActiveLink({ id: prepared.payoutId, url: `${window.location.origin}/c/${prepared.payoutId}#${prepared.capability.raw}` });
      setDraft(null);
      setAmount("");
      setLabel("");
      setPreparedFunding(null);
      await refreshStatuses(readSenderPayouts());
    } catch {
      if (hash) {
        markRecovery("Funding status is unknown. Refresh to reconcile the authoritative vault state.");
        return;
      }
      clearCapability(prepared.payoutId);
      removeSenderPayout(prepared.payoutId);
      setRecords(readSenderPayouts());
      setPreparedFunding(null);
      setDraft(null);
      setFlow("FAILED_RETRYABLE");
      setFlowError("Funding was not submitted or was rejected. No payout is shown as funded.");
    }
  }, [address, balanceState, draft, flow, preparedFunding, publicClient, refreshStatuses, sendTransactionAsync, transactionPending, waitForStatus]);

  const reclaim = useCallback(async (record: SenderPayoutRecord) => {
    const current = publicStates[record.id];
    if (!address || !current || !isReclaimEligible(current.status, BigInt(current.expiresAt), BigInt(clock), current.sender, address)) return;
    setReclaimErrors((previous) => ({ ...previous, [record.id]: "" }));
    setReclaimStages((previous) => ({ ...previous, [record.id]: "SIGNING" }));
    try {
      const result = await sendTransactionAsync(
        senderRequest([{ to: vaultAddress, data: encodeFunctionData({ abi: vaultAbi, functionName: "reclaim", args: [BigInt(record.id)] }), value: 0n }])
      );
      const hash = hashOf(result);
      if (hash) updateSenderPayout(record.id, { reclaimTxHash: hash });
      setReclaimStages((previous) => ({ ...previous, [record.id]: "SUBMITTED" }));
      setReclaimStages((previous) => ({ ...previous, [record.id]: "CONFIRMING" }));
      const reclaimed = await waitForStatus(record.id, payoutStatus.RECLAIMED);
      if (!reclaimed) {
        setReclaimErrors((previous) => ({ ...previous, [record.id]: "Reclaim was submitted but is not confirmed in the vault yet." }));
        return;
      }
      setReclaimStages((previous) => ({ ...previous, [record.id]: "FUNDED" }));
      setRecords(readSenderPayouts());
    } catch {
      setReclaimStages((previous) => ({ ...previous, [record.id]: "FAILED_RETRYABLE" }));
      setReclaimErrors((previous) => ({ ...previous, [record.id]: "Reclaim was not submitted or was rejected." }));
    }
  }, [address, clock, publicStates, sendTransactionAsync, waitForStatus]);

  const accountText = useMemo(() => (address ? shortAddress(address) : "No account connected"), [address]);

  const stateTitle =
    flow === "FUNDED"
      ? "Payout funded"
      : flow === "FAILED_RETRYABLE"
      ? "Funding needs another try"
      : flow === "RECOVERY_REQUIRED"
      ? "Funding needs recovery"
      : flow === "PREFLIGHTING"
      ? "Checking funding readiness"
      : flow === "READY_TO_SIGN"
      ? "Ready to sign"
      : flow === "SIGNING"
      ? "Signing funding transaction"
      : flow === "SUBMITTED" || flow === "CONFIRMING"
      ? "Confirming funding"
      : flow;

  const stateCopy =
    flow === "FUNDED"
      ? "The vault confirmed the sender-funded payout."
      : flow === "PREFLIGHTING"
      ? "Tempo is checking the exact transaction and fee affordability. No signature has been requested."
      : flow === "READY_TO_SIGN"
      ? "The exact transaction passed preflight. Review the details, then approve with your Tempo passkey."
      : flow === "SIGNING"
      ? "Approve the transaction with your Tempo passkey."
      : flow === "SUBMITTED" || flow === "CONFIRMING"
      ? "Waiting for a successful receipt and an exact vault reread."
      : flow === "FAILED_RETRYABLE"
      ? "Funding failed. No payout was created."
      : flow === "RECOVERY_REQUIRED"
      ? "The receipt succeeded or status became uncertain, but the authoritative payout state needs reconciliation. No claim link was revealed."
      : "";

  const balanceDisplay =
    balanceState.status === "LOADING"
      ? "Checking..."
      : balanceState.status === "READY" && balanceState.balance !== null
      ? `${formatPathUsd(BigInt(balanceState.balance))} pathUSD`
      : "Unavailable";

  const getStatusBadge = (record: SenderPayoutRecord, current: PublicPayout | undefined) => {
    if (record.outcome === "FAILED") {
      return <span className="status-pill status-pill-failed">Failed: Not created</span>;
    }
    if (record.outcome === "RECOVERY_REQUIRED") {
      return <span className="status-pill status-pill-warning">Recovery required</span>;
    }
    if (!current) {
      return <span className="status-pill status-pill-neutral">Loading status...</span>;
    }
    if (current.status === payoutStatus.FUNDED && BigInt(clock) >= BigInt(current.expiresAt)) {
      return <span className="status-pill status-pill-warning">Expired: Reclaim available</span>;
    }
    if (current.status === payoutStatus.FUNDED) {
      return <span className="status-pill status-pill-funded">Funded: Ready to claim</span>;
    }
    if (current.status === payoutStatus.CLAIMED) {
      return <span className="status-pill status-pill-success">Claimed</span>;
    }
    if (current.status === payoutStatus.RECLAIMED) {
      return <span className="status-pill status-pill-neutral">Returned to sender</span>;
    }
    return <span className="status-pill status-pill-neutral">{publicStatusLabel(current.status, BigInt(current.expiresAt), BigInt(clock))}</span>;
  };

  return (
    <main className="app-shell sender-shell">
      <header className="topbar">
        <div className="brand-group">
          <div className="brand-mark" aria-label="Reach home">
            reach<span className="brand-dot">•</span>
          </div>
          <span className="brand-tagline">Walletless Payouts</span>
        </div>
        
        <div className="topbar-actions">
          <button
            className="nav-text-btn"
            type="button"
            onClick={() => setShowHowItWorks((prev) => !prev)}
          >
            {showHowItWorks ? "Back to Send" : "How it works"}
          </button>
          <div className="network-chip">
            <span className="live-dot" /> Tempo testnet
          </div>
        </div>
      </header>

      {showHowItWorks ? (
        <div className="landing-wrapper">
          <LandingHero onStartSend={() => setShowHowItWorks(false)} />
        </div>
      ) : (
        <>
          <section className="sender-card hero-sender-card" aria-live="polite">
            <div className="sender-hero-header">
              <div className="sender-eyebrow-row">
                <span className="eyebrow">Sender Portal</span>
                <span className="badge-chain">Tempo Moderato (42431)</span>
              </div>
              <h1>Send pathUSD</h1>
              <p className="context-copy">
                Create an instant, walletless payout. You sign with a passkey, and the recipient claims with zero network gas.
              </p>
            </div>

            {/* Account & Balance Bar */}
            <div className="fintech-account-bar">
              <div className="account-cell">
                <div className="cell-icon-wrap">
                  <PasskeyIcon size={18} />
                </div>
                <div>
                  <span className="field-label">Tempo Sender Account</span>
                  <div className="cell-value-row">
                    <strong>{accountText}</strong>
                    {address && <span className="verified-badge"><CheckCircleIcon size={12} /> Connected</span>}
                  </div>
                </div>
              </div>

              {!address ? (
                <button className="claim-button compact-connect-btn" type="button" onClick={() => void connectSender()}>
                  <span>Create sender account</span>
                  <ChevronRightIcon size={16} />
                </button>
              ) : (
                <div className="balance-cell">
                  <div className="balance-text-group">
                    <span className="field-label">Available Balance</span>
                    <strong className="balance-amount">{balanceDisplay}</strong>
                    {balanceState.status === "ERROR" && (
                      <span className="error-micro">Could not read balance</span>
                    )}
                  </div>
                  <button
                    className="icon-refresh-btn"
                    type="button"
                    title="Refresh balance"
                    onClick={() => setBalanceRetry((v) => v + 1)}
                  >
                    <RefreshIcon size={16} />
                  </button>
                </div>
              )}
            </div>

            {/* Creation Form */}
            {flow === "REVIEW" && !draft && (
              <div className="sender-form">
                <div className="amount-input-card">
                  <span className="field-label">Payout Amount</span>
                  <div className="amount-input-row">
                    <span className="currency-prefix">$</span>
                    <input
                      inputMode="decimal"
                      className="amount-input"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                      aria-label="payout amount"
                      autoComplete="off"
                    />
                    <span className="currency-token-badge">pathUSD</span>
                  </div>
                  {address && balanceState.status === "READY" && balanceState.balance !== null && (
                    <div className="amount-quick-hints">
                      <span>Available: {formatPathUsd(BigInt(balanceState.balance))} pathUSD</span>
                    </div>
                  )}
                </div>

                <div className="form-two-col">
                  <label className="input-group">
                    <span className="field-label">
                      Recipient Note <em>(optional · local only)</em>
                    </span>
                    <input
                      className="form-control"
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      placeholder="e.g. For dinner or design work"
                      aria-label="recipient note"
                    />
                  </label>

                  <label className="input-group">
                    <span className="field-label">Claim Window</span>
                    <select
                      className="form-control"
                      value={expirySeconds}
                      onChange={(e) => setExpirySeconds(e.target.value)}
                      aria-label="claim expiry"
                    >
                      {expiryOptions.map((option) => (
                        <option key={option.seconds} value={option.seconds}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <button
                  className="claim-button sender-action"
                  type="button"
                  onClick={reviewPayout}
                  disabled={!address || balanceState.status !== "READY"}
                >
                  <span>Review payout</span>
                  <ChevronRightIcon size={18} />
                </button>

                {!address && (
                  <div className="form-info-callout">
                    <PasskeyIcon size={16} />
                    <span>Connect your Tempo passkey account above to begin creating payouts.</span>
                  </div>
                )}
                {address && balanceState.status === "LOADING" && (
                  <div className="form-info-callout">
                    <RefreshIcon size={16} className="spin-slow" />
                    <span>Verifying authoritative balance on Tempo before enabling funding.</span>
                  </div>
                )}
                {address && balanceState.status === "ERROR" && (
                  <div className="form-error-callout">
                    <AlertCircleIcon size={16} />
                    <span>Unable to read account balance. Please retry the balance check.</span>
                  </div>
                )}
              </div>
            )}

            {/* Review Panel */}
            {draft && (flow === "REVIEW" || flow === "PREFLIGHTING" || flow === "READY_TO_SIGN") && (
              <div className="review-panel">
                <div className="review-header">
                  <span className="field-label">Review Payout Details</span>
                  <span className="status-pill status-pill-neutral">Step 2 of 2</span>
                </div>

                <div className="review-amount-display">
                  <span className="amount-label">You are sending</span>
                  <h2>${draft.amountText} <span className="text-mint">pathUSD</span></h2>
                </div>

                <dl className="review-details-list">
                  <div className="review-detail-row">
                    <dt>Claim window</dt>
                    <dd>{draft.expiryLabel}</dd>
                  </div>
                  <div className="review-detail-row">
                    <dt>Expires at</dt>
                    <dd>{new Date(Number(draft.expiresAt) * 1000).toLocaleString()}</dd>
                  </div>
                  {draft.label && (
                    <div className="review-detail-row">
                      <dt>Local note</dt>
                      <dd>{draft.label}</dd>
                    </div>
                  )}
                  <div className="review-detail-row">
                    <dt>Network Fee</dt>
                    <dd>Tempo network fee (paid by sender)</dd>
                  </div>
                </dl>

                <div className="preflight-explanation-box">
                  <ShieldCheckIcon size={18} className="text-mint" />
                  <p>
                    Reach checks the exact approve and createPayout transaction before requesting your passkey signature.
                  </p>
                </div>

                <div className="review-actions-group">
                  {flow === "REVIEW" && (
                    <button
                      className="claim-button sender-action"
                      type="button"
                      onClick={() => void preflightPayout()}
                      disabled={!fundingAllowed(balanceState, draft.amount) || transactionPending}
                    >
                      <span>Check funding readiness</span>
                      <ChevronRightIcon size={18} />
                    </button>
                  )}
                  {flow === "PREFLIGHTING" && (
                    <button className="claim-button sender-action" type="button" disabled>
                      <span>Checking funding readiness...</span>
                    </button>
                  )}
                  {flow === "READY_TO_SIGN" && (
                    <button
                      className="claim-button sender-action"
                      type="button"
                      onClick={() => void fundPayout()}
                      disabled={transactionPending}
                    >
                      <span>Sign &amp; fund payout</span>
                      <SendIcon size={18} />
                    </button>
                  )}
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={flow === "PREFLIGHTING"}
                    onClick={() => {
                      setDraft(null);
                      setPreparedFunding(null);
                      setFlow("REVIEW");
                      setFlowError("");
                    }}
                  >
                    Back to edit
                  </button>
                </div>
              </div>
            )}

            {/* State Feedback Panel */}
            {flow !== "REVIEW" && (
              <div className={`state-panel state-${flow.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
                <div className="state-dot" aria-hidden="true" />
                <div className="state-panel-body">
                  <strong>{stateTitle}</strong>
                  <span>{stateCopy}</span>
                  {flow === "FAILED_RETRYABLE" && (
                    <button
                      className="secondary-button compact-btn mt-2"
                      type="button"
                      onClick={() => {
                        setFlow("REVIEW");
                        setFlowError("");
                      }}
                    >
                      Try again
                    </button>
                  )}
                  {flow === "RECOVERY_REQUIRED" && (
                    <button
                      className="secondary-button compact-btn mt-2"
                      type="button"
                      onClick={() => void refreshStatuses()}
                    >
                      Refresh authoritative state
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Masked Funded Claim Link */}
            {flow === "FUNDED" && activeLink && (
              <SenderClaimLink
                key={activeLink.id}
                url={activeLink.url}
                onCopy={async (url) => {
                  if (!navigator.clipboard) throw new Error("clipboard unavailable");
                  await navigator.clipboard.writeText(url);
                }}
              />
            )}

            {flowError && (
              <div className="banner-error">
                <AlertCircleIcon size={16} />
                <p className="error-copy">{flowError}</p>
              </div>
            )}
            {discoveryError && (
              <div className="banner-error">
                <AlertCircleIcon size={16} />
                <p className="error-copy">{discoveryError}</p>
              </div>
            )}
          </section>

          {/* Payout History Section */}
          <section className="sender-card payout-list-section">
            <div className="list-heading-bar">
              <div>
                <span className="eyebrow">Activity</span>
                <h2>Your Payouts</h2>
              </div>
              <button
                className="secondary-button compact-btn"
                type="button"
                onClick={() => void refreshStatuses()}
              >
                <RefreshIcon size={14} />
                <span>Refresh</span>
              </button>
            </div>

            {records.length === 0 ? (
              <div className="empty-payout-state">
                <div className="empty-icon-wrap">
                  <WalletIcon size={28} />
                </div>
                <h3>No payouts yet</h3>
                <p className="empty-copy">
                  When you fund a payout, its live onchain lifecycle and reclaim controls will appear here.
                </p>
              </div>
            ) : (
              <div className="payout-cards-grid">
                {records.map((record) => {
                  const current = publicStates[record.id];
                  const reclaimStage = reclaimStages[record.id];
                  const reclaimable = Boolean(
                    !record.outcome &&
                    address &&
                    current &&
                    isReclaimEligible(current.status, BigInt(current.expiresAt), BigInt(clock), current.sender, address)
                  );
                  const claimLinkAvailable = typeof window !== "undefined" && hasCapability(record.id);

                  return (
                    <article className="payout-item-card" key={record.id}>
                      <div className="payout-item-header">
                        <div className="payout-amount-col">
                          <strong className="payout-card-amount">
                            ${formatPathUsd(BigInt(record.amount))} <span className="token-unit">pathUSD</span>
                          </strong>
                          {record.label && <span className="payout-card-note">{record.label}</span>}
                        </div>
                        <div className="payout-badge-wrap">
                          {getStatusBadge(record, current)}
                        </div>
                      </div>

                      <dl className="payout-meta-grid">
                        <div className="meta-cell">
                          <dt>Payout ID</dt>
                          <dd className="font-mono">{record.id.slice(0, 10)}...{record.id.slice(-6)}</dd>
                        </div>
                        <div className="meta-cell">
                          <dt>Expires</dt>
                          <dd>{new Date(Number(record.expiresAt) * 1000).toLocaleString()}</dd>
                        </div>
                        {record.fundingTxHash && (
                          <div className="meta-cell">
                            <dt>Funding Tx</dt>
                            <dd className="font-mono">{shortAddress(record.fundingTxHash)}</dd>
                          </div>
                        )}
                      </dl>

                      {current?.status === payoutStatus.FUNDED && (
                        <div className="payout-capability-notice">
                          <ShieldCheckIcon size={14} />
                          <p className="form-hint">
                            {claimLinkAvailable
                              ? "Claim link available on this device/session."
                              : "Claim link unavailable on this device/session. Reach cannot recreate a lost claim link."}
                          </p>
                        </div>
                      )}

                      {record.failureMessage && (
                        <div className="payout-failure-msg">
                          <AlertCircleIcon size={14} />
                          <p className="error-copy">{record.failureMessage}</p>
                        </div>
                      )}

                      {reclaimable && (
                        <div className="payout-reclaim-action">
                          <button
                            className="secondary-button reclaim-btn"
                            type="button"
                            disabled={Boolean(reclaimStage && reclaimStage !== "FAILED_RETRYABLE") || transactionPending}
                            onClick={() => void reclaim(record)}
                          >
                            {reclaimStage === "CONFIRMING"
                              ? "Confirming reclaim..."
                              : reclaimStage === "SIGNING"
                              ? "Signing reclaim with passkey..."
                              : "Reclaim Funds to Account"}
                          </button>
                          {reclaimErrors[record.id] && (
                            <p className="error-copy mt-1">{reclaimErrors[record.id]}</p>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}

      <footer className="footer-bar">
        <div className="footer-left">
          <span>Sender signs directly on Tempo</span>
          <span className="footer-separator">·</span>
          <span>Non-custodial vault</span>
        </div>
        <div className="footer-right">
          <span>Tempo Moderato (Chain ID 42431)</span>
        </div>
      </footer>
    </main>
  );
}
