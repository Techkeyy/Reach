// src/server/app.ts
import { Handler } from "accounts/server";
import { Hono } from "hono";
import { createPublicClient, http, isAddress as isAddress3, recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { tempoModerato } from "viem/chains";

// src/shared/reach.phase2.ts
import { keccak256, parseAbi, toHex } from "viem";
var TEMPO_MODERATO_CHAIN_ID = 42431;
var TEMPO_MODERATO_RPC_URL = "https://rpc.moderato.tempo.xyz";
var PATH_USD_ADDRESS = "0x20c0000000000000000000000000000000000000";
var vaultAbi = parseAbi([
  "function getPayout(uint256 payoutId) view returns (address sender, uint256 amount, uint64 expiresAt, address claimSigner, uint8 status, address claimant)",
  "function createPayout(uint256 payoutId, uint256 amount, address claimSigner, uint64 expiresAt)",
  "function claim(uint256 payoutId, address recipient, bytes claimAuthorizationSignature)",
  "function reclaim(uint256 payoutId)",
  "function totalFundedAmount() view returns (uint256)",
  "function hashClaimAuthorization(uint256 payoutId, address recipient) view returns (bytes32)"
]);
var pathUsdAbi = parseAbi(["function balanceOf(address account) view returns (uint256)", "function approve(address spender, uint256 amount) returns (bool)"]);
var CLAIM_ACTION = keccak256(toHex("ReachPayoutVault.claim"));
var CLAIM_AUTHORIZATION_VERSION = 1n;
var claimTypes = { Claim: [{ name: "payoutId", type: "uint256" }, { name: "recipient", type: "address" }, { name: "action", type: "bytes32" }, { name: "version", type: "uint256" }] };
var payoutStatus = { NONE: 0, FUNDED: 1, CLAIMED: 2, RECLAIMED: 3 };
function claimDomain(verifyingContract) {
  return { name: "Reach Payout Vault", version: "1", chainId: TEMPO_MODERATO_CHAIN_ID, verifyingContract };
}
function payoutFromContractResult(result) {
  if (Array.isArray(result)) {
    const [sender, amount, expiresAt, claimSigner, status, claimant] = result;
    return { sender, amount: BigInt(amount), expiresAt: BigInt(expiresAt), claimSigner, status: Number(status), claimant };
  }
  const value = result;
  return { sender: value.sender, amount: BigInt(value.amount), expiresAt: BigInt(value.expiresAt), claimSigner: value.claimSigner, status: Number(value.status), claimant: value.claimant };
}
function serializePayout(payout) {
  return { sender: payout.sender, amount: payout.amount.toString(), expiresAt: payout.expiresAt.toString(), claimSigner: payout.claimSigner, status: payout.status, claimant: payout.claimant };
}

// src/shared/reach.ts
var DEFAULT_VAULT_ADDRESS = "0x98262c02746f3b91342249159deeebe87a54266c";

// src/server/relayGuard.ts
import { decodeFunctionData, isAddress, toFunctionSelector } from "viem";
var CLAIM_SELECTOR = toFunctionSelector("claim(uint256,address,bytes)");
function record(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid relay request");
  return value;
}
function zeroValue(value) {
  if (value === void 0 || value === null || value === "0x" || value === "0x0" || value === 0 || value === 0n) return true;
  try {
    return BigInt(value) === 0n;
  } catch {
    return false;
  }
}
function chainId(value) {
  try {
    return Number(BigInt(value));
  } catch {
    return NaN;
  }
}
function parseClaimCall(request, vaultAddress) {
  const root = record(request);
  if (root.method !== "eth_fillTransaction") throw new Error("only transaction fills are sponsored");
  const params = Array.isArray(root.params) ? root.params : [];
  const tx = record(params[0]);
  if (chainId(tx.chainId) !== TEMPO_MODERATO_CHAIN_ID) throw new Error("wrong chain");
  if (typeof tx.from !== "string" || !isAddress(tx.from)) throw new Error("missing sender");
  if (!zeroValue(tx.value)) throw new Error("native value is not sponsored");
  if (tx.authorizationList) throw new Error("authorization lists are not sponsored");
  const calls = tx.calls;
  if (!Array.isArray(calls) || calls.length !== 1) throw new Error("only one claim call is sponsored");
  const call = record(calls[0]);
  if (typeof call.to !== "string" || !isAddress(call.to) || call.to.toLowerCase() !== vaultAddress.toLowerCase()) throw new Error("only the Reach vault is sponsored");
  if (!zeroValue(call.value)) throw new Error("claim call cannot send native value");
  if (typeof call.data !== "string" || !call.data.startsWith("0x") || call.data.slice(0, 10).toLowerCase() !== CLAIM_SELECTOR.toLowerCase()) throw new Error("only the Reach claim selector is sponsored");
  if (typeof tx.data === "string" && tx.data !== "0x") throw new Error("top-level data is not sponsored");
  const decoded = decodeFunctionData({ abi: vaultAbi, data: call.data });
  if (decoded.functionName !== "claim") throw new Error("only the Reach claim selector is sponsored");
  const [payoutId, recipient, claimAuthorizationSignature] = decoded.args;
  if (!isAddress(recipient) || recipient.toLowerCase() !== tx.from.toLowerCase()) throw new Error("claim recipient must be the transaction sender");
  if (!claimAuthorizationSignature || claimAuthorizationSignature === "0x") throw new Error("missing claim authorization");
  return { chainId: TEMPO_MODERATO_CHAIN_ID, from: tx.from, payoutId, recipient, claimAuthorizationSignature, data: call.data };
}

// src/server/payoutDiscovery.ts
import { decodeAbiParameters, isAddress as isAddress2, keccak256 as keccak2562, toHex as toHex2 } from "viem";
var PAYOUT_CREATED_SIGNATURE = "PayoutCreated(uint256 indexed payoutId,address indexed sender,uint256 amount,uint64 expiresAt,address claimSigner,bytes32 indexed memo)";
var PAYOUT_CREATED_TOPIC = keccak2562(toHex2("PayoutCreated(uint256,address,uint256,uint64,address,bytes32)"));
var INDEXED_TOPIC = /^0x[a-fA-F0-9]{64}$/;
var TRANSACTION_HASH = /^0x[a-fA-F0-9]{64}$/;
function rowValue(row, columns, name) {
  const index = columns.indexOf(name);
  return index >= 0 ? row[index] : void 0;
}
function addressFromTopic(value) {
  if (typeof value !== "string" || !INDEXED_TOPIC.test(value)) return null;
  const address = `0x${value.slice(-40)}`;
  return isAddress2(address) ? address : null;
}
function exactBlock(value) {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  return void 0;
}
function exactTransactionHash(value) {
  return typeof value === "string" && TRANSACTION_HASH.test(value) ? value : void 0;
}
function createdAt(value) {
  if (typeof value !== "string") return void 0;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? void 0 : new Date(timestamp).toISOString();
}
function parsePayoutCreatedRows(payload, requestedSender) {
  if (!payload || typeof payload !== "object") throw new Error("payout discovery response malformed");
  const value = payload;
  if (!Array.isArray(value.columns) || !value.columns.every((column) => typeof column === "string")) throw new Error("payout discovery columns missing");
  if (!Array.isArray(value.rows) || !value.rows.every((row) => Array.isArray(row))) throw new Error("payout discovery rows missing");
  const columns = value.columns;
  const expectedSender = requestedSender.toLowerCase();
  const payouts = [];
  for (const row of value.rows) {
    const selector = rowValue(row, columns, "selector");
    const payoutIdTopic = rowValue(row, columns, "topic1");
    const senderTopic = rowValue(row, columns, "topic2");
    const data = rowValue(row, columns, "data");
    if (selector !== PAYOUT_CREATED_TOPIC || typeof data !== "string" || !/^0x[0-9a-fA-F]*$/.test(data)) continue;
    if (!INDEXED_TOPIC.test(String(payoutIdTopic)) || !INDEXED_TOPIC.test(String(senderTopic))) continue;
    const eventSender = addressFromTopic(senderTopic);
    if (!eventSender || eventSender.toLowerCase() !== expectedSender) continue;
    const decoded = decodeAbiParameters([
      { type: "uint256" },
      { type: "uint64" },
      { type: "address" }
    ], data);
    const claimSigner = decoded[2];
    if (!isAddress2(claimSigner)) continue;
    payouts.push({
      id: BigInt(String(payoutIdTopic)).toString(),
      sender: requestedSender,
      amount: decoded[0].toString(),
      expiresAt: decoded[1].toString(),
      claimSigner,
      ...exactTransactionHash(rowValue(row, columns, "tx_hash")) ? { fundingTxHash: exactTransactionHash(rowValue(row, columns, "tx_hash")) } : {},
      ...createdAt(rowValue(row, columns, "block_timestamp")) ? { createdAt: createdAt(rowValue(row, columns, "block_timestamp")) } : {},
      ...exactBlock(rowValue(row, columns, "block_num")) ? { createdBlock: exactBlock(rowValue(row, columns, "block_num")) } : {}
    });
  }
  return payouts;
}
async function discoverPayoutsBySender(sender, options) {
  const url = new URL(options.indexerUrl);
  const sql = `SELECT block_num, block_timestamp, tx_hash, selector, topic1, topic2, data FROM PayoutCreated WHERE sender = '${sender.toLowerCase()}' ORDER BY block_num DESC LIMIT 1000`;
  url.searchParams.set("chainId", "42431");
  url.searchParams.set("signature", PAYOUT_CREATED_SIGNATURE);
  url.searchParams.set("sql", sql);
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(url, { headers: { accept: "application/json" }, signal: options.signal });
  if (!response.ok) throw new Error("payout discovery unavailable");
  return parsePayoutCreatedRows(await response.json(), sender);
}

// src/server/kvAdapter.ts
import { Kv } from "accounts/server";
function createKvStore() {
  const restUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const restToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!restUrl || !restToken) {
    return Kv.memory();
  }
  const cleanUrl = restUrl.replace(/\/$/, "");
  async function executeCommand(command) {
    const response = await fetch(cleanUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${restToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(command)
    });
    if (!response.ok) {
      throw new Error(`KV REST command failed: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    if (data.error) {
      throw new Error(`KV REST error: ${data.error}`);
    }
    return data.result;
  }
  const kvStore = {
    async get(key) {
      try {
        const raw = await executeCommand(["GET", key]);
        if (raw === null || raw === void 0) return void 0;
        try {
          return JSON.parse(raw);
        } catch {
          return raw;
        }
      } catch {
        return void 0;
      }
    },
    async set(key, value, options) {
      const serialized = typeof value === "string" ? value : JSON.stringify(value);
      if (options?.ttl) {
        await executeCommand(["SET", key, serialized, "EX", options.ttl]);
      } else {
        await executeCommand(["SET", key, serialized]);
      }
    },
    async delete(key) {
      await executeCommand(["DEL", key]);
    },
    async create(key, value, options) {
      const serialized = typeof value === "string" ? value : JSON.stringify(value);
      const args = ["SET", key, serialized, "NX"];
      if (options?.ttl) {
        args.push("EX", options.ttl);
      }
      const res = await executeCommand(args);
      return res === "OK";
    },
    async take(key) {
      const val = await kvStore.get(key);
      if (val !== void 0) {
        await kvStore.delete(key);
      }
      return val;
    }
  };
  return Kv.from(kvStore);
}

// src/server/app.ts
function createApp(options = {}) {
  const app2 = new Hono();
  const vaultAddress = process.env.REACH_VAULT_ADDRESS ?? DEFAULT_VAULT_ADDRESS;
  const rpcUrl = process.env.REACH_RPC_URL ?? TEMPO_MODERATO_RPC_URL;
  const indexerUrl = process.env.REACH_INDEXER_URL ?? "https://indexer.testnet.tempo.xyz/query";
  const publicClient = createPublicClient({ chain: tempoModerato, transport: http(rpcUrl) });
  const authKv = createKvStore();
  const feePayerKey = process.env.REACH_FEE_PAYER_PRIVATE_KEY;
  function originFor(request) {
    const configured = process.env.REACH_ORIGIN;
    const requestOrigin = request.headers.get("origin");
    if (configured) {
      if (requestOrigin && requestOrigin !== configured) throw new Error("origin is not allowed");
      return configured;
    }
    return requestOrigin ?? new URL(request.url).origin;
  }
  function strictPayoutId(value) {
    if (!/^[1-9][0-9]{0,77}$/.test(value)) throw new Error("invalid payout id");
    const parsed = BigInt(value);
    if (parsed <= 0n || parsed > (1n << 256n) - 1n) throw new Error("invalid payout id");
    return parsed;
  }
  async function readPayout(payoutId) {
    const result = await publicClient.readContract({
      address: vaultAddress,
      abi: vaultAbi,
      functionName: "getPayout",
      args: [payoutId]
    });
    return payoutFromContractResult(result);
  }
  async function discoverPublicPayouts(sender) {
    const discovered = await discoverPayoutsBySender(sender, { indexerUrl, signal: AbortSignal.timeout(1e4) });
    const entries = await Promise.all(
      discovered.map(async (event) => {
        const payout = await readPayout(BigInt(event.id));
        if (payout.sender.toLowerCase() !== sender.toLowerCase()) return null;
        return {
          id: event.id,
          ...serializePayout(payout),
          ...event.fundingTxHash ? { fundingTxHash: event.fundingTxHash } : {},
          ...event.createdAt ? { createdAt: event.createdAt } : {},
          ...event.createdBlock ? { createdBlock: event.createdBlock } : {}
        };
      })
    );
    return Array.from(new Map(entries.filter((entry) => Boolean(entry)).map((entry) => [entry.id, entry])).values());
  }
  async function validateClaimForSponsorship(request) {
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
        version: CLAIM_AUTHORIZATION_VERSION
      },
      signature: parsed.claimAuthorizationSignature
    }).catch(() => null);
    if (!recovered || recovered.toLowerCase() !== payout.claimSigner.toLowerCase()) throw new Error("claim authorization is not valid for this payout");
    await publicClient.simulateContract({
      address: vaultAddress,
      abi: vaultAbi,
      functionName: "claim",
      args: [parsed.payoutId, parsed.recipient, parsed.claimAuthorizationSignature],
      account: parsed.from
    });
  }
  const relayHandler = feePayerKey ? Handler.relay({
    chains: [tempoModerato],
    feePayer: {
      account: privateKeyToAccount(feePayerKey),
      name: "Reach claim sponsor",
      url: "https://reach.local/claim-sponsor"
    },
    onRequest: async (request) => {
      await validateClaimForSponsorship(request);
    },
    path: "/relay",
    transports: { [tempoModerato.id]: http(rpcUrl) }
  }) : null;
  app2.use("*", async (context, next) => {
    context.header("X-Content-Type-Options", "nosniff");
    context.header("Referrer-Policy", "no-referrer");
    context.header("X-Frame-Options", "DENY");
    context.header(
      "Content-Security-Policy",
      "default-src 'self'; connect-src 'self' https://rpc.moderato.tempo.xyz https://indexer.testnet.tempo.xyz http://127.0.0.1:8787; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'"
    );
    await next();
  });
  app2.get(
    "/health",
    (context) => context.json({
      ok: true,
      chainId: tempoModerato.id,
      sponsorConfigured: Boolean(relayHandler)
    })
  );
  app2.get("/api/payouts/:sender", async (context) => {
    const sender = context.req.param("sender");
    if (!isAddress3(sender)) return context.json({ error: "invalid address" }, 400);
    try {
      return context.json({ address: sender, payouts: await discoverPublicPayouts(sender) });
    } catch {
      return context.json({ error: "payout discovery unavailable" }, 503);
    }
  });
  app2.get("/api/payout/:payoutId", async (context) => {
    try {
      return context.json(serializePayout(await readPayout(strictPayoutId(context.req.param("payoutId")))));
    } catch {
      return context.json({ error: "payout unavailable" }, 404);
    }
  });
  app2.get("/api/balance/:address", async (context) => {
    const address = context.req.param("address");
    if (!isAddress3(address)) return context.json({ error: "invalid address" }, 400);
    try {
      const balance = await publicClient.readContract({
        address: PATH_USD_ADDRESS,
        abi: pathUsdAbi,
        functionName: "balanceOf",
        args: [address]
      });
      return context.json({ address, token: PATH_USD_ADDRESS, balance: balance.toString() });
    } catch {
      return context.json({ error: "balance unavailable" }, 503);
    }
  });
  app2.all("/auth/*", async (context) => {
    try {
      const origin = originFor(context.req.raw);
      return await Handler.webAuthn({
        kv: authKv,
        origin,
        path: "/auth",
        rpId: process.env.REACH_RP_ID ?? new URL(origin).hostname
      }).fetch(context.req.raw);
    } catch (err) {
      if (err?.message?.includes("origin")) {
        return context.json({ error: "Untrusted origin" }, 403);
      }
      return context.json({ error: "authentication unavailable" }, 503);
    }
  });
  app2.all("/relay/*", async (context) => {
    if (!relayHandler) return context.json({ error: "sponsorship is not configured" }, 503);
    try {
      return await relayHandler.fetch(context.req.raw);
    } catch {
      return context.json({ error: "sponsorship request rejected" }, 400);
    }
  });
  if (options.serveStaticFallback) {
    app2.get("*", async (context) => {
      try {
        const { readFile } = await import("node:fs/promises");
        return context.html(await readFile("dist/index.html", "utf8"));
      } catch {
        return context.text("Reach claim app is not built.", 404);
      }
    });
  }
  return app2;
}

// src/server/serverlessHandler.ts
var app = createApp({ serveStaticFallback: false });
async function handler(req, res) {
  try {
    const host = req.headers["x-forwarded-host"] || req.headers.host || "reach-seven-lemon.vercel.app";
    const proto = req.headers["x-forwarded-proto"] || "https";
    const url = new URL(req.url || "/", `${proto}://${host}`);
    let body = void 0;
    if (req.method !== "GET" && req.method !== "HEAD") {
      if (req.body !== void 0) {
        body = typeof req.body === "string" ? req.body : Buffer.isBuffer(req.body) ? new Uint8Array(req.body) : JSON.stringify(req.body);
      } else {
        const chunks = [];
        for await (const chunk of req) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        if (chunks.length > 0) {
          body = new Uint8Array(Buffer.concat(chunks));
        }
      }
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === void 0) continue;
      if (Array.isArray(value)) {
        for (const v of value) headers.append(key, v);
      } else {
        headers.set(key, value);
      }
    }
    const webReq = new Request(url.toString(), {
      method: req.method,
      headers,
      body,
      // @ts-ignore
      duplex: "half"
    });
    const webRes = await app.fetch(webReq);
    res.statusCode = webRes.status;
    webRes.headers.forEach((val, key) => {
      res.setHeader(key, val);
    });
    const arrayBuffer = await webRes.arrayBuffer();
    res.end(Buffer.from(arrayBuffer));
  } catch (err) {
    console.error("Vercel Serverless Function error:", err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: err?.message || "Internal server error" }));
    }
  }
}
export {
  handler as default
};
