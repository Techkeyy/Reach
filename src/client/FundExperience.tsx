import { useEffect, useRef, useState } from "react";
import { formatPathUsd } from "./senderFlow";
import { PATH_USD_ADDRESS } from "../shared/reach";
import "./fund.css";

type Stage = "IDLE" | "REQUESTING_TEST_FUNDS" | "WAITING_FOR_BALANCE" | "FUNDED" | "FAILED";
type Props = { address?: string; onConnect: () => void; onSend: () => void; onBalance: (balance: string) => void };
const units = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9]\d{0,77})$/.test(value);

export default function FundExperience({ address, onConnect, onSend, onBalance }: Props) {
  const [stage, setStage] = useState<Stage>("IDLE");
  const [balance, setBalance] = useState<string>();
  const [previous, setPrevious] = useState<string>();
  const [error, setError] = useState<string>();
  const [balanceError, setBalanceError] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const [requested, setRequested] = useState(false);
  const controller = useRef<AbortController | undefined>(undefined);
  const alive = useRef(true);
  const busy = stage === "REQUESTING_TEST_FUNDS" || stage === "WAITING_FOR_BALANCE";

  async function readBalance(signal: AbortSignal) {
    const response = await fetch(`/api/balance/${address}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]), cache: "no-store" });
    const body = await response.json();
    if (!response.ok || body.address?.toLowerCase() !== address?.toLowerCase() || body.token?.toLowerCase() !== PATH_USD_ADDRESS || !units(body.balance)) throw Error("Balance unavailable");
    if (!signal.aborted && alive.current) { setBalance(body.balance); setBalanceError(false); onBalance(body.balance); }
  }
  useEffect(() => {
    alive.current = true;
    const abort = new AbortController();
    if (address) void readBalance(abort.signal).catch(() => { if (!abort.signal.aborted) setBalanceError(true); });
    return () => { alive.current = false; abort.abort(); controller.current?.abort(); };
  }, [address]);

  async function requestFunds() {
    if (!address || requested || busy || controller.current) return;
    const abort = new AbortController();
    controller.current = abort;
    setRequested(true); setStage("REQUESTING_TEST_FUNDS"); setError(undefined);
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(55_000)]);
    try {
      const response = await fetch("/api/testnet/fund", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(28_000)]),
      });
      const initial = await response.json();
      if (!response.ok) throw Error(initial.error || "Test funds could not be requested.");
      if (initial.stage !== "WAITING_FOR_BALANCE" || !units(initial.startingBalance) || initial.address?.toLowerCase() !== address.toLowerCase() || initial.chainId !== 42431 || initial.token !== PATH_USD_ADDRESS) throw Error("Funding returned unexpected evidence. Check your balance.");
      setPrevious(initial.startingBalance); setStage("WAITING_FOR_BALANCE");
      for (let attempt = 0; attempt < 20; attempt++) {
        signal.throwIfAborted();
        const status = await fetch(`/api/testnet/fund/${address}`, { cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(18_000)]) });
        const body = await status.json();
        if (!status.ok || body.stage === "FAILED") throw Error(body.error || "Funding confirmation is unavailable.");
        if (body.stage === "FUNDED") {
          if (body.chainId !== 42431 || body.token !== PATH_USD_ADDRESS || body.address?.toLowerCase() !== address.toLowerCase() || body.startingBalance !== initial.startingBalance || !units(body.balance) || BigInt(body.balance) <= BigInt(initial.startingBalance)) throw Error("A pathUSD balance increase could not be verified.");
          if (abort.signal.aborted) return;
          setBalance(body.balance); onBalance(body.balance); setBalanceError(false); setStage("FUNDED"); return;
        }
        if (!["WAITING_FOR_BALANCE", "REQUESTING_TEST_FUNDS"].includes(body.stage)) throw Error("Funding returned unexpected evidence.");
        await new Promise(resolve => setTimeout(resolve, 1_500));
      }
      throw Error("Balance confirmation timed out. Funds may arrive later. Check your balance.");
    } catch (err) {
      if (!abort.signal.aborted) {
        setStage("FAILED");
        setError(signal.aborted ? "Funding confirmation timed out. Funds may arrive later. Check your balance before requesting again." : err instanceof Error ? err.message : "Funding could not be confirmed. Check your balance.");
      }
    } finally { if (controller.current === abort) controller.current = undefined; }
  }

  return <section className="fund-page" aria-labelledby="fund-title">
    <div className="fund-network">TESTNET · Tempo Moderato</div>
    <h1 id="fund-title">Add test funds</h1>
    <p>Test funds have no real-world value.</p>
    {!address ? <div className="fund-card"><p>Connect your Reach passkey account to add test funds.</p><button className="btn-primary" onClick={onConnect}>Connect Reach account</button></div> : <>
      <div className="fund-card">
        <h2>Your Reach account</h2><code className="fund-address">{address}</code>
        <button className="btn-secondary" onClick={async () => { try { await navigator.clipboard.writeText(address); setCopyStatus("Address copied"); } catch { setCopyStatus("Copy unavailable. Select the address above to copy it."); } }}>Copy address</button>
        <span role="status">{copyStatus}</span>
        <h2>Available</h2>
        <div className="fund-balance">{balanceError ? "Balance unavailable" : balance !== undefined ? `${formatPathUsd(BigInt(balance))} pathUSD` : "Reading balance..."}</div>
        <button className="btn-secondary" disabled={busy} onClick={() => { const abort = new AbortController(); void readBalance(abort.signal).catch(() => { if (alive.current) setBalanceError(true); }); }}>Check balance</button>
      </div>
      <div className="fund-feedback" role="status" aria-live="polite">
        {stage === "REQUESTING_TEST_FUNDS" && <p>Requesting test funds...</p>}
        {stage === "WAITING_FOR_BALANCE" && <p>Waiting for your pathUSD balance to increase...</p>}
        {stage === "FUNDED" && <><h2>Test funds added</h2><p>Previous: {formatPathUsd(BigInt(previous!))} pathUSD</p><p>Available now: {formatPathUsd(BigInt(balance!))} pathUSD</p><button className="btn-primary" onClick={onSend}>Send money</button></>}
        {stage === "FAILED" && <p role="alert">{error}</p>}
      </div>
      {stage !== "FUNDED" && <button className="btn-primary" disabled={busy || requested} onClick={requestFunds}>Add test funds</button>}
      <p>One request per account every 10 minutes. Requests are never retried automatically.</p>
      <p>You can send pathUSD from another Tempo Moderato account to this address.</p>
    </>}
  </section>;
}
