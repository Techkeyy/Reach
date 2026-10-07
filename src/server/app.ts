import { Handler, type Kv } from "accounts/server";
import { Hono } from "hono";
import { createPublicClient, http, isAddress, recoverTypedDataAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { tempoModerato } from "viem/chains";
import {
  CLAIM_ACTION,
  CLAIM_AUTHORIZATION_VERSION,
  claimDomain,
  claimTypes,
  DEFAULT_VAULT_ADDRESS,
  payoutFromContractResult,
  payoutStatus,
  pathUsdAbi,
  PATH_USD_ADDRESS,
  serializePayout,
  TEMPO_MODERATO_RPC_URL,
  vaultAbi,
} from "../shared/reach.js";
import type { ConfirmedPayoutAccounting } from "../shared/transactionAccounting.js";
import { parseClaimCall } from "./relayGuard.js";
import { discoverPayoutsByClaimant, discoverPayoutsBySender, discoverReclaimedPayoutsBySender } from "./payoutDiscovery.js";
import { recoverConfirmedTransactionAccounting } from "./transactionAccounting.js";
import { createKvStore } from "./kvAdapter.js";
import { createTestnetFunding, FundingError } from "./testnetFunding.js";
import { authStageForPath, classifyAuthFailure, createAuthReference } from "./authDiagnostics.js";
import { AUTH_CHALLENGE_TTL_SECONDS } from "./authConfig.js";
import { deriveTempoAccountAddress } from "../shared/identity.js";
import { createGmailApiEmailProvider, createProtectedClaimService, createTwilioVerifyProvider, ProtectedProviderDeliveryError, type GmailApiEmailProvider, type ProtectedClaimPayout } from "./protectedClaims.js";
import { createTempoRpcReadCoordinator, DEFAULT_RPC_READ_CONCURRENCY, mapWithConcurrency, RpcAuthorityUnavailableError, type TempoRpcReadCoordinator } from "./rpcCoordinator.js";

export type CreateAppOptions = {
  serveStaticFallback?: boolean;
  /** Test-only injection point; production uses the configured durable KV store. */
  authKv?: Kv.Kv;
  /** Test-only session authority; production always resolves the Accounts WebAuthn session. */
  protectedSession?: (request: Request) => Promise<{ address: Address } | undefined>;
  /** Test-only Gmail transport injection; production constructs the server-only provider. */
  emailProvider?: GmailApiEmailProvider | null;
  /** Test-only read coordinator injection; production owns one coordinator per app process. */
  rpcCoordinator?: TempoRpcReadCoordinator;
};

export function createApp(options: CreateAppOptions = {}) {
  const app = new Hono();
  const vaultAddress = (process.env.REACH_VAULT_ADDRESS ?? DEFAULT_VAULT_ADDRESS) as Address;
  const rpcUrl = process.env.REACH_RPC_URL ?? TEMPO_MODERATO_RPC_URL;
  const indexerUrl = process.env.REACH_INDEXER_URL ?? "https://indexer.testnet.tempo.xyz/query";
  // Viem retries are disabled here. The coordinator owns the single bounded
  // retry policy so application retries cannot multiply transport retries.
  const rpcTransport = http(rpcUrl, { retryCount: 0, retryDelay: 0, timeout: 10_000 });
  const publicClient = createPublicClient({ chain: tempoModerato, transport: rpcTransport }) as any;
  const rpcCoordinator = options.rpcCoordinator ?? createTempoRpcReadCoordinator({
    logger: (event, fields) => console.info(JSON.stringify({ event, ...fields })),
  });
  const { kv: configuredAuthKv, storageType } = createKvStore();
  const authKv = options.authKv ?? configuredAuthKv;
  const testnetFunding = createTestnetFunding(authKv);
  const feePayerKey = process.env.REACH_FEE_PAYER_PRIVATE_KEY as Hex | undefined;
  const emailProvider = options.emailProvider !== undefined ? options.emailProvider : createGmailApiEmailProvider();
  const protectedClaims = createProtectedClaimService({
    kv: authKv,
    providers: {
      SMS: createTwilioVerifyProvider(),
      EMAIL: emailProvider,
    },
  });
  const webAuthnHandlers = new Map<string, ReturnType<typeof Handler.webAuthn>>();

  function originFor(request: Request) {
    const configured = process.env.REACH_ORIGIN;
    const requestOrigin = request.headers.get("origin");
    if (configured) {
      if (requestOrigin && requestOrigin !== configured) throw new Error("origin is not allowed");
      return configured;
    }
    return requestOrigin ?? new URL(request.url).origin;
  }

  function webAuthnHandlerFor(request: Request) {
    const origin = originFor(request);
    const rpId = process.env.REACH_RP_ID ?? new URL(origin).hostname;
    const cacheKey = `${origin}|${rpId}`;
    let handler = webAuthnHandlers.get(cacheKey);
    if (!handler) {
      handler = Handler.webAuthn({
        kv: authKv,
        origin,
        path: "/auth",
        rpId,
        ttl: { challenge: AUTH_CHALLENGE_TTL_SECONDS },
      });
      webAuthnHandlers.set(cacheKey, handler);
    }
    return handler;
  }

  async function authenticatedProtectedSession(request: Request) {
    const session = await webAuthnHandlerFor(request).getSession(request as any);
    if (!session) return undefined;
    const origin = originFor(request);
    const address = deriveTempoAccountAddress({
      id: session.credentialId,
      publicKey: session.publicKey as Hex,
      rpId: process.env.REACH_RP_ID ?? new URL(origin).hostname,
    });
    return { address };
  }

  const protectedSession = options.protectedSession ?? authenticatedProtectedSession;

  function protectedPayout(payout: ReturnType<typeof payoutFromContractResult>): ProtectedClaimPayout {
    return { status: payout.status, amount: payout.amount, expiresAt: payout.expiresAt, claimSigner: payout.claimSigner };
  }

  async function protectedJsonBody(context: any): Promise<Record<string, unknown>> {
    if (!context.req.header("content-type")?.startsWith("application/json")) throw new Error("JSON required");
    const body = await context.req.text();
    if (body.length > 8192) throw new Error("Request too large");
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid request");
    return parsed as Record<string, unknown>;
  }

  async function withAuthDiagnostics(request: Request, handler: () => Promise<Response>): Promise<Response> {
    const reference = createAuthReference();
    const pathname = new URL(request.url).pathname;
    let response: Response;
    try {
      response = await handler();
    } catch {
      response = Response.json({ error: "authentication unavailable" }, { status: 503 });
    }

    const errorBody = response.ok
      ? undefined
      : await response.clone().json().catch(() => ({})) as { error?: unknown };
    const errorClass = response.ok ? "NONE" : classifyAuthFailure(errorBody?.error);
    response.headers.set("X-Reach-Auth-Ref", reference);
    console.info(JSON.stringify({
      event: "REACH_AUTH",
      reference,
      stage: authStageForPath(pathname),
      method: request.method,
      path: pathname,
      status: response.status,
      outcome: response.ok ? "SUCCEEDED" : "FAILED",
      errorClass,
    }));
    return response;
  }

  function strictPayoutId(value: string) {
    if (!/^[1-9][0-9]{0,77}$/.test(value)) throw new Error("invalid payout id");
    const parsed = BigInt(value);
    if (parsed <= 0n || parsed > (1n << 256n) - 1n) throw new Error("invalid payout id");
    return parsed;
  }

  function readPayout(payoutId: bigint, essential = false) {
    const id = payoutId.toString();
    return rpcCoordinator.read(
      () => publicClient.readContract({
        address: vaultAddress,
        abi: vaultAbi,
        functionName: "getPayout",
        args: [payoutId],
      }),
      { key: `vault:getPayout:${vaultAddress.toLowerCase()}:${id}`, kind: "getPayout", essential },
    ).then((result) => payoutFromContractResult(result, payoutId));
  }

  function readLatestBlock(essential = false): Promise<{ timestamp: bigint | number | string }> {
    return rpcCoordinator.read(
      () => publicClient.getBlock({ blockTag: "latest" }),
      { key: "block:latest", kind: "latestBlock", essential, cacheTtlMs: essential ? 0 : 500 },
    ) as Promise<{ timestamp: bigint | number | string }>;
  }

  function readBalance(address: Address, token: Address = PATH_USD_ADDRESS, essential = false) {
    return rpcCoordinator.read(
      () => publicClient.readContract({
        address: token,
        abi: pathUsdAbi,
        functionName: "balanceOf",
        args: [address],
      }) as Promise<bigint>,
      { key: `token:balanceOf:${token.toLowerCase()}:${address.toLowerCase()}`, kind: "balanceOf", essential },
    );
  }

  function readTokenMetadata(address: Address, functionName: "decimals" | "symbol") {
    return rpcCoordinator.read(
      () => publicClient.readContract({
        address,
        abi: [{ type: "function", name: functionName, stateMutability: "view", inputs: [], outputs: [{ type: functionName === "decimals" ? "uint8" : "string" }] }],
        functionName,
      }),
      { key: `token:${functionName}:${address.toLowerCase()}`, kind: "tokenMetadata", cacheTtlMs: 86_400_000 },
    );
  }

  function readTransaction({ hash }: { hash: Hex }) {
    return rpcCoordinator.read(
      () => publicClient.getTransaction({ hash }),
      { key: `tx:${hash.toLowerCase()}`, kind: "transaction", cacheTtlMs: 60_000 },
    );
  }

  function readReceipt({ hash }: { hash: Hex }) {
    return rpcCoordinator.read(
      () => publicClient.getTransactionReceipt({ hash }),
      { key: `receipt:${hash.toLowerCase()}`, kind: "receipt", cacheTtlMs: 60_000 },
    );
  }

  function readChainId(): Promise<number> {
    return rpcCoordinator.read(
      () => publicClient.getChainId(),
      { key: "chainId", kind: "chainId", cacheTtlMs: 60_000 },
    ) as Promise<number>;
  }

  async function readPayoutWithAccounting(payoutId: bigint) {
    const payout = await readPayout(payoutId);
    const [fundingEvents, claimEvents, reclaimEvents] = await Promise.all([
      discoverPayoutsBySender(payout.sender, { indexerUrl, signal: AbortSignal.timeout(10_000) }).catch(() => []),
      payout.status === payoutStatus.CLAIMED && payout.claimant !== "0x0000000000000000000000000000000000000000"
        ? discoverPayoutsByClaimant(payout.claimant, { indexerUrl, signal: AbortSignal.timeout(10_000) }).catch(() => [])
        : Promise.resolve([]),
      payout.status === payoutStatus.RECLAIMED
        ? discoverReclaimedPayoutsBySender(payout.sender, { indexerUrl, signal: AbortSignal.timeout(10_000) }).catch(() => [])
        : Promise.resolve([]),
    ]);
    const fundingEvent = fundingEvents.find((event) => event.id === payoutId.toString()
      && event.sender.toLowerCase() === payout.sender.toLowerCase()
      && event.amount === payout.amount.toString()
      && event.expiresAt === payout.expiresAt.toString()
      && event.claimSigner.toLowerCase() === payout.claimSigner.toLowerCase());
    const claimEvent = claimEvents.find((event) => event.id === payoutId.toString()
      && event.recipient.toLowerCase() === payout.claimant.toLowerCase()
      && event.amount === payout.amount.toString());
    const reclaimEvent = reclaimEvents.find((event) => event.id === payoutId.toString()
      && event.sender.toLowerCase() === payout.sender.toLowerCase()
      && event.amount === payout.amount.toString());
    const protection = await protectedClaims.metadata(payoutId.toString()).catch(() => null);

    let accounting: ConfirmedPayoutAccounting | undefined;
    if (fundingEvent?.fundingTxHash) {
      const recovered = await recoverConfirmedTransactionAccounting({
        getChainId: readChainId,
        getTransaction: readTransaction,
        getTransactionReceipt: readReceipt,
        readContract: ({ address, functionName }) => readTokenMetadata(address, functionName),
      }, fundingEvent.fundingTxHash, {
        expectedSender: payout.sender,
      });
      if (recovered) {
        const feeAmount = BigInt(recovered.actualFeeAmount);
        const actualTotalDeducted = recovered.feeToken.toLowerCase() === PATH_USD_ADDRESS.toLowerCase()
          ? [{
              amount: (payout.amount + feeAmount).toString(),
              decimals: 6,
              symbol: "pathUSD",
              token: PATH_USD_ADDRESS,
            }]
          : [
              { amount: payout.amount.toString(), decimals: 6, symbol: "pathUSD", token: PATH_USD_ADDRESS },
              {
                amount: recovered.actualFeeAmount,
                decimals: recovered.feeTokenDecimals,
                ...(recovered.feeTokenSymbol ? { symbol: recovered.feeTokenSymbol } : {}),
                token: recovered.feeToken,
              },
            ];
        accounting = { ...recovered, actualTotalDeducted };
      }
    }

    return {
      id: payoutId.toString(),
      ...serializePayout(payout),
      ...(fundingEvent?.fundingTxHash ? { fundingTxHash: fundingEvent.fundingTxHash } : {}),
      ...(claimEvent?.claimTxHash ? { claimTxHash: claimEvent.claimTxHash } : {}),
      ...(reclaimEvent?.reclaimTxHash ? { reclaimTxHash: reclaimEvent.reclaimTxHash } : {}),
      ...(protection ? { protection } : {}),
      ...(fundingEvent?.createdAt ? { createdAt: fundingEvent.createdAt } : {}),
      ...(fundingEvent?.createdBlock ? { createdBlock: fundingEvent.createdBlock } : {}),
      accounting: accounting ?? null,
    };
  }

  async function discoverPublicPayouts(sender: Address) {
    const discovered = await discoverPayoutsBySender(sender, { indexerUrl, signal: AbortSignal.timeout(10_000) });
    // Indexer retries or event projections can repeat an ID. Deduplicate before
    // fanout so one payout receives one authoritative vault read per request.
    const uniqueDiscovered = [...new Map(discovered.map((event) => [event.id, event])).values()];
    const entries = await mapWithConcurrency(uniqueDiscovered, DEFAULT_RPC_READ_CONCURRENCY, async (event) => {
      const protection = await protectedClaims.metadata(event.id).catch(() => null);
      try {
        const payout = await readPayout(BigInt(event.id));
        if (payout.sender.toLowerCase() !== sender.toLowerCase()) throw new Error("payout sender mismatch");
        return {
          id: event.id,
          ...serializePayout(payout),
          ...(event.fundingTxHash ? { fundingTxHash: event.fundingTxHash } : {}),
          ...(event.createdAt ? { createdAt: event.createdAt } : {}),
          ...(event.createdBlock ? { createdBlock: event.createdBlock } : {}),
          ...(protection ? { protection } : {}),
        };
      } catch {
        rpcCoordinator.markUnresolved();
        // The event is retained as a display-only row. Indexer metadata never
        // becomes a lifecycle or financial authority substitute.
        return {
          id: event.id,
          sender,
          amount: event.amount,
          expiresAt: event.expiresAt,
          claimSigner: event.claimSigner,
          status: payoutStatus.NONE,
          claimant: "0x0000000000000000000000000000000000000000" as Address,
          authorityUnavailable: true as const,
          ...(event.fundingTxHash ? { fundingTxHash: event.fundingTxHash } : {}),
          ...(event.createdAt ? { createdAt: event.createdAt } : {}),
          ...(event.createdBlock ? { createdBlock: event.createdBlock } : {}),
          ...(protection ? { protection } : {}),
        };
      }
    });
    const payouts = Array.from(new Map(entries.map((entry) => [entry.id, entry])).values());
    return {
      payouts,
      authorityIncomplete: payouts.some((entry) => "authorityUnavailable" in entry && entry.authorityUnavailable === true),
      unresolvedCount: payouts.filter((entry) => "authorityUnavailable" in entry && entry.authorityUnavailable === true).length,
    };
  }

  async function discoverPublicActivity(address: Address) {
    const [sentResult, claimResult, latestResult] = await Promise.allSettled([
      discoverPayoutsBySender(address, { indexerUrl, signal: AbortSignal.timeout(10_000) }),
      discoverPayoutsByClaimant(address, { indexerUrl, signal: AbortSignal.timeout(10_000) }),
      readLatestBlock(),
    ]);
    const sentEvents = sentResult.status === "fulfilled" ? sentResult.value : [];
    const claimEvents = claimResult.status === "fulfilled" ? claimResult.value : [];
    let chainTimestamp: bigint | undefined;
    let chainAuthorityIncomplete = latestResult.status === "rejected";
    if (latestResult.status === "fulfilled") {
      try {
        const candidate = BigInt(latestResult.value.timestamp);
        if (candidate >= 0n && candidate < (1n << 64n)) chainTimestamp = candidate;
        else throw new Error("chain timestamp out of range");
      } catch {
        chainAuthorityIncomplete = true;
        rpcCoordinator.markUnresolved();
      }
    }
    if (sentResult.status === "rejected") rpcCoordinator.markUnresolved();
    if (claimResult.status === "rejected") rpcCoordinator.markUnresolved();
    if (latestResult.status === "rejected") rpcCoordinator.markUnresolved();

    const sentById = new Map(sentEvents.map((event) => [event.id, event]));
    const claimById = new Map(claimEvents.map((event) => [event.id, event]));
    const ids = new Set([...sentById.keys(), ...claimById.keys()]);
    const entries = await mapWithConcurrency([...ids], DEFAULT_RPC_READ_CONCURRENCY, async (id) => {
      const sentEvent = sentById.get(id);
      const claimEvent = claimById.get(id);
      const protection = await protectedClaims.metadata(id).catch(() => null);
      let payout: Awaited<ReturnType<typeof readPayout>> | undefined;
      try { payout = await readPayout(BigInt(id)); }
      catch { rpcCoordinator.markUnresolved(); }

      if (!payout) {
        const direction = sentEvent ? "SENT" as const : "RECEIVED" as const;
        return {
          payoutId: id,
          kind: "PAYOUT" as const,
          direction,
          lifecycle: "CHECKING" as const,
          sender: sentEvent?.sender ?? address,
          claimant: claimEvent?.recipient ?? "0x0000000000000000000000000000000000000000",
          amount: sentEvent?.amount ?? claimEvent?.amount ?? "0",
          expiresAt: sentEvent?.expiresAt ?? "0",
          claimSigner: sentEvent?.claimSigner,
          ...(sentEvent?.createdAt ? { createdAt: sentEvent.createdAt } : {}),
          ...(claimEvent?.claimedAt ? { claimedAt: claimEvent.claimedAt } : {}),
          ...(protection ? { protection } : {}),
          ...(sentEvent?.fundingTxHash ? { txHash: sentEvent.fundingTxHash } : claimEvent?.claimTxHash ? { txHash: claimEvent.claimTxHash } : {}),
          authorityUnavailable: true as const,
        };
      }

      const isSender = payout.sender.toLowerCase() === address.toLowerCase();
      const isClaimedRecipient = payout.status === payoutStatus.CLAIMED && payout.claimant.toLowerCase() === address.toLowerCase();
      if (!isSender && !isClaimedRecipient) return null;
      const direction = isSender ? "SENT" as const : "RECEIVED" as const;
      const lifecycle = payout.status === payoutStatus.FUNDED && chainTimestamp === undefined
        ? "CHECKING" as const
        : payout.status === payoutStatus.FUNDED && chainTimestamp! >= payout.expiresAt
          ? "EXPIRED_FUNDED" as const
          : payout.status === payoutStatus.FUNDED
            ? "FUNDED" as const
            : payout.status === payoutStatus.CLAIMED
              ? "CLAIMED" as const
              : payout.status === payoutStatus.RECLAIMED
                ? "RECLAIMED" as const
                : "NONE" as const;
      return {
        payoutId: id,
        kind: "PAYOUT" as const,
        direction,
        lifecycle,
        sender: payout.sender,
        claimant: payout.claimant,
        amount: payout.amount.toString(),
        expiresAt: payout.expiresAt.toString(),
        claimSigner: payout.claimSigner,
        ...(sentEvent?.createdAt ? { createdAt: sentEvent.createdAt } : {}),
        ...(claimEvent?.claimedAt ? { claimedAt: claimEvent.claimedAt } : {}),
        ...(protection ? { protection } : {}),
        ...((direction === "SENT" ? sentEvent?.fundingTxHash : claimEvent?.claimTxHash) ? { txHash: direction === "SENT" ? sentEvent?.fundingTxHash : claimEvent?.claimTxHash } : {}),
      };
    });
    const activities = [...new Map(entries.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)).map((entry) => [entry.payoutId, entry])).values()];
    return {
      activities,
      authorityIncomplete: sentResult.status === "rejected" || claimResult.status === "rejected" || chainAuthorityIncomplete || activities.some((entry) => "authorityUnavailable" in entry && entry.authorityUnavailable === true),
      unresolvedCount: activities.filter((entry) => "authorityUnavailable" in entry && entry.authorityUnavailable === true).length,
    };
  }

  async function validateClaimForSponsorship(request: unknown) {
    const parsed = parseClaimCall(request, vaultAddress);
    const payout = await readPayout(parsed.payoutId, true);
    if (payout.status !== payoutStatus.FUNDED) throw new Error("payout is not claimable");
    const latestBlock = await readLatestBlock(true);
    if (BigInt(latestBlock.timestamp) >= payout.expiresAt) throw new Error("payout has expired");
    const recovered = await recoverTypedDataAddress({
      domain: claimDomain(vaultAddress),
      types: claimTypes,
      primaryType: "Claim",
      message: {
        payoutId: parsed.payoutId,
        recipient: parsed.recipient,
        action: CLAIM_ACTION,
        version: CLAIM_AUTHORIZATION_VERSION,
      },
      signature: parsed.claimAuthorizationSignature,
    }).catch(() => null);
    if (!recovered || recovered.toLowerCase() !== payout.claimSigner.toLowerCase()) throw new Error("claim authorization is not valid for this payout");
    await rpcCoordinator.read(
      () => publicClient.simulateContract({
        address: vaultAddress,
        abi: vaultAbi,
        functionName: "claim",
        args: [parsed.payoutId, parsed.recipient, parsed.claimAuthorizationSignature],
        account: parsed.from,
      }),
      {
        key: `simulate:claim:${vaultAddress.toLowerCase()}:${parsed.payoutId.toString()}:${parsed.recipient.toLowerCase()}:${parsed.claimAuthorizationSignature.toLowerCase()}`,
        kind: "other",
        essential: true,
      },
    );
  }

  const relayHandler = feePayerKey
    ? Handler.relay({
        chains: [tempoModerato],
        feePayer: {
          account: privateKeyToAccount(feePayerKey),
          name: "Reach claim sponsor",
          url: "https://reach.local/claim-sponsor",
        },
        onRequest: async (request) => {
          await validateClaimForSponsorship(request);
        },
        path: "/relay",
        transports: { [tempoModerato.id]: http(rpcUrl, { retryCount: 0, retryDelay: 0, timeout: 10_000 }) },
      })
    : null;

  app.use("*", async (context, next) => {
    context.header("X-Content-Type-Options", "nosniff");
    context.header("Referrer-Policy", "no-referrer");
    context.header("X-Frame-Options", "DENY");
    context.header(
      "Content-Security-Policy",
      "default-src 'self'; connect-src 'self' https://rpc.moderato.tempo.xyz https://indexer.testnet.tempo.xyz http://127.0.0.1:8787; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'"
    );
    await next();
  });

  app.get("/health", (context) =>
    context.json({
      ok: true,
      chainId: tempoModerato.id,
      sponsorConfigured: Boolean(relayHandler),
      webAuthnStorage: storageType,
      protectedClaims: protectedClaims.availability(),
      rpcCoordinator: rpcCoordinator.metrics(),
    })
  );

  app.post("/api/internal/email-provider/verify", async (context) => {
    context.header("Cache-Control", "no-store");
    try {
      const session = await protectedSession(context.req.raw);
      if (!session) return context.json({ error: "authentication required" }, 401);
      const body = await context.req.raw.text();
      if (body.trim()) return context.json({ error: "empty request required" }, 400);
      const rateLimitKey = `internal:email-provider-verify:${session.address.toLowerCase()}`;
      const allowed = authKv.create ? await authKv.create(rateLimitKey, true, { ttl: 60 }) : false;
      if (!allowed) return context.json({ ok: false, provider: "gmail-api", category: "QUOTA_OR_RATE_LIMIT" }, 429);
    return context.json(await protectedClaims.verifyEmailProvider());
    } catch {
      return context.json({ ok: false, provider: "gmail-api", category: "UNKNOWN" }, 503);
    }
  });

  app.get("/api/payouts/:sender", async (context) => {
    const sender = context.req.param("sender");
    if (!isAddress(sender)) return context.json({ error: "invalid address" }, 400);
    try {
      const result = await discoverPublicPayouts(sender as Address);
      return context.json({ address: sender, ...result });
    } catch {
      return context.json({ error: "payout discovery unavailable" }, 503);
    }
  });

  app.get("/api/activity/:address", async (context) => {
    const address = context.req.param("address");
    if (!isAddress(address)) return context.json({ error: "invalid address" }, 400);
    try {
      context.header("Cache-Control", "no-store");
      return context.json({ address, ...(await discoverPublicActivity(address as Address)) });
    } catch {
      return context.json({ error: "activity discovery unavailable" }, 503);
    }
  });

  app.get("/api/payout/:payoutId", async (context) => {
    try {
      // Unlike discovery, this endpoint always performs a fresh normalized vault
      // read. Receipt accounting is optional and never changes lifecycle truth.
      context.header("Cache-Control", "no-store");
      return context.json(await readPayoutWithAccounting(strictPayoutId(context.req.param("payoutId"))));
    } catch (error) {
      if (/invalid payout id/i.test(error instanceof Error ? error.message : "")) return context.json({ error: "payout unavailable" }, 404);
      if (error instanceof RpcAuthorityUnavailableError) return context.json({ error: "payout authority unavailable" }, 503);
      return context.json({ error: "payout authority unavailable" }, 503);
    }
  });

  app.get("/api/balance/:address", async (context) => {
    const address = context.req.param("address");
    if (!isAddress(address)) return context.json({ error: "invalid address" }, 400);
    try {
      const balance = await readBalance(address as Address);
      return context.json({ address, token: PATH_USD_ADDRESS, balance: balance.toString() });
    } catch {
      return context.json({ error: "balance unavailable" }, 503);
    }
  });

  app.post("/api/testnet/fund", async (context) => {
    context.header("Cache-Control", "no-store");
    try {
      originFor(context.req.raw);
      const origin = context.req.header("origin");
      if (origin && origin !== (process.env.REACH_ORIGIN ?? new URL(context.req.url).origin)) return context.json({ error: "Untrusted origin" }, 403);
      if (!context.req.header("content-type")?.startsWith("application/json")) return context.json({ error: "JSON required" }, 400);
      const body = await context.req.text();
      if (body.length > 256) return context.json({ error: "Request too large" }, 400);
      let parsed: unknown;
      try { parsed = JSON.parse(body); } catch { return context.json({ error: "Invalid JSON" }, 400); }
      return context.json(await testnetFunding.request(parsed), 202);
    } catch (error) {
      if (error instanceof FundingError) {
        if (error.status === 429) context.header("Retry-After", "600");
        return context.json({ code: error.code, error: error.message }, error.status);
      }
      if (error instanceof Error && error.message === "origin is not allowed") return context.json({ error: "Untrusted origin" }, 403);
      return context.json({ error: "Test funding unavailable. Check your balance before requesting again." }, 503);
    }
  });
  app.get("/api/testnet/fund/:address", async (context) => {
    context.header("Cache-Control", "no-store");
    try { return context.json(await testnetFunding.status(context.req.param("address"))); }
    catch (error) {
      if (error instanceof FundingError) return context.json({ code: error.code, error: error.message }, error.status);
      return context.json({ error: "Funding status unavailable. Check your balance before requesting again." }, 503);
    }
  });

  // The Accounts handler consumes a registration challenge before its success
  // response reaches the browser. If that response is lost after the
  // credential was committed, the client may only have the original
  // registration payload left. Reconcile against the SDK's durable
  // credential record, without creating a Reach identity table, issuing a
  // session, or changing KV. The client must still complete a normal login
  // ceremony before considering setup recovered.
  app.post("/auth/register/reconcile", async (context) => {
    return withAuthDiagnostics(context.req.raw, async () => {
      try {
      context.header("Cache-Control", "no-store");
      originFor(context.req.raw);
      if (!context.req.header("content-type")?.startsWith("application/json")) {
        return context.json({ error: "JSON required" }, 400);
      }
      const body = await context.req.text();
      if (body.length > 2048) return context.json({ error: "Request too large" }, 400);

      let parsed: unknown;
      try { parsed = JSON.parse(body); } catch { return context.json({ error: "Invalid JSON" }, 400); }
      if (!parsed || typeof parsed !== "object") return context.json({ error: "Invalid credential record" }, 400);

      const { credentialId, publicKey } = parsed as { credentialId?: unknown; publicKey?: unknown };
      if (
        typeof credentialId !== "string" ||
        credentialId.length === 0 ||
        credentialId.length > 1024 ||
        typeof publicKey !== "string" ||
        !/^0x04[0-9a-f]{128}$/i.test(publicKey)
      ) {
        return context.json({ error: "Invalid credential record" }, 400);
      }

      // This is deliberately only the Accounts SDK credential authority. It
      // is not a Reach user/identity registry and it never returns the record.
      const stored = await authKv.get<{ publicKey?: unknown }>(`credential:${credentialId}`);
      if (typeof stored?.publicKey !== "string" || stored.publicKey.toLowerCase() !== publicKey.toLowerCase()) {
        return context.json({ status: "not_committed" }, 404);
      }

      return context.json({ status: "already_committed" });
      } catch (error) {
      if (error instanceof Error && error.message === "origin is not allowed") {
        return context.json({ error: "Untrusted origin" }, 403);
      }
      return context.json({ error: "authentication unavailable" }, 503);
      }
    });
  });

  app.all("/auth/*", async (context) => {
    return withAuthDiagnostics(context.req.raw, async () => {
      try {
        return await webAuthnHandlerFor(context.req.raw).fetch(context.req.raw);
      } catch (err: any) {
        if (err?.message?.includes("origin")) {
          return context.json({ error: "Untrusted origin" }, 403);
        }
        return context.json({ error: "authentication unavailable" }, 503);
      }
    });
  });

  app.get("/api/protected/:payoutId", async (context) => {
    context.header("Cache-Control", "no-store");
    try {
      const payoutId = strictPayoutId(context.req.param("payoutId")).toString();
      const payout = await readPayout(BigInt(payoutId));
      const metadata = await protectedClaims.metadata(payoutId);
      if (!metadata || payout.claimSigner.toLowerCase() !== (await protectedClaims.readRecord(payoutId))?.claimSigner.toLowerCase()) {
        return context.json({ error: "protected payout unavailable" }, 404);
      }
      return context.json(metadata);
    } catch {
      return context.json({ error: "protected payout unavailable" }, 404);
    }
  });

  app.post("/api/protected/register", async (context) => {
    context.header("Cache-Control", "no-store");
    try {
      const session = await protectedSession(context.req.raw);
      if (!session) throw new Error("authentication required");
      const body = await protectedJsonBody(context as any);
      const payoutId = strictPayoutId(String(body.payoutId ?? "")).toString();
      if (typeof body.sender !== "string" || !isAddress(body.sender) || body.sender.toLowerCase() !== session.address.toLowerCase()) return context.json({ error: "authenticated sender required" }, 401);
      if (typeof body.claimSigner !== "string" || !isAddress(body.claimSigner)) return context.json({ error: "invalid claim signer" }, 400);
      if (body.channel !== "EMAIL" && body.channel !== "SMS") return context.json({ error: "invalid verification channel" }, 400);
      if (typeof body.recipient !== "string" || typeof body.shareB !== "string" || typeof body.shareAProofAddress !== "string" || !isAddress(body.shareAProofAddress)) return context.json({ error: "invalid protected payout" }, 400);
      await protectedClaims.register({ payoutId, sender: session.address, claimSigner: body.claimSigner as Address, channel: body.channel, recipient: body.recipient, shareB: body.shareB, shareAProofAddress: body.shareAProofAddress as Address });
      return context.json({ ok: true }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : "protected registration unavailable";
      const status = /authentication required/i.test(message) ? 401 : /already registered/i.test(message) ? 409 : /not configured|unavailable/i.test(message) ? 503 : 400;
      return context.json({ error: status === 400 ? message : status === 409 ? "protected payout already registered" : status === 401 ? "authentication required" : "protected verification unavailable" }, status);
    }
  });

  app.post("/api/protected/begin", async (context) => {
    context.header("Cache-Control", "no-store");
    try {
      const session = await protectedSession(context.req.raw);
      if (!session) throw new Error("authentication required");
      const body = await protectedJsonBody(context as any);
      const payoutId = strictPayoutId(String(body.payoutId ?? "")).toString();
      const payout = await readPayout(BigInt(payoutId));
      return context.json(await protectedClaims.begin({ payoutId, payout: protectedPayout(payout), session }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "verification unavailable";
      const status = /authentication required/i.test(message) ? 401 : /not configured|unavailable/i.test(message) ? 503 : 400;
      return context.json({ error: status === 401 ? "authentication required" : status === 503 ? "protected verification unavailable" : message }, status);
    }
  });

  app.post("/api/protected/prove-link", async (context) => {
    context.header("Cache-Control", "no-store");
    try {
      const session = await protectedSession(context.req.raw);
      if (!session) throw new Error("authentication required");
      const body = await protectedJsonBody(context as any);
      const payoutId = strictPayoutId(String(body.payoutId ?? "")).toString();
      if (typeof body.flowId !== "string" || typeof body.proof !== "string" || !/^0x[0-9a-f]+$/i.test(body.proof)) return context.json({ error: "invalid verification proof" }, 400);
      return context.json(await protectedClaims.proveLink({ payoutId, flowId: body.flowId, session, proof: body.proof as Hex }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "verification unavailable";
      if (error instanceof ProtectedProviderDeliveryError) {
        const errorMessage = error.channel === "EMAIL"
          ? "We couldn't send the verification email right now. Try sending the code again."
          : "We couldn't send the verification code right now. Try again.";
        return context.json({ error: errorMessage, retryable: true, flowId: error.flowId, expiresAt: error.expiresAt, resendAvailableAt: 0 }, 503);
      }
      const status = /authentication required/i.test(message) ? 401 : /not configured|unavailable/i.test(message) ? 503 : 400;
      return context.json({ error: status === 401 ? "authentication required" : message === "verification email unavailable" ? "We couldn't send the verification email right now. Try again shortly." : status === 503 ? "protected verification unavailable" : "claim link verification failed" }, status);
    }
  });

  app.post("/api/protected/resend", async (context) => {
    context.header("Cache-Control", "no-store");
    try {
      const session = await protectedSession(context.req.raw);
      if (!session) throw new Error("authentication required");
      const body = await protectedJsonBody(context as any);
      const payoutId = strictPayoutId(String(body.payoutId ?? "")).toString();
      if (typeof body.flowId !== "string") return context.json({ error: "invalid verification flow" }, 400);
      return context.json(await protectedClaims.resend({ payoutId, flowId: body.flowId, session }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "verification unavailable";
      const status = /authentication required/i.test(message) ? 401 : /not configured|unavailable/i.test(message) ? 503 : 429;
      return context.json({ error: status === 401 ? "authentication required" : message === "verification email unavailable" ? "We couldn't send the verification email right now. Try again shortly." : status === 503 ? "protected verification unavailable" : "please wait before requesting another code" }, status);
    }
  });

  app.post("/api/protected/verify-code", async (context) => {
    context.header("Cache-Control", "no-store");
    try {
      const session = await protectedSession(context.req.raw);
      if (!session) throw new Error("authentication required");
      const body = await protectedJsonBody(context as any);
      const payoutId = strictPayoutId(String(body.payoutId ?? "")).toString();
      if (typeof body.flowId !== "string" || typeof body.code !== "string") return context.json({ error: "invalid verification code" }, 400);
      return context.json(await protectedClaims.verifyCode({ payoutId, flowId: body.flowId, session, code: body.code }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "verification unavailable";
      const status = /authentication required/i.test(message) ? 401 : /not configured|unavailable/i.test(message) ? 503 : 400;
      return context.json({ error: status === 401 ? "authentication required" : status === 503 ? "protected verification unavailable" : "verification code is invalid or expired" }, status);
    }
  });

  app.post("/api/protected/release", async (context) => {
    context.header("Cache-Control", "no-store");
    try {
      const session = await protectedSession(context.req.raw);
      if (!session) throw new Error("authentication required");
      const body = await protectedJsonBody(context as any);
      const payoutId = strictPayoutId(String(body.payoutId ?? "")).toString();
      const payout = await readPayout(BigInt(payoutId));
      if (typeof body.grantToken !== "string") return context.json({ error: "invalid verification grant" }, 400);
      return context.json(await protectedClaims.releaseShare({ payoutId, payout: protectedPayout(payout), grantToken: body.grantToken, session }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "verification unavailable";
      const status = /authentication required/i.test(message) ? 401 : /not configured|unavailable/i.test(message) ? 503 : 400;
      return context.json({ error: status === 401 ? "authentication required" : status === 503 ? "protected verification unavailable" : "verification grant expired" }, status);
    }
  });

  app.all("/relay*", async (context) => {
    if (!relayHandler) return context.json({ error: "sponsorship is not configured" }, 503);
    try {
      const res = await relayHandler.fetch(context.req.raw);
      return res;
    } catch (err: any) {
      return context.json({ error: err?.message || "sponsorship request rejected" }, 400);
    }
  });

  if (options.serveStaticFallback) {
    app.get("*", async (context) => {
      try {
        const { readFile } = await import("node:fs/promises");
        return context.html(await readFile("dist/index.html", "utf8"));
      } catch {
        return context.text("Reach claim app is not built.", 404);
      }
    });
  }

  return app;
}
