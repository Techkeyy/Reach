import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { encodeFunctionData, isAddress, type Address, type Hex } from "viem";
import { useConnection, useConnect, useConnectorClient, useConnectors, useDisconnect, usePublicClient, useSendTransaction } from "wagmi";
import { DEFAULT_VAULT_ADDRESS, PATH_USD_ADDRESS, payoutStatus, PayoutReadError, vaultAbi, pathUsdAbi } from "../shared/reach";
import { claimSignerForCapability, clearCapability, createClaimCapability, hasCapability, rememberCapability } from "./claimCapability";
import { canEnterFundingSigning, createPayoutId, failedBalance, formatPathUsd, fundingAllowed, loadingBalance, parsePathUsdAmount, readyBalance, type BalanceState, type FundingSubmissionState, type SenderStage } from "./senderFlow";
import { mergeSenderPayouts, promoteSenderPayoutRecord, type DiscoveredSenderPayout } from "./senderRecovery";
import { readSenderPayouts, rememberSenderPayout, removeSenderPayout, updateSenderPayout, type SenderPayoutRecord } from "./senderStorage";
import { financialQuoteError, financialQuoteFromPreflight, payoutMatchesExpected, payoutMatchesIdentity, preflightFunding, requireFinancialQuote, SAFE_PRE_SIGNING_FAILURE, SAFE_SUBMISSION_FAILED, SAFE_SUBMISSION_UNCERTAIN, senderFundingRequest, toFundingFillRequest, type FundingFillClient } from "./senderFunding";
import { actualFeeFromReceipt, quoteChanged, type FinancialQuote } from "./financialQuote";
import { FinancialError, FINANCIAL_ERROR_MESSAGES, isUserCancellation } from "./financialErrors";
import { type ReclaimUiState } from "./reclaimFlow";
import { authFailure, hasAuthenticatedAccount, withTimeout, type AuthFailureKind, type AuthFailureStage } from "./authFlow";
import { clearPendingRegistration, clearPendingRegistrationIfMatches, finishPendingRegistration, isPasskeyCreatedSetupIncompleteError, passkeySetupErrorCause, readPendingRegistration } from "./identityRecovery";
import { prepareFreshRegistration } from "./registerPreparation";
import { getLastAuthFailureStage, recordAuthStage, recordFundingStage, resetAuthFailureStage } from "./diagnostics";
import { readChainTimestamp } from "./chainTime";
import { resolvePayoutExpiry, type PayoutExpirySelection } from "./expiry";
import { useChainClock } from "./useChainClock";
import { readCurrentPayoutApi, readPublicPayout, type CurrentPayoutApi } from "./readPublicPayout";
import { reclaimReadiness, resolvePayoutLifecycle, type LivePayout } from "./payoutLifecycle";
import { upsertOperation, updateOperation } from "./operationJournal";
import { submitAndReconcile } from "./submitAndReconcile";
import AccountGateway, { type AccountAuthFlow, type AccountOnboardingStage } from "./AccountGateway";
import LandingHero from "./LandingHero";
import AppShell, { type AppView } from "./AppShell";
import HomeDashboard from "./HomeDashboard";
import FundExperience from "./FundExperience";
import SendExperience from "./SendExperience";
import BatchExperience from "./BatchExperience";
import AutomationExperience from "./AutomationExperience";
import ActivityFeed from "./ActivityFeed";
import PayoutDetail from "./PayoutDetail";
import { mergeActivityDiscovery, activityFromWalletTransfer, activityToSenderRecord, livePayoutFromActivity, type ActivityRecord, type ActivityResponse } from "./activity";
import { extractWalletTransactionHash, readWalletTransferAuthority, validateWalletTransferInput, walletTransferRequest, type WalletTransferIntent } from "./walletTransfer";
import { readWalletTransfers, rememberWalletTransfer } from "./walletTransferStorage";
import type { WalletTransferUiState } from "./WalletTransferExperience";
import type { ClaimProtection } from "../shared/claimProtection";
import { createProtectedShares, maskProtectedRecipient } from "./protectedClaims";
import { createSessionRefreshGate } from "./sessionRefresh";
import { BalanceAuthorityError, readAuthoritativeBalanceApi } from "./balanceRefresh";
import {
  PROTECTED_REAUTH_REQUIRED,
  registerProtectedPayout,
  ProtectedRegistrationError,
} from "./protectedRegistration";

type PublicPayout = { sender: Address; amount: string; expiresAt: string; claimSigner: Address; status: 0 | 1 | 2 | 3; claimant: Address };
type DiscoveredResponse = {
  address: Address;
  payouts: DiscoveredSenderPayout[];
  authorityIncomplete?: boolean;
  unresolvedCount?: number;
};
type OnboardingFixture = { stage: AccountOnboardingStage; flow: AccountAuthFlow; error?: string; address?: string; failureKind?: AuthFailureKind };
type PreparedFunding = { payoutId: string; capability: ReturnType<typeof createClaimCapability> | null; protectedShare?: { shareA: Uint8Array; shareAFragment: string }; protection: ClaimProtection; claimSigner: Address; calls: { to: Address; data: `0x${string}`; value: bigint }[]; record: SenderPayoutRecord; amountText: string; quote: FinancialQuote };
type WalletTransferReceiptView = { actualFeeAmount?: string; actualFeeSymbol?: string; actualFeeDecimals?: number; remainingBalance?: string; txHash?: string };

const vaultAddress = (import.meta.env.VITE_REACH_VAULT_ADDRESS ?? DEFAULT_VAULT_ADDRESS) as Address;
const DEV_SESSION_FIXTURE_ADDRESS = "0x0bf9000000000000000000000000000000000D42" as Address;

function applyRecoveredPayoutAccounting(record: SenderPayoutRecord, response: CurrentPayoutApi): SenderPayoutRecord {
  const accounting = response.accounting;
  if (!accounting && !response.fundingTxHash && !response.claimTxHash && !response.reclaimTxHash && !response.protection) return record;
  return {
    ...record,
    ...(response.fundingTxHash ? { fundingTxHash: response.fundingTxHash } : {}),
    ...(response.claimTxHash ? { claimTxHash: response.claimTxHash } : {}),
    ...(response.reclaimTxHash ? { reclaimTxHash: response.reclaimTxHash } : {}),
    ...(response.protection ? { protection: response.protection } : {}),
    ...(accounting ? {
      actualFeeAmount: accounting.actualFeeAmount,
      actualFeeToken: accounting.feeToken,
      ...(accounting.feeTokenSymbol ? { actualFeeSymbol: accounting.feeTokenSymbol } : {}),
      actualFeeDecimals: accounting.feeTokenDecimals,
    } : {}),
  };
}

function getOnboardingFixture(): OnboardingFixture | null {
  if (!import.meta.env.DEV) return null;
  const fixture = new URLSearchParams(window.location.search).get("onboardingFixture");
  if (!fixture) return null;

  const address = "0xAF75774194AbeEC3A0D86693d8A7bC1139311061";
  if (fixture === "gateway") return { stage: "ACCOUNT_GATEWAY", flow: "login" };
  if (fixture === "create-explainer") return { stage: "CREATE_EXPLAINER", flow: "register" };
  if (fixture === "sign-in") return { stage: "LOGIN", flow: "login" };
  if (fixture === "authenticating") return { stage: "AUTHENTICATING", flow: "login" };
  if (fixture === "account-ready") return { stage: "ACCOUNT_READY", flow: "register", address };
  if (fixture === "pending-setup") return { stage: "PASSKEY_CREATED_SETUP_INCOMPLETE", flow: "register", error: "The registration completion can be retried." };
  if (fixture === "login-failure") return { stage: "AUTH_FAILED", flow: "login", error: "HTTP 503", failureKind: "OPTIONS_FAILED" };
  if (fixture === "registration-failure") return { stage: "AUTH_FAILED", flow: "register", error: "The operation either timed out or was not allowed.", failureKind: "WEBAUTHN_FAILED" };
  return null;
}

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

function getInitialPayoutId(): string | null {
  const match = window.location.pathname.match(/^\/app\/payout\/([0-9]+)$/);
  return match?.[1] ?? null;
}

function getSessionFixtureAddress(): Address | undefined {
  if (!import.meta.env.DEV) return undefined;
  return new URLSearchParams(window.location.search).get("sessionFixture") === "connected"
    ? DEV_SESSION_FIXTURE_ADDRESS
    : undefined;
}

function feeAwareFixtureEnabled(): boolean {
  // Browser-only fixture for review screenshots; production builds cannot enter this branch.
  return Boolean(import.meta.env.DEV && new URLSearchParams(window.location.search).get("transactionFixture") === "fee-aware");
}

function feeAwareFixtureResponse(): unknown {
  return {
    tx: { type: "0x76", calls: [], feeToken: PATH_USD_ADDRESS },
    capabilities: { fee: { amount: "0x3e8", decimals: 6, formatted: "0.001", symbol: "pathUSD" }, balanceDiffs: [] },
  };
}

async function readFeeTokenBalance(publicClient: any, address: Address, feeToken: Address | null): Promise<bigint | undefined> {
  if (!feeToken || feeToken.toLowerCase() === PATH_USD_ADDRESS.toLowerCase()) return undefined;
  try {
    return await publicClient.readContract({ address: feeToken, abi: pathUsdAbi, functionName: "balanceOf", args: [address] }) as bigint;
  } catch {
    return undefined;
  }
}

async function mapWithConcurrency<T, R>(values: T[], limit: number, operation: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= values.length) return;
      results[index] = await operation(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), values.length) }, () => worker()));
  return results;
}

export default function SenderDashboard() {
  const connection = useConnection();
  const { isConnected, address } = connection;
  const connectionStatus = (connection as { status?: string }).status;
  const [sessionFixtureAddress, setSessionFixtureAddress] = useState<Address | undefined>(getSessionFixtureAddress);
  const sessionConnected = isConnected || Boolean(sessionFixtureAddress);
  const sessionAddress = address ?? sessionFixtureAddress;
  const sessionRestoring = connectionStatus === "connecting" || connectionStatus === "reconnecting";
  const onboardingFixture = getOnboardingFixture();
  const { connectAsync } = useConnect();
  const connectors = useConnectors();
  const { disconnectAsync } = useDisconnect();
  const { data: connectorClient } = useConnectorClient();
  const publicClient = usePublicClient();
  const { sendTransactionAsync } = useSendTransaction();

  const [currentView, setCurrentView] = useState<AppView>(getInitialView);
  const [selectedPayoutId, setSelectedPayoutId] = useState<string | null>(getInitialPayoutId);
  const [onboardingStarted, setOnboardingStarted] = useState(() => Boolean(onboardingFixture));
  const [onboardingStage, setOnboardingStage] = useState<AccountOnboardingStage>(() => onboardingFixture?.stage ?? "ACCOUNT_GATEWAY");
  const [onboardingFlow, setOnboardingFlow] = useState<AccountAuthFlow>(() => onboardingFixture?.flow ?? "login");
  const [onboardingError, setOnboardingError] = useState<string | null>(() => onboardingFixture?.error ?? null);
  const [onboardingFailureKind, setOnboardingFailureKind] = useState<AuthFailureKind>(() => onboardingFixture?.failureKind ?? "COMPLETE_FAILED");
  const [accountReadyAddress, setAccountReadyAddress] = useState<string | undefined>(() => onboardingFixture?.address);
  const [launchPending, setLaunchPending] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signingOutAddress, setSigningOutAddress] = useState<string | undefined>();
  const [protectedChannels, setProtectedChannels] = useState({ emailConfigured: false, smsConfigured: false });
  const [protectedReauthRequired, setProtectedReauthRequired] = useState(false);
  const authAttemptRef = useRef(0);

  const [balanceState, setBalanceState] = useState<BalanceState>(loadingBalance());
  const [payouts, setPayouts] = useState<SenderPayoutRecord[]>(() => readSenderPayouts());
  const [rawPayoutStatuses, setPayoutStatuses] = useState<Record<string, LivePayout>>({});
  const [activities, setActivities] = useState<ActivityRecord[] | null>(null);
  // The connected-session fixture is intentionally offline: its address and
  // records are synthetic, so it must not hold browser navigation on a live
  // Tempo RPC clock request. Real authenticated sessions retain the
  // authoritative chain clock.
  const { timestamp: chainTimestamp, refresh: refreshChainTime } = useChainClock(publicClient, sessionConnected && !sessionFixtureAddress);
  const payoutStatuses = useMemo(() => Object.fromEntries(Object.entries(rawPayoutStatuses).map(
    ([id, payout]) => [id, { ...payout, chainTimestamp }],
  )), [rawPayoutStatuses, chainTimestamp]);
  const [refreshing, setRefreshing] = useState(false);
  const balanceRefreshGate = useMemo(() => createSessionRefreshGate(), []);
  const payoutRefreshGate = useMemo(() => createSessionRefreshGate({ cooldownMs: 2_500 }), []);
  const activityRefreshGate = useMemo(() => createSessionRefreshGate({ cooldownMs: 2_500 }), []);

  // Send experience states
  const [prepared, setPrepared] = useState<PreparedFunding | null>(null);
  const [stage, setStage] = useState<SenderStage>("REVIEW");
  const [claimUrl, setClaimUrl] = useState<string | null>(null);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [fundingQuote, setFundingQuote] = useState<FinancialQuote | null>(null);
  const [preflightChecking, setPreflightChecking] = useState(false);
  const [submissionState, setSubmissionState] = useState<FundingSubmissionState>("NOT_SUBMITTED");
  const [walletTransferState, setWalletTransferState] = useState<WalletTransferUiState>("IDLE");
  const [walletTransferError, setWalletTransferError] = useState<string | null>(null);
  const [walletTransferQuote, setWalletTransferQuote] = useState<FinancialQuote | null>(null);
  const [walletTransferPreparing, setWalletTransferPreparing] = useState(false);
  const [walletTransferReceipt, setWalletTransferReceipt] = useState<WalletTransferReceiptView | null>(null);
  const walletTransferBusyRef = useRef(false);
  const [reclaimUiState, setReclaimUiState] = useState<ReclaimUiState>("IDLE");
  const [reclaimError, setReclaimError] = useState<string | null>(null);
  const preparedRef = useRef<PreparedFunding | null>(null);

  useEffect(() => {
    if (!sessionConnected) {
      setProtectedChannels({ emailConfigured: false, smsConfigured: false });
      return;
    }
    let cancelled = false;
    void fetch("/health", { cache: "no-store" })
      .then(response => response.ok ? response.json() as Promise<{ protectedClaims?: { emailConfigured?: boolean; smsConfigured?: boolean } }> : null)
      .then(health => {
        if (cancelled) return;
        setProtectedChannels({
          emailConfigured: Boolean(health?.protectedClaims?.emailConfigured),
          smsConfigured: Boolean(health?.protectedClaims?.smsConfigured),
        });
      })
      .catch(() => {
        if (!cancelled) setProtectedChannels({ emailConfigured: false, smsConfigured: false });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionConnected]);

  useEffect(() => {
    preparedRef.current = prepared;
  }, [prepared]);

  useEffect(() => {
    setReclaimUiState("IDLE");
    setReclaimError(null);
  }, [selectedPayoutId]);

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

  useEffect(() => {
    if (currentView === "landing" || isSigningOut || sessionConnected || sessionRestoring || protectedReauthRequired) return;
    navigate("landing");
  }, [currentView, isSigningOut, navigate, protectedReauthRequired, sessionConnected, sessionRestoring]);

  useEffect(() => {
    if (onboardingFixture || onboardingStarted || currentView !== "landing" || sessionConnected || sessionRestoring) return;
    let cancelled = false;
    void readPendingRegistration().then(pending => {
      if (cancelled || !pending) return;
      setOnboardingStarted(true);
      setOnboardingFlow("register");
      setOnboardingFailureKind("PASSKEY_CREATED_SETUP_INCOMPLETE");
      setOnboardingError("The registration completion can be retried while the setup window remains available.");
      setOnboardingStage("PASSKEY_CREATED_SETUP_INCOMPLETE");
    });
    return () => {
      cancelled = true;
    };
  }, [currentView, onboardingFixture, onboardingStarted, sessionConnected, sessionRestoring]);

  useEffect(() => {
    if (!launchPending || currentView !== "landing") return;

    if (sessionConnected) {
      setLaunchPending(false);
      setOnboardingStarted(false);
      setOnboardingStage("SESSION_READY");
      navigate("home");
      return;
    }

    const restoring = connectionStatus === "connecting" || connectionStatus === "reconnecting";
    if (!restoring) {
      setLaunchPending(false);
      setOnboardingStage("ACCOUNT_GATEWAY");
      return;
    }

    const timeout = window.setTimeout(() => {
      setLaunchPending(false);
      setOnboardingStage("ACCOUNT_GATEWAY");
    }, 2500);

    return () => window.clearTimeout(timeout);
  }, [currentView, launchPending, navigate, sessionConnected, sessionRestoring]);

  const connectWallet = useCallback(async (selectAccount = false, flow: AccountAuthFlow = "login") => {
    const attempt = ++authAttemptRef.current;
    resetAuthFailureStage();
    setOnboardingFlow(flow);
    setOnboardingError(null);
    setOnboardingStarted(true);
    setLaunchPending(false);
    if (currentView === "landing") {
      setOnboardingStage(flow === "register" ? "REGISTERING_PASSKEY" : "AUTHENTICATING");
    }

    try {
      const connector = connectors[0];
      if (!connector) throw new Error("No passkey connector is configured");

      if (flow === "register") {
        // Tempo Accounts treats a register request with an existing label as
        // a login. Clear any persisted provider snapshot first so a stale or
        // orphaned "Reach account" cannot silently cross the CREATE boundary.
        await prepareFreshRegistration(async () => {
          if (isConnected) {
            try {
              await disconnectAsync();
              return;
            } catch {
              // Fall through to the connector so the provider store is still
              // cleared when wagmi's active-connection teardown fails.
            }
          }
          await connector.disconnect();
        });
      }

      const connection = await withTimeout(
        flow === "register"
          ? connectAsync({
              connector,
              capabilities: { method: "register" as const, name: "Reach account" },
            })
          : connectAsync({
              connector,
              ...(selectAccount ? { capabilities: { selectAccount: true } } : {}),
            }),
      );

      if (attempt !== authAttemptRef.current) return;
      if (!hasAuthenticatedAccount(connection)) throw new Error("No authenticated account was returned");

      if (flow === "login") await clearPendingRegistrationIfMatches(connection.accounts?.[0]);

      if (currentView === "landing") {
        setOnboardingStage(flow === "register" ? "CREATING_ACCOUNT" : "RESOLVING_ACCOUNT");
      }
      recordAuthStage("ACCOUNT_RESOLUTION", "SUCCEEDED");
      recordAuthStage("SESSION_READY", "SUCCEEDED");
      if (flow === "register" && currentView === "landing") {
        setAccountReadyAddress(connection.accounts?.[0]);
        setOnboardingStage("ACCOUNT_READY");
      } else if (currentView !== "fund") {
        recordAuthStage("NAVIGATION", "SUCCEEDED");
        setOnboardingStage("SESSION_READY");
        navigate("home");
      }
    } catch (error) {
      if (attempt === authAttemptRef.current) {
        if (flow === "register" && isPasskeyCreatedSetupIncompleteError(error)) {
          setOnboardingError(authFailure(passkeySetupErrorCause(error), "register").technicalDetail);
          setOnboardingFailureKind("PASSKEY_CREATED_SETUP_INCOMPLETE");
          if (currentView === "landing") setOnboardingStage("PASSKEY_CREATED_SETUP_INCOMPLETE");
          return;
        }
        const failure = authFailure(error, flow, getLastAuthFailureStage() as AuthFailureStage | null);
        setOnboardingError(failure.technicalDetail);
        setOnboardingFailureKind(failure.kind);
        if (currentView === "landing") setOnboardingStage("AUTH_FAILED");
      }
    } finally {
      if (attempt === authAttemptRef.current) setLaunchPending(false);
    }
  }, [connectAsync, connectors, disconnectAsync, isConnected, navigate, currentView]);

  const finishPendingSetup = useCallback(async () => {
    const attempt = ++authAttemptRef.current;
    resetAuthFailureStage();
    setOnboardingFlow("register");
    setOnboardingError(null);
    setOnboardingStarted(true);
    setOnboardingStage("FINISHING_SETUP");

    try {
      const connector = connectors[0];
      if (!connector) throw new Error("No passkey connector is configured");

      const completion = await finishPendingRegistration("/auth");
      if (!completion) throw new Error("No incomplete account setup was found");
      recordAuthStage("REGISTER_COMPLETE", "SUCCEEDED");

      // Registration completion only proves the credential is stored. A fresh
      // login rebuilds the SDK provider account and issues a fresh session.
      const connection = await withTimeout(connectAsync({ connector }));
      if (attempt !== authAttemptRef.current) return;
      if (!hasAuthenticatedAccount(connection)) throw new Error("No authenticated account was returned");

      await clearPendingRegistration();
      recordAuthStage("ACCOUNT_RESOLUTION", "SUCCEEDED");
      recordAuthStage("SESSION_READY", "SUCCEEDED");
      setAccountReadyAddress(connection.accounts?.[0]);
      setOnboardingStage("ACCOUNT_READY");
    } catch (error) {
      if (attempt === authAttemptRef.current) {
        const failure = authFailure(error, "register", getLastAuthFailureStage() as AuthFailureStage | null);
        setOnboardingError(failure.technicalDetail);
        setOnboardingFailureKind(failure.kind);
        setOnboardingStage("PASSKEY_CREATED_SETUP_INCOMPLETE");
      }
    } finally {
      if (attempt === authAttemptRef.current) setLaunchPending(false);
    }
  }, [connectAsync, connectors]);

  const openReach = useCallback(() => {
    setOnboardingStarted(true);
    setOnboardingError(null);
    if (currentView !== "landing") navigate("landing");
    if (sessionConnected) {
      navigate("home");
      return;
    }

    if (sessionRestoring) {
      setLaunchPending(true);
      setOnboardingStage("RESTORING_SESSION");
    } else {
      setOnboardingStage("ACCOUNT_GATEWAY");
    }
  }, [currentView, navigate, sessionConnected, sessionRestoring]);

  const startAccountCreation = useCallback(() => {
    setOnboardingStarted(true);
    setOnboardingFlow("register");
    setOnboardingError(null);
    setOnboardingFailureKind("COMPLETE_FAILED");
    setOnboardingStage("CREATE_EXPLAINER");
  }, []);

  const startSignIn = useCallback(() => {
    setOnboardingStarted(true);
    setOnboardingFlow("login");
    setOnboardingError(null);
    setOnboardingFailureKind("WEBAUTHN_FAILED");
    setOnboardingStage("LOGIN");
  }, []);

  const startOverOnboarding = useCallback(() => {
    void clearPendingRegistration();
    setOnboardingStarted(true);
    setOnboardingError(null);
    setOnboardingFailureKind("COMPLETE_FAILED");
    setOnboardingStage("ACCOUNT_GATEWAY");
  }, []);

  const retryOnboarding = useCallback(() => {
    if (onboardingFlow === "register") {
      setOnboardingStage("CREATE_EXPLAINER");
    } else {
      void connectWallet(false, "login");
    }
  }, [connectWallet, onboardingFlow]);

  const signOut = useCallback(async () => {
    if (isSigningOut) return;

    setIsSigningOut(true);
    setSigningOutAddress(sessionAddress);
    ++authAttemptRef.current;
    setLaunchPending(false);

    try {
      if (isConnected) await disconnectAsync();
    } catch {
      // The local UI still exits the app shell if a connector has already cleared its session.
    }

    setOnboardingStarted(false);
    setOnboardingStage("ACCOUNT_GATEWAY");
    setOnboardingFlow("login");
    setOnboardingError(null);
    setOnboardingFailureKind("COMPLETE_FAILED");
    setAccountReadyAddress(undefined);
    setBalanceState(loadingBalance());
    setRefreshing(false);
    setPayouts([]);
    setPayoutStatuses({});
    setActivities(null);
    setSelectedPayoutId(null);
    setPrepared(null);
    setClaimUrl(null);
    setStage("REVIEW");
    setPreflightError(null);
    setPreflightChecking(false);
    setSubmissionState("NOT_SUBMITTED");
    setWalletTransferState("IDLE");
    setWalletTransferError(null);
    setReclaimUiState("IDLE");
    setReclaimError(null);
    setSessionFixtureAddress(undefined);
    balanceRefreshGate.invalidate();
    payoutRefreshGate.invalidate();
    activityRefreshGate.invalidate();
    setSigningOutAddress(undefined);
    setIsSigningOut(false);
    navigate("landing");
  }, [activityRefreshGate, balanceRefreshGate, disconnectAsync, isConnected, isSigningOut, navigate, payoutRefreshGate, sessionAddress]);

  // Every caller receives a normalized payout or an explicit read failure.
  const readPayoutStrict = useCallback(
    async (id: string): Promise<PublicPayout> => {
      if (!publicClient) throw new PayoutReadError("READ_UNAVAILABLE");
      return readPublicPayout(publicClient as any, vaultAddress, id);
    },
    [publicClient]
  );

  // Refresh balance
  const refreshBalance = useCallback(() => {
    const balanceAddress = address ?? sessionFixtureAddress;
    if (!balanceAddress) {
      setBalanceState(failedBalance("Connect your wallet to view balance."));
      return Promise.resolve(undefined);
    }
    return balanceRefreshGate.run(balanceAddress, async (isCurrent) => {
      setRefreshing(true);
      try {
        const balance = await readAuthoritativeBalanceApi(balanceAddress);
        if (isCurrent()) setBalanceState(readyBalance(balance));
      } catch (err: any) {
        if (isCurrent()) setBalanceState(failedBalance(err?.message || "Balance check failed.", err instanceof BalanceAuthorityError ? err.status : undefined));
      } finally {
        if (isCurrent()) setRefreshing(false);
      }
    });
  }, [address, balanceRefreshGate, sessionFixtureAddress]);

  useEffect(() => {
    void refreshBalance();
  }, [refreshBalance]);

  const refreshPublicActivity = useCallback((options: { force?: boolean } = {}) => {
    const activityAddress = address ?? sessionFixtureAddress;
    if (!activityAddress) return Promise.resolve();
    return activityRefreshGate.run(activityAddress, async (isCurrent) => {
      let discovery: ActivityResponse | undefined;
      try {
        const response = await fetch(`/api/activity/${activityAddress}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error("activity discovery unavailable");
        const data = await response.json() as ActivityResponse;
        if (!Array.isArray(data.activities)) throw new Error("activity response malformed");
        discovery = data;
      } catch {
        // The local sender records remain available when public activity discovery is unavailable.
      }
      const localTransfers = readWalletTransfers(activityAddress).map(activityFromWalletTransfer);
      const merged = mergeActivityDiscovery(readSenderPayouts(), discovery);
      if (isCurrent()) setActivities([...merged, ...localTransfers].sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? "")));
    }, { force: options.force === true });
  }, [activityRefreshGate, address, sessionFixtureAddress]);

  useEffect(() => {
    void refreshPublicActivity();
  }, [refreshPublicActivity]);

  // Refresh and discover payouts. The account-scoped promise coalesces mount,
  // focus, and manual triggers. Discovery records are reconciled only once per
  // refresh; a second pass is reserved for genuinely new IDs.
  const refreshPayouts = useCallback((options: { force?: boolean } = {}) => {
    if (!address) return Promise.resolve(undefined);
    return payoutRefreshGate.run(address, async (isCurrent) => {
      setRefreshing(true);
      void refreshChainTime({ force: false });
      try {
        const expectedFor = (record: SenderPayoutRecord) => ({
          sender: address,
          amount: record.amount,
          expiresAt: record.expiresAt,
          claimSigner: record.claimSigner,
        });

        const promoteOpenFunding = (record: SenderPayoutRecord, onchain: PublicPayout) => {
          const currentPrepared = preparedRef.current;
          if (!currentPrepared || currentPrepared.payoutId !== record.id) return;
          if (!payoutMatchesExpected(onchain, expectedFor(record))) return;

          const promoted = promoteSenderPayoutRecord(record, onchain);
          setPrepared((current) => current?.payoutId === record.id ? { ...current, record: promoted } : current);
          setClaimUrl(`${window.location.origin}/c/${record.id}#${currentPrepared.capability.raw}`);
          setSubmissionState("CONFIRMED");
          setStage("FUNDED");
          setPreflightError(null);
        };

        const reconcileRecords = async (records: SenderPayoutRecord[]) => mapWithConcurrency(records, 3, async (record) => {
          let onchain: PublicPayout;
          try { onchain = await readPayoutStrict(record.id); }
          catch { return { record, onchain: undefined, authorityUnavailable: true as const }; }
          const matchesSenderRecord = Boolean(onchain && payoutMatchesIdentity(onchain, expectedFor(record)));
          const next = matchesSenderRecord ? promoteSenderPayoutRecord(record, onchain) : record;
          if (onchain && matchesSenderRecord) promoteOpenFunding(next, onchain);

          // Discovery is a public, durable recovery source. Persist only the
          // public record; the bearer capability remains client-only.
          rememberSenderPayout(next);
          return { record: next, onchain, authorityUnavailable: false as const };
        });

        const publish = (reconciled: Awaited<ReturnType<typeof reconcileRecords>>) => {
          if (!isCurrent()) return;
          setPayouts(reconciled.map(({ record }) => record));
          const statusMap: Record<string, LivePayout> = {};
          for (const { record, onchain } of reconciled) {
            if (onchain && payoutMatchesIdentity(onchain, { sender: address, amount: record.amount, expiresAt: record.expiresAt, claimSigner: record.claimSigner })) {
              statusMap[record.id] = {
                ...onchain,
                status: onchain.status,
                expiresAt: BigInt(onchain.expiresAt),
                claimant: onchain.claimant,
                sender: onchain.sender,
              };
            }
          }
          setPayoutStatuses(statusMap);
        };

        // Local public records are reconciled first so a slow or unavailable
        // discovery indexer cannot hide authoritative vault state in the UI.
        const local = readSenderPayouts();
        const localIds = new Set(local.map((record) => record.id));
        const localReconciled = await reconcileRecords(local);
        publish(localReconciled);

        let merged = localReconciled.map(({ record }) => record);
        try {
          const controller = new AbortController();
          const timeout = window.setTimeout(() => controller.abort(), 10_000);
          let res: Response;
          try {
            res = await fetch(`/api/payouts/${address}`, { signal: controller.signal });
          } finally {
            window.clearTimeout(timeout);
          }
          if (res.ok) {
            const data = (await res.json()) as DiscoveredResponse;
            merged = mergeSenderPayouts(merged, data.payouts);
          }
        } catch {
          // Discovery unavailable
        }

        const newRecords = merged.filter((record) => !localIds.has(record.id));
        const localById = new Map(localReconciled.map((entry) => [entry.record.id, entry]));
        // Apply newly discovered public metadata to an already reconciled local
        // row without issuing a second vault read for that ID.
        for (const record of merged) {
          if (localIds.has(record.id)) {
            const existing = localById.get(record.id);
            if (existing) localById.set(record.id, { ...existing, record });
          }
        }
        if (newRecords.length > 0) {
          const newReconciled = await reconcileRecords(newRecords);
          const byId = localById;
          for (const entry of newReconciled) byId.set(entry.record.id, entry);
          publish([...byId.values()]);
        } else {
          publish([...localById.values()]);
        }
      } finally {
        if (isCurrent()) setRefreshing(false);
      }
    }, { force: options.force === true });
  }, [address, payoutRefreshGate, readPayoutStrict, refreshChainTime]);

  useEffect(() => {
    if (isConnected && address) {
      void refreshPayouts({ force: true });
    }
  }, [isConnected, address, refreshPayouts]);

  useEffect(() => {
    if (!isConnected || !address) return;
    const onFocus = () => { void refreshPayouts(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [isConnected, address, refreshPayouts]);

  // A fresh detail view may have been reconstructed from public metadata with
  // no browser-local receipt. Rehydrate accounting from the server boundary;
  // a missing receipt must never change the payout lifecycle.
  useEffect(() => {
    if (!selectedPayoutId) return;
    let cancelled = false;
    void readCurrentPayoutApi(selectedPayoutId).then((response) => {
      if (cancelled) return;
      setPayouts((current) => current.map((record) => record.id === selectedPayoutId ? applyRecoveredPayoutAccounting(record, response) : record));
      const current = readSenderPayouts().find((record) => record.id === selectedPayoutId);
      if (current) rememberSenderPayout(applyRecoveredPayoutAccounting(current, response));
      setActivities((currentActivities) => currentActivities?.map((activity) => activity.payoutId === selectedPayoutId
        ? {
            ...activity,
            ...(response.fundingTxHash ? { fundingTxHash: response.fundingTxHash, txHash: response.fundingTxHash } : {}),
            ...(response.claimTxHash ? { claimTxHash: response.claimTxHash } : {}),
            ...(response.reclaimTxHash ? { reclaimTxHash: response.reclaimTxHash } : {}),
            ...(response.accounting ? {
              actualFeeAmount: response.accounting.actualFeeAmount,
              actualFeeToken: response.accounting.feeToken,
              actualFeeSymbol: response.accounting.feeTokenSymbol,
              actualFeeDecimals: response.accounting.feeTokenDecimals,
            } : {}),
          }
        : activity) ?? null);
    }).catch(() => {
      // Detail remains usable with authoritative payout data and an unavailable fee notice.
    });
    return () => { cancelled = true; };
  }, [selectedPayoutId]);

  const reauthenticateProtectedSession = useCallback(async (): Promise<string | undefined> => {
    const connector = connectors[0];
    if (!connector) return undefined;

    try {
      // A connected Accounts client can retain a local wallet state after its
      // server session expires. Disconnect first so the existing connector
      // performs a fresh passkey login and receives a new session cookie.
      await disconnectAsync();
    } catch {
      // The server session may already be gone; the connector can still
      // perform the fresh login below.
    }

    try {
      const connection = await withTimeout(connectAsync({ connector }));
      const restoredAddress = connection.accounts?.[0];
      return typeof restoredAddress === "string" && isAddress(restoredAddress)
        ? restoredAddress
        : undefined;
    } catch {
      return undefined;
    }
  }, [connectAsync, connectors, disconnectAsync]);

  // Prepare Review & Funding
  const handleInitiateReview = useCallback(
    async (amountInput: string, expiry: PayoutExpirySelection, label: string, protection: ClaimProtection): Promise<boolean> => {
      setPreflightError(null);
      setPreflightChecking(false);
      setProtectedReauthRequired(false);
      setPrepared(null);
      setFundingQuote(null);
      setStage("PREFLIGHTING");
      setSubmissionState("NOT_SUBMITTED");
      try {
        const fixture = feeAwareFixtureEnabled();
        const senderAddress = address ?? (fixture ? sessionFixtureAddress : undefined);
        const parsedAmount = parsePathUsdAmount(amountInput);
        const capability = createClaimCapability();
        const claimSigner = claimSignerForCapability(capability.privateKey) as Address;
        const protectedShare = protection.mode === "PROTECTED" ? createProtectedShares(capability.privateKey) : undefined;
        const payoutId = createPayoutId();
        if (!publicClient && !fixture) throw new Error("chain reader unavailable");
        const chainTimestamp = fixture ? BigInt(Math.floor(Date.now() / 1000)) : await readChainTimestamp(publicClient as any);
        const expiresAt = resolvePayoutExpiry(chainTimestamp, expiry);

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
          protection: protection.mode === "PROTECTED"
            ? { mode: "PROTECTED", channel: protection.channel, maskedRecipient: maskProtectedRecipient(protection.channel, protection.recipient) }
            : { mode: "INSTANT" },
          createdAt: new Date().toISOString(),
        };

        // Persist the public intent and bearer before any provider interaction.
        // The journal never contains the capability itself; the capability is
        // kept in its dedicated client-only store.
        const operationId = `fund:${payoutId}`;
        if (protection.mode === "INSTANT") rememberCapability(payoutId, capability.raw);
        upsertOperation({
          operationType: "FUND",
          operationId,
          payoutIds: [payoutId],
          expectedSender: senderAddress,
          expectedAmount: record.amount,
          expectedExpiry: record.expiresAt,
          expectedClaimSigner: record.claimSigner,
          createdAt: record.createdAt,
          submissionBoundaryReached: false,
          state: "PREPARED",
        });

        if (!senderAddress || (!connectorClient && !fixture)) {
          updateOperation(operationId, { state: "FAILED_BEFORE_SUBMISSION", failureMessage: SAFE_PRE_SIGNING_FAILURE });
          clearCapability(payoutId);
          setPrepared(null);
          setStage("REVIEW");
          setSubmissionState("FAILED_BEFORE_SUBMISSION");
          setPreflightError(SAFE_PRE_SIGNING_FAILURE);
          return false;
        }

        if (protection.mode === "PROTECTED") {
          await registerProtectedPayout({
            payload: {
              payoutId,
              sender: senderAddress as Address,
              claimSigner,
              channel: protection.channel,
              recipient: protection.recipient,
              shareB: protectedShare!.shareB as Hex,
              shareAProofAddress: protectedShare!.shareAProofAddress,
            },
            reauthenticate: reauthenticateProtectedSession,
            onAuthenticationRequired: () => {
              setProtectedReauthRequired(true);
              setPreflightChecking(true);
              setPreflightError(PROTECTED_REAUTH_REQUIRED);
            },
            onAuthenticationRestored: () => {
              setProtectedReauthRequired(false);
              setPreflightError(null);
            },
          });
        }

        setPreflightChecking(true);
        const fillRequest = toFundingFillRequest(senderAddress, calls);
        const availableBalance = fixture ? 10_000_000n : await (publicClient as any).readContract({ address: PATH_USD_ADDRESS, abi: pathUsdAbi, functionName: "balanceOf", args: [senderAddress] }) as bigint;
        const pfResult = fixture ? { ok: true as const, response: feeAwareFixtureResponse() } : await preflightFunding(connectorClient as unknown as FundingFillClient, fillRequest, { availableBalance, sendAmount: parsedAmount });
        setPreflightChecking(false);
        if (!pfResult.ok) {
          updateOperation(operationId, { state: "FAILED_BEFORE_SUBMISSION", failureMessage: "message" in pfResult ? pfResult.message : SAFE_PRE_SIGNING_FAILURE });
          clearCapability(payoutId);
          setPrepared(null);
          setStage("REVIEW");
          setSubmissionState("FAILED_BEFORE_SUBMISSION");
          setPreflightError("message" in pfResult ? pfResult.message : SAFE_PRE_SIGNING_FAILURE);
        } else {
          let quote = financialQuoteFromPreflight(pfResult.response, availableBalance, parsedAmount, undefined, fillRequest.feeToken);
          const feeTokenBalance = publicClient ? await readFeeTokenBalance(publicClient, senderAddress, quote.estimatedFeeToken) : undefined;
          if (feeTokenBalance !== undefined) quote = financialQuoteFromPreflight(pfResult.response, availableBalance, parsedAmount, feeTokenBalance, fillRequest.feeToken);
          const quoteError = financialQuoteError(quote);
          if (quoteError) {
            updateOperation(operationId, { state: "FAILED_BEFORE_SUBMISSION", failureMessage: quoteError });
            clearCapability(payoutId);
            setPrepared(null);
            setFundingQuote(quote);
            setStage("REVIEW");
            setSubmissionState("FAILED_BEFORE_SUBMISSION");
            setPreflightError(quoteError);
            return true;
          }
          setPrepared({ payoutId, capability: protection.mode === "INSTANT" ? capability : null, ...(protectedShare ? { protectedShare: { shareA: protectedShare.shareA, shareAFragment: protectedShare.shareAFragment } } : {}), protection, claimSigner, calls, record, amountText: amountInput, quote });
          setFundingQuote(quote);
          setStage("READY_TO_SIGN");
          setSubmissionState("NOT_SUBMITTED");
        }

        return true;
      } catch (error) {
        setPreflightChecking(false);
        setPrepared(null);
        setStage("REVIEW");
        setSubmissionState("FAILED_BEFORE_SUBMISSION");
        setPreflightError(error instanceof FinancialError || error instanceof ProtectedRegistrationError
          ? error.message
          : SAFE_PRE_SIGNING_FAILURE);
        setFundingQuote(null);
        return false;
      }
    },
    [address, connectorClient, publicClient, reauthenticateProtectedSession, sessionFixtureAddress]
  );

  const resetWalletTransfer = useCallback(() => {
    setWalletTransferState("IDLE");
    setWalletTransferError(null);
    setWalletTransferQuote(null);
    setWalletTransferReceipt(null);
  }, []);

  const revalidateFunding = useCallback(async (): Promise<boolean> => {
    const current = preparedRef.current;
    if (!current || !address || !connectorClient || !publicClient) return false;
    setPreflightChecking(true);
    setPreflightError(null);
    try {
      const availableBalance = await (publicClient as any).readContract({ address: PATH_USD_ADDRESS, abi: pathUsdAbi, functionName: "balanceOf", args: [address] }) as bigint;
      const fillRequest = toFundingFillRequest(address, current.calls);
      const preflight = await preflightFunding(connectorClient as unknown as FundingFillClient, fillRequest, { availableBalance, sendAmount: BigInt(current.record.amount) });
      if (preflight.ok === false) {
        const code = preflight.code ?? "FEE_ESTIMATE_UNAVAILABLE";
        throw new FinancialError(code);
      }
      let quote = financialQuoteFromPreflight(preflight.response, availableBalance, BigInt(current.record.amount), undefined, fillRequest.feeToken);
      const feeTokenBalance = await readFeeTokenBalance(publicClient, address, quote.estimatedFeeToken);
      if (feeTokenBalance !== undefined) quote = financialQuoteFromPreflight(preflight.response, availableBalance, BigInt(current.record.amount), feeTokenBalance, fillRequest.feeToken);
      requireFinancialQuote(quote);
      setPrepared({ ...current, quote });
      setFundingQuote(quote);
      if (quoteChanged(current.quote, quote)) {
        setPreflightError(null);
        return false;
      }
      return true;
    } catch (error) {
      setPreflightError(error instanceof FinancialError ? error.message : FINANCIAL_ERROR_MESSAGES.FEE_ESTIMATE_UNAVAILABLE);
      return false;
    } finally {
      setPreflightChecking(false);
    }
  }, [address, connectorClient, publicClient]);

  const prepareWalletTransfer = useCallback(async (recipient: Address, amountInput: string): Promise<boolean> => {
    setWalletTransferPreparing(true);
    setWalletTransferError(null);
    setWalletTransferReceipt(null);
    try {
      const fixture = feeAwareFixtureEnabled();
      const senderAddress = address ?? (fixture ? sessionFixtureAddress : undefined);
      if (!senderAddress || (!publicClient && !fixture) || (!connectorClient && !fixture)) throw new FinancialError("NETWORK_UNAVAILABLE", "Connect your Reach account before sending to a wallet.");
      const senderBalance = fixture ? 10_000_000n : await (publicClient as any).readContract({ address: PATH_USD_ADDRESS, abi: pathUsdAbi, functionName: "balanceOf", args: [senderAddress] }) as bigint;
      const validated = validateWalletTransferInput({ sender: senderAddress, recipient, amount: amountInput, balance: senderBalance.toString() });
      const request = walletTransferRequest(validated.recipient, validated.amount);
      const fillRequest = toFundingFillRequest(senderAddress, request.calls);
      const preflight = fixture ? { ok: true as const, response: feeAwareFixtureResponse() } : await preflightFunding(connectorClient as unknown as FundingFillClient, fillRequest, { availableBalance: senderBalance, sendAmount: validated.amount });
      if (preflight.ok === false) {
        const code = preflight.code ?? "FEE_ESTIMATE_UNAVAILABLE";
        throw new FinancialError(code);
      }
      let quote = financialQuoteFromPreflight(preflight.response, senderBalance, validated.amount, undefined, fillRequest.feeToken);
      const feeTokenBalance = publicClient ? await readFeeTokenBalance(publicClient, senderAddress, quote.estimatedFeeToken) : undefined;
      if (feeTokenBalance !== undefined) quote = financialQuoteFromPreflight(preflight.response, senderBalance, validated.amount, feeTokenBalance, fillRequest.feeToken);
      setWalletTransferQuote(quote);
      if (quote.feeStatus === "UNAVAILABLE" || quote.affordabilityStatus === "UNKNOWN") throw new FinancialError("FEE_ESTIMATE_UNAVAILABLE");
      if (quote.affordabilityStatus !== "AFFORDABLE") setWalletTransferError(financialQuoteError(quote));
      return true;
    } catch (error) {
      setWalletTransferQuote(null);
      setWalletTransferError(error instanceof FinancialError ? error.message : (error instanceof Error ? error.message : FINANCIAL_ERROR_MESSAGES.FEE_ESTIMATE_UNAVAILABLE));
      return false;
    } finally {
      setWalletTransferPreparing(false);
    }
  }, [address, connectorClient, publicClient, sessionFixtureAddress]);

  const handleWalletTransfer = useCallback(async (recipient: Address, amountInput: string) => {
    if (walletTransferBusyRef.current) return;
    walletTransferBusyRef.current = true;
    setWalletTransferError(null);

    let operationId = `wallet-transfer:${Date.now()}-${Math.random().toString(16).slice(2)}`;
    try {
      const fixture = feeAwareFixtureEnabled();
      if (!address || !publicClient || (!connectorClient && !fixture)) throw new Error("Connect your Reach account before sending to a wallet.");
      const senderBalance = fixture ? 10_000_000n : await (publicClient as any).readContract({ address: PATH_USD_ADDRESS, abi: pathUsdAbi, functionName: "balanceOf", args: [address] }) as bigint;
      const recipientBalance = fixture ? 0n : await (publicClient as any).readContract({ address: PATH_USD_ADDRESS, abi: pathUsdAbi, functionName: "balanceOf", args: [recipient] }) as bigint;
      const validated = validateWalletTransferInput({ sender: address, recipient, amount: amountInput, balance: senderBalance.toString() });
      const request = walletTransferRequest(validated.recipient, validated.amount);
      const fillRequest = toFundingFillRequest(address, request.calls);
      const preflight = fixture ? { ok: true as const, response: feeAwareFixtureResponse() } : await preflightFunding(connectorClient as unknown as FundingFillClient, fillRequest, { availableBalance: senderBalance, sendAmount: validated.amount });
      if (preflight.ok === false) {
        const code = preflight.code ?? "FEE_ESTIMATE_UNAVAILABLE";
        throw new FinancialError(code);
      }
      let quote = financialQuoteFromPreflight(preflight.response, senderBalance, validated.amount, undefined, fillRequest.feeToken);
      const feeTokenBalance = await readFeeTokenBalance(publicClient, address, quote.estimatedFeeToken);
      if (feeTokenBalance !== undefined) quote = financialQuoteFromPreflight(preflight.response, senderBalance, validated.amount, feeTokenBalance, fillRequest.feeToken);
      requireFinancialQuote(quote);
      setWalletTransferQuote(quote);
      const fromBlock = fixture ? 0n : await publicClient.getBlockNumber();
      const createdAt = new Date().toISOString();
      const intent: WalletTransferIntent = {
        operationId,
        sender: address,
        recipient: validated.recipient,
        amount: validated.amount.toString(),
        createdAt,
        fromBlock,
        baselineSenderBalance: senderBalance.toString(),
        baselineRecipientBalance: recipientBalance.toString(),
      };
      upsertOperation({
        operationType: "WALLET_TRANSFER",
        operationId,
        payoutIds: [],
        expectedSender: address,
        expectedRecipient: validated.recipient,
        expectedAmount: validated.amount.toString(),
        createdAt,
        submissionBoundaryReached: false,
        state: "PREPARED",
      });

      let transactionHash: string | undefined;
      let preflightMessage: string | undefined;
      const result = await submitAndReconcile({
        operation: {
          operationType: "WALLET_TRANSFER",
          operationId,
          payoutIds: [],
          expectedSender: address,
          expectedRecipient: validated.recipient,
          expectedAmount: validated.amount.toString(),
          createdAt,
          submissionBoundaryReached: false,
          state: "PREPARED",
        },
        prepare: async () => {},
        submit: () => sendTransactionAsync(request as never),
        extractHash: (value) => {
          transactionHash = extractWalletTransactionHash(value);
          return transactionHash;
        },
        readAuthoritativeState: () => readWalletTransferAuthority(publicClient, intent, transactionHash),
        successPredicate: authority => authority.confirmed,
        waitForReceipt: async hash => {
          const receipt = await (publicClient as any).waitForTransactionReceipt({ hash });
          return { status: receipt?.status === "success" ? "success" as const : "reverted" as const, receipt };
        },
        classifySubmitError: error => isUserCancellation(error) ? "USER_CANCELLED" : "OTHER",
        persist: update => updateOperation(operationId, update),
        onState: (state, message) => {
          if (state === "AWAITING_SIGNATURE") setWalletTransferState("AWAITING_SIGNATURE");
          if (state === "SUBMISSION_ATTEMPTED" || state === "HASH_RECEIVED") setWalletTransferState("SUBMISSION_ATTEMPTED");
          if (state === "CONFIRMING") setWalletTransferState("CONFIRMING");
          if (state === "RECOVERING") { setWalletTransferState("RECOVERING"); setWalletTransferError(message ?? "Transfer confirmation is taking longer than expected."); }
          if (state === "FAILED_BEFORE_SUBMISSION") { setWalletTransferState("FAILED_BEFORE_SUBMISSION"); setWalletTransferError(message ?? "We couldn't submit this transfer. Your funds were not moved."); }
          if (state === "FAILED") { setWalletTransferState("FAILED"); setWalletTransferError(message ?? "The transfer failed. Your funds were not moved."); }
          if (state === "SUBMISSION_UNCERTAIN") { setWalletTransferState("SUBMISSION_UNCERTAIN"); setWalletTransferError(message ?? "We couldn't confirm whether this transfer completed. Check Activity before retrying."); }
          if (state === "CONFIRMED") { setWalletTransferState("CONFIRMED"); setWalletTransferError(null); }
        },
        messages: {
          failedBeforeSubmission: "We couldn't submit this transfer. Your funds were not moved.",
          failed: "The transfer failed. Your funds were not moved.",
          uncertain: "We couldn't confirm whether this transfer completed. Check Activity before retrying.",
        },
      });

      const actualFee = actualFeeFromReceipt(result.receipt, quote.estimatedFeeAmount);
      const actualEvidence = actualFee ? { actualFeeAmount: actualFee.amount.toString(), actualFeeToken: actualFee.token, actualFeeSymbol: actualFee.symbol, actualFeeDecimals: actualFee.decimals } : {};

      if (result.outcome === "CONFIRMED") {
        const remainingBalance = result.authoritative?.senderBalance;
        setWalletTransferReceipt({ ...(actualFee ? { actualFeeAmount: actualFee.amount.toString(), actualFeeSymbol: actualFee.symbol, actualFeeDecimals: actualFee.decimals } : {}), ...(remainingBalance ? { remainingBalance } : {}), ...(result.transactionHash ? { txHash: result.transactionHash } : {}) });
        rememberWalletTransfer({ operationId, sender: address, recipient: validated.recipient, amount: validated.amount.toString(), createdAt, ...(result.transactionHash ? { txHash: result.transactionHash } : {}), state: "CONFIRMED", ...actualEvidence, ...(remainingBalance ? { actualRemainingBalance: remainingBalance } : {}) });
        setWalletTransferState("CONFIRMED");
        setWalletTransferError(null);
        void refreshBalance();
        void refreshPublicActivity({ force: true });
      } else if (result.outcome === "FAILED_BEFORE_SUBMISSION") {
        setWalletTransferReceipt(null);
        rememberWalletTransfer({ operationId, sender: address, recipient: validated.recipient, amount: validated.amount.toString(), createdAt, state: "FAILED_BEFORE_SUBMISSION", failureMessage: preflightMessage ?? result.message });
        setWalletTransferState("FAILED_BEFORE_SUBMISSION");
        setWalletTransferError(preflightMessage ?? result.message ?? "We couldn't submit this transfer. Your funds were not moved.");
      } else if (result.outcome === "FAILED") {
        setWalletTransferReceipt(null);
        rememberWalletTransfer({ operationId, sender: address, recipient: validated.recipient, amount: validated.amount.toString(), createdAt, ...(result.transactionHash ? { txHash: result.transactionHash } : {}), state: "FAILED", failureMessage: result.message, ...actualEvidence });
        setWalletTransferState("FAILED");
        setWalletTransferError(result.message ?? "The transfer failed. Your funds were not moved.");
      } else {
        setWalletTransferReceipt(null);
        rememberWalletTransfer({ operationId, sender: address, recipient: validated.recipient, amount: validated.amount.toString(), createdAt, ...(result.transactionHash ? { txHash: result.transactionHash } : {}), state: "SUBMISSION_UNCERTAIN", failureMessage: result.message });
        setWalletTransferState("SUBMISSION_UNCERTAIN");
        setWalletTransferError(result.message ?? "We couldn't confirm whether this transfer completed. Check Activity before retrying.");
        void refreshPublicActivity({ force: true });
      }
    } catch (error) {
      const message = error instanceof FinancialError ? error.message : error instanceof Error ? error.message : "We couldn't prepare this transfer. Your funds were not moved.";
      setWalletTransferState("IDLE");
      setWalletTransferError(message);
    } finally {
      walletTransferBusyRef.current = false;
    }
  }, [address, connectorClient, publicClient, refreshBalance, refreshPublicActivity, sendTransactionAsync]);

  // Sign and fund through the canonical bounded submission/reconciliation engine.
  const handleSignAndFund = useCallback(async () => {
    if (!canEnterFundingSigning({ stage, preflightChecking, preflightError, prepared: Boolean(prepared), submissionState })) return;
    if (!prepared) return;
    const operationId = `fund:${prepared.payoutId}`;
    const expected = {
      sender: address ?? "",
      amount: prepared.record.amount,
      expiresAt: prepared.record.expiresAt,
      claimSigner: prepared.record.claimSigner,
    };

    setStage("SIGNING");
    setSubmissionState("SUBMITTING");
    setPreflightError(null);
    setFundingQuote(null);
    rememberSenderPayout({ ...prepared.record, submissionState: "SUBMITTING" });
    if (prepared.capability) rememberCapability(prepared.payoutId, prepared.capability.raw);
    updateOperation(operationId, { state: "PREPARED", submissionBoundaryReached: false });
    recordFundingStage("SEND_PREPARATION", "STARTED");

    const persist = (update: Parameters<typeof updateOperation>[1]) => {
      updateOperation(operationId, update);
      const next: Partial<SenderPayoutRecord> = {
        ...(update.transactionHash ? { fundingTxHash: update.transactionHash } : {}),
      };
      switch (update.state) {
        case "SUBMISSION_ATTEMPTED": next.submissionState = "SUBMITTING"; break;
        case "HASH_RECEIVED": next.submissionState = "HASH_RECEIVED"; break;
        case "CONFIRMING": next.submissionState = "CONFIRMING_RECEIPT"; break;
        case "RECOVERING": next.submissionState = "SUBMISSION_UNCERTAIN"; break;
        case "CONFIRMED": next.submissionState = "CONFIRMED"; break;
        case "FAILED": next.submissionState = "FAILED"; next.outcome = "FAILED"; break;
        case "FAILED_BEFORE_SUBMISSION": next.submissionState = "FAILED"; next.outcome = "FAILED"; break;
        case "SUBMISSION_UNCERTAIN": next.submissionState = "SUBMISSION_UNCERTAIN"; next.outcome = "RECOVERY_REQUIRED"; break;
      }
      if (update.failureMessage) next.failureMessage = update.failureMessage;
      if (Object.keys(next).length > 0) updateSenderPayout(prepared.payoutId, next);
    };

    const result = await submitAndReconcile<PublicPayout>({
      operation: {
        operationType: "FUND",
        operationId,
        payoutIds: [prepared.payoutId],
        expectedSender: expected.sender,
        expectedAmount: expected.amount,
        expectedExpiry: expected.expiresAt,
        expectedClaimSigner: expected.claimSigner,
        createdAt: prepared.record.createdAt,
        submissionBoundaryReached: false,
        state: "PREPARED",
      },
      submit: async () => sendTransactionAsync(senderFundingRequest(prepared.calls) as never),
      readAuthoritativeState: () => readPayoutStrict(prepared.payoutId),
      successPredicate: payout => payoutMatchesExpected(payout, expected),
      waitForReceipt: publicClient ? async (hash) => {
        recordFundingStage("RECEIPT_WAIT_START", "STARTED");
        const receipt = await (publicClient as any).waitForTransactionReceipt({ hash });
        recordFundingStage("RECEIPT_WAIT_SUCCEEDED", "SUCCEEDED");
        return { status: receipt?.status === "success" ? "success" as const : "reverted" as const, receipt };
      } : undefined,
      classifySubmitError: error => isUserCancellation(error) ? "USER_CANCELLED" : "OTHER",
      onState: (state, message) => {
        if (state === "HASH_RECEIVED") { setSubmissionState("HASH_RECEIVED"); setStage("SUBMITTED"); recordFundingStage("HASH_RECEIVED", "SUCCEEDED"); }
        if (state === "CONFIRMING") { setSubmissionState("CONFIRMING_RECEIPT"); setStage("CONFIRMING"); }
        if (state === "RECOVERING") { setSubmissionState("SUBMISSION_UNCERTAIN"); setStage("RECOVERY_REQUIRED"); setPreflightError(SAFE_SUBMISSION_UNCERTAIN); }
        if (state === "FAILED" || state === "FAILED_BEFORE_SUBMISSION") { setSubmissionState("FAILED"); setStage("FAILED_RETRYABLE"); setPreflightError(message ?? SAFE_SUBMISSION_FAILED); }
        if (state === "SUBMISSION_UNCERTAIN") { setSubmissionState("SUBMISSION_UNCERTAIN"); setStage("RECOVERY_REQUIRED"); setPreflightError(message ?? SAFE_SUBMISSION_UNCERTAIN); }
      },
      persist,
      messages: { failedBeforeSubmission: SAFE_PRE_SIGNING_FAILURE, failed: SAFE_SUBMISSION_FAILED, uncertain: SAFE_SUBMISSION_UNCERTAIN },
    });

    if (result.outcome === "CONFIRMED" && result.authoritative) {
      recordFundingStage("PAYOUT_READ_SUCCEEDED", "SUCCEEDED");
      recordFundingStage("FUNDED_CONFIRMED", "SUCCEEDED");
      const hash = result.transactionHash;
      const actualFee = actualFeeFromReceipt(result.receipt, prepared.quote.estimatedFeeAmount);
      const remainingBalance = publicClient ? await (publicClient as any).readContract({ address: PATH_USD_ADDRESS, abi: pathUsdAbi, functionName: "balanceOf", args: [address] }) as bigint : undefined;
      const fundedRecord = { ...prepared.record, ...(hash ? { fundingTxHash: hash } : {}), submissionState: "CONFIRMED" as const, ...(actualFee ? { actualFeeAmount: actualFee.amount.toString(), actualFeeToken: actualFee.token, actualFeeSymbol: actualFee.symbol, actualFeeDecimals: actualFee.decimals } : {}), ...(remainingBalance !== undefined ? { actualRemainingBalance: remainingBalance.toString() } : {}) };
      setPrepared({ ...prepared, record: fundedRecord });
      rememberSenderPayout(fundedRecord);
      const claimFragment = prepared.protectedShare?.shareAFragment ?? `cap=${prepared.capability?.raw ?? ""}`;
      setClaimUrl(`${window.location.origin}/c/${prepared.payoutId}#${claimFragment}`);
      setSubmissionState("CONFIRMED");
      setStage("FUNDED");
      void refreshBalance();
      void refreshPayouts({ force: true });
    } else if (result.outcome === "FAILED" || result.outcome === "FAILED_BEFORE_SUBMISSION") {
      if (prepared.capability) clearCapability(prepared.payoutId);
      const actualFee = actualFeeFromReceipt(result.receipt, prepared.quote.estimatedFeeAmount);
      rememberSenderPayout({ ...prepared.record, ...(result.transactionHash ? { fundingTxHash: result.transactionHash } : {}), submissionState: "FAILED", outcome: "FAILED", failureMessage: result.message ?? SAFE_SUBMISSION_FAILED, ...(actualFee ? { actualFeeAmount: actualFee.amount.toString(), actualFeeToken: actualFee.token, actualFeeSymbol: actualFee.symbol, actualFeeDecimals: actualFee.decimals } : {}) });
      void refreshPayouts({ force: true });
    } else {
      rememberSenderPayout({ ...prepared.record, ...(result.transactionHash ? { fundingTxHash: result.transactionHash } : {}), submissionState: "SUBMISSION_UNCERTAIN", outcome: "RECOVERY_REQUIRED", failureMessage: result.message ?? SAFE_SUBMISSION_UNCERTAIN });
      void refreshPayouts({ force: true });
    }
  }, [address, prepared, preflightChecking, preflightError, publicClient, readPayoutStrict, refreshBalance, refreshPayouts, sendTransactionAsync, stage, submissionState]);

  // Reclaim / Return Funds
  const handleReturnFunds = useCallback(
    async (id: string) => {
      const persistReclaim = (update: Partial<SenderPayoutRecord>) => {
        updateSenderPayout(id, update);
        setPayouts((current) => current.map((record) => record.id === id ? { ...record, ...update } : record));
      };
      const operationId = `reclaim:${id}`;
      setReclaimUiState("CHECKING");
      setReclaimError(null);

      let payout: PublicPayout;
      try { payout = await readPayoutStrict(id); } catch {
        setReclaimUiState("FAILED_BEFORE_SUBMISSION");
        setReclaimError("We couldn't verify this payout right now. No transaction was submitted. Try again.");
        return;
      }

      const publish = (value: PublicPayout) => {
        setPayoutStatuses(current => ({ ...current, [id]: { ...value, expiresAt: BigInt(value.expiresAt) } }));
        const terminal = resolvePayoutLifecycle({ authoritativePayout: value }).financialState;
        setPayouts(current => current.map(record => record.id === id && (terminal === "CLAIMED" || terminal === "RECLAIMED") ? promoteSenderPayoutRecord(record, value) : record));
      };
      publish(payout);
      const initial = reclaimReadiness(payout, address);
      if (initial === "RECLAIMED") { setReclaimUiState("RECLAIMED"); return; }
      if (initial === "CLAIMED") { setReclaimUiState("IDLE"); return; }
      if (initial === "UNAVAILABLE") { setReclaimUiState("FAILED_BEFORE_SUBMISSION"); setReclaimError("This payout is no longer available. No transaction was submitted."); return; }
      if (initial === "UNAUTHORIZED") { setReclaimUiState("FAILED_BEFORE_SUBMISSION"); setReclaimError("Only the sender can return this payout. No transaction was submitted."); return; }

      let chainTimestamp: bigint;
      try { chainTimestamp = await readChainTimestamp(publicClient as any); } catch {
        setReclaimUiState("FAILED_BEFORE_SUBMISSION");
        setReclaimError("We couldn't verify this payout right now. No transaction was submitted. Try again.");
        return;
      }
      const ready = reclaimReadiness(payout, address, chainTimestamp);
      if (ready !== "ELIGIBLE") {
        setReclaimUiState("FAILED_BEFORE_SUBMISSION");
        setReclaimError(ready === "NOT_EXPIRED" ? "This payout has not expired yet. No transaction was submitted." : "We couldn't verify this payout right now. No transaction was submitted.");
        return;
      }

      let reclaimData: Hex;
      try { reclaimData = encodeFunctionData({ abi: vaultAbi, functionName: "reclaim", args: [BigInt(id)] }); } catch {
        setReclaimUiState("FAILED_BEFORE_SUBMISSION");
        setReclaimError("We couldn't prepare the return transaction. No transaction was submitted. Try again.");
        return;
      }

      const existing = readSenderPayouts().find(record => record.id === id);
      upsertOperation({
        operationType: "RECLAIM",
        operationId,
        payoutIds: [id],
        expectedSender: payout.sender,
        expectedAmount: payout.amount,
        expectedExpiry: payout.expiresAt,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        submissionBoundaryReached: false,
        state: "PREPARED",
      });
      const persist = (update: Parameters<typeof updateOperation>[1]) => {
        updateOperation(operationId, update);
        const next: Partial<SenderPayoutRecord> = { ...(update.transactionHash ? { reclaimTxHash: update.transactionHash } : {}) };
        if (update.state === "SUBMISSION_ATTEMPTED" || update.state === "HASH_RECEIVED" || update.state === "CONFIRMING") next.reclaimState = "SUBMITTING";
        if (update.state === "RECOVERING" || update.state === "SUBMISSION_UNCERTAIN") next.reclaimState = "SUBMISSION_UNCERTAIN";
        if (update.state === "CONFIRMED") next.reclaimState = "CONFIRMED";
        if (Object.keys(next).length > 0) persistReclaim(next);
      };

      const result = await submitAndReconcile<PublicPayout>({
        operation: { operationType: "RECLAIM", operationId, payoutIds: [id], expectedSender: payout.sender, expectedAmount: payout.amount, expectedExpiry: payout.expiresAt, createdAt: existing?.createdAt ?? new Date().toISOString(), submissionBoundaryReached: false, state: "PREPARED" },
        submit: () => sendTransactionAsync(senderFundingRequest([{ to: vaultAddress, data: reclaimData, value: 0n }]) as never),
        readAuthoritativeState: () => readPayoutStrict(id),
        successPredicate: value => resolvePayoutLifecycle({ authoritativePayout: value }).financialState === "RECLAIMED",
        failedPredicate: value => resolvePayoutLifecycle({ authoritativePayout: value }).financialState === "CLAIMED",
        waitForReceipt: publicClient ? async hash => {
          const receipt = await (publicClient as any).waitForTransactionReceipt({ hash });
          return { status: receipt?.status === "success" ? "success" as const : "reverted" as const };
        } : undefined,
        persist,
        onState: (state, message) => {
          if (state === "SUBMISSION_ATTEMPTED") setReclaimUiState("SUBMITTING");
          if (state === "HASH_RECEIVED" || state === "CONFIRMING") setReclaimUiState("CONFIRMING");
          if (state === "RECOVERING") { setReclaimUiState("RECOVERING"); setReclaimError(null); }
          if (state === "FAILED") { setReclaimUiState("FAILED"); setReclaimError(message ?? "The return transaction failed. No funds were moved."); }
          if (state === "SUBMISSION_UNCERTAIN") { setReclaimUiState("SUBMISSION_UNCERTAIN"); setReclaimError(message ?? SAFE_SUBMISSION_UNCERTAIN); }
          if (state === "CONFIRMED") { setReclaimUiState("RECLAIMED"); setReclaimError(null); }
        },
        messages: { failed: "The return transaction failed. No funds were moved.", uncertain: SAFE_SUBMISSION_UNCERTAIN },
      });

      if (result.authoritative) publish(result.authoritative);
      if (result.outcome === "CONFIRMED") { persistReclaim({ reclaimState: "CONFIRMED" }); void refreshBalance(); void refreshPayouts({ force: true }); }
      else if (result.outcome === "FAILED") { persistReclaim({ reclaimState: undefined, outcome: "FAILED", failureMessage: result.message }); void refreshPayouts({ force: true }); }
      else if (result.outcome === "SUBMISSION_UNCERTAIN") { persistReclaim({ reclaimState: "SUBMISSION_UNCERTAIN", outcome: "RECOVERY_REQUIRED", failureMessage: result.message }); void refreshPayouts({ force: true }); }
    },
    [address, publicClient, readPayoutStrict, refreshBalance, refreshPayouts, sendTransactionAsync]
  );

  const handleCopyClaimLink = useCallback(async (url: string) => {
    await navigator.clipboard.writeText(url);
  }, []);

  const handleResetSend = useCallback(() => {
    setPrepared(null);
    setClaimUrl(null);
    setStage("REVIEW");
    setPreflightError(null);
    setWalletTransferQuote(null);
    setWalletTransferError(null);
    setSubmissionState("NOT_SUBMITTED");
    navigate("send");
  }, [navigate]);

  // If view is landing, render LandingHero directly (no sidebar on public dashboard)
  if (currentView === "landing") {
    if (onboardingStarted) {
      return (
        <AccountGateway
          stage={onboardingStage}
          authFlow={onboardingFlow}
          accountAddress={accountReadyAddress}
          errorMessage={onboardingError}
          failureKind={onboardingFailureKind}
          onCreateAccount={startAccountCreation}
          onSignIn={startSignIn}
          onCreatePasskey={() => void connectWallet(false, "register")}
          onFinishSetup={() => void finishPendingSetup()}
          onSignInWithPasskey={() => void connectWallet(false, "login")}
          onUseAnotherPasskey={() => void connectWallet(true, "login")}
          onRetry={retryOnboarding}
          onStartOver={startOverOnboarding}
          onEnterReach={() => navigate("home")}
        />
      );
    }

    return (
      <LandingHero
        onStartSend={openReach}
        isConnected={sessionConnected}
        connectedAddress={sessionAddress}
      />
    );
  }

  if (!sessionConnected && !sessionRestoring) {
    return (
      <LandingHero
        onStartSend={openReach}
        isConnected={false}
        connectedAddress={undefined}
      />
    );
  }

  const selectedActivity = selectedPayoutId ? activities?.find((activity) => activity.payoutId === selectedPayoutId) : undefined;
  const selectedRecord = selectedPayoutId ? payouts.find((p) => p.id === selectedPayoutId) ?? (selectedActivity ? activityToSenderRecord(selectedActivity) : null) : null;
  const selectedLive = selectedActivity?.authorityUnavailable ? undefined : selectedPayoutId ? payoutStatuses[selectedPayoutId] ?? (selectedActivity ? livePayoutFromActivity(selectedActivity) : undefined) : undefined;
  const pathUsdFormatted = balanceState.status === "READY" ? formatPathUsd(BigInt(balanceState.balance || "0")) : undefined;
  const reclaimBusy = reclaimUiState === "CHECKING" || reclaimUiState === "AWAITING_SIGNATURE" || reclaimUiState === "SUBMITTING" || reclaimUiState === "CONFIRMING" || reclaimUiState === "RECOVERING";

  return (
    <AppShell
      currentView={currentView}
      onNavigate={(v) => navigate(v)}
      isConnected={sessionConnected}
      connectedAddress={isSigningOut ? signingOutAddress ?? sessionAddress : sessionAddress}
      onConnectWallet={connectWallet}
      onSignOut={signOut}
      isSigningOut={isSigningOut}
      pathUsdBalance={pathUsdFormatted}
    >

      {currentView === "home" && (
        <HomeDashboard
          balanceState={balanceState}
          payouts={payouts}
          payoutStatuses={payoutStatuses}
          activities={activities ?? undefined}
          connectedAddress={sessionAddress}
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
          connectedAddress={sessionAddress}
          balanceState={balanceState}
          onCancel={() => navigate("home")}
          onInitiateReview={handleInitiateReview}
          onSignAndFund={handleSignAndFund}
          onRevalidateFunding={revalidateFunding}
          onReset={handleResetSend}
          onViewActivity={() => navigate("activity")}
          stage={stage}
          fundedRecord={prepared?.record || null}
          claimUrl={claimUrl}
          onCopyClaimLink={handleCopyClaimLink}
          preflightError={preflightError}
          preflightChecking={preflightChecking}
          fundingQuote={fundingQuote ?? prepared?.quote ?? null}
          submissionState={submissionState}
          walletTransferState={walletTransferState}
          walletTransferError={walletTransferError}
          walletTransferQuote={walletTransferQuote}
          walletTransferPreparing={walletTransferPreparing}
          walletTransferReceipt={walletTransferReceipt}
          onPrepareWalletTransfer={prepareWalletTransfer}
          onWalletTransfer={handleWalletTransfer}
          onResetWalletTransfer={resetWalletTransfer}
          protectedChannels={protectedChannels}
        />
      )}

      {currentView === "batch" && (
        <BatchExperience
          connectedAddress={address}
          pathUsdBalance={pathUsdFormatted}
          onDone={() => {
            void refreshPayouts({ force: true });
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
          activities={activities ?? undefined}
          onSelectPayout={(id) => navigate("payout-detail", id)}
          onStartSend={() => navigate("send")}
          onRefresh={async () => { await refreshPayouts({ force: true }); await refreshPublicActivity({ force: true }); }}
          refreshing={refreshing}
        />
      )}

      {currentView === "payout-detail" && selectedRecord && (
        <PayoutDetail
          record={selectedRecord}
          live={selectedLive}
          connectedAddress={address}
          capabilityAvailable={hasCapability(selectedRecord.id)}
          onBack={() => navigate("activity")}
          onReturnFunds={handleReturnFunds}
          returningFunds={reclaimBusy}
          reclaimState={reclaimUiState}
          reclaimError={reclaimError}
        />
      )}
    </AppShell>
  );
}
