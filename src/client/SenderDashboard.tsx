import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { encodeFunctionData, type Address, type Hex } from "viem";
import { useConnection, useConnect, useConnectorClient, useConnectors, usePublicClient, useSendTransaction } from "wagmi";
import { DEFAULT_VAULT_ADDRESS, PATH_USD_ADDRESS, payoutStatus, TEMPO_MODERATO_CHAIN_ID, vaultAbi, pathUsdAbi } from "../shared/reach";
import { claimSignerForCapability, clearCapability, createClaimCapability, hasCapability, rememberCapability } from "./claimCapability";
import { createPayoutId, expiryFromNow, failedBalance, formatPathUsd, fundingAllowed, isReclaimEligible, loadingBalance, parseAuthoritativeBalance, parsePathUsdAmount, publicStatusLabel, readyBalance, type BalanceState, type SenderStage } from "./senderFlow";
import { mergeSenderPayouts, type DiscoveredSenderPayout } from "./senderRecovery";
import { readSenderPayouts, rememberSenderPayout, removeSenderPayout, updateSenderPayout, type SenderPayoutRecord } from "./senderStorage";
import { failedArtifactMessage, preflightFunding, resolveFundingReceipt, toFundingFillRequest, type FundingFillClient } from "./senderFunding";
import { authFailureMessage, hasAuthenticatedAccount, withTimeout } from "./authFlow";
import { recordAuthStage } from "./diagnostics";
import LandingHero from "./LandingHero";
import AppShell, { type AppView } from "./AppShell";
import HomeDashboard from "./HomeDashboard";
import FundExperience from "./FundExperience";
import SendExperience from "./SendExperience";
import BatchExperience from "./BatchExperience";
import AutomationExperience from "./AutomationExperience";
import ActivityFeed from "./ActivityFeed";
import PayoutDetail from "./PayoutDetail";

type PublicPayout = { sender: Address; amount: string; expiresAt: string; claimSigner: Address; status: 0 | 1 | 2 | 3; claimant: Address };
type DiscoveredResponse = { address: Address; payouts: DiscoveredSenderPayout[] };
type PreparedFunding = { payoutId: string; capability: ReturnType<typeof createClaimCapability>; claimSigner: Address; calls: { to: Address; data: `0x${string}`; value: bigint }[]; record: SenderPayoutRecord; amountText: string };

const vaultAddress = (import.meta.env.VITE_REACH_VAULT_ADDRESS ?? DEFAULT_VAULT_ADDRESS) as Address;

function getInitialView(): AppView {
  const path = window.location.pathname.replace(/\/$/, "");
  if (path === "/app" || path === "/app/home") return "home";
  if (path === "/app/send") return "send";
  if (path === "/app/fund") return "fund";
  if (path === "/app/batch") return "batch";
  if (path === "/app/automation" || path === "/app/agents") return "automation";
  if (path === "/app/activity") return "activity";
  if (path.startsWith("/app/payout/")) return "payout-detail";
  return "landing";
}

export default function SenderDashboard() {
  const { isConnected, address } = useConnection();
  const { connectAsync } = useConnect();
  const connectors = useConnectors();
  const { data: connectorClient } = useConnectorClient();
  const publicClient = usePublicClient();
  const { sendTransactionAsync } = useSendTransaction();

  const [currentView, setCurrentView] = useState<AppView>(getInitialView);
  const [selectedPayoutId, setSelectedPayoutId] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const authAttemptRef = useRef(0);

  const [balanceState, setBalanceState] = useState<BalanceState>(loadingBalance());
  const [payouts, setPayouts] = useState<SenderPayoutRecord[]>(() => readSenderPayouts());
  const [payoutStatuses, setPayoutStatuses] = useState<Record<string, { status: number; expiresAt: bigint; claimant?: string; sender?: string }>>({});
  const [refreshing, setRefreshing] = useState(false);

  // Send experience states
  const [prepared, setPrepared] = useState<PreparedFunding | null>(null);
  const [stage, setStage] = useState<SenderStage>("REVIEW");
  const [claimUrl, setClaimUrl] = useState<string | null>(null);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [preflightChecking, setPreflightChecking] = useState(false);
  const [returningFunds, setReturningFunds] = useState(false);

  // Sync route
  const navigate = useCallback((view: AppView, payoutId?: string) => {
    setCurrentView(view);
    if (payoutId) {
      setSelectedPayoutId(payoutId);
      window.history.pushState({}, "", `/app/payout/${payoutId}`);
    } else if (view === "landing") {
      window.history.pushState({}, "", "/");
    } else {
      window.history.pushState({}, "", `/app/${view}`);
    }
  }, []);

  const connectWallet = useCallback(async (selectAccount = false) => {
    const attempt = ++authAttemptRef.current;
    setAuthBusy(true);
    setAuthError(null);

    try {
      const connector = connectors[0];
      if (!connector) throw new Error("No passkey connector is configured");

      const connection = await withTimeout(
        connectAsync({
          connector,
          ...(selectAccount ? { capabilities: { selectAccount: true } } : {}),
        }),
      );

      if (attempt !== authAttemptRef.current) return;
      if (!hasAuthenticatedAccount(connection)) throw new Error("No authenticated account was returned");

      recordAuthStage("ACCOUNT_RESOLUTION", "SUCCEEDED");
      recordAuthStage("SESSION_READY", "SUCCEEDED");
      if (currentView !== "fund") {
        recordAuthStage("NAVIGATION", "SUCCEEDED");
        navigate("home");
      }
    } catch (error) {
      if (attempt === authAttemptRef.current) {
        setAuthError(authFailureMessage(error));
      }
    } finally {
      if (attempt === authAttemptRef.current) setAuthBusy(false);
    }
  }, [connectAsync, connectors, navigate, currentView]);

  const disconnectWallet = useCallback(() => {
    // In Wagmi, switching view or clearing
    navigate("landing");
  }, [navigate]);

  // Read authoritative onchain payout
  const readPayout = useCallback(
    async (id: string): Promise<PublicPayout | null> => {
      if (!publicClient) return null;
      try {
        const result = (await (publicClient as any).readContract({
          address: vaultAddress,
          abi: vaultAbi,
          functionName: "getPayout",
          args: [BigInt(id)],
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

  // Refresh balance
  const refreshBalance = useCallback(async () => {
    if (!address) {
      setBalanceState(failedBalance("Connect your wallet to view balance."));
      return;
    }
    setRefreshing(true);
    try {
      const res = await fetch(`/api/balance/${address}`);
      if (res.ok) {
        const data = await res.json();
        setBalanceState(readyBalance(parseAuthoritativeBalance(data)));
      } else if (publicClient) {
        const bal = (await (publicClient as any).readContract({
          address: PATH_USD_ADDRESS,
          abi: pathUsdAbi,
          functionName: "balanceOf",
          args: [address as Address],
        })) as bigint;
        setBalanceState(readyBalance(bal.toString()));
      } else {
        setBalanceState(failedBalance("Unable to reach balance service.", res.status));
      }
    } catch (err: any) {
      if (publicClient && address) {
        try {
          const bal = (await (publicClient as any).readContract({
            address: PATH_USD_ADDRESS,
            abi: pathUsdAbi,
            functionName: "balanceOf",
            args: [address as Address],
          })) as bigint;
          setBalanceState(readyBalance(bal.toString()));
        } catch {
          setBalanceState(failedBalance(err?.message || "Balance check failed."));
        }
      } else {
        setBalanceState(failedBalance(err?.message || "Balance check failed."));
      }
    } finally {
      setRefreshing(false);
    }
  }, [address, publicClient]);

  useEffect(() => {
    void refreshBalance();
  }, [refreshBalance]);

  // Refresh and discover payouts
  const refreshPayouts = useCallback(async () => {
    if (!address) return;
    setRefreshing(true);
    try {
      const local = readSenderPayouts();
      let merged = local;
      try {
        const res = await fetch(`/api/payouts/${address}`);
        if (res.ok) {
          const data = (await res.json()) as DiscoveredResponse;
          merged = mergeSenderPayouts(local, data.payouts);
        }
      } catch {
        // Discovery unavailable
      }
      setPayouts(merged);

      // Poll status for all payouts
      const statusMap: Record<string, { status: number; expiresAt: bigint; claimant?: string; sender?: string }> = {};
      await Promise.all(
        merged.map(async (record) => {
          const onchain = await readPayout(record.id);
          if (onchain) {
            statusMap[record.id] = {
              status: onchain.status,
              expiresAt: BigInt(onchain.expiresAt),
              claimant: onchain.claimant,
              sender: onchain.sender,
            };
          }
        })
      );
      setPayoutStatuses(statusMap);
    } finally {
      setRefreshing(false);
    }
  }, [address, readPayout]);

  useEffect(() => {
    if (isConnected && address) {
      void refreshPayouts();
    }
  }, [isConnected, address, refreshPayouts]);

  // Prepare Review & Funding
  const handleInitiateReview = useCallback(
    async (amountInput: string, expirySeconds: number, label: string): Promise<boolean> => {
      setPreflightError(null);
      try {
        const parsedAmount = parsePathUsdAmount(amountInput);
        const capability = createClaimCapability();
        const claimSigner = claimSignerForCapability(capability.privateKey) as Address;
        const payoutId = createPayoutId();
        const nowSeconds = Math.floor(Date.now() / 1000);
        const expiresAt = expiryFromNow(nowSeconds, expirySeconds);

        const approveData = encodeFunctionData({
          abi: pathUsdAbi,
          functionName: "approve",
          args: [vaultAddress, parsedAmount],
        });

        const createData = encodeFunctionData({
          abi: vaultAbi,
          functionName: "createPayout",
          args: [BigInt(payoutId), parsedAmount, claimSigner, expiresAt],
        });

        const calls = [
          { to: PATH_USD_ADDRESS, data: approveData, value: 0n },
          { to: vaultAddress, data: createData, value: 0n },
        ];

        const record: SenderPayoutRecord = {
          id: payoutId,
          amount: parsedAmount.toString(),
          expiresAt: expiresAt.toString(),
          claimSigner,
          label: label || undefined,
          createdAt: new Date().toISOString(),
        };

        setPrepared({
          payoutId,
          capability,
          claimSigner,
          calls,
          record,
          amountText: amountInput,
        });

        // Run preflight in background
        if (address && connectorClient) {
          setPreflightChecking(true);
          const fillRequest = toFundingFillRequest(address as Address, calls);
          const pfResult = await preflightFunding(connectorClient as unknown as FundingFillClient, fillRequest);
          setPreflightChecking(false);
          if (!pfResult.ok) {
            setPreflightError("message" in pfResult ? pfResult.message : "Payment preflight check failed on Tempo.");
          }
        }

        return true;
      } catch (err: any) {
        setPreflightError(err?.message || "Could not prepare payout");
        return false;
      }
    },
    [address, connectorClient]
  );

  // Sign and Fund
  const handleSignAndFund = useCallback(async () => {
    if (!prepared) return;
    setStage("CONFIRMING");
    setPreflightError(null);

    try {
      const hash = await sendTransactionAsync({
        chainId: TEMPO_MODERATO_CHAIN_ID,
        calls: prepared.calls,
      });

      // Poll until payout is confirmed FUNDED
      let funded = false;
      for (let attempt = 0; attempt < 25; attempt++) {
        const onchain = await readPayout(prepared.payoutId);
        if (onchain && onchain.status === payoutStatus.FUNDED) {
          funded = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 1200));
      }

      if (funded) {
        rememberSenderPayout({
          ...prepared.record,
          fundingTxHash: typeof hash === "string" ? hash : undefined,
        });
        rememberCapability(prepared.payoutId, prepared.capability.raw);

        const link = `${window.location.origin}/c/${prepared.payoutId}#${prepared.capability.raw}`;
        setClaimUrl(link);
        setStage("FUNDED");
        void refreshBalance();
        void refreshPayouts();
      } else {
        setStage("FAILED_RETRYABLE");
        setPreflightError("Transaction was submitted but vault funding confirmation timed out.");
      }
    } catch (err: any) {
      setStage("FAILED_RETRYABLE");
      setPreflightError(err?.message || "Transaction was rejected or failed.");
    }
  }, [prepared, sendTransactionAsync, readPayout, refreshBalance, refreshPayouts]);

  // Reclaim / Return Funds
  const handleReturnFunds = useCallback(
    async (id: string) => {
      setReturningFunds(true);
      try {
        const reclaimData = encodeFunctionData({
          abi: vaultAbi,
          functionName: "reclaim",
          args: [BigInt(id)],
        });

        await sendTransactionAsync({
          chainId: TEMPO_MODERATO_CHAIN_ID,
          calls: [{ to: vaultAddress, data: reclaimData, value: 0n }],
        });

        // Poll until reclaimed
        for (let attempt = 0; attempt < 20; attempt++) {
          const onchain = await readPayout(id);
          if (onchain && onchain.status === 3) {
            break;
          }
          await new Promise((r) => setTimeout(r, 1200));
        }

        void refreshBalance();
        void refreshPayouts();
      } catch (err: any) {
        alert(err?.message || "Failed to return funds");
      } finally {
        setReturningFunds(false);
      }
    },
    [readPayout, refreshBalance, refreshPayouts, sendTransactionAsync]
  );

  const handleCopyClaimLink = useCallback(async (url: string) => {
    await navigator.clipboard.writeText(url);
  }, []);

  const handleResetSend = useCallback(() => {
    setPrepared(null);
    setClaimUrl(null);
    setStage("REVIEW");
    setPreflightError(null);
    navigate("send");
  }, [navigate]);

  // If view is landing, render LandingHero directly (no sidebar on public dashboard)
  if (currentView === "landing") {
    return (
      <LandingHero
        onStartSend={() => {
          if (isConnected) {
            navigate("home");
          } else {
            void connectWallet();
          }
        }}
        onConnectWallet={() => void connectWallet()}
        onRetryPasskey={() => void connectWallet()}
        onUseAnotherPasskey={() => void connectWallet(true)}
        isConnected={isConnected}
        connectedAddress={address}
        authBusy={authBusy}
        authError={authError}
      />
    );
  }

  const selectedRecord = selectedPayoutId ? payouts.find((p) => p.id === selectedPayoutId) : null;
  const selectedLive = selectedPayoutId ? payoutStatuses[selectedPayoutId] : undefined;
  const pathUsdFormatted = balanceState.status === "READY" ? formatPathUsd(BigInt(balanceState.balance || "0")) : undefined;

  return (
    <AppShell
      currentView={currentView}
      onNavigate={(v) => navigate(v)}
      isConnected={isConnected}
      connectedAddress={address}
      onConnectWallet={connectWallet}
      onDisconnectWallet={disconnectWallet}
      pathUsdBalance={pathUsdFormatted}
    >

      {currentView === "home" && (
        <HomeDashboard
          balanceState={balanceState}
          payouts={payouts}
          payoutStatuses={payoutStatuses}
          onStartSend={() => navigate("send")}
          onAddTestFunds={() => navigate("fund")}
          onSelectPayout={(id) => navigate("payout-detail", id)}
          onViewAllActivity={() => navigate("activity")}
          onRefreshBalance={refreshBalance}
          refreshing={refreshing}
        />
      )}

      {currentView === "fund" && <FundExperience key={address ?? "disconnected"} address={isConnected ? address : undefined} onConnect={connectWallet} onSend={() => navigate("send")} onBalance={balance => setBalanceState(readyBalance(balance))} />}

      {currentView === "send" && (
        <SendExperience
          balanceState={balanceState}
          onCancel={() => navigate("home")}
          onInitiateReview={handleInitiateReview}
          onSignAndFund={handleSignAndFund}
          onReset={handleResetSend}
          onViewActivity={() => navigate("activity")}
          stage={stage}
          fundedRecord={prepared?.record || null}
          claimUrl={claimUrl}
          onCopyClaimLink={handleCopyClaimLink}
          preflightError={preflightError}
          preflightChecking={preflightChecking}
        />
      )}

      {currentView === "batch" && (
        <BatchExperience
          connectedAddress={address}
          pathUsdBalance={pathUsdFormatted}
          onDone={() => {
            void refreshPayouts();
            navigate("activity");
          }}
        />
      )}

      {currentView === "automation" && (
        <AutomationExperience
          connectedAddress={address}
          pathUsdBalance={pathUsdFormatted}
          onDone={() => navigate("home")}
        />
      )}

      {currentView === "activity" && (
        <ActivityFeed
          payouts={payouts}
          payoutStatuses={payoutStatuses}
          onSelectPayout={(id) => navigate("payout-detail", id)}
          onStartSend={() => navigate("send")}
          onRefresh={refreshPayouts}
          refreshing={refreshing}
        />
      )}

      {currentView === "payout-detail" && selectedRecord && (
        <PayoutDetail
          record={selectedRecord}
          live={selectedLive}
          connectedAddress={address}
          onBack={() => navigate("activity")}
          onReturnFunds={handleReturnFunds}
          returningFunds={returningFunds}
        />
      )}
    </AppShell>
  );
}
