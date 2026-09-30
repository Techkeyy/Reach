import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { encodeFunctionData, type Address, type Hex } from "viem";
import { useConnection, useConnect, useConnectorClient, useConnectors, useDisconnect, usePublicClient, useSendTransaction } from "wagmi";
import { DEFAULT_VAULT_ADDRESS, PATH_USD_ADDRESS, payoutStatus, vaultAbi, pathUsdAbi } from "../shared/reach";
import { claimSignerForCapability, clearCapability, createClaimCapability, hasCapability, rememberCapability } from "./claimCapability";
import { canEnterFundingSigning, createPayoutId, failedBalance, formatPathUsd, fundingAllowed, isReclaimEligible, loadingBalance, parseAuthoritativeBalance, parsePathUsdAmount, publicStatusLabel, readyBalance, type BalanceState, type FundingSubmissionState, type SenderStage } from "./senderFlow";
import { mergeSenderPayouts, promoteSenderPayoutRecord, type DiscoveredSenderPayout } from "./senderRecovery";
import { readSenderPayouts, rememberSenderPayout, removeSenderPayout, updateSenderPayout, type SenderPayoutRecord } from "./senderStorage";
import { payoutMatchesExpected, payoutMatchesIdentity, preflightFunding, SAFE_PRE_SIGNING_FAILURE, SAFE_SUBMISSION_FAILED, SAFE_SUBMISSION_UNCERTAIN, senderFundingRequest, toFundingFillRequest, type FundingFillClient } from "./senderFunding";
import { type ReclaimUiState } from "./reclaimFlow";
import { authFailure, hasAuthenticatedAccount, withTimeout, type AuthFailureKind, type AuthFailureStage } from "./authFlow";
import { clearPendingRegistration, clearPendingRegistrationIfMatches, finishPendingRegistration, isPasskeyCreatedSetupIncompleteError, passkeySetupErrorCause, readPendingRegistration } from "./identityRecovery";
import { prepareFreshRegistration } from "./registerPreparation";
import { getLastAuthFailureStage, recordAuthStage, recordFundingStage, resetAuthFailureStage } from "./diagnostics";
import { readChainTimestamp, expiryFromChainTimestamp } from "./chainTime";
import { useChainClock } from "./useChainClock";
import { readPublicPayout } from "./readPublicPayout";
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

type PublicPayout = { sender: Address; amount: string; expiresAt: string; claimSigner: Address; status: 0 | 1 | 2 | 3; claimant: Address };
type DiscoveredResponse = { address: Address; payouts: DiscoveredSenderPayout[] };
type OnboardingFixture = { stage: AccountOnboardingStage; flow: AccountAuthFlow; error?: string; address?: string; failureKind?: AuthFailureKind };
type PreparedFunding = { payoutId: string; capability: ReturnType<typeof createClaimCapability>; claimSigner: Address; calls: { to: Address; data: `0x${string}`; value: bigint }[]; record: SenderPayoutRecord; amountText: string };

const vaultAddress = (import.meta.env.VITE_REACH_VAULT_ADDRESS ?? DEFAULT_VAULT_ADDRESS) as Address;
const DEV_SESSION_FIXTURE_ADDRESS = "0x0bf9000000000000000000000000000000000D42D" as Address;

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
  const authAttemptRef = useRef(0);

  const [balanceState, setBalanceState] = useState<BalanceState>(loadingBalance());
  const [payouts, setPayouts] = useState<SenderPayoutRecord[]>(() => readSenderPayouts());
  const [rawPayoutStatuses, setPayoutStatuses] = useState<Record<string, { status: number; expiresAt: bigint; claimant?: string; sender?: string }>>({});
  const { timestamp: chainTimestamp, refresh: refreshChainTime } = useChainClock(publicClient, sessionConnected);
  const payoutStatuses = useMemo(() => Object.fromEntries(Object.entries(rawPayoutStatuses).map(
    ([id, payout]) => [id, { ...payout, chainTimestamp }],
  )), [rawPayoutStatuses, chainTimestamp]);
  const [refreshing, setRefreshing] = useState(false);

  // Send experience states
  const [prepared, setPrepared] = useState<PreparedFunding | null>(null);
  const [stage, setStage] = useState<SenderStage>("REVIEW");
  const [claimUrl, setClaimUrl] = useState<string | null>(null);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [preflightChecking, setPreflightChecking] = useState(false);
  const [submissionState, setSubmissionState] = useState<FundingSubmissionState>("NOT_SUBMITTED");
  const [reclaimUiState, setReclaimUiState] = useState<ReclaimUiState>("IDLE");
  const [reclaimError, setReclaimError] = useState<string | null>(null);
  const preparedRef = useRef<PreparedFunding | null>(null);

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
    if (currentView === "landing" || isSigningOut || sessionConnected || sessionRestoring) return;
    navigate("landing");
  }, [currentView, isSigningOut, navigate, sessionConnected, sessionRestoring]);

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
    setPayouts([]);
    setPayoutStatuses({});
    setSelectedPayoutId(null);
    setPrepared(null);
    setClaimUrl(null);
    setStage("REVIEW");
    setPreflightError(null);
    setPreflightChecking(false);
    setSubmissionState("NOT_SUBMITTED");
    setReclaimUiState("IDLE");
    setReclaimError(null);
    setSessionFixtureAddress(undefined);
    setSigningOutAddress(undefined);
    setIsSigningOut(false);
    navigate("landing");
  }, [disconnectAsync, isConnected, isSigningOut, navigate, sessionAddress]);

  // Strict reads are used by the operation engine. Background refreshes may
  // still use the nullable wrapper, but a financial action must distinguish an
  // authoritative NONE response from an unavailable vault read.
  const readPayoutStrict = useCallback(
    async (id: string): Promise<PublicPayout> => {
      if (!publicClient) throw new Error("public client unavailable");
      return readPublicPayout(publicClient as any, vaultAddress, id);
    },
    [publicClient]
  );

  const readPayout = useCallback(
    async (id: string): Promise<PublicPayout | null> => {
      try { return await readPayoutStrict(id); } catch { return null; }
    },
    [readPayoutStrict]
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
    void refreshChainTime();
    setRefreshing(true);
    try {
      const expectedFor = (record: SenderPayoutRecord) => ({
        sender: address,
        amount: record.amount,
        expiresAt: record.expiresAt,
        claimSigner: record.claimSigner,
      });

      const promoteOpenFunding = (record: SenderPayoutRecord, onchain: PublicPayout) => {
        const currentPrepared = preparedRef.current;
        if (!currentPrepared || currentPrepared.payoutId !== record.id || onchain.status !== payoutStatus.FUNDED) return;
        if (!payoutMatchesExpected(onchain, expectedFor(record))) return;

        const promoted = promoteSenderPayoutRecord(record, onchain);
        setPrepared((current) => current?.payoutId === record.id ? { ...current, record: promoted } : current);
        setClaimUrl(`${window.location.origin}/c/${record.id}#${currentPrepared.capability.raw}`);
        setSubmissionState("CONFIRMED");
        setStage("FUNDED");
        setPreflightError(null);
      };

      const reconcileRecords = async (records: SenderPayoutRecord[]) => Promise.all(records.map(async (record) => {
        const onchain = await readPayout(record.id);
        const matchesSenderRecord = onchain && payoutMatchesIdentity(onchain, expectedFor(record));
        const next = matchesSenderRecord ? promoteSenderPayoutRecord(record, onchain) : record;
        if (onchain && matchesSenderRecord) promoteOpenFunding(next, onchain);

        // Discovery is a public, durable recovery source. Persist only the
        // public record; the bearer capability remains client-only.
        rememberSenderPayout(next);
        return { record: next, onchain };
      }));

      const publish = async (reconciled: Awaited<ReturnType<typeof reconcileRecords>>) => {
        setPayouts(reconciled.map(({ record }) => record));
        const statusMap: Record<string, { status: number; expiresAt: bigint; claimant?: string; sender?: string; chainTimestamp?: bigint }> = {};
        for (const { record, onchain } of reconciled) {
          if (onchain && payoutMatchesIdentity(onchain, { sender: address, amount: record.amount, expiresAt: record.expiresAt, claimSigner: record.claimSigner })) {
            statusMap[record.id] = {
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
      const localReconciled = await reconcileRecords(local);
      await publish(localReconciled);

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
      await publish(await reconcileRecords(merged));
    } finally {
      setRefreshing(false);
    }
  }, [address, readPayout, refreshChainTime]);

  useEffect(() => {
    if (isConnected && address) {
      void refreshPayouts();
    }
  }, [isConnected, address, refreshPayouts]);

  // Prepare Review & Funding
  const handleInitiateReview = useCallback(
    async (amountInput: string, expirySeconds: number, label: string): Promise<boolean> => {
      setPreflightError(null);
      setPreflightChecking(false);
      setPrepared(null);
      setStage("PREFLIGHTING");
      setSubmissionState("NOT_SUBMITTED");
      try {
        const parsedAmount = parsePathUsdAmount(amountInput);
        const capability = createClaimCapability();
        const claimSigner = claimSignerForCapability(capability.privateKey) as Address;
        const payoutId = createPayoutId();
        if (!publicClient) throw new Error("chain reader unavailable");
        const chainTimestamp = await readChainTimestamp(publicClient as any);
        const expiresAt = expiryFromChainTimestamp(chainTimestamp, expirySeconds);

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

        // Persist the public intent and bearer before any provider interaction.
        // The journal never contains the capability itself; the capability is
        // kept in its dedicated client-only store.
        const operationId = `fund:${payoutId}`;
        rememberCapability(payoutId, capability.raw);
        upsertOperation({
          operationType: "FUND",
          operationId,
          payoutIds: [payoutId],
          expectedSender: address,
          expectedAmount: record.amount,
          expectedExpiry: record.expiresAt,
          expectedClaimSigner: record.claimSigner,
          createdAt: record.createdAt,
          submissionBoundaryReached: false,
          state: "PREPARED",
        });

        setPrepared({
          payoutId,
          capability,
          claimSigner,
          calls,
          record,
          amountText: amountInput,
        });

        if (!address || !connectorClient) {
          updateOperation(operationId, { state: "FAILED_BEFORE_SUBMISSION", failureMessage: SAFE_PRE_SIGNING_FAILURE });
          clearCapability(payoutId);
          setPrepared(null);
          setStage("REVIEW");
          setSubmissionState("FAILED_BEFORE_SUBMISSION");
          setPreflightError(SAFE_PRE_SIGNING_FAILURE);
          return true;
        }

        setPreflightChecking(true);
        const fillRequest = toFundingFillRequest(address as Address, calls);
        const pfResult = await preflightFunding(connectorClient as unknown as FundingFillClient, fillRequest);
        setPreflightChecking(false);
        if (!pfResult.ok) {
          updateOperation(operationId, { state: "FAILED_BEFORE_SUBMISSION", failureMessage: "message" in pfResult ? pfResult.message : SAFE_PRE_SIGNING_FAILURE });
          clearCapability(payoutId);
          setPrepared(null);
          setStage("REVIEW");
          setSubmissionState("FAILED_BEFORE_SUBMISSION");
          setPreflightError("message" in pfResult ? pfResult.message : SAFE_PRE_SIGNING_FAILURE);
        } else {
          setStage("READY_TO_SIGN");
          setSubmissionState("NOT_SUBMITTED");
        }

        return true;
      } catch {
        setPrepared(null);
        setStage("REVIEW");
        setSubmissionState("FAILED_BEFORE_SUBMISSION");
        setPreflightError(SAFE_PRE_SIGNING_FAILURE);
        return false;
      }
    },
    [address, connectorClient, publicClient]
  );

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
    rememberSenderPayout({ ...prepared.record, submissionState: "SUBMITTING" });
    rememberCapability(prepared.payoutId, prepared.capability.raw);
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
        return { status: receipt?.status === "success" ? "success" as const : "reverted" as const };
      } : undefined,
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
      rememberSenderPayout({ ...prepared.record, ...(hash ? { fundingTxHash: hash } : {}), submissionState: "CONFIRMED" });
      setClaimUrl(`${window.location.origin}/c/${prepared.payoutId}#${prepared.capability.raw}`);
      setSubmissionState("CONFIRMED");
      setStage("FUNDED");
      void refreshBalance();
      void refreshPayouts();
    } else if (result.outcome === "FAILED" || result.outcome === "FAILED_BEFORE_SUBMISSION") {
      clearCapability(prepared.payoutId);
      rememberSenderPayout({ ...prepared.record, ...(result.transactionHash ? { fundingTxHash: result.transactionHash } : {}), submissionState: "FAILED", outcome: "FAILED", failureMessage: result.message ?? SAFE_SUBMISSION_FAILED });
      void refreshPayouts();
    } else {
      rememberSenderPayout({ ...prepared.record, ...(result.transactionHash ? { fundingTxHash: result.transactionHash } : {}), submissionState: "SUBMISSION_UNCERTAIN", outcome: "RECOVERY_REQUIRED", failureMessage: result.message ?? SAFE_SUBMISSION_UNCERTAIN });
      void refreshPayouts();
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
        setPayoutStatuses(current => ({ ...current, [id]: { status: value.status, expiresAt: BigInt(value.expiresAt), claimant: value.claimant, sender: value.sender, ...current[id] } }));
        setPayouts(current => current.map(record => record.id === id && (value.status === payoutStatus.CLAIMED || value.status === payoutStatus.RECLAIMED) ? promoteSenderPayoutRecord(record, { status: value.status }) : record));
      };
      publish(payout);
      if (payout.status === payoutStatus.RECLAIMED) { setReclaimUiState("RECLAIMED"); return; }
      if (payout.status === payoutStatus.CLAIMED) { setReclaimUiState("IDLE"); return; }
      if (payout.status !== payoutStatus.FUNDED) { setReclaimUiState("FAILED_BEFORE_SUBMISSION"); setReclaimError("This payout is no longer available. No transaction was submitted."); return; }
      if (!address || payout.sender.toLowerCase() !== address.toLowerCase()) { setReclaimUiState("FAILED_BEFORE_SUBMISSION"); setReclaimError("Only the sender can return this payout. No transaction was submitted."); return; }

      let chainTimestamp: bigint;
      try { chainTimestamp = await readChainTimestamp(publicClient as any); } catch {
        setReclaimUiState("FAILED_BEFORE_SUBMISSION");
        setReclaimError("We couldn't verify this payout right now. No transaction was submitted. Try again.");
        return;
      }
      if (chainTimestamp < BigInt(payout.expiresAt)) { setReclaimUiState("FAILED_BEFORE_SUBMISSION"); setReclaimError("This payout has not expired yet. No transaction was submitted."); return; }

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
        successPredicate: value => value.status === payoutStatus.RECLAIMED,
        failedPredicate: value => value.status === payoutStatus.CLAIMED,
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
      if (result.outcome === "CONFIRMED") { persistReclaim({ reclaimState: "CONFIRMED" }); void refreshBalance(); void refreshPayouts(); }
      else if (result.outcome === "FAILED") { persistReclaim({ reclaimState: undefined, outcome: "FAILED", failureMessage: result.message }); void refreshPayouts(); }
      else if (result.outcome === "SUBMISSION_UNCERTAIN") { persistReclaim({ reclaimState: "SUBMISSION_UNCERTAIN", outcome: "RECOVERY_REQUIRED", failureMessage: result.message }); void refreshPayouts(); }
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

  const selectedRecord = selectedPayoutId ? payouts.find((p) => p.id === selectedPayoutId) : null;
  const selectedLive = selectedPayoutId ? payoutStatuses[selectedPayoutId] : undefined;
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
          submissionState={submissionState}
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
