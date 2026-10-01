// src/server/app.ts
import { Handler } from "accounts/server";
import { Hono } from "hono";
import { createPublicClient, http, isAddress as isAddress5, recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { tempoModerato } from "viem/chains";

// src/shared/reach.phase2.ts
import { isAddress, keccak256, parseAbi, toHex } from "viem";
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
var pathUsdAbi = parseAbi(["function balanceOf(address account) view returns (uint256)", "function approve(address spender, uint256 amount) returns (bool)", "function transfer(address to, uint256 amount) returns (bool)"]);
var CLAIM_ACTION = keccak256(toHex("ReachPayoutVault.claim"));
var CLAIM_AUTHORIZATION_VERSION = 1n;
var claimTypes = { Claim: [{ name: "payoutId", type: "uint256" }, { name: "recipient", type: "address" }, { name: "action", type: "bytes32" }, { name: "version", type: "uint256" }] };
var payoutStatus = { NONE: 0, FUNDED: 1, CLAIMED: 2, RECLAIMED: 3 };
function claimDomain(verifyingContract) {
  return { name: "Reach Payout Vault", version: "1", chainId: TEMPO_MODERATO_CHAIN_ID, verifyingContract };
}
var PayoutReadError = class extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.name = "PayoutReadError";
  }
  code;
};
function uint(value, bits) {
  if (typeof value !== "bigint" && !(typeof value === "number" && Number.isSafeInteger(value)) && !(typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value))) throw new PayoutReadError("DECODE_FAILURE");
  const parsed = BigInt(value);
  if (parsed < 0n || parsed >= 1n << BigInt(bits)) throw new PayoutReadError("DECODE_FAILURE");
  return parsed;
}
function parsePayoutId(value) {
  const id = uint(value, 256);
  if (id === 0n) throw new PayoutReadError("DECODE_FAILURE");
  return id;
}
function payoutFromContractResult(result, payoutId) {
  if (payoutId !== void 0) parsePayoutId(payoutId);
  if (!result || typeof result !== "object") throw new PayoutReadError("DECODE_FAILURE");
  const names = ["sender", "amount", "expiresAt", "claimSigner", "status", "claimant"];
  if (Array.isArray(result) && result.length !== names.length) throw new PayoutReadError("DECODE_FAILURE");
  const fields = Array.isArray(result) ? result : names.map((name) => Object.hasOwn(result, name) ? result[name] : void 0);
  if (fields.some((value) => value === void 0 || value === null)) throw new PayoutReadError("DECODE_FAILURE");
  const [sender, amount, expiresAt, claimSigner, status, claimant] = fields;
  for (const address of [sender, claimSigner, claimant]) {
    if (typeof address !== "string" || !isAddress(address, { strict: false })) throw new PayoutReadError("DECODE_FAILURE");
  }
  const decodedStatus = uint(status, 8);
  if (decodedStatus > 3n) throw new PayoutReadError("DECODE_FAILURE");
  const objectId = result.id;
  if (objectId !== void 0 && parsePayoutId(objectId) !== (payoutId === void 0 ? parsePayoutId(objectId) : parsePayoutId(payoutId))) throw new PayoutReadError("DECODE_FAILURE");
  return { sender, amount: uint(amount, 256), expiresAt: uint(expiresAt, 64), claimSigner, status: Number(decodedStatus), claimant };
}
function serializePayout(payout) {
  return { sender: payout.sender, amount: payout.amount.toString(), expiresAt: payout.expiresAt.toString(), claimSigner: payout.claimSigner, status: payout.status, claimant: payout.claimant };
}

// src/shared/reach.ts
var DEFAULT_VAULT_ADDRESS = "0x98262c02746f3b91342249159deeebe87a54266c";

// src/server/relayGuard.ts
import { decodeFunctionData, isAddress as isAddress2, toFunctionSelector } from "viem";
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
  if (typeof tx.from !== "string" || !isAddress2(tx.from)) throw new Error("missing sender");
  if (!zeroValue(tx.value)) throw new Error("native value is not sponsored");
  if (tx.authorizationList) throw new Error("authorization lists are not sponsored");
  const calls = tx.calls;
  if (!Array.isArray(calls) || calls.length !== 1) throw new Error("only one claim call is sponsored");
  const call = record(calls[0]);
  if (typeof call.to !== "string" || !isAddress2(call.to) || call.to.toLowerCase() !== vaultAddress.toLowerCase()) throw new Error("only the Reach vault is sponsored");
  if (!zeroValue(call.value)) throw new Error("claim call cannot send native value");
  if (typeof call.data !== "string" || !call.data.startsWith("0x") || call.data.slice(0, 10).toLowerCase() !== CLAIM_SELECTOR.toLowerCase()) throw new Error("only the Reach claim selector is sponsored");
  if (typeof tx.data === "string" && tx.data !== "0x") throw new Error("top-level data is not sponsored");
  const decoded = decodeFunctionData({ abi: vaultAbi, data: call.data });
  if (decoded.functionName !== "claim") throw new Error("only the Reach claim selector is sponsored");
  const [payoutId, recipient, claimAuthorizationSignature] = decoded.args;
  if (!isAddress2(recipient) || recipient.toLowerCase() !== tx.from.toLowerCase()) throw new Error("claim recipient must be the transaction sender");
  if (!claimAuthorizationSignature || claimAuthorizationSignature === "0x") throw new Error("missing claim authorization");
  return { chainId: TEMPO_MODERATO_CHAIN_ID, from: tx.from, payoutId, recipient, claimAuthorizationSignature, data: call.data };
}

// src/server/payoutDiscovery.ts
import { decodeAbiParameters, isAddress as isAddress3, keccak256 as keccak2562, toHex as toHex2 } from "viem";
var PAYOUT_CREATED_SIGNATURE = "PayoutCreated(uint256 indexed payoutId,address indexed sender,uint256 amount,uint64 expiresAt,address claimSigner,bytes32 indexed memo)";
var PAYOUT_CLAIMED_SIGNATURE = "PayoutClaimed(uint256 indexed payoutId,address indexed recipient,uint256 amount,bytes32 indexed memo)";
var PAYOUT_CREATED_TOPIC = keccak2562(toHex2("PayoutCreated(uint256,address,uint256,uint64,address,bytes32)"));
var PAYOUT_CLAIMED_TOPIC = keccak2562(toHex2("PayoutClaimed(uint256,address,uint256,bytes32)"));
var INDEXED_TOPIC = /^0x[a-fA-F0-9]{64}$/;
var TRANSACTION_HASH = /^0x[a-fA-F0-9]{64}$/;
function rowValue(row, columns, name) {
  const index = columns.indexOf(name);
  return index >= 0 ? row[index] : void 0;
}
function addressFromTopic(value) {
  if (typeof value !== "string" || !INDEXED_TOPIC.test(value)) return null;
  const address = `0x${value.slice(-40)}`;
  return isAddress3(address) ? address : null;
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
    if (!isAddress3(claimSigner)) continue;
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
function parsePayoutClaimedRows(payload, requestedRecipient) {
  if (!payload || typeof payload !== "object") throw new Error("claim discovery response malformed");
  const value = payload;
  if (!Array.isArray(value.columns) || !value.columns.every((column) => typeof column === "string")) throw new Error("claim discovery columns missing");
  if (!Array.isArray(value.rows) || !value.rows.every((row) => Array.isArray(row))) throw new Error("claim discovery rows missing");
  const columns = value.columns;
  const expectedRecipient = requestedRecipient.toLowerCase();
  const claims = [];
  for (const row of value.rows) {
    const selector = rowValue(row, columns, "selector");
    const payoutIdTopic = rowValue(row, columns, "topic1");
    const recipientTopic = rowValue(row, columns, "topic2");
    const data = rowValue(row, columns, "data");
    if (selector !== PAYOUT_CLAIMED_TOPIC || typeof data !== "string" || !/^0x[0-9a-fA-F]*$/.test(data)) continue;
    if (!INDEXED_TOPIC.test(String(payoutIdTopic)) || !INDEXED_TOPIC.test(String(recipientTopic))) continue;
    const eventRecipient = addressFromTopic(recipientTopic);
    if (!eventRecipient || eventRecipient.toLowerCase() !== expectedRecipient) continue;
    const decoded = decodeAbiParameters([{ type: "uint256" }], data);
    claims.push({
      id: BigInt(String(payoutIdTopic)).toString(),
      recipient: requestedRecipient,
      amount: decoded[0].toString(),
      ...exactTransactionHash(rowValue(row, columns, "tx_hash")) ? { claimTxHash: exactTransactionHash(rowValue(row, columns, "tx_hash")) } : {},
      ...createdAt(rowValue(row, columns, "block_timestamp")) ? { claimedAt: createdAt(rowValue(row, columns, "block_timestamp")) } : {},
      ...exactBlock(rowValue(row, columns, "block_num")) ? { claimedBlock: exactBlock(rowValue(row, columns, "block_num")) } : {}
    });
  }
  return claims;
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
async function discoverPayoutsByClaimant(recipient, options) {
  const url = new URL(options.indexerUrl);
  const sql = `SELECT block_num, block_timestamp, tx_hash, selector, topic1, topic2, data FROM PayoutClaimed WHERE recipient = '${recipient.toLowerCase()}' ORDER BY block_num DESC LIMIT 1000`;
  url.searchParams.set("chainId", "42431");
  url.searchParams.set("signature", PAYOUT_CLAIMED_SIGNATURE);
  url.searchParams.set("sql", sql);
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(url, { headers: { accept: "application/json" }, signal: options.signal });
  if (!response.ok) throw new Error("claim discovery unavailable");
  return parsePayoutClaimedRows(await response.json(), recipient);
}

// src/server/kvAdapter.ts
import { Kv } from "accounts/server";
function createKvStore() {
  const restUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const restToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  const isProduction = process.env.NODE_ENV === "production" || process.env.VERCEL === "1" || process.env.VERCEL_ENV === "production";
  if (!restUrl || !restToken) {
    if (isProduction && process.env.ALLOW_MEMORY_KV !== "true") {
      throw new Error("Durable KV configuration missing in production runtime. Failing closed.");
    }
    return {
      kv: Kv.memory(),
      storageType: "memory"
    };
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
  return {
    kv: Kv.from(kvStore),
    storageType: "durable"
  };
}

// src/server/testnetFunding.ts
import { isAddress as isAddress4, zeroAddress } from "viem";
var FUND_COOLDOWN_SECONDS = 600;
var CONFIRMATION_MS = 45e3;
var hashPattern = /^0x[0-9a-fA-F]{64}$/;
var FundingError = class extends Error {
  constructor(code, message, status = 503) {
    super(message);
    this.code = code;
    this.status = status;
  }
  code;
  status;
};
function fundingAddress(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || !("address" in body)) {
    throw new FundingError("INVALID_REQUEST", "Provide only your Reach account address.", 400);
  }
  const address = body.address;
  if (typeof address !== "string" || !isAddress4(address) || address.toLowerCase() === zeroAddress) {
    throw new FundingError("INVALID_ADDRESS", "A valid Reach account address is required.", 400);
  }
  return address.toLowerCase();
}
function faucetHashes(result) {
  const values = typeof result === "string" ? [result] : result;
  if (!Array.isArray(values) || values.length < 1 || values.length > 16 || !values.every((x) => typeof x === "string" && hashPattern.test(x))) {
    throw new FundingError("UNEXPECTED_RESPONSE", "The faucet returned an unexpected response. Check your balance before requesting again.", 502);
  }
  return [...new Set(values)];
}
function createTestnetFunding(kv, dependencies = {}) {
  const fetchRpc = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? Date.now;
  const key = (address) => `reach:testnet-fund:42431:${address.toLowerCase()}`;
  async function storage(operation) {
    let timer;
    try {
      return await Promise.race([operation, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new FundingError("STORAGE_UNAVAILABLE", "Funding storage is unavailable. Check your balance before requesting again.")), 5e3);
      })]);
    } finally {
      clearTimeout(timer);
    }
  }
  async function rpc(method, params) {
    let response;
    try {
      response = await fetchRpc(TEMPO_MODERATO_RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(8e3)
      });
    } catch {
      throw new FundingError("RPC_UNAVAILABLE", "Tempo could not be reached. Funding may be uncertain; check your balance before requesting again.");
    }
    if (response.status === 429) throw new FundingError("FAUCET_RATE_LIMIT", "The testnet service is rate limited. Wait before requesting again.", 429);
    if (!response.ok) throw new FundingError("RPC_UNAVAILABLE", "The Tempo testnet service is unavailable.");
    let data;
    try {
      data = await response.json();
    } catch {
      throw new FundingError("UNEXPECTED_RESPONSE", "The Tempo service returned an unreadable response.", 502);
    }
    if (data?.error) throw new FundingError("FAUCET_REFUSED", "The Tempo service refused this request. Check your balance before requesting again.", 502);
    if (data?.jsonrpc !== "2.0" || data?.id !== 1 || !("result" in data)) throw new FundingError("UNEXPECTED_RESPONSE", "The Tempo service returned an unexpected response.", 502);
    return data.result;
  }
  async function assertChain() {
    if (await rpc("eth_chainId", []) !== "0xa5bf") throw new FundingError("WRONG_CHAIN", "Test funding is available only on Tempo Moderato.");
  }
  async function balanceOf(address) {
    const result = await rpc("eth_call", [{ to: PATH_USD_ADDRESS, data: `0x70a08231${address.slice(2).padStart(64, "0")}` }, "latest"]);
    if (typeof result !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(result)) throw new FundingError("BALANCE_UNAVAILABLE", "Your authoritative pathUSD balance could not be read.");
    return BigInt(result).toString();
  }
  const publicResult = (attempt) => ({ ...attempt, chainId: 42431, token: PATH_USD_ADDRESS, retryAfter: FUND_COOLDOWN_SECONDS });
  const failure = (error) => error instanceof FundingError ? error : new FundingError("FUNDING_UNAVAILABLE", "Test funding is unavailable. Check your balance before requesting again.");
  return {
    async request(body) {
      const address = fundingAddress(body);
      const attempt = { address, stage: "REQUESTING_TEST_FUNDS", startedAt: now() };
      if (!kv.create || !await storage(kv.create(key(address), attempt, { ttl: FUND_COOLDOWN_SECONDS }))) {
        throw new FundingError("COOLDOWN", "This account requested test funds recently. Check its balance or wait 10 minutes.", 429);
      }
      try {
        await assertChain();
        attempt.startingBalance = await balanceOf(address);
        attempt.txHashes = faucetHashes(await rpc("tempo_fundAddress", [address]));
        attempt.stage = "WAITING_FOR_BALANCE";
        await storage(kv.set(key(address), attempt, { ttl: FUND_COOLDOWN_SECONDS }));
        return publicResult(attempt);
      } catch (error) {
        const safe = failure(error);
        await storage(kv.set(key(address), { ...attempt, stage: "FAILED", error: safe.message }, { ttl: FUND_COOLDOWN_SECONDS }));
        throw safe;
      }
    },
    async status(input) {
      const address = fundingAddress({ address: input });
      const attempt = await storage(kv.get(key(address)));
      if (!attempt) throw new FundingError("NO_ATTEMPT", "No recent test funding request was found. Check your balance.", 404);
      if (attempt.stage === "FUNDED" || attempt.stage === "FAILED") return publicResult(attempt);
      if (now() - attempt.startedAt > CONFIRMATION_MS) {
        return publicResult({ ...attempt, stage: "FAILED", error: "Balance confirmation timed out. Funds may arrive later. Check your balance; do not immediately request again." });
      }
      if (!attempt.txHashes || attempt.startingBalance === void 0) return publicResult(attempt);
      await assertChain();
      const [balance, ...receipts] = await Promise.all([
        balanceOf(address),
        ...attempt.txHashes.map((hash) => rpc("eth_getTransactionReceipt", [hash]))
      ]);
      if (receipts.some((r) => r?.status === "0x0")) return publicResult({ ...attempt, stage: "FAILED", balance, error: "A faucet transaction reverted. Check your balance before requesting again." });
      if (receipts.some((r, i) => r !== null && (!r || r.transactionHash?.toLowerCase() !== attempt.txHashes[i].toLowerCase() || !["0x0", "0x1"].includes(r.status)))) {
        throw new FundingError("UNEXPECTED_RECEIPT", "Faucet confirmation returned unexpected evidence.", 502);
      }
      const stage = receipts.every((r) => r?.status === "0x1") && BigInt(balance) > BigInt(attempt.startingBalance) ? "FUNDED" : "WAITING_FOR_BALANCE";
      return publicResult({ ...attempt, stage, balance });
    }
  };
}

// src/server/authDiagnostics.ts
function authStageForPath(pathname) {
  if (pathname.endsWith("/register/options")) return "REGISTER_OPTIONS";
  if (pathname.endsWith("/register/reconcile")) return "REGISTER_RECONCILE";
  if (pathname.endsWith("/register")) return "REGISTER_COMPLETE";
  if (pathname.endsWith("/login/options")) return "LOGIN_OPTIONS";
  if (pathname.endsWith("/login")) return "LOGIN_COMPLETE";
  if (pathname.endsWith("/logout")) return "LOGOUT";
  return "AUTH";
}
function classifyAuthFailure(message) {
  if (typeof message !== "string" || message.length === 0) return "NONE";
  const value = message.toLowerCase();
  if (value.includes("origin")) return "ORIGIN_MISMATCH";
  if (value.includes("rp id") || value.includes("rp_id") || value.includes("relying party")) return "RP_ID_MISMATCH";
  if (value.includes("missing or expired challenge")) return "CHALLENGE_MISSING_OR_EXPIRED";
  if (value.includes("credential already exists")) return "CREDENTIAL_ALREADY_EXISTS";
  if (value.includes("unknown credential")) return "UNKNOWN_CREDENTIAL";
  if (value.includes("authentication failed")) return "AUTHENTICATION_FAILED";
  if (value.includes("public key")) return "PUBLIC_KEY_INVALID";
  if (value.includes("credential") || value.includes("attestation") || value.includes("client data")) return "INVALID_CREDENTIAL";
  if (value.includes("kv ") || value.includes("redis") || value.includes("rest command")) return "KV_FAILURE";
  return "UNCLASSIFIED_ERROR";
}
function createAuthReference() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const suffix = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `RCH-${suffix}`;
}

// src/server/authConfig.ts
var AUTH_CHALLENGE_TTL_SECONDS = 10 * 60;

// src/server/app.ts
function createApp(options = {}) {
  const app2 = new Hono();
  const vaultAddress = process.env.REACH_VAULT_ADDRESS ?? DEFAULT_VAULT_ADDRESS;
  const rpcUrl = process.env.REACH_RPC_URL ?? TEMPO_MODERATO_RPC_URL;
  const indexerUrl = process.env.REACH_INDEXER_URL ?? "https://indexer.testnet.tempo.xyz/query";
  const publicClient = createPublicClient({ chain: tempoModerato, transport: http(rpcUrl) });
  const { kv: configuredAuthKv, storageType } = createKvStore();
  const authKv = options.authKv ?? configuredAuthKv;
  const testnetFunding = createTestnetFunding(authKv);
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
  async function withAuthDiagnostics(request, handler2) {
    const reference = createAuthReference();
    const pathname = new URL(request.url).pathname;
    let response;
    try {
      response = await handler2();
    } catch {
      response = Response.json({ error: "authentication unavailable" }, { status: 503 });
    }
    const errorBody = response.ok ? void 0 : await response.clone().json().catch(() => ({}));
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
      errorClass
    }));
    return response;
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
    return payoutFromContractResult(result, payoutId);
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
  async function discoverPublicActivity(address) {
    const [sentEvents, claimEvents, latestBlock] = await Promise.all([
      discoverPayoutsBySender(address, { indexerUrl, signal: AbortSignal.timeout(1e4) }),
      discoverPayoutsByClaimant(address, { indexerUrl, signal: AbortSignal.timeout(1e4) }),
      publicClient.getBlock({ blockTag: "latest" })
    ]);
    const chainTimestamp = BigInt(latestBlock.timestamp);
    const sentById = new Map(sentEvents.map((event) => [event.id, event]));
    const claimById = new Map(claimEvents.map((event) => [event.id, event]));
    const ids = /* @__PURE__ */ new Set([...sentById.keys(), ...claimById.keys()]);
    const entries = await Promise.all([...ids].map(async (id) => {
      const payout = await readPayout(BigInt(id));
      const sentEvent = sentById.get(id);
      const claimEvent = claimById.get(id);
      const isSender = payout.sender.toLowerCase() === address.toLowerCase();
      const isClaimedRecipient = payout.status === payoutStatus.CLAIMED && payout.claimant.toLowerCase() === address.toLowerCase();
      if (!isSender && !isClaimedRecipient) return null;
      const direction = isSender ? "SENT" : "RECEIVED";
      const lifecycle = payout.status === payoutStatus.FUNDED && chainTimestamp >= payout.expiresAt ? "EXPIRED_FUNDED" : payout.status === payoutStatus.FUNDED ? "FUNDED" : payout.status === payoutStatus.CLAIMED ? "CLAIMED" : payout.status === payoutStatus.RECLAIMED ? "RECLAIMED" : "NONE";
      return {
        payoutId: id,
        direction,
        lifecycle,
        sender: payout.sender,
        claimant: payout.claimant,
        amount: payout.amount.toString(),
        expiresAt: payout.expiresAt.toString(),
        claimSigner: payout.claimSigner,
        ...sentEvent?.createdAt ? { createdAt: sentEvent.createdAt } : {},
        ...claimEvent?.claimedAt ? { claimedAt: claimEvent.claimedAt } : {},
        ...(direction === "SENT" ? sentEvent?.fundingTxHash : claimEvent?.claimTxHash) ? { txHash: direction === "SENT" ? sentEvent?.fundingTxHash : claimEvent?.claimTxHash } : {}
      };
    }));
    return [...new Map(entries.filter((entry) => Boolean(entry)).map((entry) => [entry.payoutId, entry])).values()];
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
      sponsorConfigured: Boolean(relayHandler),
      webAuthnStorage: storageType
    })
  );
  app2.get("/api/payouts/:sender", async (context) => {
    const sender = context.req.param("sender");
    if (!isAddress5(sender)) return context.json({ error: "invalid address" }, 400);
    try {
      return context.json({ address: sender, payouts: await discoverPublicPayouts(sender) });
    } catch {
      return context.json({ error: "payout discovery unavailable" }, 503);
    }
  });
  app2.get("/api/activity/:address", async (context) => {
    const address = context.req.param("address");
    if (!isAddress5(address)) return context.json({ error: "invalid address" }, 400);
    try {
      context.header("Cache-Control", "no-store");
      return context.json({ address, activities: await discoverPublicActivity(address) });
    } catch {
      return context.json({ error: "activity discovery unavailable" }, 503);
    }
  });
  app2.get("/api/payout/:payoutId", async (context) => {
    try {
      context.header("Cache-Control", "no-store");
      return context.json(serializePayout(await readPayout(strictPayoutId(context.req.param("payoutId")))));
    } catch {
      return context.json({ error: "payout unavailable" }, 404);
    }
  });
  app2.get("/api/balance/:address", async (context) => {
    const address = context.req.param("address");
    if (!isAddress5(address)) return context.json({ error: "invalid address" }, 400);
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
  app2.post("/api/testnet/fund", async (context) => {
    context.header("Cache-Control", "no-store");
    try {
      originFor(context.req.raw);
      const origin = context.req.header("origin");
      if (origin && origin !== (process.env.REACH_ORIGIN ?? new URL(context.req.url).origin)) return context.json({ error: "Untrusted origin" }, 403);
      if (!context.req.header("content-type")?.startsWith("application/json")) return context.json({ error: "JSON required" }, 400);
      const body = await context.req.text();
      if (body.length > 256) return context.json({ error: "Request too large" }, 400);
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        return context.json({ error: "Invalid JSON" }, 400);
      }
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
  app2.get("/api/testnet/fund/:address", async (context) => {
    context.header("Cache-Control", "no-store");
    try {
      return context.json(await testnetFunding.status(context.req.param("address")));
    } catch (error) {
      if (error instanceof FundingError) return context.json({ code: error.code, error: error.message }, error.status);
      return context.json({ error: "Funding status unavailable. Check your balance before requesting again." }, 503);
    }
  });
  app2.post("/auth/register/reconcile", async (context) => {
    return withAuthDiagnostics(context.req.raw, async () => {
      try {
        context.header("Cache-Control", "no-store");
        originFor(context.req.raw);
        if (!context.req.header("content-type")?.startsWith("application/json")) {
          return context.json({ error: "JSON required" }, 400);
        }
        const body = await context.req.text();
        if (body.length > 2048) return context.json({ error: "Request too large" }, 400);
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          return context.json({ error: "Invalid JSON" }, 400);
        }
        if (!parsed || typeof parsed !== "object") return context.json({ error: "Invalid credential record" }, 400);
        const { credentialId, publicKey } = parsed;
        if (typeof credentialId !== "string" || credentialId.length === 0 || credentialId.length > 1024 || typeof publicKey !== "string" || !/^0x04[0-9a-f]{128}$/i.test(publicKey)) {
          return context.json({ error: "Invalid credential record" }, 400);
        }
        const stored = await authKv.get(`credential:${credentialId}`);
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
  app2.all("/auth/*", async (context) => {
    return withAuthDiagnostics(context.req.raw, async () => {
      try {
        const origin = originFor(context.req.raw);
        return await Handler.webAuthn({
          kv: authKv,
          origin,
          path: "/auth",
          rpId: process.env.REACH_RP_ID ?? new URL(origin).hostname,
          ttl: { challenge: AUTH_CHALLENGE_TTL_SECONDS }
        }).fetch(context.req.raw);
      } catch (err) {
        if (err?.message?.includes("origin")) {
          return context.json({ error: "Untrusted origin" }, 403);
        }
        return context.json({ error: "authentication unavailable" }, 503);
      }
    });
  });
  app2.all("/relay*", async (context) => {
    if (!relayHandler) return context.json({ error: "sponsorship is not configured" }, 503);
    try {
      const res = await relayHandler.fetch(context.req.raw);
      return res;
    } catch (err) {
      return context.json({ error: err?.message || "sponsorship request rejected" }, 400);
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
