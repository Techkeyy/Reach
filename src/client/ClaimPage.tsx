import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { encodeFunctionData, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { useAccount, useConnect, useConnectors, usePublicClient, useSendTransaction } from "wagmi";
import {
  CLAIM_ACTION,
  CLAIM_AUTHORIZATION_VERSION,
  claimDomain,
  claimTypes,
  DEFAULT_VAULT_ADDRESS,
  payoutStatus,
  type PayoutStatus,
  TEMPO_MODERATO_CHAIN_ID,
  vaultAbi,
} from "../shared/reach";
import {
  clearCapability,
  readCapability,
  recoverCapability,
  recoverPending,
  rememberCapability,
  rememberPending,
} from "./claimCapability";
import { formatPathUsd } from "./senderFlow";
import {
  ReachLogo,
  PasskeyIcon,
  CheckCircleIcon,
  ClockIcon,
  AlertCircleIcon,
  ShieldCheckIcon,
  LockIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  ArrowRightIcon,
} from "./components/Icons";

type ClaimStage =
  | "LOADING"
  | "READY_TO_CLAIM"
  | "CREATING_ACCOUNT"
  | "AWAITING_PASSKEY"
  | "PREPARING_CLAIM"
  | "AWAITING_CONFIRMATION"
  | "CLAIMED"
  | "ALREADY_CLAIMED"
  | "EXPIRED"
  | "RECLAIMED"
  | "INVALID_LINK"
  | "MISSING_CREDENTIAL"
  | "FAILED_RETRYABLE";

type PublicPayout = {
  sender: Address;
  amount: string;
  expiresAt: string;
  claimSigner: Address;
  status: 0 | 1 | 2 | 3;
  claimant: Address;
};

const vaultAddress = (import.meta.env.VITE_REACH_VAULT_ADDRESS ?? DEFAULT_VAULT_ADDRESS) as Address;

function hashOf(result: unknown): Hex | undefined {
  if (typeof result === "string" && result.startsWith("0x")) return result as Hex;
  if (result && typeof result === "object" && "hash" in result && typeof (result as any).hash === "string") {
    return (result as any).hash;
  }
  return undefined;
}

export default function ClaimPage() {
  const publicClient = usePublicClient();
  const { address: connectedAddress } = useAccount();
  const { connectAsync } = useConnect();
  const connectors = useConnectors();
  const { sendTransactionAsync, isPending: sending } = useSendTransaction();

  const [id, setId] = useState<string | null>(null);
  const [capability, setCapability] = useState<{ raw: string; privateKey: Hex } | null>(null);
  const [payout, setPayout] = useState<PublicPayout | null>(null);
  const [stage, setStage] = useState<ClaimStage>("LOADING");
  const [retryable, setRetryable] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const busy = useRef(false);

  const readPayout = useCallback(
    async (payoutId: string): Promise<PublicPayout | null> => {
      try {
        const res = await fetch(`/api/payout/${payoutId}`);
        if (res.ok) {
          const data = await res.json();
          return {
            sender: data.sender,
            amount: data.amount,
            expiresAt: data.expiresAt,
            claimSigner: data.claimSigner,
            status: Number(data.status) as 0 | 1 | 2 | 3,
            claimant: data.claimant,
          };
        }
      } catch {
        // Fallback to RPC read
      }

      if (!publicClient) return null;
      try {
        const result = (await (publicClient as any).readContract({
          address: vaultAddress,
          abi: vaultAbi,
          functionName: "getPayout",
          args: [BigInt(payoutId)],
        })) as any;
        return {
          sender: result.sender as Address,
          amount: result.amount.toString(),
          expiresAt: result.expiresAt.toString(),
          claimSigner: result.claimSigner as Address,
          status: Number(result.status) as 0 | 1 | 2 | 3,
          claimant: result.claimant as Address,
        };
      } catch {
        return null;
      }
    },
    [publicClient]
  );

  const applyState = useCallback(
    (current: PublicPayout, pending: { recipient?: string; txHash?: string } | null) => {
      const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
      const expiresAt = BigInt(current.expiresAt);

      if (pending?.txHash) {
        setTxHash(pending.txHash);
      }

      if (current.status === payoutStatus.CLAIMED) {
        if (pending?.recipient && current.claimant.toLowerCase() === pending.recipient.toLowerCase()) {
          setStage("CLAIMED");
        } else {
          setStage("ALREADY_CLAIMED");
        }
        return;
      }

      if (current.status === payoutStatus.RECLAIMED) {
        setStage("RECLAIMED");
        return;
      }

      if (nowSeconds >= expiresAt) {
        setStage("EXPIRED");
        return;
      }

      if (pending?.recipient) {
        setStage("AWAITING_CONFIRMATION");
        return;
      }

      setStage("READY_TO_CLAIM");
    },
    []
  );

  const boot = useCallback(async () => {
    const segments = window.location.pathname.replace(/\/$/, "").split("/");
    const parsedId = segments[segments.length - 1];
    if (!parsedId || !/^[1-9][0-9]{0,77}$/.test(parsedId)) {
      setStage("INVALID_LINK");
      return;
    }
    setId(parsedId);

    let currentCapability: { raw: string; privateKey: Hex } | null = null;
    if (window.location.hash) {
      try {
        currentCapability = readCapability(window.location.hash);
        rememberCapability(parsedId, currentCapability.raw);
      } catch {
        setStage("INVALID_LINK");
        return;
      }
    } else {
      currentCapability = recoverCapability(parsedId);
    }
    setCapability(currentCapability);

    const onchain = await readPayout(parsedId);
    if (!onchain) {
      setStage("INVALID_LINK");
      return;
    }
    setPayout(onchain);

    if (currentCapability) {
      const derived = privateKeyToAccount(currentCapability.privateKey).address.toLowerCase();
      if (derived !== onchain.claimSigner.toLowerCase()) {
        setStage("INVALID_LINK");
        return;
      }
    } else if (onchain.status === payoutStatus.FUNDED) {
      setStage("MISSING_CREDENTIAL");
      return;
    }

    const pending = recoverPending(parsedId);
    applyState(onchain, pending);
  }, [applyState, readPayout]);

  useEffect(() => {
    void boot();
  }, [boot]);

  const claim = useCallback(async () => {
    if (busy.current || !id || !capability || !payout) return;
    busy.current = true;
    setRetryable(false);

    try {
      let recipient = connectedAddress;
      if (!recipient) {
        const connector = connectors[0];
        if (!connector) throw new Error("passkey unavailable");
        setStage("CREATING_ACCOUNT");
        const connection = await connectAsync({
          connector,
          capabilities: { method: "register" as const, name: "Reach recipient" },
        });
        recipient = connection.accounts[0] as Address | undefined;
      }

      if (!recipient) throw new Error("recipient unavailable");
      setStage("AWAITING_PASSKEY");

      const signature = await privateKeyToAccount(capability.privateKey).signTypedData({
        domain: claimDomain(vaultAddress),
        types: claimTypes,
        primaryType: "Claim",
        message: {
          payoutId: BigInt(id),
          recipient,
          action: CLAIM_ACTION,
          version: CLAIM_AUTHORIZATION_VERSION,
        },
      });

      const data = encodeFunctionData({
        abi: vaultAbi,
        functionName: "claim",
        args: [BigInt(id), recipient, signature],
      });

      rememberPending(id, { recipient });
      setStage("PREPARING_CLAIM");

      const result = await sendTransactionAsync({
        chainId: TEMPO_MODERATO_CHAIN_ID,
        calls: [{ to: vaultAddress, data, value: 0n }],
      });

      const hash = hashOf(result);
      if (hash) {
        setTxHash(hash);
      }
      rememberPending(id, { recipient, ...(hash ? { txHash: hash } : {}) });
      setStage("AWAITING_CONFIRMATION");

      // Poll until claimed
      for (let attempt = 0; attempt < 25; attempt++) {
        const refreshed = await readPayout(id);
        if (!refreshed) {
          setStage("INVALID_LINK");
          break;
        }
        applyState(refreshed, { recipient, ...(hash ? { txHash: hash } : {}) });
        if (refreshed.status !== payoutStatus.FUNDED) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
    } catch {
      setRetryable(true);
      setStage("FAILED_RETRYABLE");
    } finally {
      busy.current = false;
    }
  }, [applyState, capability, connectAsync, connectedAddress, connectors, id, payout, readPayout, sendTransactionAsync]);

  const amountDisplay = payout ? `$${formatPathUsd(BigInt(payout.amount))}` : "$0.00";

  return (
    <div className="claim-experience-layout">
      {/* Header */}
      <header className="claim-topbar">
        <div className="claim-brand" onClick={() => (window.location.href = "/")}>
          <ReachLogo size={24} />
          <span className="brand-text">reach<span className="brand-dot">.</span></span>
        </div>
        <div className="network-pill-light">
          <span className="network-dot" />
          <span>Tempo Moderato</span>
        </div>
      </header>

      {/* Main Viewport Content */}
      <main className="claim-viewport-card">
        {/* Dominant Amount Display */}
        <div className="claim-amount-section">
          <span className="claim-eyebrow">Someone sent you</span>
          <div className="claim-amount-figure">
            <span className="claim-amount-val">{amountDisplay}</span>
            <span className="claim-amount-token">pathUSD</span>
          </div>
        </div>

        {/* State Panel & Progressive Actions */}
        <div className="claim-action-section">
          {stage === "LOADING" && (
            <div className="claim-state-box state-loading">
              <div className="signing-spinner" />
              <span>Verifying claim link...</span>
            </div>
          )}

          {stage === "READY_TO_CLAIM" && (
            <div className="claim-ready-box">
              <div className="claim-info-line">
                <span>Ready to claim. Reach covers 100% of the network fee.</span>
              </div>
              <button
                type="button"
                className="btn-primary btn-large btn-full btn-claim-cta"
                onClick={() => void claim()}
                disabled={sending}
              >
                <PasskeyIcon size={20} />
                <span>Get my money</span>
                <ArrowRightIcon size={18} />
              </button>
            </div>
          )}

          {stage === "CREATING_ACCOUNT" && (
            <div className="claim-state-box state-processing">
              <div className="signing-spinner" />
              <div>
                <strong>Creating your account</strong>
                <p>Your passkey stays securely on your device. No wallet app needed.</p>
              </div>
            </div>
          )}

          {stage === "AWAITING_PASSKEY" && (
            <div className="claim-state-box state-processing">
              <PasskeyIcon size={24} className="passkey-active-icon" />
              <div>
                <strong>Securing with your passkey</strong>
                <p>Approve the prompt on your device (Face ID, Touch ID, or Windows Hello).</p>
              </div>
            </div>
          )}

          {(stage === "PREPARING_CLAIM" || stage === "AWAITING_CONFIRMATION") && (
            <div className="claim-state-box state-processing">
              <div className="signing-spinner" />
              <div>
                <strong>Receiving your money</strong>
                <p>Confirming transaction on Tempo Moderato...</p>
              </div>
            </div>
          )}

          {(stage === "CLAIMED" || stage === "ALREADY_CLAIMED") && (
            <div className="claim-success-box">
              <div className="success-icon-animated">
                <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
                  <circle cx="28" cy="28" r="26" stroke="#167B5A" strokeWidth="3" className="success-circle-stroke" />
                  <path d="M18 29l7 7 14-14" stroke="#167B5A" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="success-check-stroke" />
                </svg>
              </div>
              <h2 className="success-title">You got it</h2>
              <p className="success-desc">The {amountDisplay} pathUSD is now in your account.</p>

              <button
                type="button"
                className="btn-primary btn-large btn-full"
                onClick={() => (window.location.href = "/")}
              >
                <span>Done</span>
              </button>

              {/* Collapsible Transaction Details */}
              <div className="claim-details-accordion">
                <button
                  type="button"
                  className="accordion-toggle"
                  onClick={() => setShowDetails((prev) => !prev)}
                >
                  <span>Transaction details</span>
                  <ChevronDownIcon
                    size={16}
                    style={{ transform: showDetails ? "rotate(180deg)" : "none", transition: "transform 200ms" }}
                  />
                </button>
                {showDetails && (
                  <div className="accordion-content">
                    <div className="accordion-row">
                      <span>Network</span>
                      <span>Tempo Moderato</span>
                    </div>
                    {txHash && (
                      <div className="accordion-row">
                        <span>Transaction</span>
                        <a
                          href={`https://moderato.tempo.xyz/tx/${txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="accordion-link"
                        >
                          {`${txHash.slice(0, 8)}...${txHash.slice(-6)}`}
                          <ExternalLinkIcon size={12} />
                        </a>
                      </div>
                    )}
                    <div className="accordion-row">
                      <span>Network fee</span>
                      <span className="fee-sponsored-tag">Paid by Reach</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {stage === "EXPIRED" && (
            <div className="claim-state-box state-error">
              <ClockIcon size={24} />
              <div>
                <strong>Claim window closed</strong>
                <p>This payout is protected, but its claim window has expired.</p>
              </div>
            </div>
          )}

          {stage === "RECLAIMED" && (
            <div className="claim-state-box state-error">
              <AlertCircleIcon size={24} />
              <div>
                <strong>Funds returned to sender</strong>
                <p>The sender reclaimed this payout after the claim window closed.</p>
              </div>
            </div>
          )}

          {stage === "INVALID_LINK" && (
            <div className="claim-state-box state-error">
              <AlertCircleIcon size={24} />
              <div>
                <strong>Invalid claim link</strong>
                <p>This link is incomplete or invalid. Please request a new link from the sender.</p>
              </div>
            </div>
          )}

          {stage === "MISSING_CREDENTIAL" && (
            <div className="claim-state-box state-error">
              <LockIcon size={24} />
              <div>
                <strong>Missing claim key</strong>
                <p>This claim link is missing its private authorization fragment.</p>
              </div>
            </div>
          )}

          {stage === "FAILED_RETRYABLE" && (
            <div className="claim-retry-box">
              <div className="claim-state-box state-error">
                <AlertCircleIcon size={24} />
                <div>
                  <strong>Claim failed</strong>
                  <p>Network connection failed. Nothing was changed.</p>
                </div>
              </div>
              <button
                type="button"
                className="btn-primary btn-large btn-full"
                onClick={() => void claim()}
              >
                <span>Try again</span>
              </button>
            </div>
          )}
        </div>

        {/* Reassurance Badges */}
        <div className="claim-reassurance-grid">
          <div className="reassurance-item">
            <LockIcon size={16} className="reassurance-icon" />
            <span>No wallet app needed</span>
          </div>
          <div className="reassurance-item">
            <CheckCircleIcon size={16} className="reassurance-icon" />
            <span>No gas payment needed to claim</span>
          </div>
          <div className="reassurance-item">
            <PasskeyIcon size={16} className="reassurance-icon" />
            <span>Secured with your passkey</span>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="claim-footer">
        <span>Reach sponsors 100% of recipient claim gas on Tempo.</span>
      </footer>
    </div>
  );
}
