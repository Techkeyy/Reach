import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { encodeFunctionData, isAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { useAccount, useConnect, useConnectors, useDisconnect, usePublicClient, useSendTransaction } from "wagmi";
import {
  CLAIM_ACTION,
  CLAIM_AUTHORIZATION_VERSION,
  claimDomain,
  claimTypes,
  DEFAULT_VAULT_ADDRESS,
  PATH_USD_ADDRESS,
  pathUsdAbi,
  payoutStatus,
  TEMPO_MODERATO_CHAIN_ID,
  vaultAbi,
  PayoutReadError,
  parseClaimPayoutId,
} from "../shared/reach";
import {
  clearCapability,
  readCapability,
  recoverCapability,
  recoverPending,
  rememberCapability,
  rememberPending,
} from "./claimCapability";
import { consumeClaimFragment } from "./claimFragment";
import { formatPathUsd, parsePathUsdAmount } from "./senderFlow";
import { readChainTimestamp } from "./chainTime";
import { withTimeout } from "./authFlow";
import { readCurrentPayoutApi, readPublicPayout } from "./readPublicPayout";
import { resolvePayoutLifecycle } from "./payoutLifecycle";
import { upsertOperation, updateOperation } from "./operationJournal";
import { submitClaimAndReconcile } from "./claimAuthority";
import { clearProtectedBytes, readProtectedShare, reconstructProtectedPrivateKey, signProtectedChallenge } from "./protectedClaims";
import { readAuthoritativeBalanceApi } from "./balanceRefresh";
import { claimedLinkView } from "./claimedLinkState";
import {
  beginProtectedRecipientVerification,
  PROTECTED_REAUTH_REQUIRED,
  PROTECTED_SESSION_ADDRESS_MISMATCH,
  sameProtectedAddress,
  type ProtectedRecipientConnectionMethod,
} from "./protectedAuthSession";
import {
  ProtectedFlowState,
  type ProtectedBeginAttempt,
  type ProtectedOtpFlow,
} from "./protectedFlowState";
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
  SendIcon,
  RefreshIcon,
  CopyIcon,
} from "./components/Icons";

type ClaimStage =
  | "LOADING"
  | "CHECKING"
  | "READY_TO_CLAIM"
  | "PROTECTED_VERIFY"
  | "PROTECTED_OTP"
  | "PROTECTED_RELEASING"
  | "CREATING_ACCOUNT"
  | "REAUTHENTICATING"
  | "AWAITING_PASSKEY"
  | "PREPARING_CLAIM"
  | "AWAITING_CONFIRMATION"
  | "CLAIMED"
  | "ALREADY_CLAIMED"
  | "EXPIRED"
  | "RECLAIMED"
  | "INVALID_LINK"
  | "MISSING_CREDENTIAL"
  | "FAILED_RETRYABLE"
  | "RECOVERY_REQUIRED"
  | "REVERTED";

type PublicPayout = {
  sender: Address;
  amount: string;
  expiresAt: string;
  claimSigner: Address;
  status: 0 | 1 | 2 | 3;
  claimant: Address;
};

type ProtectedMetadata = {
  mode: "PROTECTED";
  channel: "EMAIL" | "SMS";
  maskedRecipient: string;
};

type ProtectedFlowView = ProtectedOtpFlow;

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
  const { disconnectAsync } = useDisconnect();
  const { sendTransactionAsync, isPending: sending } = useSendTransaction();

  const [id, setId] = useState<string | null>(null);
  const [capability, setCapability] = useState<{ raw: string; privateKey: Hex } | null>(null);
  const [protectedShareA, setProtectedShareA] = useState<Uint8Array | null>(null);
  const protectedShareARef = useRef<Uint8Array | null>(null);
  const fragmentConsumedRef = useRef(false);
  const protectedPrivateKey = useRef<Hex | null>(null);
  const [protectedMetadata, setProtectedMetadata] = useState<ProtectedMetadata | null>(null);
  const [protectedFlow, setProtectedFlow] = useState<ProtectedFlowView | null>(null);
  const [protectedCode, setProtectedCode] = useState("");
  const [protectedError, setProtectedError] = useState<string | null>(null);
  const [protectedDeliveryRetry, setProtectedDeliveryRetry] = useState(false);
  const [payout, setPayout] = useState<PublicPayout | null>(null);
  const [stage, setStage] = useState<ClaimStage>("LOADING");
  const [retryable, setRetryable] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [manualChecking, setManualChecking] = useState(false);

  // Recipient onward transfer state
  const [recipientBalance, setRecipientBalance] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [showTransferForm, setShowTransferForm] = useState(false);
  const [transferTo, setTransferTo] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferSending, setTransferSending] = useState(false);
  const [transferTxHash, setTransferTxHash] = useState<string | null>(null);
  const [transferSuccess, setTransferSuccess] = useState(false);
  const [copiedAddr, setCopiedAddr] = useState(false);

  const busy = useRef(false);
  const protectedFlowStateRef = useRef(new ProtectedFlowState());

  const readPayoutStrict = useCallback(async (payoutId: string): Promise<PublicPayout> => {
    if (!publicClient) throw new PayoutReadError("READ_UNAVAILABLE");
    return readPublicPayout(publicClient as any, vaultAddress, payoutId);
  }, [publicClient]);

  const readPayout = useCallback(
    async (payoutId: string): Promise<PublicPayout> => {
      try {
        return await readCurrentPayoutApi(payoutId);
      } catch (error) {
        if (error instanceof PayoutReadError && error.code === "NOT_FOUND") throw error;
        return readPayoutStrict(payoutId);
      }
    },
    [readPayoutStrict]
  );

  const readAuthoritativePayout = readPayout;

  const refreshRecipientBalance = useCallback(
    async (accountAddr: Address) => {
      setBalanceLoading(true);
      try {
        setRecipientBalance(await readAuthoritativeBalanceApi(accountAddr));
      } catch {
        setRecipientBalance(null);
      } finally {
        setBalanceLoading(false);
      }
    },
    []
  );

  const applyState = useCallback(
    (current: PublicPayout, pending: { recipient?: string; txHash?: string } | null, chainTimestamp?: bigint, capabilityPresent = false) => {
      const lifecycle = resolvePayoutLifecycle({ authoritativePayout: current, chainTimestamp, capabilityPresent });

      if (pending?.txHash) {
        setTxHash(pending.txHash);
      }

      if (lifecycle.financialState === "CLAIMED") {
        if (claimedLinkView(current.claimant, connectedAddress) === "CLAIMED") {
          setStage("CLAIMED");
          void refreshRecipientBalance(current.claimant);
        } else {
          setStage("ALREADY_CLAIMED");
        }
        return;
      }

      if (lifecycle.financialState === "RECLAIMED") {
        setStage("RECLAIMED");
        return;
      }

      if (lifecycle.financialState === "NONE") { setStage("INVALID_LINK"); return; }
      if (lifecycle.displayState === "CHECKING" || lifecycle.displayState === "RECOVERING") {
        setStage("RECOVERY_REQUIRED");
        return;
      }

      if (lifecycle.isExpired) {
        setStage("EXPIRED");
        return;
      }

      // A live Protected journey is monotonic for this mounted claim page.
      // Connector/address updates and metadata refreshes must not regress an
      // already-created flow back to the initial verification screen.
      if (protectedFlowStateRef.current.hasAdvancedFlow()) return;

      if (pending?.recipient) {
        // A persisted pending record is not an active confirmation loop.
        // Keep a still-funded claim retry-protected after bounded recovery/reload.
        setStage("RECOVERY_REQUIRED");
        return;
      }

      setStage(lifecycle.allowedActions.includes("CLAIM") ? "READY_TO_CLAIM" : "MISSING_CREDENTIAL");
    },
    [connectedAddress, refreshRecipientBalance]
  );

  const boot = useCallback(async () => {
    const bootSnapshot = protectedFlowStateRef.current.beginBoot();
    const commitBootStage = (nextStage: ClaimStage) => {
      if (protectedFlowStateRef.current.canCommitBoot(bootSnapshot)) setStage(nextStage);
    };
    const segments = window.location.pathname.replace(/\/$/, "").split("/");
    const pathId = segments[segments.length - 1];
    let parsedId: string;
    try {
      parsedId = parseClaimPayoutId(pathId).toString();
    } catch {
      commitBootStage("INVALID_LINK");
      return;
    }
    setId(parsedId);

    let currentCapability: { raw: string; privateKey: Hex } | null = null;
    let currentProtectedShare: Uint8Array | null = null;
    if (window.location.hash) {
      fragmentConsumedRef.current = true;
      try {
        const parsedFragment = consumeClaimFragment(
          window.location.hash,
          () => window.history.replaceState(null, "", window.location.pathname),
          readProtectedShare,
          readCapability,
        );
        if (parsedFragment.kind === "PROTECTED") {
          currentProtectedShare = parsedFragment.value;
        } else {
          currentCapability = parsedFragment.value;
          rememberCapability(parsedId, currentCapability.raw);
        }
      } catch {
        commitBootStage("INVALID_LINK");
        return;
      }
    } else if (fragmentConsumedRef.current) {
      currentProtectedShare = protectedShareARef.current;
      currentCapability = recoverCapability(parsedId);
      if (!currentProtectedShare && !currentCapability) {
        commitBootStage("INVALID_LINK");
        return;
      }
    } else {
      currentCapability = recoverCapability(parsedId);
    }
    if (currentProtectedShare) {
      protectedShareARef.current = currentProtectedShare;
      setProtectedShareA(currentProtectedShare);
    }
    setCapability(currentCapability);

    let onchain: PublicPayout;
    try { onchain = await readAuthoritativePayout(parsedId); }
    catch (error) {
      commitBootStage(error instanceof PayoutReadError && error.code === "NOT_FOUND" ? "INVALID_LINK" : "RECOVERY_REQUIRED");
      return;
    }
    setPayout(onchain);
    let chainTimestamp: bigint | undefined;
    if (onchain.status === payoutStatus.FUNDED) {
      try {
        chainTimestamp = await readChainTimestamp(publicClient as any);
      } catch {
        // A funded payout cannot be treated as claimable without authoritative
        // chain time. Keep all auth and claim actions hidden until it is known.
        commitBootStage("CHECKING");
        return;
      }
    }

    const lifecycle = resolvePayoutLifecycle({ authoritativePayout: onchain, chainTimestamp });
    if (lifecycle.financialState === "NONE") { commitBootStage("INVALID_LINK"); return; }

    if (lifecycle.financialState === "CLAIMED") {
      clearCapability(parsedId);
    }
    if (lifecycle.financialState === "CLAIMED" || lifecycle.financialState === "RECLAIMED") {
      if (protectedFlowStateRef.current.canCommitBoot(bootSnapshot)) applyState(onchain, recoverPending(parsedId), chainTimestamp);
      return;
    }

    if (lifecycle.financialState === "EXPIRED_FUNDED") {
      commitBootStage("EXPIRED");
      return;
    }

    if (currentProtectedShare) {
      // Protected metadata is supplemental display data. Fetch it only after
      // authoritative lifecycle routing so terminal claimed/reclaimed links
      // never request recipient-channel metadata.
      void fetch(`/api/protected/${parsedId}`, { cache: "no-store", credentials: "include", signal: AbortSignal.timeout(3_000) })
        .then(async protectedResponse => {
          if (protectedResponse.ok) setProtectedMetadata(await protectedResponse.json() as ProtectedMetadata);
        })
        .catch(() => {
          // The authoritative payout path remains the source of lifecycle truth.
        });
      commitBootStage("PROTECTED_VERIFY");
      return;
    }

    if (currentCapability) {
      const derived = privateKeyToAccount(currentCapability.privateKey).address.toLowerCase();
      if (derived !== onchain.claimSigner.toLowerCase()) {
        commitBootStage("INVALID_LINK");
        return;
      }
    } else if (lifecycle.vaultStatus === payoutStatus.FUNDED) {
      commitBootStage("MISSING_CREDENTIAL");
      return;
    }

    const pending = recoverPending(parsedId);
    if (protectedFlowStateRef.current.canCommitBoot(bootSnapshot)) applyState(onchain, pending, chainTimestamp, Boolean(currentCapability));
  }, [applyState, publicClient, readAuthoritativePayout]);

  useEffect(() => {
    void boot();
  }, [boot]);

  const claim = useCallback(async () => {
    const activeCapability = capability ?? (protectedPrivateKey.current ? { raw: "", privateKey: protectedPrivateKey.current } : null);
    if (busy.current || !id || !activeCapability || !payout) return;
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

      const current = await readAuthoritativePayout(id);
      if (!current) throw new Error("payout unavailable");
      const terminal = resolvePayoutLifecycle({ authoritativePayout: current });
      if (terminal.financialState === "CLAIMED" || terminal.financialState === "RECLAIMED") { setPayout(current); applyState(current, { recipient }); return; }
      const chainTimestamp = await readChainTimestamp(publicClient as any);
      const lifecycle = resolvePayoutLifecycle({ authoritativePayout: current, chainTimestamp, capabilityPresent: true });
      if (!lifecycle.allowedActions.includes("CLAIM")) { setPayout(current); applyState(current, { recipient }, chainTimestamp); return; }
      setPayout(current);

      const signature = await privateKeyToAccount(activeCapability.privateKey).signTypedData({
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
      const operationId = `claim:${id}`;
      upsertOperation({
        operationType: "CLAIM",
        operationId,
        payoutIds: [id],
        expectedRecipient: recipient,
        expectedAmount: current.amount,
        expectedExpiry: current.expiresAt,
        expectedClaimSigner: current.claimSigner,
        createdAt: new Date().toISOString(),
        submissionBoundaryReached: false,
        state: "PREPARED",
      });

      const result = await submitClaimAndReconcile({
        operation: { operationType: "CLAIM", operationId, payoutIds: [id], expectedRecipient: recipient, expectedAmount: current.amount, expectedExpiry: current.expiresAt, expectedClaimSigner: current.claimSigner, createdAt: new Date().toISOString(), submissionBoundaryReached: false, state: "PREPARED" },
        submit: () => sendTransactionAsync({ chainId: TEMPO_MODERATO_CHAIN_ID, calls: [{ to: vaultAddress, data, value: 0n }] }),
        readAuthoritativeState: () => readAuthoritativePayout(id),
        waitForReceipt: publicClient ? async hash => {
          const receipt = await (publicClient as any).waitForTransactionReceipt({ hash });
          return { status: receipt?.status === "success" ? "success" as const : "reverted" as const };
        } : undefined,
        persist: update => {
          updateOperation(operationId, update);
          if (update.transactionHash) { setTxHash(update.transactionHash); rememberPending(id, { recipient: recipient!, txHash: update.transactionHash }); }
        },
        onState: (state) => {
          if (state === "HASH_RECEIVED" || state === "CONFIRMING") setStage("AWAITING_CONFIRMATION");
          if (state === "RECOVERING") setStage("RECOVERY_REQUIRED");
        },
        messages: { uncertain: "We couldn't confirm whether your claim completed. Check status before trying again." },
      });

      if (result.authoritative) setPayout(result.authoritative);
      const hash = result.transactionHash;
      if (hash) { setTxHash(hash); rememberPending(id, { recipient, txHash: hash }); }
      if (result.outcome === "CONFIRMED" && result.authoritative) {
        clearCapability(id);
        applyState(result.authoritative, { recipient, ...(hash ? { txHash: hash } : {}) });
      } else if (resolvePayoutLifecycle({ authoritativePayout: result.authoritative }).financialState === "RECLAIMED") {
        setStage("RECLAIMED");
      } else if (result.outcome === "FAILED") {
        setStage("REVERTED");
      } else if (result.outcome === "FAILED_BEFORE_SUBMISSION") {
        setRetryable(true);
        setStage("FAILED_RETRYABLE");
      } else {
        setStage("RECOVERY_REQUIRED");
      }
    } catch (err: any) {
      // Provider text is not receipt or vault evidence.
      setStage("RECOVERY_REQUIRED");
    } finally {
      busy.current = false;
      protectedPrivateKey.current = null;
    }
  }, [applyState, capability, connectAsync, connectedAddress, connectors, id, payout, publicClient, readAuthoritativePayout, sendTransactionAsync]);

  const connectRecipient = useCallback(async (method: ProtectedRecipientConnectionMethod): Promise<string | undefined> => {
    const connector = connectors[0];
    if (!connector) return undefined;
    const connection = await withTimeout(connectAsync({
      connector,
      ...(method === "register" ? { capabilities: { method: "register" as const, name: "Reach recipient" } } : {}),
    }));
    const address = connection.accounts?.[0];
    return typeof address === "string" && isAddress(address) ? address : undefined;
  }, [connectAsync, connectors]);

  const startProtectedVerification = useCallback(async () => {
    if (busy.current || !id || !payout || !protectedShareA) return;

    const flowState = protectedFlowStateRef.current;
    const activeOtpFlow = flowState.otpFlow(id);
    if (activeOtpFlow) {
      if (!connectedAddress || !sameProtectedAddress(activeOtpFlow.address, connectedAddress)) {
        setProtectedError(PROTECTED_SESSION_ADDRESS_MISMATCH);
        setStage("PROTECTED_VERIFY");
        return;
      }
      setProtectedError(null);
      setProtectedFlow(activeOtpFlow);
      setStage("PROTECTED_OTP");
      return;
    }

    const existingAttempt = flowState.beginAttempt(id);
    if (existingAttempt && (!connectedAddress || !sameProtectedAddress(existingAttempt.address, connectedAddress))) {
      setProtectedError(PROTECTED_SESSION_ADDRESS_MISMATCH);
      setStage("PROTECTED_VERIFY");
      return;
    }
    if (flowState.phase === "BEGINNING") return;
    if (!existingAttempt && !flowState.start(id, connectedAddress)) return;

    busy.current = true;
    setProtectedError(null);
    setProtectedDeliveryRetry(false);
    try {
      const current = await readAuthoritativePayout(id);
      let attempt: ProtectedBeginAttempt | null = existingAttempt;
      if (!attempt) {
        const { response: beginResponse, address } = await beginProtectedRecipientVerification({
          initialAddress: connectedAddress,
          connect: connectRecipient,
          disconnect: disconnectAsync,
          begin: () => fetch("/api/protected/begin", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ payoutId: id }),
          }),
          onRegistrationStarted: () => setStage("CREATING_ACCOUNT"),
          onReauthenticationRequired: () => {
            setProtectedError(PROTECTED_REAUTH_REQUIRED);
            setStage("REAUTHENTICATING");
          },
          onAuthenticationStarted: () => setStage("REAUTHENTICATING"),
          onAuthenticationRestored: () => setProtectedError(null),
        });
        const beginBody = await beginResponse.json().catch(() => ({})) as { flowId?: unknown; challenge?: unknown; error?: unknown };
        if (!beginResponse.ok || typeof beginBody.flowId !== "string" || typeof beginBody.challenge !== "string") throw new Error(typeof beginBody.error === "string" ? beginBody.error : "Protected verification is unavailable.");
        attempt = { payoutId: id, flowId: beginBody.flowId, challenge: beginBody.challenge, address };
        flowState.recordBegin(attempt);
      }

      const proof = await signProtectedChallenge(protectedShareA, attempt.challenge);
      const proofResponse = await fetch("/api/protected/prove-link", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payoutId: id, flowId: attempt.flowId, proof }),
      });
      const proofBody = await proofResponse.json().catch(() => ({})) as { maskedRecipient?: unknown; expiresAt?: unknown; resendAvailableAt?: unknown; flowId?: unknown; retryable?: unknown; error?: unknown };
      if (!proofResponse.ok || typeof proofBody.expiresAt !== "number") {
        if (proofResponse.status === 503 && proofBody.retryable === true && proofBody.flowId === attempt.flowId && typeof proofBody.expiresAt === "number") {
          const retryFlow: ProtectedFlowView = {
            payoutId: id,
            flowId: attempt.flowId,
            expiresAt: proofBody.expiresAt,
            resendAvailableAt: typeof proofBody.resendAvailableAt === "number" ? proofBody.resendAvailableAt : 0,
            address: attempt.address,
          };
          flowState.recordCodeSent(retryFlow);
          setPayout(current);
          setProtectedFlow(retryFlow);
          setProtectedDeliveryRetry(true);
          setProtectedError("We couldn't send the verification email right now. Try sending the code again.");
          setStage("PROTECTED_OTP");
          return;
        }
        throw new Error(typeof proofBody.error === "string" ? proofBody.error : "This claim link could not be verified.");
      }
      const nextFlow: ProtectedFlowView = {
        payoutId: id,
        flowId: attempt.flowId,
        expiresAt: proofBody.expiresAt,
        resendAvailableAt: typeof proofBody.resendAvailableAt === "number" ? proofBody.resendAvailableAt : Date.now(),
        address: attempt.address,
      };
      flowState.recordCodeSent(nextFlow);
      setPayout(current);
      setProtectedFlow(nextFlow);
      setProtectedDeliveryRetry(false);
      setStage("PROTECTED_OTP");
    } catch (error) {
      setProtectedError(error instanceof Error ? error.message : "Protected verification is unavailable.");
      setStage("PROTECTED_VERIFY");
      flowState.abortBeginning();
    } finally {
      busy.current = false;
    }
  }, [connectedAddress, connectRecipient, disconnectAsync, id, payout, protectedShareA, readAuthoritativePayout, signProtectedChallenge]);

  const resendProtectedCode = useCallback(async () => {
    if (busy.current || !id || !protectedFlow) return;
    busy.current = true;
    setProtectedError(null);
    try {
      const response = await fetch("/api/protected/resend", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payoutId: id, flowId: protectedFlow.flowId }),
      });
      const body = await response.json().catch(() => ({})) as { resendAvailableAt?: unknown; error?: unknown };
      if (!response.ok || typeof body.resendAvailableAt !== "number") throw new Error(typeof body.error === "string" ? body.error : "We couldn't send another code yet.");
      const updatedFlow = { ...protectedFlow, resendAvailableAt: body.resendAvailableAt };
      protectedFlowStateRef.current.updateOtpFlow(updatedFlow);
      setProtectedFlow(updatedFlow);
      setProtectedDeliveryRetry(false);
      setProtectedError(null);
    } catch (error) {
      setProtectedError(error instanceof Error ? error.message : "We couldn't send another code yet.");
      setProtectedDeliveryRetry(true);
    } finally {
      busy.current = false;
    }
  }, [id, protectedFlow]);

  const verifyProtectedCode = useCallback(async () => {
    if (busy.current || !id || !protectedFlow || !protectedShareA || !connectedAddress || !payout || !protectedCode) return;
    busy.current = true;
    setProtectedError(null);
    setStage("PROTECTED_RELEASING");
    try {
      const verifyResponse = await fetch("/api/protected/verify-code", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payoutId: id, flowId: protectedFlow.flowId, code: protectedCode }),
      });
      const verifyBody = await verifyResponse.json().catch(() => ({})) as { grantToken?: unknown; error?: unknown };
      if (!verifyResponse.ok || typeof verifyBody.grantToken !== "string") throw new Error(typeof verifyBody.error === "string" ? verifyBody.error : "The verification code is invalid or expired.");
      const releaseResponse = await fetch("/api/protected/release", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payoutId: id, grantToken: verifyBody.grantToken }),
      });
      const releaseBody = await releaseResponse.json().catch(() => ({})) as { shareB?: unknown; error?: unknown };
      if (!releaseResponse.ok || typeof releaseBody.shareB !== "string") throw new Error(typeof releaseBody.error === "string" ? releaseBody.error : "Protected verification could not be completed.");
      const privateKey = reconstructProtectedPrivateKey(protectedShareA, releaseBody.shareB as Hex);
      const derivedSigner = privateKeyToAccount(privateKey).address.toLowerCase();
      const current = await readAuthoritativePayout(id);
      if (derivedSigner !== current.claimSigner.toLowerCase()) {
        clearProtectedBytes(protectedShareA);
        setProtectedShareA(null);
        throw new Error("Protected claim verification failed closed.");
      }
      clearProtectedBytes(protectedShareA);
      setProtectedShareA(null);
      protectedFlowStateRef.current.clear();
      setProtectedFlow(null);
      setProtectedCode("");
      protectedPrivateKey.current = privateKey;
      busy.current = false;
      await claim();
    } catch (error) {
      setProtectedError(error instanceof Error ? error.message : "The verification code is invalid or expired.");
      setProtectedDeliveryRetry(false);
      setStage("PROTECTED_OTP");
      busy.current = false;
    }
  }, [claim, connectedAddress, id, payout, protectedCode, protectedFlow, protectedShareA, readAuthoritativePayout]);

  const checkStatusManually = useCallback(async () => {
    if (!id) return;
    setManualChecking(true);
    try {
      const refreshed = await readAuthoritativePayout(id);
      if (refreshed) {
        setPayout(refreshed);
        const pending = recoverPending(id);
        const chainTimestamp = resolvePayoutLifecycle({ authoritativePayout: refreshed }).vaultStatus === payoutStatus.FUNDED ? await readChainTimestamp(publicClient as any) : undefined;
        applyState(refreshed, pending, chainTimestamp, Boolean(capability));
      }
    } catch {
      setStage("RECOVERY_REQUIRED");
    } finally {
      setManualChecking(false);
    }
  }, [applyState, capability, id, publicClient, readAuthoritativePayout]);

  const executeTransfer = useCallback(async () => {
    if (!connectedAddress || !transferTo || !transferAmount) return;
    setTransferError(null);
    const cleanTo = transferTo.trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(cleanTo)) {
      setTransferError("Please enter a valid 0x recipient address.");
      return;
    }

    const parsedAmount = parsePathUsdAmount(transferAmount);
    if (!parsedAmount) {
      setTransferError("Please enter a valid amount.");
      return;
    }

    const currentBal = BigInt(recipientBalance ?? "0");
    if (parsedAmount > currentBal) {
      setTransferError(`Amount exceeds your balance of $${formatPathUsd(currentBal)} pathUSD.`);
      return;
    }

    setTransferSending(true);
    try {
      const data = encodeFunctionData({
        abi: pathUsdAbi,
        functionName: "transfer",
        args: [cleanTo as Address, parsedAmount],
      });

      const result = await sendTransactionAsync({
        chainId: TEMPO_MODERATO_CHAIN_ID,
        calls: [{ to: PATH_USD_ADDRESS, data, value: 0n }],
      });

      const hash = hashOf(result);
      if (hash) {
        setTransferTxHash(hash);
      }
      setTransferSuccess(true);
      void refreshRecipientBalance(connectedAddress);
    } catch (err: any) {
      setTransferError(err?.message || "Transfer failed. Please try again.");
    } finally {
      setTransferSending(false);
    }
  }, [connectedAddress, transferTo, transferAmount, recipientBalance, sendTransactionAsync, refreshRecipientBalance]);

  const copyRecipientAddr = useCallback((addr: string) => {
    void navigator.clipboard.writeText(addr);
    setCopiedAddr(true);
    setTimeout(() => setCopiedAddr(false), 2000);
  }, []);

  const amountDisplay = payout ? `$${formatPathUsd(BigInt(payout.amount))}` : "$0.00";
  const recipientAddr = stage === "CLAIMED" ? connectedAddress : undefined;

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

          {stage === "CHECKING" && (
            <div className="claim-state-box state-loading">
              <div className="signing-spinner" />
              <span>Checking payout expiry...</span>
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

          {(stage === "PROTECTED_VERIFY" || stage === "CREATING_ACCOUNT") && protectedShareA && (
            <div className="claim-ready-box">
              <div className="claim-info-line">
                <ShieldCheckIcon size={18} />
                <span>Protected claim. Verify access to {protectedMetadata?.maskedRecipient ?? "the recipient channel"} before claiming.</span>
              </div>
              {protectedError && <div className="error-banner" role="alert"><AlertCircleIcon size={16} /><span>{protectedError}</span></div>}
              <button type="button" className="btn-primary btn-large btn-full btn-claim-cta" onClick={() => void startProtectedVerification()} disabled={busy.current || stage === "CREATING_ACCOUNT"}>
                <ShieldCheckIcon size={20} />
                <span>{stage === "CREATING_ACCOUNT" ? "Setting up your account..." : "Verify it's you"}</span>
                <ArrowRightIcon size={18} />
              </button>
            </div>
          )}

          {stage === "PROTECTED_OTP" && (
            <div className="claim-ready-box">
              <div className="claim-info-line">
                <ShieldCheckIcon size={18} />
                <span>{protectedDeliveryRetry ? "The code was not sent. Try sending it again." : `A code was sent to ${protectedMetadata?.maskedRecipient ?? "your verified channel"}.`}</span>
              </div>
              {protectedError && <div className="error-banner" role="alert"><AlertCircleIcon size={16} /><span>{protectedError}</span></div>}
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                className="text-input"
                aria-label="Verification code"
                placeholder="Enter verification code"
                value={protectedCode}
                onChange={(event) => setProtectedCode(event.target.value.replace(/\D/g, "").slice(0, 10))}
              />
              <button type="button" className="btn-primary btn-large btn-full btn-claim-cta" onClick={() => void verifyProtectedCode()} disabled={!protectedCode || busy.current}>
                <PasskeyIcon size={20} />
                <span>Verify and claim</span>
                <ArrowRightIcon size={18} />
              </button>
              <button type="button" className="btn-text-action" onClick={() => void resendProtectedCode()} disabled={Date.now() < (protectedFlow?.resendAvailableAt ?? 0) || busy.current}>
                {Date.now() < (protectedFlow?.resendAvailableAt ?? 0) ? "Wait before resending" : protectedDeliveryRetry ? "Try sending the code again" : "Send a new code"}
              </button>
            </div>
          )}

          {stage === "PROTECTED_RELEASING" && (
            <div className="claim-state-box state-processing">
              <div className="signing-spinner" />
              <span>Verifying your recipient access and preparing the claim...</span>
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

          {stage === "REAUTHENTICATING" && (
            <div className="claim-state-box state-processing">
              <PasskeyIcon size={24} className="passkey-active-icon" />
              <div>
                {protectedError && <div className="error-banner" role="alert"><AlertCircleIcon size={16} /><span>{protectedError}</span></div>}
                <strong>Sign in again to continue.</strong>
                <p>Approve the passkey prompt on your device to continue securely.</p>
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

          {stage === "RECOVERY_REQUIRED" && (
            <div className="claim-retry-box">
              <div className="claim-state-box state-warning">
                <ClockIcon size={24} />
                <div>
                  <strong>Claim submitted</strong>
                  <p>Confirmation is taking longer than expected. Your transaction may have already completed.</p>
                </div>
              </div>
              {txHash && (
                <a
                  href={`https://moderato.tempo.xyz/tx/${txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-secondary btn-full"
                  style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                >
                  <span>View transaction on explorer</span>
                  <ExternalLinkIcon size={14} />
                </a>
              )}
              <button
                type="button"
                className="btn-primary btn-large btn-full"
                onClick={() => void checkStatusManually()}
                disabled={manualChecking}
              >
                {manualChecking ? <div className="signing-spinner" /> : <RefreshIcon size={18} />}
                <span>Check onchain status</span>
              </button>
            </div>
          )}

          {stage === "ALREADY_CLAIMED" && (
            <div className="claim-state-box state-error">
              <AlertCircleIcon size={24} />
              <div>
                <strong>Already claimed</strong>
                <p>This payout has already been claimed. No further action is available.</p>
              </div>
            </div>
          )}

          {stage === "CLAIMED" && (
            <div className="claim-success-box">
              <div className="success-icon-animated">
                <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
                  <circle cx="28" cy="28" r="26" stroke="var(--success)" strokeWidth="3" className="success-circle-stroke" />
                  <path d="M18 29l7 7 14-14" stroke="var(--success)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="success-check-stroke" />
                </svg>
              </div>
              <h2 className="success-title">You got it</h2>
              <p className="success-desc">The {amountDisplay} pathUSD is now in your account.</p>

              {/* Recipient Account Summary */}
              {recipientAddr && (
                <div className="recipient-account-card" style={{
                  background: "var(--bg-subtle)",
                  border: "1px solid var(--border-default)",
                  borderRadius: "var(--radius-lg)",
                  padding: "16px",
                  textAlign: "left",
                  width: "100%",
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                  marginTop: "8px"
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--ink-muted)" }}>Your Passkey Account</span>
                    <button
                      type="button"
                      className="btn-inline-copy"
                      onClick={() => copyRecipientAddr(recipientAddr)}
                      style={{ fontSize: "12px", color: "var(--primary)", display: "flex", alignItems: "center", gap: 4 }}
                    >
                      <CopyIcon size={12} />
                      <span>{copiedAddr ? "Copied" : "Copy"}</span>
                    </button>
                  </div>
                  <div style={{ fontSize: "13px", fontFamily: "monospace", color: "var(--ink-primary)", wordBreak: "break-all" }}>
                    {recipientAddr}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderTop: "1px solid var(--border-default)", paddingTop: "8px" }}>
                    <span style={{ fontSize: "12px", color: "var(--ink-muted)" }}>Available Balance</span>
                    <span style={{ fontSize: "15px", fontWeight: 700, color: "var(--ink-primary)" }}>
                      {balanceLoading ? "..." : recipientBalance ? `$${formatPathUsd(BigInt(recipientBalance))} pathUSD` : amountDisplay}
                    </span>
                  </div>
                </div>
              )}

              {/* Action Buttons: Done or Send onward */}
              {!showTransferForm && !transferSuccess && (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", width: "100%", marginTop: "12px" }}>
                  <button
                    type="button"
                    className="btn-primary btn-large btn-full"
                    onClick={() => (window.location.href = "/app/home")}
                  >
                    <span>View account</span>
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-full"
                    onClick={() => (window.location.href = "/app/send")}
                  >
                    <SendIcon size={18} />
                    <span>Send money</span>
                  </button>
                  <button
                    type="button"
                    className="btn-text-action"
                    onClick={() => setShowTransferForm(true)}
                  >
                    Send pathUSD onward here
                  </button>
                </div>
              )}

              {/* Onward Transfer Form */}
              {showTransferForm && !transferSuccess && (
                <div className="onward-transfer-box" style={{
                  width: "100%",
                  marginTop: "16px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                  textAlign: "left"
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--ink-primary)" }}>Send pathUSD</span>
                    <button
                      type="button"
                      className="btn-text-action"
                      onClick={() => {
                        setShowTransferForm(false);
                        setTransferError(null);
                      }}
                      style={{ fontSize: "12px" }}
                    >
                      Cancel
                    </button>
                  </div>

                  <div className="input-group">
                    <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--ink-muted)" }}>Recipient Address</label>
                    <input
                      type="text"
                      className="text-input"
                      placeholder="0x..."
                      value={transferTo}
                      onChange={(e) => setTransferTo(e.target.value)}
                      disabled={transferSending}
                    />
                  </div>

                  <div className="input-group">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <label style={{ fontSize: "12px", fontWeight: 600, color: "var(--ink-muted)" }}>Amount (pathUSD)</label>
                      {recipientBalance && (
                        <button
                          type="button"
                          className="btn-text-action"
                          style={{ fontSize: "11px" }}
                          onClick={() => setTransferAmount(formatPathUsd(BigInt(recipientBalance)))}
                        >
                          Max: ${formatPathUsd(BigInt(recipientBalance))}
                        </button>
                      )}
                    </div>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      className="text-input"
                      placeholder="0.00"
                      value={transferAmount}
                      onChange={(e) => setTransferAmount(e.target.value)}
                      disabled={transferSending}
                    />
                  </div>

                  {transferError && (
                    <div className="error-banner" style={{ fontSize: "12px", padding: "8px 12px", display: "flex", alignItems: "center", gap: 6 }}>
                      <AlertCircleIcon size={14} />
                      <span>{transferError}</span>
                    </div>
                  )}

                  <button
                    type="button"
                    className="btn-primary btn-large btn-full"
                    onClick={() => void executeTransfer()}
                    disabled={transferSending || !transferTo || !transferAmount}
                  >
                    {transferSending ? (
                      <>
                        <div className="signing-spinner" />
                        <span>Sending with passkey...</span>
                      </>
                    ) : (
                      <>
                        <PasskeyIcon size={18} />
                        <span>Transfer pathUSD</span>
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* Transfer Complete State */}
              {transferSuccess && (
                <div style={{ width: "100%", marginTop: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
                  <div className="claim-state-box state-ready" style={{ background: "var(--success-soft)", borderColor: "var(--success)" }}>
                    <CheckCircleIcon size={20} style={{ color: "var(--success)" }} />
                    <div style={{ textAlign: "left" }}>
                      <strong>Transfer complete</strong>
                      <p style={{ fontSize: "12px", color: "var(--ink-muted)" }}>
                        Sent {transferAmount} pathUSD to {transferTo.slice(0, 6)}...{transferTo.slice(-4)}
                      </p>
                    </div>
                  </div>
                  {transferTxHash && (
                    <a
                      href={`https://moderato.tempo.xyz/tx/${transferTxHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-secondary btn-full"
                      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                    >
                      <span>View transfer on explorer</span>
                      <ExternalLinkIcon size={14} />
                    </a>
                  )}
                  <button
                    type="button"
                    className="btn-primary btn-full"
                    onClick={() => (window.location.href = "/app/home")}
                  >
                    <span>View account</span>
                  </button>
                </div>
              )}

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
                        <span>Claim Transaction</span>
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

          {stage === "REVERTED" && (
            <div className="claim-retry-box">
              <div className="claim-state-box state-error">
                <AlertCircleIcon size={24} />
                <div>
                  <strong>Claim reverted onchain</strong>
                  <p>The contract rejected this claim. The funds may have already been claimed or reclaimed.</p>
                </div>
              </div>
              <button
                type="button"
                className="btn-secondary btn-large btn-full"
                onClick={() => void checkStatusManually()}
              >
                <span>Check status</span>
              </button>
            </div>
          )}

          {stage === "FAILED_RETRYABLE" && (
            <div className="claim-retry-box">
              <div className="claim-state-box state-error">
                <AlertCircleIcon size={24} />
                <div>
                  <strong>Claim could not complete</strong>
                  <p>Network connection failed or passkey prompt was cancelled. Nothing was changed.</p>
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
