import { useCallback, useEffect, useRef, useState } from "react";
import { encodeFunctionData, formatUnits, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { useConnection, useConnect, useConnectors, useSendTransactionSync } from "wagmi";
import { CLAIM_ACTION, CLAIM_AUTHORIZATION_VERSION, claimDomain, claimTypes, DEFAULT_VAULT_ADDRESS, PATH_USD_DECIMALS, payoutStatus, TEMPO_MODERATO_CHAIN_ID, vaultAbi, type PayoutStatus } from "../shared/reach";
import { claimSignerForCapability, clearCapability, readCapability, recoverCapability, recoverPending, rememberCapability, rememberPending } from "./claimCapability";

type Payout = { sender: Address; amount: string; expiresAt: string; claimSigner: Address; status: PayoutStatus; claimant: Address };
type Stage = "LOADING" | "READY_TO_CLAIM" | "CREATING_ACCOUNT" | "AWAITING_PASSKEY" | "PREPARING_CLAIM" | "AWAITING_CONFIRMATION" | "CLAIMED" | "EXPIRED" | "ALREADY_CLAIMED" | "RECLAIMED" | "MISSING_CREDENTIAL" | "INVALID_LINK" | "FAILED_RETRYABLE";
const vaultAddress = (import.meta.env.VITE_REACH_VAULT_ADDRESS ?? DEFAULT_VAULT_ADDRESS) as Address;
function payoutIdFromPath() { return window.location.pathname.replace(/\/$/, "").match(/^\/c\/([1-9][0-9]{0,77})$/)?.[1] ?? null; }
function amountText(amount: string) { return Number(formatUnits(BigInt(amount), PATH_USD_DECIMALS)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function title(stage: Stage) { return ({ LOADING: "Checking your claim", READY_TO_CLAIM: "Ready to claim", CREATING_ACCOUNT: "Creating your secure account", AWAITING_PASSKEY: "Waiting for your passkey", PREPARING_CLAIM: "Preparing your claim", AWAITING_CONFIRMATION: "Confirming your claim", CLAIMED: "Claimed", ALREADY_CLAIMED: "Already claimed", RECLAIMED: "Returned to sender", EXPIRED: "This claim expired", MISSING_CREDENTIAL: "Claim credential unavailable", INVALID_LINK: "This link is not valid", FAILED_RETRYABLE: "Something needs another try" } satisfies Record<Stage, string>)[stage]; }
function hashOf(value: unknown): string | undefined { if (!value || typeof value !== "object") return undefined; const record = value as Record<string, unknown>; if (typeof record.transactionHash === "string") return record.transactionHash; if (typeof record.hash === "string") return record.hash; return hashOf(record.receipt); }
function stripFragment() { if (window.location.hash) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`); }

export default function App() {
  const id = payoutIdFromPath();
  const { address: connectedAddress } = useConnection();
  const connectors = useConnectors();
  const { connectAsync } = useConnect();
  const { mutateAsync: sendTransactionAsync, isPending: sending } = useSendTransactionSync();
  const [stage, setStage] = useState<Stage>("LOADING");
  const [payout, setPayout] = useState<Payout | null>(null);
  const [capability, setCapability] = useState<ReturnType<typeof readCapability> | null>(null);
  const [retryable, setRetryable] = useState(false);
  const busy = useRef(false);
  const booting = useRef(false);
  const readPayout = useCallback(async (payoutId: string): Promise<Payout | null> => {
    const response = await fetch(`/api/payout/${payoutId}`, { headers: { accept: "application/json" } });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("payout read failed");
    return (await response.json()) as Payout;
  }, []);
  const applyState = useCallback((next: Payout, pending: { recipient: string; txHash?: string } | null) => {
    setPayout(next);
    if (next.status === payoutStatus.CLAIMED) { if (id) clearCapability(id); setCapability(null); setStage("CLAIMED"); return; }
    if (next.status === payoutStatus.RECLAIMED) { if (id) clearCapability(id); setCapability(null); setStage("RECLAIMED"); return; }
    if (next.status !== payoutStatus.FUNDED) { setStage("INVALID_LINK"); return; }
    if (BigInt(next.expiresAt) <= BigInt(Math.floor(Date.now() / 1000))) { setStage("EXPIRED"); return; }
    setStage(pending ? "AWAITING_CONFIRMATION" : "READY_TO_CLAIM");
  }, [id]);
  const boot = useCallback(async () => {
    if (booting.current) return;
    if (!id) { setStage("INVALID_LINK"); return; }
    booting.current = true;
    setStage("LOADING"); setRetryable(false);
    let current: ReturnType<typeof readCapability> | null = null;
    try {
      const next = await readPayout(id);
      if (!next) { stripFragment(); setPayout(null); setCapability(null); setStage("INVALID_LINK"); return; }
      if (next.status === payoutStatus.CLAIMED || next.status === payoutStatus.RECLAIMED) { stripFragment(); applyState(next, null); return; }
      if (next.status !== payoutStatus.FUNDED) { stripFragment(); setPayout(next); setCapability(null); setStage("INVALID_LINK"); return; }
      if (BigInt(next.expiresAt) <= BigInt(Math.floor(Date.now() / 1000))) { stripFragment(); setPayout(next); setCapability(null); setStage("EXPIRED"); return; }
      try {
        const fromHash = window.location.hash ? readCapability(window.location.hash) : null;
        current = fromHash ?? recoverCapability(id);
        if (fromHash) { rememberCapability(id, fromHash.raw); stripFragment(); }
      } catch {
        clearCapability(id); stripFragment(); setPayout(next); setCapability(null); setStage("INVALID_LINK"); return;
      }
      if (!current) { setPayout(next); setCapability(null); setStage("MISSING_CREDENTIAL"); return; }
      if (claimSignerForCapability(current.privateKey).toLowerCase() !== next.claimSigner.toLowerCase()) { clearCapability(id); stripFragment(); setCapability(null); setStage("INVALID_LINK"); return; }
      setCapability(current); const pending = recoverPending(id); applyState(next, pending);
      if (pending && next.status === payoutStatus.FUNDED) for (let attempt = 0; attempt < 20; attempt += 1) { await new Promise((resolve) => window.setTimeout(resolve, 1500)); const refreshed = await readPayout(id); if (!refreshed) { setPayout(null); setCapability(null); setStage("INVALID_LINK"); break; } applyState(refreshed, pending); if (refreshed.status !== payoutStatus.FUNDED) break; }
    } catch { setCapability(current); setRetryable(true); setStage("FAILED_RETRYABLE"); } finally { booting.current = false; }
  }, [applyState, id, readPayout]);
  useEffect(() => { void boot(); }, [boot]);
  const claim = useCallback(async () => {
    if (!id || !payout || !capability || busy.current || sending) return; busy.current = true; setRetryable(false);
    try {
      let recipient = connectedAddress;
      if (!recipient) { const connector = connectors[0]; if (!connector) throw new Error("passkey unavailable"); setStage("CREATING_ACCOUNT"); const connection = await connectAsync({ connector, capabilities: { method: "register" as const, name: "Reach recipient" } }); recipient = connection.accounts[0] as Address | undefined; }
      if (!recipient) throw new Error("recipient unavailable"); setStage("AWAITING_PASSKEY");
      const signature = await privateKeyToAccount(capability.privateKey).signTypedData({ domain: claimDomain(vaultAddress), types: claimTypes, primaryType: "Claim", message: { payoutId: BigInt(id), recipient, action: CLAIM_ACTION, version: CLAIM_AUTHORIZATION_VERSION } });
      const data = encodeFunctionData({ abi: vaultAbi, functionName: "claim", args: [BigInt(id), recipient, signature] }); rememberPending(id, { recipient }); setStage("PREPARING_CLAIM");
      const result = await sendTransactionAsync({ chainId: TEMPO_MODERATO_CHAIN_ID, calls: [{ to: vaultAddress, data, value: 0n }] }); const hash = hashOf(result); rememberPending(id, { recipient, ...(hash ? { txHash: hash } : {}) }); setStage("AWAITING_CONFIRMATION");
      for (let attempt = 0; attempt < 20; attempt += 1) { const refreshed = await readPayout(id); if (!refreshed) { setPayout(null); setCapability(null); setStage("INVALID_LINK"); break; } applyState(refreshed, { recipient, ...(hash ? { txHash: hash } : {}) }); if (refreshed.status !== payoutStatus.FUNDED) break; await new Promise((resolve) => window.setTimeout(resolve, 1500)); }
    } catch { setRetryable(true); setStage("FAILED_RETRYABLE"); } finally { busy.current = false; }
  }, [applyState, capability, connectAsync, connectedAddress, connectors, id, payout, readPayout, sendTransactionAsync, sending]);
  const terminal = stage === "CLAIMED" || stage === "ALREADY_CLAIMED" || stage === "RECLAIMED" || stage === "EXPIRED";
  const context = stage === "INVALID_LINK" ? "This claim link is incomplete or no longer matches the payout. Ask the sender to send the original link again." : stage === "MISSING_CREDENTIAL" ? "This payout is still awaiting a claim credential. Ask the sender to send the original link again." : stage === "EXPIRED" ? "This payout is protected, but its claim window has closed." : stage === "RECLAIMED" ? "The sender received this payout back after the claim window closed." : stage === "ALREADY_CLAIMED" || stage === "CLAIMED" ? "This payout has already been claimed." : stage === "AWAITING_PASSKEY" ? "Approve the passkey prompt on this device. It may use fingerprint, Face ID, Windows Hello, a PIN, or another supported passkey." : stage === "CREATING_ACCOUNT" ? "Your new account stays with your passkey. No wallet app or pre-funded gas is needed." : stage === "AWAITING_CONFIRMATION" ? "Your claim was submitted. We’re checking the vault before calling it complete." : "Claim it with a passkey. Reach covers the network fee.";
  const amount = payout ? amountText(payout.amount) : "—";
  const clearLink = () => { if (id) clearCapability(id); setCapability(null); setStage("INVALID_LINK"); };
  return <main className="app-shell"><div className="topbar"><div className="brand-mark" aria-label="Reach home">reach<span>•</span></div><div className="network-chip"><i /> Tempo testnet</div></div><section className="claim-card" aria-live="polite"><div className="soft-orb" aria-hidden="true" /><div className="eyebrow">Someone sent you</div><h1>{payout ? `$${amount}` : "Your money is waiting"}</h1><div className="token-line">{payout ? "pathUSD" : "Private, walletless claiming"}</div><p className="context-copy">{context}</p><div className={`state-panel state-${stage.toLowerCase().replace(/[^a-z]+/g, "-")}`}><div className="state-dot" aria-hidden="true" /><div><strong>{title(stage)}</strong>{retryable && <span> Network connection failed — nothing was changed.</span>}</div></div>{stage === "READY_TO_CLAIM" && <button className="claim-button" type="button" onClick={() => void claim()} disabled={sending}>Claim ${amount}<span aria-hidden="true">→</span></button>}{stage === "FAILED_RETRYABLE" && <button className="claim-button" type="button" onClick={() => void boot()}>Try again <span aria-hidden="true">↻</span></button>}{stage === "AWAITING_CONFIRMATION" && <button className="secondary-button" type="button" onClick={() => void boot()}>Check again</button>}{terminal && <button className="secondary-button" type="button" onClick={clearLink}>Clear this link</button>}<div className="reassurance"><span className="lock-icon" aria-hidden="true">⌁</span><span>No wallet app. No gas balance. Your passkey stays on your device.</span></div></section><footer><span>Reach is sponsoring this one-time claim.</span><span className="footer-separator">·</span><span>Tempo Moderato</span></footer></main>;
}
