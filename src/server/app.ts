import { Handler } from "accounts/server";
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
import { discoverPayoutsBySender } from "./payoutDiscovery.js";
import { createKvStore } from "./kvAdapter.js";

export type CreateAppOptions = {
  serveStaticFallback?: boolean;
};

export function createApp(options: CreateAppOptions = {}) {
  const app = new Hono();
  const vaultAddress = (process.env.REACH_VAULT_ADDRESS ?? DEFAULT_VAULT_ADDRESS) as Address;
  const rpcUrl = process.env.REACH_RPC_URL ?? TEMPO_MODERATO_RPC_URL;
  const indexerUrl = process.env.REACH_INDEXER_URL ?? "https://indexer.testnet.tempo.xyz/query";
  const publicClient = createPublicClient({ chain: tempoModerato, transport: http(rpcUrl) }) as any;
  const authKv = createKvStore();
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
    return payoutFromContractResult(result);
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

  app.get("/api/payout/:payoutId", async (context) => {
    try {
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

  app.all("/auth/*", async (context) => {
    try {
      const origin = originFor(context.req.raw);
      return await Handler.webAuthn({
        kv: authKv,
        origin,
        path: "/auth",
        rpId: process.env.REACH_RP_ID ?? new URL(origin).hostname,
      }).fetch(context.req.raw);
    } catch (err: any) {
      if (err?.message?.includes("origin")) {
        return context.json({ error: "Untrusted origin" }, 403);
      }
      return context.json({ error: "authentication unavailable" }, 503);
    }
  });

  app.all("/relay/*", async (context) => {
    if (!relayHandler) return context.json({ error: "sponsorship is not configured" }, 503);
    try {
      return await relayHandler.fetch(context.req.raw);
    } catch {
      return context.json({ error: "sponsorship request rejected" }, 400);
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
