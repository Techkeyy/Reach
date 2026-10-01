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
import { parseClaimCall } from "./relayGuard.js";
import { discoverPayoutsByClaimant, discoverPayoutsBySender } from "./payoutDiscovery.js";
import { createKvStore } from "./kvAdapter.js";
import { createTestnetFunding, FundingError } from "./testnetFunding.js";
import { authStageForPath, classifyAuthFailure, createAuthReference } from "./authDiagnostics.js";
import { AUTH_CHALLENGE_TTL_SECONDS } from "./authConfig.js";

export type CreateAppOptions = {
  serveStaticFallback?: boolean;
  /** Test-only injection point; production uses the configured durable KV store. */
  authKv?: Kv.Kv;
};

export function createApp(options: CreateAppOptions = {}) {
  const app = new Hono();
  const vaultAddress = (process.env.REACH_VAULT_ADDRESS ?? DEFAULT_VAULT_ADDRESS) as Address;
  const rpcUrl = process.env.REACH_RPC_URL ?? TEMPO_MODERATO_RPC_URL;
  const indexerUrl = process.env.REACH_INDEXER_URL ?? "https://indexer.testnet.tempo.xyz/query";
  const publicClient = createPublicClient({ chain: tempoModerato, transport: http(rpcUrl) }) as any;
  const { kv: configuredAuthKv, storageType } = createKvStore();
  const authKv = options.authKv ?? configuredAuthKv;
  const testnetFunding = createTestnetFunding(authKv);
  const feePayerKey = process.env.REACH_FEE_PAYER_PRIVATE_KEY as Hex | undefined;

  function originFor(request: Request) {
    const configured = process.env.REACH_ORIGIN;
    const requestOrigin = request.headers.get("origin");
    if (configured) {
      if (requestOrigin && requestOrigin !== configured) throw new Error("origin is not allowed");
      return configured;
    }
    return requestOrigin ?? new URL(request.url).origin;
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

  async function readPayout(payoutId: bigint) {
    const result = await publicClient.readContract({
      address: vaultAddress,
      abi: vaultAbi,
      functionName: "getPayout",
      args: [payoutId],
    });
    return payoutFromContractResult(result, payoutId);
  }

  async function discoverPublicPayouts(sender: Address) {
    const discovered = await discoverPayoutsBySender(sender, { indexerUrl, signal: AbortSignal.timeout(10_000) });
    const entries = await Promise.all(
      discovered.map(async (event) => {
        const payout = await readPayout(BigInt(event.id));
        if (payout.sender.toLowerCase() !== sender.toLowerCase()) return null;
        return {
          id: event.id,
          ...serializePayout(payout),
          ...(event.fundingTxHash ? { fundingTxHash: event.fundingTxHash } : {}),
          ...(event.createdAt ? { createdAt: event.createdAt } : {}),
          ...(event.createdBlock ? { createdBlock: event.createdBlock } : {}),
        };
      })
    );
    return Array.from(new Map(entries.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)).map((entry) => [entry.id, entry])).values());
  }

  async function discoverPublicActivity(address: Address) {
    const [sentEvents, claimEvents, latestBlock] = await Promise.all([
      discoverPayoutsBySender(address, { indexerUrl, signal: AbortSignal.timeout(10_000) }),
      discoverPayoutsByClaimant(address, { indexerUrl, signal: AbortSignal.timeout(10_000) }),
      publicClient.getBlock({ blockTag: "latest" }),
    ]);
    const chainTimestamp = BigInt(latestBlock.timestamp);
    const sentById = new Map(sentEvents.map((event) => [event.id, event]));
    const claimById = new Map(claimEvents.map((event) => [event.id, event]));
    const ids = new Set([...sentById.keys(), ...claimById.keys()]);
    const entries = await Promise.all([...ids].map(async (id) => {
      const payout = await readPayout(BigInt(id));
      const sentEvent = sentById.get(id);
      const claimEvent = claimById.get(id);
      const isSender = payout.sender.toLowerCase() === address.toLowerCase();
      const isClaimedRecipient = payout.status === payoutStatus.CLAIMED && payout.claimant.toLowerCase() === address.toLowerCase();
      if (!isSender && !isClaimedRecipient) return null;
      const direction = isSender ? "SENT" as const : "RECEIVED" as const;
      const lifecycle = payout.status === payoutStatus.FUNDED && chainTimestamp >= payout.expiresAt
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
        direction,
        lifecycle,
        sender: payout.sender,
        claimant: payout.claimant,
        amount: payout.amount.toString(),
        expiresAt: payout.expiresAt.toString(),
        claimSigner: payout.claimSigner,
        ...(sentEvent?.createdAt ? { createdAt: sentEvent.createdAt } : {}),
        ...(claimEvent?.claimedAt ? { claimedAt: claimEvent.claimedAt } : {}),
        ...((direction === "SENT" ? sentEvent?.fundingTxHash : claimEvent?.claimTxHash) ? { txHash: direction === "SENT" ? sentEvent?.fundingTxHash : claimEvent?.claimTxHash } : {}),
      };
    }));
    return [...new Map(entries.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)).map((entry) => [entry.payoutId, entry])).values()];
  }

  async function validateClaimForSponsorship(request: unknown) {
    const parsed = parseClaimCall(request, vaultAddress);
    const payout = await readPayout(parsed.payoutId);
    if (payout.status !== payoutStatus.FUNDED) throw new Error("payout is not claimable");
    const latestBlock = await publicClient.getBlock({ blockTag: "latest" });
    if (latestBlock.timestamp >= payout.expiresAt) throw new Error("payout has expired");
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
    await publicClient.simulateContract({
      address: vaultAddress,
      abi: vaultAbi,
      functionName: "claim",
      args: [parsed.payoutId, parsed.recipient, parsed.claimAuthorizationSignature],
      account: parsed.from,
    });
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
        transports: { [tempoModerato.id]: http(rpcUrl) },
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
    })
  );

  app.get("/api/payouts/:sender", async (context) => {
    const sender = context.req.param("sender");
    if (!isAddress(sender)) return context.json({ error: "invalid address" }, 400);
    try {
      return context.json({ address: sender, payouts: await discoverPublicPayouts(sender as Address) });
    } catch {
      return context.json({ error: "payout discovery unavailable" }, 503);
    }
  });

  app.get("/api/activity/:address", async (context) => {
    const address = context.req.param("address");
    if (!isAddress(address)) return context.json({ error: "invalid address" }, 400);
    try {
      context.header("Cache-Control", "no-store");
      return context.json({ address, activities: await discoverPublicActivity(address as Address) });
    } catch {
      return context.json({ error: "activity discovery unavailable" }, 503);
    }
  });

  app.get("/api/payout/:payoutId", async (context) => {
    try {
      // Unlike discovery, this endpoint always performs a fresh normalized vault read.
      context.header("Cache-Control", "no-store");
      return context.json(serializePayout(await readPayout(strictPayoutId(context.req.param("payoutId")))));
    } catch {
      return context.json({ error: "payout unavailable" }, 404);
    }
  });

  app.get("/api/balance/:address", async (context) => {
    const address = context.req.param("address");
    if (!isAddress(address)) return context.json({ error: "invalid address" }, 400);
    try {
      const balance = await publicClient.readContract({
        address: PATH_USD_ADDRESS,
        abi: pathUsdAbi,
        functionName: "balanceOf",
        args: [address as Address],
      });
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
        const origin = originFor(context.req.raw);
        return await Handler.webAuthn({
          kv: authKv,
          origin,
          path: "/auth",
          rpId: process.env.REACH_RP_ID ?? new URL(origin).hostname,
          ttl: { challenge: AUTH_CHALLENGE_TTL_SECONDS },
        }).fetch(context.req.raw);
      } catch (err: any) {
        if (err?.message?.includes("origin")) {
          return context.json({ error: "Untrusted origin" }, 403);
        }
        return context.json({ error: "authentication unavailable" }, 503);
      }
    });
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
