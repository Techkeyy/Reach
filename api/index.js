// src/server/app.ts
import { Handler } from "accounts/server";
import { Hono } from "hono";
import { createPublicClient as createPublicClient2, http as http3, isAddress as isAddress8, recoverTypedDataAddress } from "viem";
import { privateKeyToAccount as privateKeyToAccount3 } from "viem/accounts";
import { tempoModerato as tempoModerato3 } from "viem/chains";

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
var PAYOUT_RECLAIMED_SIGNATURE = "PayoutReclaimed(uint256 indexed payoutId,address indexed sender,uint256 amount,bytes32 indexed memo)";
var PAYOUT_CREATED_TOPIC = keccak2562(toHex2("PayoutCreated(uint256,address,uint256,uint64,address,bytes32)"));
var PAYOUT_CLAIMED_TOPIC = keccak2562(toHex2("PayoutClaimed(uint256,address,uint256,bytes32)"));
var PAYOUT_RECLAIMED_TOPIC = keccak2562(toHex2("PayoutReclaimed(uint256,address,uint256,bytes32)"));
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
function parsePayoutReclaimedRows(payload, requestedSender) {
  if (!payload || typeof payload !== "object") throw new Error("reclaim discovery response malformed");
  const value = payload;
  if (!Array.isArray(value.columns) || !value.columns.every((column) => typeof column === "string")) throw new Error("reclaim discovery columns missing");
  if (!Array.isArray(value.rows) || !value.rows.every((row) => Array.isArray(row))) throw new Error("reclaim discovery rows missing");
  const columns = value.columns;
  const expectedSender = requestedSender.toLowerCase();
  const reclaims = [];
  for (const row of value.rows) {
    const selector = rowValue(row, columns, "selector");
    const payoutIdTopic = rowValue(row, columns, "topic1");
    const senderTopic = rowValue(row, columns, "topic2");
    const data = rowValue(row, columns, "data");
    if (selector !== PAYOUT_RECLAIMED_TOPIC || typeof data !== "string" || !/^0x[0-9a-fA-F]*$/.test(data)) continue;
    if (!INDEXED_TOPIC.test(String(payoutIdTopic)) || !INDEXED_TOPIC.test(String(senderTopic))) continue;
    const eventSender = addressFromTopic(senderTopic);
    if (!eventSender || eventSender.toLowerCase() !== expectedSender) continue;
    const decoded = decodeAbiParameters([{ type: "uint256" }], data);
    reclaims.push({
      id: BigInt(String(payoutIdTopic)).toString(),
      sender: requestedSender,
      amount: decoded[0].toString(),
      ...exactTransactionHash(rowValue(row, columns, "tx_hash")) ? { reclaimTxHash: exactTransactionHash(rowValue(row, columns, "tx_hash")) } : {},
      ...createdAt(rowValue(row, columns, "block_timestamp")) ? { reclaimedAt: createdAt(rowValue(row, columns, "block_timestamp")) } : {},
      ...exactBlock(rowValue(row, columns, "block_num")) ? { reclaimedBlock: exactBlock(rowValue(row, columns, "block_num")) } : {}
    });
  }
  return reclaims;
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
async function discoverReclaimedPayoutsBySender(sender, options) {
  const url = new URL(options.indexerUrl);
  const sql = `SELECT block_num, block_timestamp, tx_hash, selector, topic1, topic2, data FROM PayoutReclaimed WHERE sender = '${sender.toLowerCase()}' ORDER BY block_num DESC LIMIT 1000`;
  url.searchParams.set("chainId", "42431");
  url.searchParams.set("signature", PAYOUT_RECLAIMED_SIGNATURE);
  url.searchParams.set("sql", sql);
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(url, { headers: { accept: "application/json" }, signal: options.signal });
  if (!response.ok) throw new Error("reclaim discovery unavailable");
  return parsePayoutReclaimedRows(await response.json(), sender);
}

// src/server/transactionAccounting.ts
import { isAddress as isAddress4, parseAbi as parseAbi2 } from "viem";

// src/shared/transactionAccounting.ts
function feeTokenUnitsFromGasUnits(raw, decimals) {
  if (!Number.isInteger(decimals) || decimals < 0) throw new Error("invalid fee-token decimals");
  if (decimals === 18) return raw;
  if (decimals < 18) return raw / 10n ** BigInt(18 - decimals);
  return raw * 10n ** BigInt(decimals - 18);
}
function actualFeeAmountFromGas(gasUsed, effectiveGasPrice, decimals) {
  if (gasUsed < 0n || effectiveGasPrice < 0n) throw new Error("invalid receipt gas data");
  return feeTokenUnitsFromGasUnits(gasUsed * effectiveGasPrice, decimals);
}

// src/server/transactionAccounting.ts
var feeTokenAbi = parseAbi2([
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
]);
function asBigInt(value) {
  if (typeof value !== "string" && typeof value !== "bigint" && typeof value !== "number") return null;
  try {
    const parsed = BigInt(value);
    return parsed >= 0n ? parsed : null;
  } catch {
    return null;
  }
}
function validHash(value) {
  return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value);
}
function sameAddress(left, right) {
  return typeof left === "string" && isAddress4(left) && left.toLowerCase() === right.toLowerCase();
}
function matchesExpectedTarget(value, expected) {
  if (value === null || value === void 0) return false;
  const targets = Array.isArray(expected) ? expected : [expected];
  return targets.some((target) => sameAddress(value, target));
}
async function recoverConfirmedTransactionAccounting(reader, txHash, options = {}) {
  if (!validHash(txHash)) return null;
  try {
    const expectedChainId = options.expectedChainId ?? TEMPO_MODERATO_CHAIN_ID;
    const [chainId2, transaction, receipt] = await Promise.all([
      reader.getChainId(),
      reader.getTransaction({ hash: txHash }),
      reader.getTransactionReceipt({ hash: txHash })
    ]);
    if (chainId2 !== expectedChainId || !transaction || !receipt || receipt.status !== "success") return null;
    if (transaction.chainId !== void 0 && Number(transaction.chainId) !== expectedChainId) return null;
    if (receipt.transactionHash && receipt.transactionHash.toLowerCase() !== txHash.toLowerCase()) return null;
    if (options.expectedSender && !sameAddress(transaction.from ?? receipt.from, options.expectedSender)) return null;
    if (options.expectedTo && !matchesExpectedTarget(transaction.to, options.expectedTo)) return null;
    const feeToken = receipt.feeToken ?? transaction.feeToken;
    if (!feeToken || !isAddress4(feeToken)) return null;
    const gasUsed = asBigInt(receipt.gasUsed);
    const effectiveGasPrice = asBigInt(receipt.effectiveGasPrice);
    if (gasUsed === null || effectiveGasPrice === null) return null;
    const decimalsValue = await reader.readContract({ address: feeToken, abi: feeTokenAbi, functionName: "decimals" });
    const decimals = asBigInt(decimalsValue);
    if (decimals === null || decimals > 255n) return null;
    let symbol;
    try {
      const symbolValue = await reader.readContract({ address: feeToken, abi: feeTokenAbi, functionName: "symbol" });
      if (typeof symbolValue === "string" && symbolValue.length > 0 && symbolValue.length <= 32) symbol = symbolValue;
    } catch {
    }
    return {
      txHash,
      receiptStatus: "success",
      feeToken,
      feeTokenDecimals: Number(decimals),
      ...symbol ? { feeTokenSymbol: symbol } : {},
      actualFeeAmount: actualFeeAmountFromGas(gasUsed, effectiveGasPrice, Number(decimals)).toString(),
      gasUsed: gasUsed.toString(),
      effectiveGasPrice: effectiveGasPrice.toString()
    };
  } catch {
    return null;
  }
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
    },
    async compareAndSet(key, expected, value, options) {
      const script = `
        local current = redis.call('GET', KEYS[1])
        local expected = ARGV[1]
        if expected == '__reach_missing__' then
          if current then return 0 end
        elseif current ~= expected then
          return 0
        end
        local ttl = tonumber(ARGV[3])
        if ttl and ttl > 0 then
          redis.call('SET', KEYS[1], ARGV[2], 'EX', ttl)
        else
          redis.call('SET', KEYS[1], ARGV[2])
        end
        return 1
      `;
      const serialized = typeof value === "string" ? value : JSON.stringify(value);
      const result = await executeCommand([
        "EVAL",
        script,
        1,
        key,
        expected ?? "__reach_missing__",
        serialized,
        options?.ttl ?? 0
      ]);
      return result === 1;
    }
  };
  return {
    kv: Kv.from(kvStore),
    storageType: "durable"
  };
}

// src/server/testnetFunding.ts
import { isAddress as isAddress5, zeroAddress } from "viem";
import { createHash } from "node:crypto";
var FUND_COOLDOWN_SECONDS = 600;
var FUND_NETWORK_WINDOW_SECONDS = 600;
var FUND_NETWORK_MAX_REQUESTS = 5;
var FUND_GLOBAL_MAX_REQUESTS = 50;
var FUND_ROTATION_WINDOW_SECONDS = 3600;
var FUND_ROTATION_MAX_ADDRESSES = 5;
var CONFIRMATION_MS = 45e3;
var hashPattern = /^0x[0-9a-fA-F]{64}$/;
var NETWORK_KEY_PREFIX = "reach-testnet-fund:v1:";
var DEFAULT_NETWORK_KEY = "unknown";
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
  if (typeof address !== "string" || !isAddress5(address) || address.toLowerCase() === zeroAddress) {
    throw new FundingError("INVALID_ADDRESS", "A valid Reach account address is required.", 400);
  }
  return address.toLowerCase();
}
function fundingNetworkKey(request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  const real = request.headers.get("x-real-ip")?.trim();
  const source = (forwarded || real || DEFAULT_NETWORK_KEY).slice(0, 128);
  return createHash("sha256").update(`${NETWORK_KEY_PREFIX}${source}`).digest("hex").slice(0, 32);
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
  const limits = {
    networkMaxRequests: dependencies.limits?.networkMaxRequests ?? FUND_NETWORK_MAX_REQUESTS,
    globalMaxRequests: dependencies.limits?.globalMaxRequests ?? FUND_GLOBAL_MAX_REQUESTS,
    rotationMaxAddresses: dependencies.limits?.rotationMaxAddresses ?? FUND_ROTATION_MAX_ADDRESSES
  };
  const key = (address) => `reach:testnet-fund:42431:${address.toLowerCase()}`;
  const networkDigest = (networkKey) => createHash("sha256").update(`${NETWORK_KEY_PREFIX}${(networkKey || DEFAULT_NETWORK_KEY).slice(0, 128)}`).digest("hex").slice(0, 32);
  const slot = async (prefix, count, ttl) => {
    for (let index = 0; index < count; index += 1) {
      if (await storage(kv.create(`${prefix}:${index}`, "1", { ttl }))) return true;
    }
    return false;
  };
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
  async function reserveAbuseQuota(address, networkKey) {
    const digest = networkDigest(networkKey);
    const currentBucket = Math.floor(now() / (FUND_NETWORK_WINDOW_SECONDS * 1e3));
    const networkPrefix = `reach:testnet-fund:network:${digest}:${currentBucket}`;
    if (!await slot(networkPrefix, limits.networkMaxRequests, FUND_NETWORK_WINDOW_SECONDS)) {
      throw new FundingError("NETWORK_RATE_LIMIT", "Too many test funding requests from this network. Wait before requesting again.", 429);
    }
    const globalPrefix = `reach:testnet-fund:global:${currentBucket}`;
    if (!await slot(globalPrefix, limits.globalMaxRequests, FUND_NETWORK_WINDOW_SECONDS)) {
      throw new FundingError("GLOBAL_RATE_LIMIT", "Test funding is temporarily rate limited. Wait before requesting again.", 429);
    }
    const rotationMarker = `reach:testnet-fund:rotation:address:${digest}:${address}`;
    if (await storage(kv.get(rotationMarker))) return;
    const rotationBucket = Math.floor(now() / (FUND_ROTATION_WINDOW_SECONDS * 1e3));
    const rotationPrefix = `reach:testnet-fund:rotation:slots:${digest}:${rotationBucket}`;
    if (!await slot(rotationPrefix, limits.rotationMaxAddresses, FUND_ROTATION_WINDOW_SECONDS)) {
      throw new FundingError("ACCOUNT_ROTATION_LIMIT", "Too many different accounts requested test funds from this network. Wait before trying again.", 429);
    }
    await storage(kv.create(rotationMarker, "1", { ttl: FUND_ROTATION_WINDOW_SECONDS }));
  }
  return {
    async request(body, options = {}) {
      const address = fundingAddress(body);
      const attempt = { address, stage: "REQUESTING_TEST_FUNDS", startedAt: now() };
      if (!kv.create || !await storage(kv.create(key(address), attempt, { ttl: FUND_COOLDOWN_SECONDS }))) {
        throw new FundingError("COOLDOWN", "This account requested test funds recently. Check its balance or wait 10 minutes.", 429);
      }
      try {
        await reserveAbuseQuota(address, options.networkKey);
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

// src/shared/identity.ts
import { Account as TempoAccount } from "viem/tempo";
function deriveTempoAccountAddress(credential) {
  return TempoAccount.fromWebAuthnP256(
    { id: credential.id, publicKey: credential.publicKey },
    { rpId: credential.rpId }
  ).address;
}

// src/server/protectedClaims.ts
import { createCipheriv, createDecipheriv, createHash as createHash2, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { google } from "googleapis";
import { recoverMessageAddress } from "viem";
var RECORD_PREFIX = "protected:claim:";
var ACTIVE_FLOW_PREFIX = "protected:active-flow:";
var FLOW_PREFIX = "protected:flow:";
var GRANT_PREFIX = "protected:grant:";
var PROOF_SESSION_PREFIX = "protected:proof-session:";
var OTP_DELIVERY_LOCK_PREFIX = "protected:otp-delivery-lock:";
var FLOW_TTL_SECONDS = 10 * 60;
var GRANT_TTL_SECONDS = 60;
var MAX_OTP_ATTEMPTS = 5;
var OTP_RESEND_COOLDOWN_SECONDS = 30;
var EMAIL_OTP_TTL_SECONDS = 5 * 60;
var OTP_DELIVERY_LOCK_TTL_SECONDS = 30;
var DEFAULT_PROVIDER_TIMEOUT_MS = 1e4;
var ProtectedProviderDeliveryError = class extends Error {
  flowId;
  expiresAt;
  channel;
  constructor(channel, flowId, expiresAt) {
    super(channel === "EMAIL" ? "verification email unavailable" : "verification provider unavailable");
    this.name = "ProtectedProviderDeliveryError";
    this.channel = channel;
    this.flowId = flowId;
    this.expiresAt = expiresAt;
  }
};
function hexBytes(value, name) {
  if (typeof value !== "string") throw new Error(`${name} must be 32 bytes`);
  const normalized = value.startsWith("0x") ? value.slice(2) : value;
  if (!/^[0-9a-f]{64}$/i.test(normalized)) throw new Error(`${name} must be 32 bytes`);
  return Buffer.from(normalized, "hex");
}
function keyFromEnv(value) {
  if (!value) return null;
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error("protected claims encryption key must be 32-byte hex");
  return Buffer.from(value, "hex");
}
function encrypt(value, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("hex")}.${tag.toString("hex")}.${ciphertext.toString("hex")}`;
}
function decrypt(envelope, key) {
  const parts = envelope.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("invalid protected envelope");
  const iv = Buffer.from(parts[1], "hex");
  const tag = Buffer.from(parts[2], "hex");
  const ciphertext = Buffer.from(parts[3], "hex");
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) throw new Error("invalid protected envelope");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
function normalizeRecipient(channel, value) {
  if (typeof value !== "string") throw new Error("recipient is required");
  const normalized = value.trim();
  if (channel === "EMAIL") {
    const email = normalized.toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("invalid email recipient");
    return email;
  }
  if (!/^\+[1-9][0-9]{7,14}$/.test(normalized)) throw new Error("phone must use E.164 format");
  return normalized;
}
function maskProtectedRecipient(channel, normalized) {
  if (channel === "EMAIL") {
    const [local, domain] = normalized.split("@");
    if (!local || !domain) return "your email address";
    return `${local.slice(0, 1)}${"\u2022".repeat(Math.min(3, Math.max(2, local.length - 1)))}@${domain}`;
  }
  return `${normalized.slice(0, 3)}${"\u2022".repeat(Math.max(4, normalized.length - 7))}${normalized.slice(-4)}`;
}
function publicMetadata(record2, key) {
  const recipient = decrypt(record2.encryptedRecipient, key).toString("utf8");
  return { mode: "PROTECTED", channel: record2.channel, maskedRecipient: maskProtectedRecipient(record2.channel, recipient) };
}
function requirePayoutEligibility(payout, nowMs = Date.now()) {
  if (payout.status !== 1) throw new Error("payout is not claimable");
  if (BigInt(Math.floor(nowMs / 1e3)) >= payout.expiresAt) throw new Error("payout has expired");
}
function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}
function hashToken(value) {
  return createHash2("sha256").update(value).digest("hex");
}
function createEmailOtp(generateOtp) {
  const code = generateOtp ? generateOtp() : String(randomInt(0, 1e6)).padStart(6, "0");
  if (!/^[0-9]{6}$/.test(code)) throw new Error("invalid verification code");
  return code;
}
function emailOtpVerifier(key, input) {
  const scopeBinding = input.scope === "SESSION" && input.sessionAddress ? input.sessionAddress.toLowerCase() : "payout";
  return createHmac("sha256", key).update(`reach-email-otp
${input.payoutId}
${input.flowId}
${scopeBinding}
${input.recipient}
${input.expiresAt}
${input.code}`).digest("hex");
}
function secureHexEqual(left, right) {
  if (!/^[0-9a-f]{64}$/i.test(left) || !/^[0-9a-f]{64}$/i.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}
function grantKey(token, address) {
  return `${GRANT_PREFIX}${hashToken(token)}:${address.toLowerCase()}`;
}
function proofSessionKey(flowId, address) {
  return `${PROOF_SESSION_PREFIX}${flowId}:${address.toLowerCase()}`;
}
function otpDeliveryLockKey(flowId) {
  return `${OTP_DELIVERY_LOCK_PREFIX}${flowId}`;
}
function challengeText(payoutId, flowId, challenge) {
  return `Reach protected claim verification
Payout: ${payoutId}
Flow: ${flowId}
Challenge: ${challenge}`;
}
function createProtectedClaimService(options) {
  let key = null;
  try {
    key = keyFromEnv(options.encryptionKey ?? process.env.REACH_PROTECTED_CLAIMS_ENCRYPTION_KEY);
  } catch {
    key = null;
  }
  const now = options.now ?? (() => Date.now());
  const providerTimeoutMs = options.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
  function providerFor(channel) {
    if (options.providers && Object.prototype.hasOwnProperty.call(options.providers, channel)) return options.providers[channel] ?? null;
    return options.provider ?? null;
  }
  function requireKey() {
    if (!key) throw new Error("protected verification is not configured");
    return key;
  }
  function requireChannelConfigured(channel) {
    const configuredKey = requireKey();
    const provider = providerFor(channel);
    if (!provider) throw new Error("protected verification is not configured");
    return { key: configuredKey, provider };
  }
  async function verifyEmailProvider() {
    const provider = providerFor("EMAIL");
    if (!provider || typeof provider.verifyTransport !== "function") {
      return { ok: false, provider: "gmail-api", category: "UNKNOWN", scopeAuthorized: false };
    }
    return provider.verifyTransport();
  }
  function availability() {
    const emailProvider = providerFor("EMAIL");
    return {
      emailConfigured: Boolean(key && providerFor("EMAIL")),
      smsConfigured: Boolean(key && providerFor("SMS")),
      gmailApiConfigured: Boolean(emailProvider?.gmailApiConfigured)
    };
  }
  async function withProviderTimeout(operation) {
    let timer;
    try {
      return await Promise.race([
        operation,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("verification provider timed out")), providerTimeoutMs);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  async function sendVerificationCode(input) {
    const { channel, recipient, payoutId, flow, key: key2, provider } = input;
    if (channel === "EMAIL") {
      const otpExpiresAt = Math.min(flow.expiresAt, now() + EMAIL_OTP_TTL_SECONDS * 1e3);
      const code = createEmailOtp(options.generateOtp);
      try {
        await withProviderTimeout(provider.sendVerificationCode({ channel, recipient, code, payoutId, flowId: flow.flowId }));
      } catch {
        throw new Error("verification email unavailable");
      }
      return {
        otpVerifier: emailOtpVerifier(key2, {
          payoutId,
          flowId: flow.flowId,
          sessionAddress: flow.sessionAddress,
          scope: flow.otpScope ?? (flow.sessionAddress ? "SESSION" : "PAYOUT"),
          recipient,
          expiresAt: otpExpiresAt,
          code
        }),
        otpExpiresAt
      };
    }
    try {
      await withProviderTimeout(provider.sendVerificationCode({ channel, recipient, payoutId, flowId: flow.flowId }));
    } catch {
      throw new Error("verification provider unavailable");
    }
    return {};
  }
  async function readRecord(payoutId) {
    return options.kv.get(`${RECORD_PREFIX}${payoutId}`);
  }
  async function register(input) {
    const { key: key2 } = requireChannelConfigured(input.channel);
    const recipient = normalizeRecipient(input.channel, input.recipient);
    const shareB = hexBytes(input.shareB, "shareB");
    const record2 = {
      version: 1,
      payoutId: input.payoutId,
      sender: input.sender,
      claimSigner: input.claimSigner,
      channel: input.channel,
      encryptedRecipient: encrypt(Buffer.from(recipient, "utf8"), key2),
      encryptedShareB: encrypt(shareB, key2),
      shareAProofAddress: input.shareAProofAddress,
      createdAt: new Date(now()).toISOString()
    };
    const created = options.kv.create ? await options.kv.create(`${RECORD_PREFIX}${input.payoutId}`, record2) : false;
    if (!created) throw new Error("protected payout already registered");
  }
  async function metadata(payoutId) {
    const configuredKey = requireKey();
    const record2 = await readRecord(payoutId);
    return record2 ? publicMetadata(record2, configuredKey) : null;
  }
  async function claimProofForSession(flow, session) {
    if (!options.kv.create) throw new Error("protected verification storage unavailable");
    return options.kv.create(
      proofSessionKey(flow.flowId, session.address),
      { payoutId: flow.payoutId, sessionAddress: session.address },
      { ttl: FLOW_TTL_SECONDS }
    );
  }
  async function hasProofForSession(flow, session) {
    return Boolean(await options.kv.get(proofSessionKey(flow.flowId, session.address)));
  }
  async function waitForFlow(flowId) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const current = await options.kv.get(`${FLOW_PREFIX}${flowId}`);
      if (current) return current;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return void 0;
  }
  async function waitForOtpChallenge(flowId) {
    const attempts = Math.ceil((providerTimeoutMs + 1e3) / 50);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const current = await options.kv.get(`${FLOW_PREFIX}${flowId}`);
      if (!current) return void 0;
      if (current.otpVerifier && current.otpExpiresAt) return current;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return options.kv.get(`${FLOW_PREFIX}${flowId}`);
  }
  function otpScope(flow) {
    return flow.otpScope ?? (flow.sessionAddress ? "SESSION" : "PAYOUT");
  }
  function otpFlowResponse(flow, record2, configuredKey) {
    return {
      maskedRecipient: maskProtectedRecipient(record2.channel, decrypt(record2.encryptedRecipient, configuredKey).toString("utf8")),
      expiresAt: flow.expiresAt,
      resendAvailableAt: flow.lastSentAt ? flow.lastSentAt + OTP_RESEND_COOLDOWN_SECONDS * 1e3 : now()
    };
  }
  async function begin(input) {
    const nowMs = now();
    requirePayoutEligibility(input.payout, nowMs);
    const record2 = await readRecord(input.payoutId);
    if (!record2) throw new Error("protected payout not found");
    const configured = requireChannelConfigured(record2.channel);
    if (record2.claimSigner.toLowerCase() !== input.payout.claimSigner.toLowerCase()) throw new Error("protected payout does not match vault");
    const existingFlowId = await options.kv.get(`${ACTIVE_FLOW_PREFIX}${input.payoutId}`);
    if (existingFlowId) {
      const existing = await waitForFlow(existingFlowId);
      if (existing && existing.expiresAt > nowMs) {
        return {
          flowId: existing.flowId,
          challenge: challengeText(input.payoutId, existing.flowId, existing.challenge),
          metadata: publicMetadata(record2, configured.key)
        };
      }
      await options.kv.delete(`${ACTIVE_FLOW_PREFIX}${input.payoutId}`);
    }
    const flowId = randomToken(18);
    const challenge = randomToken(32);
    const flow = {
      version: 1,
      flowId,
      payoutId: input.payoutId,
      otpScope: "PAYOUT",
      challenge,
      expiresAt: nowMs + FLOW_TTL_SECONDS * 1e3,
      proofVerified: false,
      otpAttempts: 0
    };
    const activeCreated = options.kv.create ? await options.kv.create(`${ACTIVE_FLOW_PREFIX}${input.payoutId}`, flowId, { ttl: FLOW_TTL_SECONDS }) : false;
    if (!activeCreated) {
      const joinedFlowId = await options.kv.get(`${ACTIVE_FLOW_PREFIX}${input.payoutId}`);
      const joined = joinedFlowId ? await waitForFlow(joinedFlowId) : void 0;
      if (joined && joined.expiresAt > now()) {
        return {
          flowId: joined.flowId,
          challenge: challengeText(input.payoutId, joined.flowId, joined.challenge),
          metadata: publicMetadata(record2, configured.key)
        };
      }
      throw new Error("verification already in progress");
    }
    try {
      await options.kv.set(`${FLOW_PREFIX}${flowId}`, flow, { ttl: FLOW_TTL_SECONDS });
    } catch (error) {
      await options.kv.delete(`${ACTIVE_FLOW_PREFIX}${input.payoutId}`);
      throw error;
    }
    return { flowId, challenge: challengeText(input.payoutId, flowId, challenge), metadata: publicMetadata(record2, configured.key) };
  }
  async function proveLink(input) {
    const flow = await options.kv.get(`${FLOW_PREFIX}${input.flowId}`);
    if (!flow || flow.payoutId !== input.payoutId || flow.expiresAt <= now()) throw new Error("verification session expired");
    const record2 = await readRecord(input.payoutId);
    if (!record2) throw new Error("protected payout not found");
    const configured = requireChannelConfigured(record2.channel);
    const recovered = await recoverMessageAddress({ message: challengeText(flow.payoutId, flow.flowId, flow.challenge), signature: input.proof }).catch(() => null);
    if (!recovered || recovered.toLowerCase() !== record2.shareAProofAddress.toLowerCase()) throw new Error("claim link verification failed");
    const proofCreated = await claimProofForSession(flow, input.session);
    if (!proofCreated) throw new Error("verification link proof already used");
    const proofVerifiedFlow = { ...flow, proofVerified: true };
    await options.kv.set(`${FLOW_PREFIX}${flow.flowId}`, proofVerifiedFlow, { ttl: FLOW_TTL_SECONDS });
    const currentFlow = await options.kv.get(`${FLOW_PREFIX}${flow.flowId}`) ?? proofVerifiedFlow;
    if (currentFlow.otpVerifier && currentFlow.otpExpiresAt) return otpFlowResponse(currentFlow, record2, configured.key);
    const deliveryLockCreated = options.kv.create ? await options.kv.create(otpDeliveryLockKey(flow.flowId), input.session.address, { ttl: OTP_DELIVERY_LOCK_TTL_SECONDS }) : false;
    if (!deliveryLockCreated) {
      const deliveredFlow = await waitForOtpChallenge(flow.flowId);
      if (deliveredFlow?.otpVerifier && deliveredFlow.otpExpiresAt) return otpFlowResponse(deliveredFlow, record2, configured.key);
      throw new ProtectedProviderDeliveryError(record2.channel, flow.flowId, flow.expiresAt);
    }
    try {
      const recipient = decrypt(record2.encryptedRecipient, configured.key).toString("utf8");
      const otp = await sendVerificationCode({ channel: record2.channel, recipient, payoutId: input.payoutId, flow: proofVerifiedFlow, key: configured.key, provider: configured.provider });
      const sentAt = now();
      await options.kv.set(`${FLOW_PREFIX}${flow.flowId}`, { ...proofVerifiedFlow, ...otp, lastSentAt: sentAt }, { ttl: FLOW_TTL_SECONDS });
      return otpFlowResponse({ ...proofVerifiedFlow, ...otp, lastSentAt: sentAt }, record2, configured.key);
    } catch (error) {
      if (error instanceof Error && /verification (email|provider) unavailable/.test(error.message)) {
        throw new ProtectedProviderDeliveryError(record2.channel, flow.flowId, flow.expiresAt);
      }
      throw error;
    } finally {
      await options.kv.delete(otpDeliveryLockKey(flow.flowId));
    }
  }
  async function resend(input) {
    const flow = await options.kv.get(`${FLOW_PREFIX}${input.flowId}`);
    if (!flow || flow.payoutId !== input.payoutId || !flow.proofVerified || flow.expiresAt <= now() || !await hasProofForSession(flow, input.session)) throw new Error("verification session expired");
    if (flow.lastSentAt && now() - flow.lastSentAt < OTP_RESEND_COOLDOWN_SECONDS * 1e3) throw new Error("please wait before requesting another code");
    if (!options.kv.create || !await options.kv.create(otpDeliveryLockKey(flow.flowId), input.session.address, { ttl: OTP_DELIVERY_LOCK_TTL_SECONDS })) throw new Error("please wait before requesting another code");
    const record2 = await readRecord(input.payoutId);
    try {
      if (!record2) throw new Error("protected payout not found");
      const configured = requireChannelConfigured(record2.channel);
      const recipient = decrypt(record2.encryptedRecipient, configured.key).toString("utf8");
      const { otpVerifier: _oldOtpVerifier, otpExpiresAt: _oldOtpExpiresAt, ...invalidatedFlow } = flow;
      await options.kv.set(`${FLOW_PREFIX}${flow.flowId}`, invalidatedFlow, { ttl: FLOW_TTL_SECONDS });
      const otp = await sendVerificationCode({ channel: record2.channel, recipient, payoutId: input.payoutId, flow: invalidatedFlow, key: configured.key, provider: configured.provider });
      const sentAt = now();
      await options.kv.set(`${FLOW_PREFIX}${flow.flowId}`, { ...invalidatedFlow, ...otp, lastSentAt: sentAt }, { ttl: FLOW_TTL_SECONDS });
      return { resendAvailableAt: sentAt + OTP_RESEND_COOLDOWN_SECONDS * 1e3 };
    } catch (error) {
      if (error instanceof Error && /verification (email|provider) unavailable/.test(error.message)) throw new ProtectedProviderDeliveryError(record2?.channel ?? "EMAIL", flow.flowId, flow.expiresAt);
      throw error;
    } finally {
      await options.kv.delete(otpDeliveryLockKey(flow.flowId));
    }
  }
  async function verifyCode(input) {
    const flow = await options.kv.get(`${FLOW_PREFIX}${input.flowId}`);
    if (!flow || flow.payoutId !== input.payoutId || !flow.proofVerified || flow.expiresAt <= now() || !await hasProofForSession(flow, input.session)) throw new Error("verification session expired");
    if (flow.otpAttempts >= MAX_OTP_ATTEMPTS) throw new Error("verification code is invalid or expired");
    const record2 = await readRecord(input.payoutId);
    if (!record2) throw new Error("protected payout not found");
    const configured = requireChannelConfigured(record2.channel);
    const recipient = decrypt(record2.encryptedRecipient, configured.key).toString("utf8");
    let accepted = false;
    if (record2.channel === "EMAIL") {
      if (!/^[0-9]{6}$/.test(input.code) || !flow.otpVerifier || !flow.otpExpiresAt || flow.otpExpiresAt <= now()) throw new Error("verification code is invalid or expired");
      const expected = emailOtpVerifier(configured.key, { payoutId: input.payoutId, flowId: flow.flowId, sessionAddress: flow.sessionAddress, scope: otpScope(flow), recipient, expiresAt: flow.otpExpiresAt, code: input.code });
      accepted = secureHexEqual(flow.otpVerifier, expected);
    } else {
      if (!/^[0-9]{4,10}$/.test(input.code) || !configured.provider.verifyCode) throw new Error("verification provider unavailable");
      try {
        accepted = await withProviderTimeout(configured.provider.verifyCode({ channel: record2.channel, recipient, code: input.code, payoutId: input.payoutId, flowId: flow.flowId }));
      } catch {
        throw new Error("verification provider unavailable");
      }
    }
    if (!accepted) {
      await options.kv.set(`${FLOW_PREFIX}${flow.flowId}`, { ...flow, otpAttempts: flow.otpAttempts + 1 }, { ttl: FLOW_TTL_SECONDS });
      throw new Error("verification code is invalid or expired");
    }
    const grantToken = randomToken();
    const expiresAt = now() + GRANT_TTL_SECONDS * 1e3;
    await options.kv.set(grantKey(grantToken, input.session.address), { version: 1, payoutId: input.payoutId, sessionAddress: input.session.address, expiresAt }, { ttl: GRANT_TTL_SECONDS });
    await options.kv.delete(`${FLOW_PREFIX}${flow.flowId}`);
    await options.kv.delete(`${ACTIVE_FLOW_PREFIX}${input.payoutId}`);
    return { grantToken, expiresAt };
  }
  async function releaseShare(input) {
    const configuredKey = requireKey();
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(input.grantToken)) throw new Error("invalid verification grant");
    const grant = options.kv.take ? await options.kv.take(grantKey(input.grantToken, input.session.address)) : void 0;
    if (!grant || grant.payoutId !== input.payoutId || grant.expiresAt <= now() || grant.sessionAddress.toLowerCase() !== input.session.address.toLowerCase()) throw new Error("verification grant expired");
    requirePayoutEligibility(input.payout, now());
    const record2 = await readRecord(input.payoutId);
    if (!record2 || record2.claimSigner.toLowerCase() !== input.payout.claimSigner.toLowerCase()) throw new Error("protected payout does not match vault");
    return { shareB: `0x${decrypt(record2.encryptedShareB, configuredKey).toString("hex")}` };
  }
  return { register, metadata, begin, proveLink, resend, verifyCode, releaseShare, readRecord, availability, verifyEmailProvider };
}
function createTwilioVerifyProvider(env = process.env) {
  const accountSid = env.TWILIO_ACCOUNT_SID;
  const authToken = env.TWILIO_AUTH_TOKEN;
  const serviceSid = env.TWILIO_VERIFY_SERVICE_SID;
  if (!accountSid || !authToken || !serviceSid) return null;
  const endpoint2 = `https://verify.twilio.com/v2/Services/${encodeURIComponent(serviceSid)}`;
  async function request(path, values) {
    const body = new URLSearchParams(values);
    const response = await fetch(`${endpoint2}/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body,
      signal: AbortSignal.timeout(DEFAULT_PROVIDER_TIMEOUT_MS)
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error("verification provider unavailable");
    return json;
  }
  return {
    async sendVerificationCode(input) {
      await request("Verifications", { To: input.recipient, Channel: "sms" });
    },
    async verifyCode(input) {
      const result = await request("VerificationCheck", { To: input.recipient, Code: input.code });
      return result?.status === "approved";
    }
  };
}
function parseProtectedEmailSender(value) {
  const trimmed = value.trim();
  const match = /^(.*?)\s*<([^<>\s@]+@[^<>\s@]+)>$/.exec(trimmed);
  if (!match) return { email: trimmed };
  const name = match[1].trim();
  return name ? { name, email: match[2] } : { email: match[2] };
}
var GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
var defaultGmailOAuthClientFactory = (clientId, clientSecret) => new google.auth.OAuth2(clientId, clientSecret);
var defaultGmailApiClientFactory = (auth) => google.gmail({ version: "v1", auth });
function errorProperty(error, key) {
  return error && typeof error === "object" && key in error ? error[key] : void 0;
}
function safeGoogleStatus(error) {
  const response = errorProperty(error, "response");
  const responseStatus = response && typeof response === "object" ? errorProperty(response, "status") : void 0;
  const code = errorProperty(error, "code");
  const value = typeof responseStatus === "number" ? responseStatus : code;
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599 ? value : void 0;
}
function safeGoogleReason(error) {
  const response = errorProperty(error, "response");
  const data = response && typeof response === "object" ? errorProperty(response, "data") : void 0;
  const nestedError = data && typeof data === "object" ? errorProperty(data, "error") : void 0;
  const errors = nestedError && typeof nestedError === "object" ? errorProperty(nestedError, "errors") : void 0;
  const first = Array.isArray(errors) ? errors[0] : void 0;
  const reason = first && typeof first === "object" ? errorProperty(first, "reason") : void 0;
  return typeof reason === "string" ? reason.toLowerCase() : "";
}
function classifyGmailApiError(error, phase = "SEND") {
  const status = safeGoogleStatus(error);
  const reason = safeGoogleReason(error);
  let safeCategory = "UNKNOWN";
  if (phase === "TOKEN" && (reason.includes("invalid_grant") || status === 400 || status === 401)) safeCategory = "TOKEN_REFRESH";
  else if (reason.includes("accessnotconfigured") || reason.includes("api_disabled")) safeCategory = "API_DISABLED";
  else if (reason.includes("insufficientpermissions") || reason.includes("insufficient_permission")) safeCategory = "SCOPE";
  else if (reason.includes("ratelimit") || reason.includes("dailylimit") || reason.includes("userratelimit") || status === 429) safeCategory = "QUOTA_OR_RATE_LIMIT";
  else if (reason.includes("timeout") || status === 408 || status === 504) safeCategory = "TIMEOUT";
  else if (status === 401) safeCategory = "AUTH";
  else if (status !== void 0 && status >= 400) safeCategory = "PROVIDER_REJECTED";
  return { provider: "gmail-api", safeCategory, ...status !== void 0 ? { status } : {} };
}
function logGmailApiError(error, phase) {
  const metadata = classifyGmailApiError(error, phase);
  console.warn(JSON.stringify(metadata));
  return metadata;
}
function encodeGmailMessage(input) {
  const message = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    "Subject: Your Reach verification code",
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    input.html
  ].join("\r\n");
  return Buffer.from(message, "utf8").toString("base64url");
}
function createGmailApiEmailProvider(env = process.env, oauthClientFactory = defaultGmailOAuthClientFactory, gmailClientFactory = defaultGmailApiClientFactory) {
  const clientId = env.GMAIL_OAUTH_CLIENT_ID?.trim();
  const clientSecret = env.GMAIL_OAUTH_CLIENT_SECRET?.trim();
  const refreshToken = env.GMAIL_OAUTH_REFRESH_TOKEN?.trim();
  const from = env.REACH_PROTECTED_EMAIL_FROM?.trim();
  if (!clientId || !clientSecret || !refreshToken || !from || /[\r\n]/.test(from)) return null;
  let sender;
  try {
    sender = parseProtectedEmailSender(from);
    normalizeRecipient("EMAIL", sender.email);
  } catch {
    return null;
  }
  const oauthClient = oauthClientFactory(clientId, clientSecret);
  oauthClient.setCredentials({ refresh_token: refreshToken });
  const gmail = gmailClientFactory(oauthClient);
  const fromHeader = sender.name ? `${sender.name} <${sender.email}>` : sender.email;
  return {
    gmailApiConfigured: true,
    async verifyTransport() {
      try {
        const tokenResult = await oauthClient.getAccessToken();
        if (!tokenResult.token) return { ok: false, provider: "gmail-api", scopeAuthorized: false, category: "TOKEN_REFRESH" };
        const tokenInfo = await oauthClient.getTokenInfo(tokenResult.token);
        const scopeAuthorized = Array.isArray(tokenInfo.scopes) && tokenInfo.scopes.includes(GMAIL_SEND_SCOPE);
        return scopeAuthorized ? { ok: true, provider: "gmail-api", scopeAuthorized: true } : { ok: false, provider: "gmail-api", scopeAuthorized: false, category: "SCOPE" };
      } catch (error) {
        const metadata = logGmailApiError(error, "TOKEN");
        return {
          ok: false,
          provider: "gmail-api",
          scopeAuthorized: false,
          category: metadata.safeCategory
        };
      }
    },
    async sendVerificationCode(input) {
      if (input.channel !== "EMAIL" || !input.code) throw new Error("verification email unavailable");
      try {
        const html = `<p><strong>Reach</strong></p><p>Verify your protected payment.</p><p>Your verification code is:</p><p style="font-size:24px;letter-spacing:0.25em"><strong>${input.code}</strong></p><p>This code expires in 5 minutes.</p><p>Only enter this code on the official Reach claim page. If you were not expecting a payment, ignore this email.</p>`;
        await gmail.users.messages.send({
          userId: "me",
          requestBody: { raw: encodeGmailMessage({ from: fromHeader, to: input.recipient, html }) }
        });
      } catch (error) {
        logGmailApiError(error, "SEND");
        throw new Error("verification email unavailable");
      }
    }
  };
}

// src/server/rpcCoordinator.ts
var DEFAULT_RPC_READ_CONCURRENCY = 3;
var DEFAULT_RPC_MAX_RETRIES = 2;
var DEFAULT_RPC_RETRY_BASE_MS = 150;
var DEFAULT_RPC_RETRY_MAX_MS = 1500;
var DEFAULT_RPC_RETRY_TOTAL_MS = 3e3;
var DEFAULT_RPC_CIRCUIT_FAILURE_THRESHOLD = 3;
var DEFAULT_RPC_CIRCUIT_COOLDOWN_MS = 5e3;
async function mapWithConcurrency(values, limit, operation) {
  const results = new Array(values.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= values.length) return;
      results[index] = await operation(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, Math.floor(limit)), values.length) }, () => worker()));
  return results;
}
var RpcAuthorityUnavailableError = class extends Error {
  code = "AUTHORITY_UNAVAILABLE";
  rateLimited;
  retryAfterMs;
  constructor(message = "Tempo authority is temporarily unavailable", options = {}) {
    super(message, options.cause === void 0 ? void 0 : { cause: options.cause });
    this.name = "RpcAuthorityUnavailableError";
    this.rateLimited = options.rateLimited ?? false;
    this.retryAfterMs = options.retryAfterMs;
  }
};
function asRecord(value) {
  return value && typeof value === "object" ? value : void 0;
}
function nestedErrors(error) {
  const values = [];
  const seen = /* @__PURE__ */ new Set();
  let current = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    values.push(current);
    const record2 = asRecord(current);
    current = record2?.cause ?? record2?.error ?? record2?.raw;
  }
  return values;
}
function statusOf(error) {
  for (const candidate of nestedErrors(error)) {
    const record2 = asRecord(candidate);
    const value = record2?.status ?? record2?.statusCode ?? asRecord(record2?.response)?.status;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  }
  return void 0;
}
function messageOf(error) {
  return nestedErrors(error).map((candidate) => {
    const record2 = asRecord(candidate);
    return typeof record2?.message === "string" ? record2.message : String(candidate);
  }).join(" ");
}
function isRateLimitError(error) {
  const status = statusOf(error);
  if (status === 429 || status === 420 || status === 503) return true;
  return /(?:\b429\b|too many requests|rate[ -]?limit|throttl|quota exceeded|resource exhausted)/i.test(messageOf(error));
}
function retryAfterValue(value, now, numericIsMilliseconds = false) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return numericIsMilliseconds ? value : value * 1e3;
  if (typeof value !== "string" || !value.trim()) return void 0;
  const trimmed = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) return retryAfterValue(Number(trimmed), now, numericIsMilliseconds);
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? void 0 : Math.max(0, parsed - now);
}
function retryAfterMsFromError(error, now = Date.now()) {
  for (const candidate of nestedErrors(error)) {
    const record2 = asRecord(candidate);
    const directMs = retryAfterValue(record2?.retryAfterMs, now, true);
    if (directMs !== void 0) return directMs;
    const direct = retryAfterValue(record2?.retryAfter, now);
    if (direct !== void 0) return direct;
    const response = asRecord(record2?.response);
    const headers = response?.headers;
    if (headers && typeof headers.get === "function") {
      const header = headers.get("retry-after");
      const parsed = retryAfterValue(header, now);
      if (parsed !== void 0) return parsed;
    }
    if (headers && typeof headers === "object") {
      const headerRecord = headers;
      const parsed = retryAfterValue(headerRecord["retry-after"] ?? headerRecord["Retry-After"], now);
      if (parsed !== void 0) return parsed;
    }
  }
  const match = messageOf(error).match(/retry[- ]after\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
  return match ? retryAfterValue(match[1], now) : void 0;
}
function defaultSleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
function createTempoRpcReadCoordinator(options = {}) {
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? DEFAULT_RPC_READ_CONCURRENCY));
  const maxRetries = Math.max(0, Math.floor(options.maxRetries ?? DEFAULT_RPC_MAX_RETRIES));
  const retryBaseMs = Math.max(0, options.retryBaseMs ?? DEFAULT_RPC_RETRY_BASE_MS);
  const retryMaxMs = Math.max(retryBaseMs, options.retryMaxMs ?? DEFAULT_RPC_RETRY_MAX_MS);
  const retryTotalMs = Math.max(0, options.retryTotalMs ?? DEFAULT_RPC_RETRY_TOTAL_MS);
  const circuitFailureThreshold = Math.max(1, Math.floor(options.circuitFailureThreshold ?? DEFAULT_RPC_CIRCUIT_FAILURE_THRESHOLD));
  const circuitCooldownMs = Math.max(1, options.circuitCooldownMs ?? DEFAULT_RPC_CIRCUIT_COOLDOWN_MS);
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;
  const logger = options.logger;
  const inFlight = /* @__PURE__ */ new Map();
  const completed = /* @__PURE__ */ new Map();
  const queue = [];
  let active = 0;
  let maxObserved = 0;
  let rateLimitFailures = 0;
  let circuitOpenUntil = 0;
  const metrics = {
    logicalReads: 0,
    dedupHits: 0,
    underlyingRpcCalls: 0,
    maxConcurrency: 0,
    rateLimitEvents: 0,
    retryCount: 0,
    circuitBreakerOpens: 0,
    unresolvedAuthority: 0,
    activeConcurrency: 0,
    queuedReads: 0,
    circuitOpenUntil: null
  };
  const emit = (event, fields = {}) => {
    try {
      logger?.(event, fields);
    } catch {
    }
  };
  const isOpen = () => {
    if (circuitOpenUntil === 0) return false;
    if (now() >= circuitOpenUntil) {
      circuitOpenUntil = 0;
      metrics.circuitOpenUntil = null;
      rateLimitFailures = 0;
      emit("tempo_rpc_circuit_half_open", {});
      return false;
    }
    return true;
  };
  const openCircuit = () => {
    if (circuitOpenUntil > now()) return;
    circuitOpenUntil = now() + circuitCooldownMs;
    metrics.circuitOpenUntil = circuitOpenUntil;
    metrics.circuitBreakerOpens += 1;
    emit("tempo_rpc_circuit_open", { cooldownMs: circuitCooldownMs });
  };
  const execute = async (item) => {
    if (!item.essential && isOpen()) throw new RpcAuthorityUnavailableError(void 0, { rateLimited: true });
    const startedAt = now();
    let attempt = 0;
    let waited = 0;
    while (true) {
      metrics.underlyingRpcCalls += 1;
      try {
        const value = await item.operation();
        rateLimitFailures = 0;
        if (item.cacheTtlMs > 0) completed.set(item.key, { value, expiresAt: now() + item.cacheTtlMs });
        emit("tempo_rpc_read", { kind: item.kind, attempt: attempt + 1, dedup: false });
        return value;
      } catch (error) {
        if (!isRateLimitError(error)) throw error;
        metrics.rateLimitEvents += 1;
        rateLimitFailures += 1;
        emit("tempo_rpc_rate_limited", { kind: item.kind, attempt: attempt + 1 });
        if (rateLimitFailures >= circuitFailureThreshold) openCircuit();
        if (attempt >= maxRetries) {
          throw new RpcAuthorityUnavailableError(void 0, { rateLimited: true, retryAfterMs: retryAfterMsFromError(error, now()), cause: error });
        }
        const retryAfter = retryAfterMsFromError(error, now());
        const exponential = Math.min(retryMaxMs, retryBaseMs * 2 ** attempt);
        const jitter = Math.floor(exponential * 0.25 * Math.max(0, Math.min(1, random())));
        const delay = Math.min(retryMaxMs, Math.max(retryAfter ?? 0, exponential + jitter));
        if (waited + delay > retryTotalMs || now() - startedAt + delay > retryTotalMs) {
          throw new RpcAuthorityUnavailableError(void 0, { rateLimited: true, retryAfterMs: retryAfter, cause: error });
        }
        metrics.retryCount += 1;
        emit("tempo_rpc_retry", { kind: item.kind, attempt: attempt + 1, delayMs: delay });
        await sleep(delay);
        waited += delay;
        attempt += 1;
      }
    }
  };
  const drain = () => {
    while (active < concurrency && queue.length > 0) {
      const item = queue.shift();
      metrics.queuedReads = queue.length;
      active += 1;
      metrics.activeConcurrency = active;
      maxObserved = Math.max(maxObserved, active);
      metrics.maxConcurrency = maxObserved;
      void execute(item).then(item.resolve, item.reject).finally(() => {
        active -= 1;
        metrics.activeConcurrency = active;
        drain();
      });
    }
  };
  const read = (operation, readOptions) => {
    const kind = readOptions.kind ?? "other";
    const essential = readOptions.essential ?? false;
    const cacheTtlMs = Math.max(0, readOptions.cacheTtlMs ?? 0);
    metrics.logicalReads += 1;
    const pending = inFlight.get(readOptions.key);
    if (pending) {
      metrics.dedupHits += 1;
      emit("tempo_rpc_dedup", { kind });
      return pending;
    }
    const cached = completed.get(readOptions.key);
    if (cached) {
      if (cached.expiresAt > now()) return Promise.resolve(cached.value);
      completed.delete(readOptions.key);
    }
    if (!essential && isOpen()) {
      metrics.unresolvedAuthority += 1;
      emit("tempo_rpc_read_blocked", { kind, reason: "circuit_open" });
      return Promise.reject(new RpcAuthorityUnavailableError(void 0, { rateLimited: true }));
    }
    const promise = new Promise((resolve, reject) => {
      queue.push({ key: readOptions.key, kind, essential, cacheTtlMs, operation, resolve, reject });
      metrics.queuedReads = queue.length;
      drain();
    }).finally(() => {
      inFlight.delete(readOptions.key);
      metrics.queuedReads = queue.length;
    });
    inFlight.set(readOptions.key, promise);
    return promise;
  };
  return {
    read,
    markUnresolved(count = 1) {
      metrics.unresolvedAuthority += Math.max(0, count);
      emit("tempo_rpc_authority_unresolved", { count: Math.max(0, count) });
    },
    metrics() {
      return { ...metrics, circuitOpenUntil: circuitOpenUntil || null };
    },
    isCircuitOpen: isOpen,
    clearCompletedCache() {
      completed.clear();
    }
  };
}

// src/server/agentAuthorization.ts
import { createCipheriv as createCipheriv2, createDecipheriv as createDecipheriv2, createHash as createHash3, randomBytes as randomBytes2 } from "node:crypto";
import { isAddress as isAddress6, toFunctionSelector as toFunctionSelector2 } from "viem";
import { createPublicClient, createWalletClient, http } from "viem";
import { tempoModerato } from "viem/chains";
import { Account as TempoAccount2, Actions, KeyAuthorizationManager } from "viem/tempo";
import { KeyAuthorization, SignatureEnvelope } from "ox/tempo";
import { privateKeyToAccount } from "viem/accounts";
var POLICY_PREFIX = "reach:agent-policy:v1:";
var PAYMENT_PREFIX = "reach:agent-payment:v1:";
var MPP_PAYMENT_PREFIX = "reach:agent-mpp-payment:v1:";
var OWNER_POLICY_INDEX_PREFIX = "reach:agent-owner-policies:v1:";
var POLICY_PAYMENT_INDEX_PREFIX = "reach:agent-policy-payments:v1:";
var POLICY_MPP_INDEX_PREFIX = "reach:agent-policy-mpp-payments:v1:";
var POLICY_TTL_SECONDS = 366 * 24 * 60 * 60;
var MAX_POLICY_LIFETIME_SECONDS = 366 * 24 * 60 * 60;
var MAX_DESTINATIONS = 64;
var ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
var APPROVE_SELECTOR = toFunctionSelector2("approve(address,uint256)");
var TRANSFER_SELECTOR = toFunctionSelector2("transfer(address,uint256)");
var CREATE_PAYOUT_SELECTOR = toFunctionSelector2("createPayout(uint256,uint256,address,uint64)");
var SESSION_ESCROW_ADDRESS = "0x4d50500000000000000000000000000000000000";
var SESSION_OPEN_SELECTOR = toFunctionSelector2("open(address,address,address,uint96,bytes32,address)");
var SESSION_TOP_UP_SELECTOR = toFunctionSelector2("topUp((address,address,address,address,bytes32,address,bytes32),uint96)");
var SESSION_CLOSE_SELECTOR = toFunctionSelector2("close((address,address,address,address,bytes32,address,bytes32),uint96,uint96,bytes)");
var SESSION_REQUEST_CLOSE_SELECTOR = toFunctionSelector2("requestClose((address,address,address,address,bytes32,address,bytes32))");
var SESSION_WITHDRAW_SELECTOR = toFunctionSelector2("withdraw((address,address,address,address,bytes32,address,bytes32))");
var processLocks = /* @__PURE__ */ new Map();
function stableJson(value) {
  return JSON.stringify(value);
}
async function withProcessLock(key, operation) {
  const previous = processLocks.get(key) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  processLocks.set(key, previous.then(() => current));
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (processLocks.get(key) === current) processLocks.delete(key);
  }
}
async function atomicUpdate(kv, key, mutate, ttl) {
  const compareAndSet = kv.compareAndSet;
  if (!compareAndSet) {
    return withProcessLock(key, async () => {
      const current = await kv.get(key);
      const change = mutate(current);
      if (change.delete) await kv.delete(key);
      else if (change.value !== void 0) await kv.set(key, change.value, ttl ? { ttl } : void 0);
      return change.result;
    });
  }
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const current = await kv.get(key);
    const change = mutate(current);
    if (change.delete) {
      const deleted = await compareAndSet(key, current === void 0 ? null : stableJson(current), { deleted: true }, { ttl: 30 });
      if (deleted) {
        await kv.delete(key);
        return change.result;
      }
      continue;
    }
    if (change.value === void 0) return change.result;
    const updated = await compareAndSet(key, current === void 0 ? null : stableJson(current), change.value, ttl ? { ttl } : void 0);
    if (updated) return change.result;
  }
  throw new Error("durable authorization state is contended");
}
function parseEncryptionKey(value) {
  if (!value) return void 0;
  if (/^[0-9a-f]{64}$/i.test(value)) return Buffer.from(value, "hex");
  try {
    const decoded = Buffer.from(value, "base64url");
    return decoded.length === 32 ? decoded : void 0;
  } catch {
    return void 0;
  }
}
function encryptSecret(secret, key) {
  const iv = randomBytes2(12);
  const cipher = createCipheriv2("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return {
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url")
  };
}
function decryptSecret(secret, key) {
  const decipher = createDecipheriv2("aes-256-gcm", key, Buffer.from(secret.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(secret.tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(secret.ciphertext, "base64url")), decipher.final()]).toString("utf8");
}
function tokenHash(token) {
  return createHash3("sha256").update(token).digest("hex");
}
function publicPolicy(policy) {
  const remaining = BigInt(policy.cumulativeBudgetRaw) - BigInt(policy.spentRaw) - BigInt(policy.reservedRaw);
  const {
    tokenHash: _tokenHash,
    encryptedPrivateKey: _encryptedPrivateKey,
    keyAuthorization: _keyAuthorization,
    ...safePolicy
  } = policy;
  return {
    ...safePolicy,
    remainingRaw: (remaining < 0n ? 0n : remaining).toString()
  };
}
function policyKey(id) {
  return `${POLICY_PREFIX}${id}`;
}
function paymentKey(policyId, idempotencyKey) {
  return `${PAYMENT_PREFIX}${policyId}:${idempotencyKey}`;
}
function ownerPolicyIndexKey(ownerAddress) {
  return `${OWNER_POLICY_INDEX_PREFIX}${ownerAddress.toLowerCase()}`;
}
function policyPaymentIndexKey(policyId) {
  return `${POLICY_PAYMENT_INDEX_PREFIX}${policyId}`;
}
function policyMppIndexKey(policyId) {
  return `${POLICY_MPP_INDEX_PREFIX}${policyId}`;
}
function requirePositiveUint(value, field) {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) throw new Error(`${field} must be a positive integer`);
  const parsed = BigInt(value);
  if (parsed > (1n << 256n) - 1n) throw new Error(`${field} is too large`);
  return parsed.toString();
}
function normalizeDestinations(values) {
  if (values === void 0 || values === null) return null;
  if (!Array.isArray(values) || values.length > MAX_DESTINATIONS || values.length === 0) throw new Error("allowedDestinations must be a non-empty address list");
  const result = values.map((value) => {
    if (typeof value !== "string" || !isAddress6(value) || value.toLowerCase() === ZERO_ADDRESS) throw new Error("allowedDestinations contains an invalid address");
    return value.toLowerCase();
  });
  return [...new Set(result)];
}
function normalizeOrigins(values) {
  if (values === void 0 || values === null) return null;
  if (!Array.isArray(values) || values.length > MAX_DESTINATIONS || values.length === 0) throw new Error("allowedOrigins must be a non-empty origin list");
  const result = values.map((value) => {
    if (typeof value !== "string") throw new Error("allowedOrigins contains an invalid origin");
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error("allowedOrigins contains an invalid origin");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("allowedOrigins must use http or https");
    if (parsed.username || parsed.password || parsed.pathname !== "/" && parsed.pathname !== "" || parsed.search || parsed.hash) throw new Error("allowedOrigins must contain origins only");
    return parsed.origin.toLowerCase();
  });
  return [...new Set(result)];
}
function selectorsForPurpose(policy, vaultAddress) {
  if (policy.purpose === "VAULT_PAYOUT") {
    return [
      { address: PATH_USD_ADDRESS, selector: APPROVE_SELECTOR, recipients: [vaultAddress] },
      { address: vaultAddress, selector: CREATE_PAYOUT_SELECTOR }
    ];
  }
  if (policy.purpose === "MPP_DIRECT") {
    if (!policy.allowedDestinations || policy.allowedDestinations.length === 0) throw new Error("MPP direct authorization requires recipient allowlist");
    return [{ address: PATH_USD_ADDRESS, selector: TRANSFER_SELECTOR, recipients: policy.allowedDestinations }];
  }
  if (!policy.allowedDestinations || policy.allowedDestinations.length === 0) throw new Error("MPP session authorization requires recipient allowlist");
  return [
    { address: SESSION_ESCROW_ADDRESS, selector: SESSION_OPEN_SELECTOR },
    { address: SESSION_ESCROW_ADDRESS, selector: SESSION_TOP_UP_SELECTOR },
    { address: SESSION_ESCROW_ADDRESS, selector: SESSION_CLOSE_SELECTOR },
    { address: SESSION_ESCROW_ADDRESS, selector: SESSION_REQUEST_CLOSE_SELECTOR },
    { address: SESSION_ESCROW_ADDRESS, selector: SESSION_WITHDRAW_SELECTOR }
  ];
}
function validateKeyAuthorization(policy, value, vaultAddress, rootAddress) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("missing key authorization");
  const authorization = KeyAuthorization.fromRpc(value);
  if (authorization.account && authorization.account.toLowerCase() !== rootAddress.toLowerCase()) throw new Error("access key account binding does not match owner");
  if (authorization.address.toLowerCase() !== policy.agentAddress.toLowerCase()) throw new Error("access key does not match the server-held signer");
  if (Number(authorization.chainId) !== policy.chainId) throw new Error("access key chain is not Reach Moderato");
  if (authorization.type !== "secp256k1") throw new Error("Reach server agents require a secp256k1 access key");
  if (!authorization.expiry || Number(authorization.expiry) !== policy.expiryTimestamp) throw new Error("access key expiry does not match policy");
  if (authorization.isAdmin) throw new Error("admin access keys are not permitted");
  const limits = authorization.limits ?? [];
  if (limits.length !== 1) throw new Error("access key limits are broader than policy");
  const limit = limits[0];
  if (!limit || limit.token.toLowerCase() !== PATH_USD_ADDRESS.toLowerCase() || BigInt(limit.limit) !== BigInt(policy.cumulativeBudgetRaw) || limit.period !== void 0) throw new Error("access key cumulative budget does not match policy");
  const scopes = authorization.scopes ?? [];
  if (authorization.allowAnyCalls === true || scopes.some((scope) => scope?.allowAnyCalls === true)) throw new Error("broad access-key calls are not permitted");
  const expectedScopes = selectorsForPurpose(policy, vaultAddress);
  if (scopes.length !== expectedScopes.length) throw new Error("access key scopes are broader than policy");
  for (const expected of expectedScopes) {
    const actual = scopes.find((scope) => scope.address.toLowerCase() === expected.address.toLowerCase() && scope.selector?.toLowerCase() === expected.selector.toLowerCase());
    if (!actual) throw new Error("access key scopes are incomplete or broader than policy");
    const expectedRecipients = expected.recipients?.map((address) => address.toLowerCase()).sort() ?? void 0;
    const actualRecipients = actual.recipients?.map((address) => address.toLowerCase()).sort() ?? void 0;
    if (JSON.stringify(actualRecipients) !== JSON.stringify(expectedRecipients)) throw new Error("access key recipient scopes are incomplete or broader than policy");
  }
  if (!authorization.signature || !SignatureEnvelope.verify(authorization.signature, { payload: KeyAuthorization.getSignPayload(authorization), address: rootAddress })) throw new Error("owner signature on access key authorization is invalid");
  return authorization;
}
function asRpcAddress(value, field) {
  if (typeof value !== "string" || !isAddress6(value)) throw new Error(`${field} must be a valid address`);
  return value.toLowerCase();
}
async function verifyAccessKeyOnchain(rpcUrl, policy, authorization) {
  const transport = http(rpcUrl, { retryCount: 0, retryDelay: 0, timeout: 1e4 });
  const publicClient = createPublicClient({ chain: tempoModerato, transport });
  const metadata = await Actions.accessKey.getMetadata(publicClient, {
    account: policy.ownerAddress,
    accessKey: policy.agentAddress
  });
  if (metadata.address.toLowerCase() !== policy.agentAddress.toLowerCase()) throw new Error("onchain access key identity does not match policy");
  if (metadata.keyType !== authorization.type) throw new Error("onchain access key type does not match policy");
  if (metadata.expiry !== BigInt(policy.expiryTimestamp)) throw new Error("onchain access key expiry does not match policy");
  if (metadata.isRevoked) throw new Error("onchain access key is revoked");
  const remaining = await Actions.accessKey.getRemainingLimit(publicClient, {
    account: policy.ownerAddress,
    accessKey: policy.agentAddress,
    token: PATH_USD_ADDRESS
  });
  if (remaining.periodEnd !== void 0) throw new Error("onchain access key has a recurring spending limit");
  if (remaining.remaining < BigInt(policy.cumulativeBudgetRaw)) throw new Error("onchain access key has insufficient remaining budget");
}
function createAgentAuthorizationService(kv, dependencies = {}) {
  const store = kv;
  const now = dependencies.now ?? (() => Math.floor(Date.now() / 1e3));
  const rpcUrl = dependencies.rpcUrl ?? process.env.REACH_RPC_URL ?? TEMPO_MODERATO_RPC_URL;
  const vaultAddress = dependencies.vaultAddress ?? process.env.REACH_VAULT_ADDRESS ?? DEFAULT_VAULT_ADDRESS;
  const encryptionKey = parseEncryptionKey(process.env.REACH_AGENT_ENCRYPTION_KEY);
  const verifyAuthorization = dependencies.verifyOnchainAuthorization ?? ((policy, authorization) => verifyAccessKeyOnchain(rpcUrl, policy, authorization));
  function assertAvailable() {
    if (!encryptionKey) throw new Error("agent authorization encryption is not configured");
  }
  async function readPolicy(id) {
    return store.get(policyKey(id));
  }
  async function appendIndex(key, value) {
    await atomicUpdate(store, key, (current) => {
      const values = Array.isArray(current) ? current.filter((item) => typeof item === "string") : [];
      if (!values.includes(value)) values.push(value);
      return { value: values.slice(-2e3), result: void 0 };
    }, POLICY_TTL_SECONDS);
  }
  async function listPolicies(ownerAddress) {
    const owner = asRpcAddress(ownerAddress, "ownerAddress");
    const ids = await store.get(ownerPolicyIndexKey(owner)) ?? [];
    const policies = await Promise.all(ids.map((id) => readPolicy(id)));
    return policies.filter((policy) => Boolean(policy && policy.ownerAddress.toLowerCase() === owner.toLowerCase())).map(publicPolicy).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }
  async function listPayments(ownerAddress, policyId) {
    const owner = asRpcAddress(ownerAddress, "ownerAddress");
    const policy = await readPolicy(policyId);
    if (!policy || policy.ownerAddress.toLowerCase() !== owner.toLowerCase()) return void 0;
    const keys = await store.get(policyPaymentIndexKey(policyId)) ?? [];
    const payments = await Promise.all(keys.map((idempotencyKey) => store.get(paymentKey(policyId, idempotencyKey))));
    return {
      policy: publicPolicy(policy),
      payments: payments.filter((payment) => Boolean(payment)).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    };
  }
  async function listMppPayments(ownerAddress, policyId) {
    const owner = asRpcAddress(ownerAddress, "ownerAddress");
    const policy = await readPolicy(policyId);
    if (!policy || policy.ownerAddress.toLowerCase() !== owner.toLowerCase()) return void 0;
    const keys = await store.get(policyMppIndexKey(policyId)) ?? [];
    const payments = await Promise.all(keys.map((idempotencyKey) => store.get(mppPaymentKey(policyId, idempotencyKey))));
    return {
      policy: publicPolicy(policy),
      payments: payments.filter((payment) => Boolean(payment)).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    };
  }
  async function create(input, ownerAddress) {
    assertAvailable();
    const owner = asRpcAddress(ownerAddress, "ownerAddress");
    const maxPerPaymentRaw = requirePositiveUint(input.maxPerPaymentRaw, "maxPerPaymentRaw");
    const cumulativeBudgetRaw = requirePositiveUint(input.cumulativeBudgetRaw, "cumulativeBudgetRaw");
    if (BigInt(maxPerPaymentRaw) > BigInt(cumulativeBudgetRaw)) throw new Error("maxPerPaymentRaw cannot exceed cumulativeBudgetRaw");
    if (!Number.isSafeInteger(input.expiryTimestamp) || input.expiryTimestamp <= now() || input.expiryTimestamp > now() + MAX_POLICY_LIFETIME_SECONDS) throw new Error("expiryTimestamp is outside the permitted window");
    const allowedDestinations = normalizeDestinations(input.allowedDestinations);
    const purpose = input.purpose ?? "VAULT_PAYOUT";
    if (purpose !== "VAULT_PAYOUT" && purpose !== "MPP_DIRECT" && purpose !== "MPP_SESSION") throw new Error("unsupported authorization purpose");
    if ((purpose === "MPP_DIRECT" || purpose === "MPP_SESSION") && (!allowedDestinations || allowedDestinations.length === 0)) throw new Error(`${purpose === "MPP_SESSION" ? "MPP session" : "MPP direct"} authorization requires allowedDestinations`);
    const allowedOrigins = normalizeOrigins(input.allowedOrigins);
    if ((purpose === "MPP_DIRECT" || purpose === "MPP_SESSION") && (!allowedOrigins || allowedOrigins.length === 0)) throw new Error("MPP authorization requires allowedOrigins");
    const privateKey = `0x${randomBytes2(32).toString("hex")}`;
    const signer = privateKeyToAccount(privateKey);
    const id = randomBytes2(16).toString("hex");
    const token = `reach_agent_${id}_${randomBytes2(32).toString("base64url")}`;
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    const policy = {
      version: 1,
      id,
      ownerAddress: owner,
      agentAddress: signer.address,
      agentPublicKey: signer.publicKey,
      chainId: TEMPO_MODERATO_CHAIN_ID,
      currency: PATH_USD_ADDRESS,
      maxPerPaymentRaw,
      cumulativeBudgetRaw,
      reservedRaw: "0",
      spentRaw: "0",
      expiryTimestamp: input.expiryTimestamp,
      allowedDestinations,
      allowedOrigins,
      purpose,
      status: "PENDING",
      tokenHash: tokenHash(token),
      encryptedPrivateKey: encryptSecret(privateKey, encryptionKey),
      createdAt: timestamp,
      updatedAt: timestamp
    };
    if (!store.create || !await store.create(policyKey(id), policy, { ttl: POLICY_TTL_SECONDS })) throw new Error("could not allocate a unique authorization");
    try {
      await appendIndex(ownerPolicyIndexKey(owner), id);
    } catch (error) {
      await store.delete(policyKey(id));
      throw error;
    }
    return {
      policy: publicPolicy(policy),
      token,
      authorization: {
        chainId: TEMPO_MODERATO_CHAIN_ID,
        expiry: input.expiryTimestamp,
        keyType: "secp256k1",
        publicKey: signer.publicKey,
        // This object crosses JSON before it reaches wallet_authorizeAccessKey.
        // RPC bigint values therefore use the canonical 0x-prefixed form.
        limits: [{ token: PATH_USD_ADDRESS, limit: `0x${BigInt(cumulativeBudgetRaw).toString(16)}` }],
        scopes: selectorsForPurpose(policy, vaultAddress)
      }
    };
  }
  async function activate(id, ownerAddress, keyAuthorization, rootAddress) {
    assertAvailable();
    const policy = await readPolicy(id);
    if (!policy || policy.ownerAddress.toLowerCase() !== ownerAddress.toLowerCase()) throw new Error("authorization not found");
    if (policy.status !== "PENDING") throw new Error("authorization is not pending");
    if (rootAddress.toLowerCase() !== policy.ownerAddress.toLowerCase()) throw new Error("root account does not match owner");
    const storedAuthorization = validateKeyAuthorization(policy, keyAuthorization, vaultAddress, rootAddress);
    await verifyAuthorization(policy, storedAuthorization);
    const updated = { ...policy, status: "ACTIVE", rootAddress: rootAddress.toLowerCase(), keyAuthorization: storedAuthorization, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
    await atomicUpdate(store, policyKey(id), (current) => {
      if (!current || current.status !== "PENDING") throw new Error("authorization changed while activating");
      return { value: updated, result: publicPolicy(updated) };
    }, POLICY_TTL_SECONDS);
    return publicPolicy(updated);
  }
  async function revoke(id, ownerAddress) {
    const policy = await readPolicy(id);
    if (!policy || policy.ownerAddress.toLowerCase() !== ownerAddress.toLowerCase()) throw new Error("authorization not found");
    if (policy.status === "REVOKED") return publicPolicy(policy);
    const updated = { ...policy, status: "REVOKED", updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
    await atomicUpdate(store, policyKey(id), (current) => {
      if (!current || current.ownerAddress.toLowerCase() !== ownerAddress.toLowerCase()) throw new Error("authorization changed while revoking");
      return { value: { ...current, ...updated }, result: publicPolicy({ ...current, ...updated }) };
    }, POLICY_TTL_SECONDS);
    return publicPolicy(updated);
  }
  async function authenticate(token) {
    if (typeof token !== "string" || !/^reach_agent_[a-f0-9]{32}_[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("invalid agent credential");
    const id = token.split("_")[2];
    const policy = await readPolicy(id);
    if (!policy || tokenHash(token) !== policy.tokenHash) throw new Error("invalid agent credential");
    if (policy.status === "ACTIVE" && policy.expiryTimestamp <= now()) {
      await atomicUpdate(store, policyKey(id), (current) => current ? { value: { ...current, status: "EXPIRED", updatedAt: (/* @__PURE__ */ new Date()).toISOString() }, result: void 0 } : { result: void 0 });
      throw new Error("agent authorization expired");
    }
    if (policy.status !== "ACTIVE") throw new Error(`agent authorization is ${policy.status.toLowerCase()}`);
    return policy;
  }
  async function reconcilePolicy(policyId, payment, success, error) {
    await atomicUpdate(store, policyKey(policyId), (current) => {
      if (!current) throw new Error("authorization not found");
      if (!success) {
        return { value: { ...current, reservedRaw: (BigInt(current.reservedRaw) - BigInt(payment.amountRaw)).toString(), updatedAt: (/* @__PURE__ */ new Date()).toISOString() }, result: void 0 };
      }
      return { value: { ...current, reservedRaw: (BigInt(current.reservedRaw) - BigInt(payment.amountRaw)).toString(), spentRaw: (BigInt(current.spentRaw) + BigInt(payment.amountRaw)).toString(), updatedAt: (/* @__PURE__ */ new Date()).toISOString() }, result: void 0 };
    }, POLICY_TTL_SECONDS);
    if (error) await store.set(paymentKey(policyId, payment.idempotencyKey), { ...payment, error, updatedAt: (/* @__PURE__ */ new Date()).toISOString() }, { ttl: POLICY_TTL_SECONDS });
  }
  async function submit(policy, payment) {
    const privateKey = decryptSecret(policy.encryptedPrivateKey, encryptionKey);
    if (dependencies.submitPayout) return dependencies.submitPayout({ policy, payment, privateKey });
    const authorization = KeyAuthorization.fromRpc(policy.keyAuthorization);
    const keyAuthorizationManager = KeyAuthorizationManager.from({ source: {
      async get(key) {
        if (key.address.toLowerCase() !== policy.ownerAddress.toLowerCase() || key.accessKey.toLowerCase() !== policy.agentAddress.toLowerCase() || key.chainId !== policy.chainId) return void 0;
        return authorization;
      },
      async remove() {
      },
      async set() {
      }
    } });
    const account = TempoAccount2.fromSecp256k1(privateKey, { access: policy.ownerAddress, keyAuthorizationManager });
    const transport = http(rpcUrl, { retryCount: 0, retryDelay: 0, timeout: 1e4 });
    const walletClient = createWalletClient({ account, chain: tempoModerato, transport });
    const publicClient = createPublicClient({ chain: tempoModerato, transport });
    const approveTxHash = await walletClient.writeContract({ address: PATH_USD_ADDRESS, abi: pathUsdAbi, functionName: "approve", args: [vaultAddress, BigInt(payment.amountRaw)] });
    const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveTxHash });
    if (approveReceipt.status !== "success") throw new Error("access-key approval reverted");
    const createTxHash = await walletClient.writeContract({ address: vaultAddress, abi: vaultAbi, functionName: "createPayout", args: [BigInt(payment.payoutId), BigInt(payment.amountRaw), payment.claimSigner, BigInt(payment.payoutExpiresAt)] });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: createTxHash });
    if (receipt.status !== "success") throw new Error("access-key payout creation reverted");
    return { approveTxHash, createTxHash };
  }
  async function pay(token, input) {
    const policy = await authenticate(token);
    const amountRaw = requirePositiveUint(input.amountRaw, "amountRaw");
    if (typeof input.idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(input.idempotencyKey)) throw new Error("idempotencyKey is invalid");
    const destination = asRpcAddress(input.destination, "destination");
    const claimSigner = asRpcAddress(input.claimSigner ?? input.destination, "claimSigner");
    if (policy.allowedDestinations && !policy.allowedDestinations.includes(destination.toLowerCase())) throw new Error("destination is outside the authorization allowlist");
    if (BigInt(amountRaw) > BigInt(policy.maxPerPaymentRaw)) throw new Error("payment exceeds the per-payment budget");
    const payoutExpiresAt = input.payoutExpiresAt === void 0 ? Math.min(policy.expiryTimestamp, now() + 7 * 24 * 60 * 60).toString() : requirePositiveUint(input.payoutExpiresAt, "payoutExpiresAt");
    if (BigInt(payoutExpiresAt) <= BigInt(now()) || BigInt(payoutExpiresAt) > BigInt(policy.expiryTimestamp)) throw new Error("payoutExpiresAt is outside the authorization window");
    const existing = await store.get(paymentKey(policy.id, input.idempotencyKey));
    if (existing) {
      if (existing.amountRaw !== amountRaw || existing.destination.toLowerCase() !== destination.toLowerCase() || existing.claimSigner.toLowerCase() !== claimSigner.toLowerCase()) throw new Error("idempotency key was already used for a different payment");
      if (existing.state === "UNKNOWN") throw Object.assign(new Error("payment submission is uncertain; reconcile before retrying"), { code: "UNKNOWN_SETTLEMENT", payment: existing });
      if (existing.state === "FAILED") throw Object.assign(new Error(existing.error ?? "payment failed"), { code: "PAYMENT_FAILED", payment: existing });
      return { payment: existing, policy: publicPolicy(policy) };
    }
    const id = randomBytes2(16).toString("hex");
    const payment = {
      version: 1,
      id,
      policyId: policy.id,
      idempotencyKey: input.idempotencyKey,
      payoutId: BigInt(`0x${randomBytes2(32).toString("hex")}`).toString(),
      amountRaw,
      destination,
      claimSigner,
      payoutExpiresAt,
      state: "RESERVED",
      reservedAt: (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    if (!store.create || !await store.create(paymentKey(policy.id, input.idempotencyKey), payment, { ttl: POLICY_TTL_SECONDS })) {
      const retry = await store.get(paymentKey(policy.id, input.idempotencyKey));
      if (retry) return { payment: retry, policy: publicPolicy(policy) };
      throw new Error("could not allocate payment idempotency record");
    }
    try {
      await appendIndex(policyPaymentIndexKey(policy.id), input.idempotencyKey);
    } catch (error) {
      await store.delete(paymentKey(policy.id, input.idempotencyKey));
      throw error;
    }
    let reserved = false;
    try {
      await atomicUpdate(store, policyKey(policy.id), (current) => {
        if (!current || current.status !== "ACTIVE") throw new Error("agent authorization is no longer active");
        if (current.expiryTimestamp <= now()) throw new Error("agent authorization expired");
        const nextReserved = BigInt(current.reservedRaw) + BigInt(amountRaw);
        if (BigInt(current.spentRaw) + nextReserved > BigInt(current.cumulativeBudgetRaw)) throw new Error("payment exceeds the cumulative budget");
        return { value: { ...current, reservedRaw: nextReserved.toString(), updatedAt: (/* @__PURE__ */ new Date()).toISOString() }, result: void 0 };
      }, POLICY_TTL_SECONDS);
      reserved = true;
      await store.set(paymentKey(policy.id, input.idempotencyKey), { ...payment, state: "SUBMITTING", updatedAt: (/* @__PURE__ */ new Date()).toISOString() }, { ttl: POLICY_TTL_SECONDS });
      const result = await submit(policy, payment);
      const confirmed = { ...payment, state: "CONFIRMED", approveTxHash: result.approveTxHash, createTxHash: result.createTxHash, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
      await store.set(paymentKey(policy.id, input.idempotencyKey), confirmed, { ttl: POLICY_TTL_SECONDS });
      await reconcilePolicy(policy.id, confirmed, true);
      const updatedPolicy = await readPolicy(policy.id);
      return { payment: confirmed, policy: publicPolicy(updatedPolicy ?? policy) };
    } catch (error) {
      const message = error instanceof Error ? error.message : "payment submission is uncertain";
      const unknown = /timeout|timed out|network|transport|rpc|socket|unknown|fetch/i.test(message);
      const failed = { ...payment, state: unknown ? "UNKNOWN" : "FAILED", error: unknown ? "Payment submission is uncertain. Do not retry this idempotency key; reconcile it first." : message, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
      await store.set(paymentKey(policy.id, input.idempotencyKey), failed, { ttl: POLICY_TTL_SECONDS });
      if (!unknown && reserved) await reconcilePolicy(policy.id, failed, false);
      throw Object.assign(new Error(failed.error), { code: unknown ? "UNKNOWN_SETTLEMENT" : "PAYMENT_FAILED", payment: failed });
    }
  }
  async function getPayment(token, idempotencyKey) {
    const policy = await authenticate(token);
    const payment = await store.get(paymentKey(policy.id, idempotencyKey));
    if (!payment) throw new Error("payment not found");
    return { payment, policy: publicPolicy(policy) };
  }
  async function reconcilePayment(token, idempotencyKey) {
    const policy = await authenticate(token);
    const payment = await store.get(paymentKey(policy.id, idempotencyKey));
    if (!payment) throw new Error("payment not found");
    if (payment.state !== "UNKNOWN") return { payment, policy: publicPolicy(policy) };
    if (!dependencies.readPayout) throw new Error("payment reconciliation authority is not configured");
    const payout = await dependencies.readPayout(BigInt(payment.payoutId));
    const matchingPayout = payout.amount === BigInt(payment.amountRaw) && payout.claimSigner.toLowerCase() === payment.claimSigner.toLowerCase() && (payout.sender.toLowerCase() === policy.ownerAddress.toLowerCase() || payout.sender.toLowerCase() === policy.agentAddress.toLowerCase());
    if (!matchingPayout || payout.status === 0) throw new Error("payment is not yet authoritative onchain");
    const confirmed = {
      ...payment,
      state: "CONFIRMED",
      error: void 0,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await store.set(paymentKey(policy.id, idempotencyKey), confirmed, { ttl: POLICY_TTL_SECONDS });
    await reconcilePolicy(policy.id, confirmed, true);
    const updatedPolicy = await readPolicy(policy.id);
    return { payment: confirmed, policy: publicPolicy(updatedPolicy ?? policy) };
  }
  function mppPaymentKey(policyId, idempotencyKey) {
    return `${MPP_PAYMENT_PREFIX}${policyId}:${idempotencyKey}`;
  }
  async function mppReserve(token, input) {
    const policy = await authenticate(token);
    if (policy.purpose !== "MPP_DIRECT" && policy.purpose !== "MPP_SESSION") throw new Error("authorization is not approved for MPP payments");
    const expectedMode = policy.purpose === "MPP_DIRECT" ? "charge" : "session";
    if (input.mode !== expectedMode) throw new Error("authorization purpose does not match MPP payment mode");
    const amountRaw = requirePositiveUint(input.amountRaw, "amountRaw");
    const recipient = asRpcAddress(input.recipient, "recipient");
    if (!policy.allowedDestinations?.some((address) => address.toLowerCase() === recipient.toLowerCase())) throw new Error("MPP recipient is outside the authorization allowlist");
    if (!policy.allowedOrigins?.includes(input.endpointOrigin.toLowerCase())) throw new Error("MPP endpoint origin is outside the authorization allowlist");
    if (BigInt(amountRaw) > BigInt(policy.maxPerPaymentRaw)) throw new Error("MPP payment exceeds the per-payment budget");
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(input.idempotencyKey)) throw new Error("idempotencyKey is invalid");
    const key = mppPaymentKey(policy.id, input.idempotencyKey);
    const existing = await store.get(key);
    if (existing) {
      if (existing.amountRaw !== amountRaw || existing.recipient.toLowerCase() !== recipient.toLowerCase() || existing.mode !== input.mode || existing.endpointOrigin !== input.endpointOrigin.toLowerCase()) throw new Error("MPP idempotency key was already used for a different payment");
      if (existing.state === "UNKNOWN") throw Object.assign(new Error("MPP payment submission is uncertain; reconcile before retrying"), { code: "UNKNOWN_SETTLEMENT", payment: existing });
      if (existing.state === "FAILED") throw Object.assign(new Error(existing.error ?? "MPP payment failed"), { code: "PAYMENT_FAILED", payment: existing });
      if (existing.state === "CONFIRMED") return { payment: existing, policy: publicPolicy(policy), replay: true };
      throw new Error("MPP payment is already in progress");
    }
    const payment = {
      version: 1,
      id: randomBytes2(16).toString("hex"),
      policyId: policy.id,
      idempotencyKey: input.idempotencyKey,
      mode: input.mode,
      amountRaw,
      recipient,
      endpointOrigin: input.endpointOrigin.toLowerCase(),
      state: "RESERVED",
      reservedAt: (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    if (!store.create || !await store.create(key, payment, { ttl: POLICY_TTL_SECONDS })) {
      const retry = await store.get(key);
      if (retry) return { payment: retry, policy: publicPolicy(policy), replay: retry.state === "CONFIRMED" };
      throw new Error("could not allocate MPP payment idempotency record");
    }
    try {
      await appendIndex(policyMppIndexKey(policy.id), input.idempotencyKey);
    } catch (error) {
      await store.delete(key);
      throw error;
    }
    try {
      await atomicUpdate(store, policyKey(policy.id), (current) => {
        if (!current || current.status !== "ACTIVE") throw new Error("agent authorization is no longer active");
        if (current.expiryTimestamp <= now()) throw new Error("agent authorization expired");
        const nextReserved = BigInt(current.reservedRaw) + BigInt(amountRaw);
        if (BigInt(current.spentRaw) + nextReserved > BigInt(current.cumulativeBudgetRaw)) throw new Error("MPP payment exceeds the cumulative budget");
        return { value: { ...current, reservedRaw: nextReserved.toString(), updatedAt: (/* @__PURE__ */ new Date()).toISOString() }, result: void 0 };
      }, POLICY_TTL_SECONDS);
      return { payment, policy: publicPolicy({ ...await readPolicy(policy.id) ?? policy }), replay: false };
    } catch (error) {
      await store.delete(key);
      throw error;
    }
  }
  async function mppConfirm(token, idempotencyKey, input) {
    const policy = await authenticate(token);
    const key = mppPaymentKey(policy.id, idempotencyKey);
    const existing = await store.get(key);
    if (!existing) throw new Error("MPP payment not found");
    if (existing.state === "CONFIRMED") return { payment: existing, policy: publicPolicy(policy) };
    if (existing.state !== "RESERVED") throw new Error("MPP payment is not confirmable");
    if (!input.receipt || typeof input.receipt !== "object" || input.receipt.status !== "success" || input.receipt.method !== "tempo" || typeof input.receipt.reference !== "string" || !input.receipt.reference) throw new Error("MPP receipt is not authoritative");
    if (!Number.isInteger(input.responseStatus) || input.responseStatus < 200 || input.responseStatus >= 300) throw new Error("MPP paid response status is not successful");
    const confirmed = { ...existing, state: "CONFIRMED", receipt: input.receipt, responseStatus: input.responseStatus, responseBody: input.responseBody, responseContentType: input.responseContentType, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
    const transition = await atomicUpdate(store, key, (current) => {
      if (!current) throw new Error("MPP payment not found");
      if (current.state === "CONFIRMED") return { result: { payment: current, transitioned: false } };
      if (current.state !== "RESERVED") throw new Error("MPP payment is not confirmable");
      return { value: confirmed, result: { payment: confirmed, transitioned: true } };
    }, POLICY_TTL_SECONDS);
    if (!transition.transitioned) return { payment: transition.payment, policy: publicPolicy(policy) };
    await atomicUpdate(store, policyKey(policy.id), (current) => {
      if (!current) throw new Error("authorization not found");
      return { value: { ...current, reservedRaw: (BigInt(current.reservedRaw) - BigInt(existing.amountRaw)).toString(), spentRaw: (BigInt(current.spentRaw) + BigInt(existing.amountRaw)).toString(), updatedAt: (/* @__PURE__ */ new Date()).toISOString() }, result: void 0 };
    }, POLICY_TTL_SECONDS);
    await store.set(key, confirmed, { ttl: POLICY_TTL_SECONDS });
    const updatedPolicy = await readPolicy(policy.id);
    return { payment: confirmed, policy: publicPolicy(updatedPolicy ?? policy) };
  }
  async function mppReconcile(token, idempotencyKey) {
    const policy = await authenticate(token);
    const key = mppPaymentKey(policy.id, idempotencyKey);
    const existing = await store.get(key);
    if (!existing) throw new Error("MPP payment not found");
    if (existing.state !== "UNKNOWN") return { payment: existing, policy: publicPolicy(policy) };
    if (!dependencies.readMppReceipt) throw new Error("MPP payment reconciliation authority is not configured");
    const receipt = await dependencies.readMppReceipt(existing);
    if (!receipt || typeof receipt !== "object" || receipt.status !== "success" || receipt.method !== "tempo" || typeof receipt.reference !== "string" || !receipt.reference) throw new Error("MPP payment is not yet authoritative onchain");
    const confirmed = { ...existing, state: "CONFIRMED", receipt, error: void 0, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
    const transition = await atomicUpdate(store, key, (current) => {
      if (!current) throw new Error("MPP payment not found");
      if (current.state === "CONFIRMED") return { result: { payment: current, transitioned: false } };
      if (current.state !== "UNKNOWN") throw new Error("MPP payment is not awaiting reconciliation");
      return { value: confirmed, result: { payment: confirmed, transitioned: true } };
    }, POLICY_TTL_SECONDS);
    if (!transition.transitioned) return { payment: transition.payment, policy: publicPolicy(policy) };
    await atomicUpdate(store, policyKey(policy.id), (current) => {
      if (!current) throw new Error("authorization not found");
      return { value: { ...current, reservedRaw: (BigInt(current.reservedRaw) - BigInt(existing.amountRaw)).toString(), spentRaw: (BigInt(current.spentRaw) + BigInt(existing.amountRaw)).toString(), updatedAt: (/* @__PURE__ */ new Date()).toISOString() }, result: void 0 };
    }, POLICY_TTL_SECONDS);
    const updatedPolicy = await readPolicy(policy.id);
    return { payment: confirmed, policy: publicPolicy(updatedPolicy ?? policy) };
  }
  async function mppFail(token, idempotencyKey, message, uncertain, reference) {
    const policy = await authenticate(token);
    const key = mppPaymentKey(policy.id, idempotencyKey);
    const existing = await store.get(key);
    if (!existing) throw new Error("MPP payment not found");
    if (existing.state === "CONFIRMED" || existing.state === "UNKNOWN") return { payment: existing, policy: publicPolicy(policy) };
    const failed = { ...existing, ...reference ? { reference } : {}, state: uncertain ? "UNKNOWN" : "FAILED", error: message, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
    const transition = await atomicUpdate(store, key, (current) => {
      if (!current) throw new Error("MPP payment not found");
      if (current.state === "CONFIRMED" || current.state === "UNKNOWN" || current.state === "FAILED") return { result: { payment: current, transitioned: false } };
      if (current.state !== "RESERVED") throw new Error("MPP payment is not fail-able");
      return { value: failed, result: { payment: failed, transitioned: true } };
    }, POLICY_TTL_SECONDS);
    if (transition.transitioned && !uncertain) {
      await atomicUpdate(store, policyKey(policy.id), (current) => {
        if (!current) throw new Error("authorization not found");
        return { value: { ...current, reservedRaw: (BigInt(current.reservedRaw) - BigInt(existing.amountRaw)).toString(), updatedAt: (/* @__PURE__ */ new Date()).toISOString() }, result: void 0 };
      }, POLICY_TTL_SECONDS);
    }
    const updatedPolicy = await readPolicy(policy.id);
    return { payment: transition.payment, policy: publicPolicy(updatedPolicy ?? policy) };
  }
  async function getMppPayment(token, idempotencyKey) {
    const policy = await authenticate(token);
    const payment = await store.get(mppPaymentKey(policy.id, idempotencyKey));
    return payment ? { payment, policy: publicPolicy(policy) } : void 0;
  }
  async function withSigner(token, purpose, operation) {
    const policy = await authenticate(token);
    if (policy.purpose !== purpose) throw new Error("authorization purpose does not permit this MPP operation");
    const privateKey = decryptSecret(policy.encryptedPrivateKey, encryptionKey);
    const authorization = KeyAuthorization.fromRpc(policy.keyAuthorization);
    const keyAuthorizationManager = KeyAuthorizationManager.from({ source: {
      async get(key) {
        if (key.address.toLowerCase() !== policy.ownerAddress.toLowerCase() || key.accessKey.toLowerCase() !== policy.agentAddress.toLowerCase() || key.chainId !== policy.chainId) return void 0;
        return authorization;
      },
      async remove() {
      },
      async set() {
      }
    } });
    const account = TempoAccount2.fromSecp256k1(privateKey, { access: policy.ownerAddress, keyAuthorizationManager });
    const transport = http(rpcUrl, { retryCount: 0, retryDelay: 0, timeout: 1e4 });
    const walletClient = createWalletClient({ account, chain: tempoModerato, transport });
    const publicClient = createPublicClient({ chain: tempoModerato, transport });
    return operation({ policy: publicPolicy(policy), account, walletClient, publicClient });
  }
  return {
    create,
    activate,
    revoke,
    authenticate,
    pay,
    getPayment,
    reconcilePayment,
    mppReserve,
    mppConfirm,
    mppReconcile,
    mppFail,
    getMppPayment,
    listPolicies,
    listPayments,
    listMppPayments,
    withSigner,
    readPolicy,
    publicPolicy
  };
}

// src/server/mpp.ts
import { createHmac as createHmac2, timingSafeEqual as timingSafeEqual2 } from "node:crypto";
import { Mppx, Store, tempo } from "mppx/server";
import { createWalletClient as createWalletClient2, http as http2, isAddress as isAddress7 } from "viem";
import { privateKeyToAccount as privateKeyToAccount2 } from "viem/accounts";
import { tempoModerato as tempoModerato2 } from "viem/chains";
var MPP_PREFIX = "reach:mpp:v1:";
var RECEIPT_TTL_SECONDS = 30 * 24 * 60 * 60;
var IDENTITY_HEADER = "x-reach-mpp-identity";
var localLocks = /* @__PURE__ */ new Map();
function safeJson(value) {
  return JSON.parse(JSON.stringify(value, (_key, nested) => typeof nested === "bigint" ? nested.toString() : nested));
}
async function withLock(key, operation) {
  const previous = localLocks.get(key) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  localLocks.set(key, previous.then(() => current));
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (localLocks.get(key) === current) localLocks.delete(key);
  }
}
function createMppStore(kv) {
  return Store.upstash({
    async get(key) {
      return await kv.get(key) ?? null;
    },
    async set(key, value) {
      await kv.set(key, value, { ttl: RECEIPT_TTL_SECONDS });
    },
    async del(key) {
      await kv.delete(key);
    },
    async update(key, fn) {
      if (!kv.compareAndSet) {
        return withLock(key, async () => {
          const current = await kv.get(key) ?? null;
          const change = fn(current);
          if (change.op === "set") await kv.set(key, change.value, { ttl: RECEIPT_TTL_SECONDS });
          else if (change.op === "delete") await kv.delete(key);
          return change.result;
        });
      }
      for (let attempt = 0; attempt < 24; attempt += 1) {
        const current = await kv.get(key);
        const change = fn(current ?? null);
        if (change.op === "noop") return change.result;
        if (change.op === "delete") {
          const tombstone = await kv.compareAndSet(key, current === void 0 ? null : JSON.stringify(current), { deleted: true }, { ttl: 1 });
          if (tombstone) return change.result;
          continue;
        }
        const updated = await kv.compareAndSet(key, current === void 0 ? null : JSON.stringify(current), change.value, { ttl: RECEIPT_TTL_SECONDS });
        if (updated) return change.result;
      }
      throw new Error("durable MPP store is contended");
    }
  }, { keyPrefix: MPP_PREFIX });
}
function createMppService(kv) {
  const secretKey = process.env.MPP_SECRET_KEY;
  const recipientValue = process.env.REACH_MPP_RECIPIENT_ADDRESS;
  if (!secretKey || !recipientValue || !isAddress7(recipientValue)) return void 0;
  const recipient = recipientValue;
  const price = process.env.REACH_MPP_PRICE ?? "0.01";
  const identitySecret = process.env.REACH_MPP_IDENTITY_SECRET ?? secretKey;
  const settlementPrivateKey = process.env.REACH_MPP_SETTLEMENT_PRIVATE_KEY;
  const settlementAccount = settlementPrivateKey ? privateKeyToAccount2(settlementPrivateKey) : void 0;
  if (settlementAccount && settlementAccount.address.toLowerCase() !== recipient.toLowerCase()) throw new Error("MPP settlement signer must equal the configured recipient");
  const settlementClient = settlementAccount ? createWalletClient2({ account: settlementAccount, chain: tempoModerato2, transport: http2(process.env.REACH_RPC_URL ?? "https://rpc.moderato.tempo.xyz", { retryCount: 0, retryDelay: 0, timeout: 1e4 }) }) : void 0;
  const store = createMppStore(kv);
  const sessionIdentity = async (parameters) => {
    const value = parameters.request?.headers.get(IDENTITY_HEADER);
    const sourceAddress = parameters.source?.match(/(0x[0-9a-fA-F]{40})$/)?.[1];
    if (!value || !sourceAddress) return null;
    const separator = value.indexOf(".");
    if (separator <= 0) return null;
    const identity = value.slice(0, separator);
    const supplied = value.slice(separator + 1);
    const expected = createHmac2("sha256", identitySecret).update(`${identity}:${sourceAddress.toLowerCase()}:${recipient.toLowerCase()}`).digest("base64url");
    const suppliedBytes = Buffer.from(supplied);
    const expectedBytes = Buffer.from(expected);
    if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual2(suppliedBytes, expectedBytes)) return null;
    return await kv.get(`${MPP_PREFIX}identity:${identity}:${recipient.toLowerCase()}`) ?? null;
  };
  const mppx = Mppx.create({
    methods: [
      tempo.charge({
        testnet: true,
        chainId: TEMPO_MODERATO_CHAIN_ID,
        currency: PATH_USD_ADDRESS,
        recipient,
        store,
        storeKeyPrefix: "charge:",
        waitForConfirmation: true
      }),
      tempo.session({
        chainId: TEMPO_MODERATO_CHAIN_ID,
        currency: PATH_USD_ADDRESS,
        recipient,
        store,
        sse: false,
        minVoucherDelta: "0",
        account: settlementAccount,
        feePayer: settlementAccount ? true : void 0,
        bootstrap: true,
        resolveChannelId: sessionIdentity,
        ...settlementClient ? { getClient: async () => settlementClient } : {},
        ...settlementAccount ? { settlementSchedule: { intervalMs: 6e4 } } : {},
        onSessionSettlement: async (settlement) => {
          await kv.set(`${MPP_PREFIX}settlement:${settlement.txHash}`, safeJson({ status: "CONFIRMED", ...settlement, recordedAt: (/* @__PURE__ */ new Date()).toISOString() }), { ttl: RECEIPT_TTL_SECONDS });
        },
        onSessionSettlementFailure: async (failure) => {
          await kv.set(`${MPP_PREFIX}settlement-failure:${failure.channelId}:${failure.trigger}`, safeJson({ status: "UNKNOWN", ...failure, error: failure.error instanceof Error ? failure.error.message : String(failure.error), recordedAt: (/* @__PURE__ */ new Date()).toISOString() }), { ttl: RECEIPT_TTL_SECONDS });
        }
      })
    ],
    realm: process.env.MPP_REALM ?? "Reach agent service",
    secretKey
  });
  mppx.onPaymentSuccess(async ({ receipt, challenge, request }) => {
    const reference = typeof receipt.reference === "string" ? receipt.reference : challenge.id;
    await kv.set(`${MPP_PREFIX}receipt:${reference}`, safeJson({
      status: "CONFIRMED",
      chainId: TEMPO_MODERATO_CHAIN_ID,
      receipt,
      challenge,
      request,
      recordedAt: (/* @__PURE__ */ new Date()).toISOString()
    }), { ttl: RECEIPT_TTL_SECONDS });
    const identity = request instanceof Request ? request.headers.get(IDENTITY_HEADER) : void 0;
    const channelId = typeof receipt.channelId === "string" ? receipt.channelId : void 0;
    if (identity && channelId && identity.includes(".")) {
      const identityId = identity.slice(0, identity.indexOf("."));
      await kv.set(`${MPP_PREFIX}identity:${identityId}:${recipient.toLowerCase()}`, channelId, { ttl: RECEIPT_TTL_SECONDS });
    }
  });
  return {
    recipient,
    price,
    chainId: TEMPO_MODERATO_CHAIN_ID,
    async handle(request) {
      const result = await mppx.tempo.charge({
        amount: price,
        currency: PATH_USD_ADDRESS,
        recipient,
        supportedModes: ["pull"],
        description: "Reach agent service charge"
      })(request);
      if (result.status === 402) return result.challenge;
      return result.withReceipt(Response.json({
        ok: true,
        service: "Reach agent service",
        payment: "CONFIRMED",
        chainId: TEMPO_MODERATO_CHAIN_ID
      }));
    },
    async handleSession(request) {
      const result = await mppx.tempo.session({
        amount: price,
        unitType: "request",
        suggestedDeposit: price,
        currency: PATH_USD_ADDRESS,
        recipient
      })(request);
      if (result.status === 402) return result.challenge;
      return result.withReceipt(Response.json({
        ok: true,
        service: "Reach agent session service",
        payment: "CONFIRMED",
        chainId: TEMPO_MODERATO_CHAIN_ID
      }));
    }
  };
}

// src/server/mppPayer.ts
import { createHmac as createHmac3 } from "node:crypto";
import { Challenge, Constants, Credential, Receipt } from "mppx";
import { Mppx as Mppx2, createJsonChannelStore, sessionManager, tempo as tempo2 } from "mppx/client";
import { formatUnits, keccak256 as keccak2563 } from "viem";
var PAYMENT_HEADER_NAMES = [
  Constants.Headers.authorization,
  Constants.Headers.paymentAuthorization,
  Constants.Headers.paymentSession,
  Constants.Headers.paymentReceipt,
  Constants.Headers.wwwAuthenticate
];
var MPP_SESSION_ESCROW = "0x4d50500000000000000000000000000000000000";
var MPP_IDENTITY_HEADER = "x-reach-mpp-identity";
var payerLocks = /* @__PURE__ */ new Map();
function safeJson2(value) {
  return JSON.parse(JSON.stringify(value, (_key, nested) => typeof nested === "bigint" ? nested.toString() : nested));
}
async function withPayerLock(key, operation) {
  const previous = payerLocks.get(key) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  payerLocks.set(key, previous.then(() => current));
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (payerLocks.get(key) === current) payerLocks.delete(key);
  }
}
function endpoint(input, allowedOrigins) {
  let url;
  try {
    url = new URL(input.url);
  } catch {
    throw new Error("MPP endpoint URL is invalid");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("MPP endpoint must use http or https");
  const origin = url.origin.toLowerCase();
  if (!allowedOrigins?.includes(origin)) throw new Error("MPP endpoint origin is outside the authorization allowlist");
  return { url, origin };
}
function requestInit(input) {
  const headers = new Headers(input.headers ?? {});
  for (const name of PAYMENT_HEADER_NAMES) headers.delete(name);
  if (headers.has("host") || headers.has("content-length")) throw new Error("MPP request contains a forbidden transport header");
  return {
    method: input.method ?? "GET",
    headers,
    ...input.body === void 0 ? {} : { body: input.body },
    redirect: "manual"
  };
}
function guardedFetch(fetcher, allowedOrigins) {
  return async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("MPP endpoint must use http or https");
    if (!allowedOrigins?.includes(url.origin.toLowerCase())) throw new Error("MPP endpoint origin is outside the authorization allowlist");
    const response = await fetcher(input, { ...init, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) throw new Error("MPP endpoint redirects are not permitted");
    return response;
  };
}
function validateChallenge(challenge, policy, mode, origin) {
  if (challenge.method !== "tempo" || challenge.intent !== mode) throw new Error("unsupported MPP challenge");
  const challengeChainId = challenge.request?.chainId ?? challenge.request?.methodDetails?.chainId;
  if (challengeChainId !== policy.chainId) throw new Error("MPP challenge chain is not authorized");
  if (String(challenge.request?.currency ?? "").toLowerCase() !== policy.currency.toLowerCase()) throw new Error("MPP challenge currency is not authorized");
  if (typeof challenge.request?.amount !== "string" || !/^[1-9][0-9]*$/.test(challenge.request.amount)) throw new Error("MPP challenge amount is invalid");
  if (BigInt(challenge.request.amount) > BigInt(policy.maxPerPaymentRaw)) throw new Error("MPP challenge exceeds the per-payment budget");
  const expiresAt = typeof challenge.expires === "string" ? Math.floor(new Date(challenge.expires).getTime() / 1e3) : NaN;
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1e3) || expiresAt > policy.expiryTimestamp) throw new Error("MPP challenge expiry is outside the authorization window");
  const recipientValue = challenge.request?.recipient;
  if (typeof recipientValue !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(recipientValue)) throw new Error("MPP challenge recipient is invalid");
  const recipient = recipientValue.toLowerCase();
  if (!policy.allowedDestinations?.some((address) => address.toLowerCase() === recipient)) throw new Error("MPP challenge recipient is outside the authorization allowlist");
  if (!policy.allowedOrigins?.includes(origin)) throw new Error("MPP challenge origin is outside the authorization allowlist");
  if (mode === "charge" && !challenge.request?.methodDetails?.supportedModes?.includes("pull")) throw new Error("MPP challenge does not support the required pull mode");
  if (mode === "charge" && challenge.request?.methodDetails?.splits) throw new Error("MPP split payments are not permitted");
  if (mode === "session" && challenge.request?.methodDetails?.sessionProtocol !== "v2") throw new Error("unsupported MPP session protocol");
  if (mode === "session" && challenge.request?.methodDetails?.escrowContract?.toLowerCase() !== MPP_SESSION_ESCROW) throw new Error("MPP session escrow is not authorized");
  return { amountRaw: challenge.request.amount, recipient };
}
function receiptFromResponse(response) {
  const receipt = Receipt.fromResponse(response);
  if (receipt.status !== "success" || receipt.method !== "tempo" || typeof receipt.reference !== "string" || receipt.reference.length === 0) throw new Error("MPP response receipt is not authoritative");
  return safeJson2(receipt);
}
function referenceFromCredential(credential) {
  try {
    const parsed = Credential.deserialize(credential);
    if (parsed.payload?.type === "hash" && typeof parsed.payload.hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(parsed.payload.hash)) return parsed.payload.hash;
    if (parsed.payload?.type === "transaction" && typeof parsed.payload.signature === "string" && /^0x[0-9a-fA-F]+$/.test(parsed.payload.signature)) return keccak2563(parsed.payload.signature);
  } catch {
  }
  return void 0;
}
function identityHeader(policy, payerAddress) {
  const secret = process.env.REACH_MPP_IDENTITY_SECRET;
  const recipient = policy.allowedDestinations?.[0];
  if (!secret || typeof policy.id !== "string" || typeof recipient !== "string") return void 0;
  const identity = policy.id;
  const proof = createHmac3("sha256", secret).update(`${identity}:${payerAddress.toLowerCase()}:${recipient.toLowerCase()}`).digest("base64url");
  return `${identity}.${proof}`;
}
function createMppPayerService(agentService, kv, dependencies = {}) {
  const fetcher = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
  async function request(token, input) {
    const existing = await agentService.getMppPayment(token, input.idempotencyKey);
    if (existing?.payment.state === "CONFIRMED") return { payment: existing.payment, response: { status: existing.payment.responseStatus, body: existing.payment.responseBody ?? "", contentType: existing.payment.responseContentType } };
    return agentService.withSigner(token, "MPP_DIRECT", async ({ policy, account, publicClient }) => {
      const target = endpoint(input, policy.allowedOrigins);
      const init = requestInit(input);
      let reserved = false;
      let paymentReference;
      const payerFetch = guardedFetch(fetcher, policy.allowedOrigins);
      const mppx = Mppx2.create({
        polyfill: false,
        fetch: payerFetch,
        methods: [tempo2.charge({
          account,
          getClient: () => publicClient,
          expectedChainId: policy.chainId,
          expectedRecipients: policy.allowedDestinations ?? [],
          mode: "pull"
        })],
        maxPaymentRetries: 1,
        onChallenge: async (challenge, helpers) => {
          const checked = validateChallenge(challenge, policy, "charge", target.origin.toLowerCase());
          const reservation = await agentService.mppReserve(token, {
            amountRaw: checked.amountRaw,
            recipient: checked.recipient,
            endpointOrigin: target.origin,
            idempotencyKey: input.idempotencyKey,
            mode: "charge"
          });
          reserved = !reservation.replay;
          return helpers.createCredential();
        }
      });
      mppx.onCredentialCreated(({ credential }) => {
        paymentReference = referenceFromCredential(credential);
      });
      try {
        const response = await mppx.fetch(target.url, init);
        const receipt = receiptFromResponse(response);
        const body = await response.clone().text();
        const result = await agentService.mppConfirm(token, input.idempotencyKey, {
          receipt,
          responseStatus: response.status,
          responseBody: body.length > 128 * 1024 ? body.slice(0, 128 * 1024) : body,
          responseContentType: response.headers.get("content-type") ?? void 0
        });
        return { payment: result.payment, response: { status: response.status, body, contentType: response.headers.get("content-type") } };
      } catch (error) {
        if (reserved) {
          const message = error instanceof Error ? error.message : "MPP payment failed";
          const uncertain = /timeout|network|transport|rpc|socket|broadcast|receipt|authoritative/i.test(message);
          await agentService.mppFail(token, input.idempotencyKey, uncertain ? "MPP payment submission is uncertain; reconcile before retrying" : message, uncertain, paymentReference);
        }
        throw error;
      }
    });
  }
  async function sessionRequest(token, input) {
    const existing = await agentService.getMppPayment(token, input.idempotencyKey);
    if (existing?.payment.state === "CONFIRMED") return { payment: existing.payment, response: { status: existing.payment.responseStatus, body: existing.payment.responseBody ?? "", contentType: existing.payment.responseContentType } };
    return agentService.withSigner(token, "MPP_SESSION", async ({ policy, account, publicClient }) => {
      const target = endpoint(input, policy.allowedOrigins);
      const init = requestInit(input);
      const identity = identityHeader(policy, account.address);
      if (identity) init.headers.set(MPP_IDENTITY_HEADER, identity);
      const lockKey = `${policy.id}:${target.origin}:${MPP_SESSION_ESCROW}`;
      return withPayerLock(lockKey, async () => {
        let reserved = false;
        const payerFetch = guardedFetch(fetcher, policy.allowedOrigins);
        const challengeFetch = async (requestInput, requestOptions) => {
          const response = await payerFetch(requestInput, requestOptions);
          if (response.status === 402) {
            const challenges = Challenge.fromResponseList(response);
            const challenge = challenges.find((candidate) => candidate.method === "tempo" && candidate.intent === "session");
            if (!challenge) throw new Error("MPP session challenge is missing");
            const checked = validateChallenge(challenge, policy, "session", target.origin.toLowerCase());
            const reservation = await agentService.mppReserve(token, {
              amountRaw: checked.amountRaw,
              recipient: checked.recipient,
              endpointOrigin: target.origin,
              idempotencyKey: input.idempotencyKey,
              mode: "session"
            });
            reserved = !reservation.replay;
          }
          return response;
        };
        const manager = sessionManager({
          account,
          getClient: () => publicClient,
          fetch: challengeFetch,
          bootstrap: true,
          allowedChainIds: [policy.chainId],
          escrow: MPP_SESSION_ESCROW,
          maxDeposit: formatUnits(BigInt(policy.maxPerPaymentRaw), 6),
          channelStore: createJsonChannelStore({
            async get(key) {
              return await kv.get(`reach:mpp:channel:${policy.id}:${key}`);
            },
            async set(key, value) {
              await kv.set(`reach:mpp:channel:${policy.id}:${key}`, value);
            },
            async delete(key) {
              await kv.delete(`reach:mpp:channel:${policy.id}:${key}`);
            }
          })
        });
        try {
          const response = await manager.fetch(target.url, init);
          const receipt = receiptFromResponse(response);
          const body = await response.clone().text();
          const result = await agentService.mppConfirm(token, input.idempotencyKey, {
            receipt,
            responseStatus: response.status,
            responseBody: body.length > 128 * 1024 ? body.slice(0, 128 * 1024) : body,
            responseContentType: response.headers.get("content-type") ?? void 0
          });
          return { payment: result.payment, response: { status: response.status, body, contentType: response.headers.get("content-type") } };
        } catch (error) {
          if (reserved) {
            const message = error instanceof Error ? error.message : "MPP session payment failed";
            const uncertain = /timeout|network|transport|rpc|socket|broadcast|receipt|authoritative/i.test(message);
            await agentService.mppFail(token, input.idempotencyKey, uncertain ? "MPP session settlement is uncertain; reconcile before retrying" : message, uncertain);
          }
          throw error;
        }
      });
    });
  }
  async function sessionClose(token, input) {
    return agentService.withSigner(token, "MPP_SESSION", async ({ policy, account, publicClient }) => {
      const target = endpoint(input, policy.allowedOrigins);
      const init = requestInit(input);
      const identity = identityHeader(policy, account.address);
      if (identity) init.headers.set(MPP_IDENTITY_HEADER, identity);
      const lockKey = `${policy.id}:${target.origin}:${MPP_SESSION_ESCROW}`;
      return withPayerLock(lockKey, async () => {
        const manager = sessionManager({
          account,
          getClient: () => publicClient,
          fetch: guardedFetch(fetcher, policy.allowedOrigins),
          bootstrap: true,
          allowedChainIds: [policy.chainId],
          escrow: MPP_SESSION_ESCROW,
          maxDeposit: formatUnits(BigInt(policy.maxPerPaymentRaw), 6),
          channelStore: createJsonChannelStore({
            async get(key) {
              return await kv.get(`reach:mpp:channel:${policy.id}:${key}`);
            },
            async set(key, value) {
              await kv.set(`reach:mpp:channel:${policy.id}:${key}`, value);
            },
            async delete(key) {
              await kv.delete(`reach:mpp:channel:${policy.id}:${key}`);
            }
          })
        });
        await manager.fetch(target.url, { ...init, method: "HEAD", body: void 0 });
        const receipt = await manager.close();
        if (!receipt) throw new Error("MPP session has no reusable channel to close");
        return { status: "CLOSED", receipt: safeJson2(receipt), channelId: manager.channelId };
      });
    });
  }
  return { request, sessionRequest, sessionClose };
}

// src/server/app.ts
function createApp(options = {}) {
  const app2 = new Hono();
  const vaultAddress = process.env.REACH_VAULT_ADDRESS ?? DEFAULT_VAULT_ADDRESS;
  const rpcUrl = process.env.REACH_RPC_URL ?? TEMPO_MODERATO_RPC_URL;
  const indexerUrl = process.env.REACH_INDEXER_URL ?? "https://indexer.testnet.tempo.xyz/query";
  const rpcTransport = http3(rpcUrl, { retryCount: 0, retryDelay: 0, timeout: 1e4 });
  const publicClient = createPublicClient2({ chain: tempoModerato3, transport: rpcTransport });
  const rpcCoordinator = options.rpcCoordinator ?? createTempoRpcReadCoordinator({
    logger: (event, fields) => console.info(JSON.stringify({ event, ...fields }))
  });
  const { kv: configuredAuthKv, storageType } = createKvStore();
  const authKv = options.authKv ?? configuredAuthKv;
  const testnetFunding = createTestnetFunding(authKv);
  const feePayerKey = process.env.REACH_FEE_PAYER_PRIVATE_KEY;
  const emailProvider = options.emailProvider !== void 0 ? options.emailProvider : createGmailApiEmailProvider();
  const protectedClaims = createProtectedClaimService({
    kv: authKv,
    providers: {
      SMS: createTwilioVerifyProvider(),
      EMAIL: emailProvider
    }
  });
  const webAuthnHandlers = /* @__PURE__ */ new Map();
  function originFor(request) {
    const configured = process.env.REACH_ORIGIN;
    const requestOrigin = request.headers.get("origin");
    if (configured) {
      if (requestOrigin && requestOrigin !== configured) throw new Error("origin is not allowed");
      return configured;
    }
    return requestOrigin ?? new URL(request.url).origin;
  }
  function webAuthnHandlerFor(request) {
    const origin = originFor(request);
    const rpId = process.env.REACH_RP_ID ?? new URL(origin).hostname;
    const cacheKey = `${origin}|${rpId}`;
    let handler2 = webAuthnHandlers.get(cacheKey);
    if (!handler2) {
      handler2 = Handler.webAuthn({
        kv: authKv,
        origin,
        path: "/auth",
        rpId,
        ttl: { challenge: AUTH_CHALLENGE_TTL_SECONDS }
      });
      webAuthnHandlers.set(cacheKey, handler2);
    }
    return handler2;
  }
  async function authenticatedProtectedSession(request) {
    const session = await webAuthnHandlerFor(request).getSession(request);
    if (!session) return void 0;
    const origin = originFor(request);
    const address = deriveTempoAccountAddress({
      id: session.credentialId,
      publicKey: session.publicKey,
      rpId: process.env.REACH_RP_ID ?? new URL(origin).hostname
    });
    return { address };
  }
  const protectedSession = options.protectedSession ?? authenticatedProtectedSession;
  const mppService = createMppService(authKv);
  const agentPayments = options.agentService ?? createAgentAuthorizationService(authKv, {
    rpcUrl,
    vaultAddress,
    readPayout: async (payoutId) => {
      const payout = await readPayout(payoutId, true);
      return { sender: payout.sender, amount: payout.amount, expiresAt: payout.expiresAt, claimSigner: payout.claimSigner, status: payout.status };
    },
    readMppReceipt: async (payment) => {
      if (payment.mode !== "charge" || !payment.reference) return void 0;
      const receipt = await readReceipt({ hash: payment.reference }).catch(() => void 0);
      if (!receipt || receipt.status !== "success") return void 0;
      return { status: "success", method: "tempo", reference: payment.reference };
    }
  });
  const mppPayer = createMppPayerService(agentPayments, authKv);
  function protectedPayout(payout) {
    return { status: payout.status, amount: payout.amount, expiresAt: payout.expiresAt, claimSigner: payout.claimSigner };
  }
  async function protectedJsonBody(context) {
    if (!context.req.header("content-type")?.startsWith("application/json")) throw new Error("JSON required");
    const body = await context.req.text();
    if (body.length > 8192) throw new Error("Request too large");
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid request");
    return parsed;
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
  function readPayout(payoutId, essential = false) {
    const id = payoutId.toString();
    return rpcCoordinator.read(
      () => publicClient.readContract({
        address: vaultAddress,
        abi: vaultAbi,
        functionName: "getPayout",
        args: [payoutId]
      }),
      { key: `vault:getPayout:${vaultAddress.toLowerCase()}:${id}`, kind: "getPayout", essential }
    ).then((result) => payoutFromContractResult(result, payoutId));
  }
  function readLatestBlock(essential = false) {
    return rpcCoordinator.read(
      () => publicClient.getBlock({ blockTag: "latest" }),
      { key: "block:latest", kind: "latestBlock", essential, cacheTtlMs: essential ? 0 : 500 }
    );
  }
  function readBalance(address, token = PATH_USD_ADDRESS, essential = false) {
    return rpcCoordinator.read(
      () => publicClient.readContract({
        address: token,
        abi: pathUsdAbi,
        functionName: "balanceOf",
        args: [address]
      }),
      { key: `token:balanceOf:${token.toLowerCase()}:${address.toLowerCase()}`, kind: "balanceOf", essential }
    );
  }
  function readTokenMetadata(address, functionName) {
    return rpcCoordinator.read(
      () => publicClient.readContract({
        address,
        abi: [{ type: "function", name: functionName, stateMutability: "view", inputs: [], outputs: [{ type: functionName === "decimals" ? "uint8" : "string" }] }],
        functionName
      }),
      { key: `token:${functionName}:${address.toLowerCase()}`, kind: "tokenMetadata", cacheTtlMs: 864e5 }
    );
  }
  function readTransaction({ hash }) {
    return rpcCoordinator.read(
      () => publicClient.getTransaction({ hash }),
      { key: `tx:${hash.toLowerCase()}`, kind: "transaction", cacheTtlMs: 6e4 }
    );
  }
  function readReceipt({ hash }) {
    return rpcCoordinator.read(
      () => publicClient.getTransactionReceipt({ hash }),
      { key: `receipt:${hash.toLowerCase()}`, kind: "receipt", cacheTtlMs: 6e4 }
    );
  }
  function readChainId() {
    return rpcCoordinator.read(
      () => publicClient.getChainId(),
      { key: "chainId", kind: "chainId", cacheTtlMs: 6e4 }
    );
  }
  async function readPayoutWithAccounting(payoutId) {
    const payout = await readPayout(payoutId);
    const [fundingEvents, claimEvents, reclaimEvents] = await Promise.all([
      discoverPayoutsBySender(payout.sender, { indexerUrl, signal: AbortSignal.timeout(1e4) }).catch(() => []),
      payout.status === payoutStatus.CLAIMED && payout.claimant !== "0x0000000000000000000000000000000000000000" ? discoverPayoutsByClaimant(payout.claimant, { indexerUrl, signal: AbortSignal.timeout(1e4) }).catch(() => []) : Promise.resolve([]),
      payout.status === payoutStatus.RECLAIMED ? discoverReclaimedPayoutsBySender(payout.sender, { indexerUrl, signal: AbortSignal.timeout(1e4) }).catch(() => []) : Promise.resolve([])
    ]);
    const fundingEvent = fundingEvents.find((event) => event.id === payoutId.toString() && event.sender.toLowerCase() === payout.sender.toLowerCase() && event.amount === payout.amount.toString() && event.expiresAt === payout.expiresAt.toString() && event.claimSigner.toLowerCase() === payout.claimSigner.toLowerCase());
    const claimEvent = claimEvents.find((event) => event.id === payoutId.toString() && event.recipient.toLowerCase() === payout.claimant.toLowerCase() && event.amount === payout.amount.toString());
    const reclaimEvent = reclaimEvents.find((event) => event.id === payoutId.toString() && event.sender.toLowerCase() === payout.sender.toLowerCase() && event.amount === payout.amount.toString());
    const protection = await protectedClaims.metadata(payoutId.toString()).catch(() => null);
    let accounting;
    if (fundingEvent?.fundingTxHash) {
      const recovered = await recoverConfirmedTransactionAccounting({
        getChainId: readChainId,
        getTransaction: readTransaction,
        getTransactionReceipt: readReceipt,
        readContract: ({ address, functionName }) => readTokenMetadata(address, functionName)
      }, fundingEvent.fundingTxHash, {
        expectedSender: payout.sender
      });
      if (recovered) {
        const feeAmount = BigInt(recovered.actualFeeAmount);
        const actualTotalDeducted = recovered.feeToken.toLowerCase() === PATH_USD_ADDRESS.toLowerCase() ? [{
          amount: (payout.amount + feeAmount).toString(),
          decimals: 6,
          symbol: "pathUSD",
          token: PATH_USD_ADDRESS
        }] : [
          { amount: payout.amount.toString(), decimals: 6, symbol: "pathUSD", token: PATH_USD_ADDRESS },
          {
            amount: recovered.actualFeeAmount,
            decimals: recovered.feeTokenDecimals,
            ...recovered.feeTokenSymbol ? { symbol: recovered.feeTokenSymbol } : {},
            token: recovered.feeToken
          }
        ];
        accounting = { ...recovered, actualTotalDeducted };
      }
    }
    return {
      id: payoutId.toString(),
      ...serializePayout(payout),
      ...fundingEvent?.fundingTxHash ? { fundingTxHash: fundingEvent.fundingTxHash } : {},
      ...claimEvent?.claimTxHash ? { claimTxHash: claimEvent.claimTxHash } : {},
      ...reclaimEvent?.reclaimTxHash ? { reclaimTxHash: reclaimEvent.reclaimTxHash } : {},
      ...protection ? { protection } : {},
      ...fundingEvent?.createdAt ? { createdAt: fundingEvent.createdAt } : {},
      ...fundingEvent?.createdBlock ? { createdBlock: fundingEvent.createdBlock } : {},
      accounting: accounting ?? null
    };
  }
  async function discoverPublicPayouts(sender) {
    const discovered = await discoverPayoutsBySender(sender, { indexerUrl, signal: AbortSignal.timeout(1e4) });
    const uniqueDiscovered = [...new Map(discovered.map((event) => [event.id, event])).values()];
    const entries = await mapWithConcurrency(uniqueDiscovered, DEFAULT_RPC_READ_CONCURRENCY, async (event) => {
      const protection = await protectedClaims.metadata(event.id).catch(() => null);
      try {
        const payout = await readPayout(BigInt(event.id));
        if (payout.sender.toLowerCase() !== sender.toLowerCase()) throw new Error("payout sender mismatch");
        return {
          id: event.id,
          ...serializePayout(payout),
          ...event.fundingTxHash ? { fundingTxHash: event.fundingTxHash } : {},
          ...event.createdAt ? { createdAt: event.createdAt } : {},
          ...event.createdBlock ? { createdBlock: event.createdBlock } : {},
          ...protection ? { protection } : {}
        };
      } catch {
        rpcCoordinator.markUnresolved();
        return {
          id: event.id,
          sender,
          amount: event.amount,
          expiresAt: event.expiresAt,
          claimSigner: event.claimSigner,
          status: payoutStatus.NONE,
          claimant: "0x0000000000000000000000000000000000000000",
          authorityUnavailable: true,
          ...event.fundingTxHash ? { fundingTxHash: event.fundingTxHash } : {},
          ...event.createdAt ? { createdAt: event.createdAt } : {},
          ...event.createdBlock ? { createdBlock: event.createdBlock } : {},
          ...protection ? { protection } : {}
        };
      }
    });
    const payouts = Array.from(new Map(entries.map((entry) => [entry.id, entry])).values());
    return {
      payouts,
      authorityIncomplete: payouts.some((entry) => "authorityUnavailable" in entry && entry.authorityUnavailable === true),
      unresolvedCount: payouts.filter((entry) => "authorityUnavailable" in entry && entry.authorityUnavailable === true).length
    };
  }
  async function discoverPublicActivity(address) {
    const [sentResult, claimResult, latestResult] = await Promise.allSettled([
      discoverPayoutsBySender(address, { indexerUrl, signal: AbortSignal.timeout(1e4) }),
      discoverPayoutsByClaimant(address, { indexerUrl, signal: AbortSignal.timeout(1e4) }),
      readLatestBlock()
    ]);
    const sentEvents = sentResult.status === "fulfilled" ? sentResult.value : [];
    const claimEvents = claimResult.status === "fulfilled" ? claimResult.value : [];
    let chainTimestamp;
    let chainAuthorityIncomplete = latestResult.status === "rejected";
    if (latestResult.status === "fulfilled") {
      try {
        const candidate = BigInt(latestResult.value.timestamp);
        if (candidate >= 0n && candidate < 1n << 64n) chainTimestamp = candidate;
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
    const ids = /* @__PURE__ */ new Set([...sentById.keys(), ...claimById.keys()]);
    const entries = await mapWithConcurrency([...ids], DEFAULT_RPC_READ_CONCURRENCY, async (id) => {
      const sentEvent = sentById.get(id);
      const claimEvent = claimById.get(id);
      const protection = await protectedClaims.metadata(id).catch(() => null);
      let payout;
      try {
        payout = await readPayout(BigInt(id));
      } catch {
        rpcCoordinator.markUnresolved();
      }
      if (!payout) {
        const direction2 = sentEvent ? "SENT" : "RECEIVED";
        return {
          payoutId: id,
          kind: "PAYOUT",
          direction: direction2,
          lifecycle: "CHECKING",
          sender: sentEvent?.sender ?? address,
          claimant: claimEvent?.recipient ?? "0x0000000000000000000000000000000000000000",
          amount: sentEvent?.amount ?? claimEvent?.amount ?? "0",
          expiresAt: sentEvent?.expiresAt ?? "0",
          claimSigner: sentEvent?.claimSigner,
          ...sentEvent?.createdAt ? { createdAt: sentEvent.createdAt } : {},
          ...claimEvent?.claimedAt ? { claimedAt: claimEvent.claimedAt } : {},
          ...protection ? { protection } : {},
          ...sentEvent?.fundingTxHash ? { txHash: sentEvent.fundingTxHash } : claimEvent?.claimTxHash ? { txHash: claimEvent.claimTxHash } : {},
          authorityUnavailable: true
        };
      }
      const isSender = payout.sender.toLowerCase() === address.toLowerCase();
      const isClaimedRecipient = payout.status === payoutStatus.CLAIMED && payout.claimant.toLowerCase() === address.toLowerCase();
      if (!isSender && !isClaimedRecipient) return null;
      const direction = isSender ? "SENT" : "RECEIVED";
      const lifecycle = payout.status === payoutStatus.FUNDED && chainTimestamp === void 0 ? "CHECKING" : payout.status === payoutStatus.FUNDED && chainTimestamp >= payout.expiresAt ? "EXPIRED_FUNDED" : payout.status === payoutStatus.FUNDED ? "FUNDED" : payout.status === payoutStatus.CLAIMED ? "CLAIMED" : payout.status === payoutStatus.RECLAIMED ? "RECLAIMED" : "NONE";
      return {
        payoutId: id,
        kind: "PAYOUT",
        direction,
        lifecycle,
        sender: payout.sender,
        claimant: payout.claimant,
        amount: payout.amount.toString(),
        expiresAt: payout.expiresAt.toString(),
        claimSigner: payout.claimSigner,
        ...sentEvent?.createdAt ? { createdAt: sentEvent.createdAt } : {},
        ...claimEvent?.claimedAt ? { claimedAt: claimEvent.claimedAt } : {},
        ...protection ? { protection } : {},
        ...(direction === "SENT" ? sentEvent?.fundingTxHash : claimEvent?.claimTxHash) ? { txHash: direction === "SENT" ? sentEvent?.fundingTxHash : claimEvent?.claimTxHash } : {}
      };
    });
    const activities = [...new Map(entries.filter((entry) => Boolean(entry)).map((entry) => [entry.payoutId, entry])).values()];
    const authorityIncomplete = sentResult.status === "rejected" || claimResult.status === "rejected" || chainAuthorityIncomplete || activities.some((entry) => "authorityUnavailable" in entry && entry.authorityUnavailable === true);
    return {
      activities,
      authorityComplete: !authorityIncomplete,
      authorityIncomplete,
      unresolvedCount: activities.filter((entry) => "authorityUnavailable" in entry && entry.authorityUnavailable === true).length
    };
  }
  async function validateClaimForSponsorship(request) {
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
        version: CLAIM_AUTHORIZATION_VERSION
      },
      signature: parsed.claimAuthorizationSignature
    }).catch(() => null);
    if (!recovered || recovered.toLowerCase() !== payout.claimSigner.toLowerCase()) throw new Error("claim authorization is not valid for this payout");
    await rpcCoordinator.read(
      () => publicClient.simulateContract({
        address: vaultAddress,
        abi: vaultAbi,
        functionName: "claim",
        args: [parsed.payoutId, parsed.recipient, parsed.claimAuthorizationSignature],
        account: parsed.from
      }),
      {
        key: `simulate:claim:${vaultAddress.toLowerCase()}:${parsed.payoutId.toString()}:${parsed.recipient.toLowerCase()}:${parsed.claimAuthorizationSignature.toLowerCase()}`,
        kind: "other",
        essential: true
      }
    );
  }
  const relayHandler = feePayerKey ? Handler.relay({
    chains: [tempoModerato3],
    feePayer: {
      account: privateKeyToAccount3(feePayerKey),
      name: "Reach claim sponsor",
      url: "https://reach.local/claim-sponsor"
    },
    onRequest: async (request) => {
      await validateClaimForSponsorship(request);
    },
    path: "/relay",
    transports: { [tempoModerato3.id]: http3(rpcUrl, { retryCount: 0, retryDelay: 0, timeout: 1e4 }) }
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
      chainId: tempoModerato3.id,
      sponsorConfigured: Boolean(relayHandler),
      webAuthnStorage: storageType,
      protectedClaims: protectedClaims.availability(),
      agentAuthorization: {
        configured: Boolean(process.env.REACH_AGENT_ENCRYPTION_KEY),
        durableStorage: storageType === "durable"
      },
      mpp: mppService ? { configured: true, chainId: mppService.chainId, recipient: mppService.recipient, price: mppService.price } : { configured: false },
      rpcCoordinator: rpcCoordinator.metrics()
    })
  );
  function bearerAgentToken(request) {
    const value = request.headers.get("authorization");
    if (!value || !/^Bearer\s+/i.test(value)) return void 0;
    return value.replace(/^Bearer\s+/i, "").trim();
  }
  function agentFailure(context, error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    const message = error instanceof Error ? error.message : "agent operation unavailable";
    if (code === "UNKNOWN_SETTLEMENT") return context.json({ code, error: "Payment submission is uncertain. Do not retry this idempotency key; reconcile it first.", payment: error.payment }, 503);
    if (/authentication required|authorization not found|invalid agent credential|authorization is revoked|authorization is expired/i.test(message)) return context.json({ error: "agent authorization unavailable" }, 401);
    if (/not configured|durable|encryption/i.test(message)) return context.json({ error: "agent authorization unavailable" }, 503);
    if (/already used|budget|allowlist|scope|scope|expiry|invalid|exceed|pending|active|root account|unsupported|recipient|origin|redirect|challenge|purpose|header|protocol|currency|chain/i.test(message)) return context.json({ error: message }, 400);
    return context.json({ error: "agent operation unavailable" }, 503);
  }
  app2.post("/api/agent/authorizations", async (context) => {
    context.header("Cache-Control", "no-store");
    try {
      const session = await protectedSession(context.req.raw);
      if (!session) return context.json({ error: "authentication required" }, 401);
      const body = await protectedJsonBody(context);
      const result = await agentPayments.create({
        maxPerPaymentRaw: String(body.maxPerPaymentRaw ?? ""),
        cumulativeBudgetRaw: String(body.cumulativeBudgetRaw ?? ""),
        expiryTimestamp: Number(body.expiryTimestamp),
        allowedDestinations: Array.isArray(body.allowedDestinations) ? body.allowedDestinations.map(String) : void 0,
        allowedOrigins: Array.isArray(body.allowedOrigins) ? body.allowedOrigins.map(String) : void 0,
        purpose: body.purpose === void 0 ? void 0 : String(body.purpose)
      }, session.address);
      return context.json(result, 201);
    } catch (error) {
      return agentFailure(context, error);
    }
  });
  app2.get("/api/agent/authorizations", async (context) => {
    context.header("Cache-Control", "no-store");
    try {
      const session = await protectedSession(context.req.raw);
      if (!session) return context.json({ error: "authentication required" }, 401);
      return context.json({ policies: await agentPayments.listPolicies(session.address) });
    } catch (error) {
      return agentFailure(context, error);
    }
  });
  app2.get("/api/agent/authorizations/:id", async (context) => {
    context.header("Cache-Control", "no-store");
    try {
      const session = await protectedSession(context.req.raw);
      if (!session) return context.json({ error: "authentication required" }, 401);
      const policy = await agentPayments.readPolicy(context.req.param("id"));
      if (!policy || policy.ownerAddress.toLowerCase() !== session.address.toLowerCase()) return context.json({ error: "agent authorization unavailable" }, 404);
      return context.json(agentPayments.publicPolicy(policy));
    } catch (error) {
      return agentFailure(context, error);
    }
  });
  app2.get("/api/agent/authorizations/:id/payments", async (context) => {
    context.header("Cache-Control", "no-store");
    try {
      const session = await protectedSession(context.req.raw);
      if (!session) return context.json({ error: "authentication required" }, 401);
      const policyId = context.req.param("id");
      const [payouts, mpp] = await Promise.all([
        agentPayments.listPayments(session.address, policyId),
        agentPayments.listMppPayments(session.address, policyId)
      ]);
      if (!payouts || !mpp) return context.json({ error: "agent authorization unavailable" }, 404);
      return context.json({ policy: mpp.policy, payments: payouts.payments, mppPayments: mpp.payments });
    } catch (error) {
      return agentFailure(context, error);
    }
  });
  app2.post("/api/agent/authorizations/:id/activate", async (context) => {
    context.header("Cache-Control", "no-store");
    try {
      const session = await protectedSession(context.req.raw);
      if (!session) return context.json({ error: "authentication required" }, 401);
      const body = await protectedJsonBody(context);
      if (typeof body.rootAddress !== "string" || !isAddress8(body.rootAddress) || !body.keyAuthorization || typeof body.keyAuthorization !== "object") return context.json({ error: "invalid access-key authorization" }, 400);
      return context.json(await agentPayments.activate(context.req.param("id"), session.address, body.keyAuthorization, body.rootAddress));
    } catch (error) {
      return agentFailure(context, error);
    }
  });
  app2.post("/api/agent/authorizations/:id/revoke", async (context) => {
    context.header("Cache-Control", "no-store");
    try {
      const session = await protectedSession(context.req.raw);
      if (!session) return context.json({ error: "authentication required" }, 401);
      const result = await agentPayments.revoke(context.req.param("id"), session.address);
      return context.json({ ...result, revokedAt: (/* @__PURE__ */ new Date()).toISOString() });
    } catch (error) {
      return agentFailure(context, error);
    }
  });
  app2.post("/api/agent/payments", async (context) => {
    context.header("Cache-Control", "no-store");
    try {
      const token = bearerAgentToken(context.req.raw);
      if (!token) return context.json({ error: "agent authorization required" }, 401);
      const body = await protectedJsonBody(context);
      const result = await agentPayments.pay(token, {
        amountRaw: String(body.amountRaw ?? ""),
        destination: String(body.destination ?? ""),
        claimSigner: body.claimSigner === void 0 ? void 0 : String(body.claimSigner),
        idempotencyKey: String(body.idempotencyKey ?? ""),
        payoutExpiresAt: body.payoutExpiresAt === void 0 ? void 0 : String(body.payoutExpiresAt)
      });
      return context.json(result);
    } catch (error) {
      return agentFailure(context, error);
    }
  });
  app2.get("/api/agent/payments/:idempotencyKey", async (context) => {
    context.header("Cache-Control", "no-store");
    try {
      const token = bearerAgentToken(context.req.raw);
      if (!token) return context.json({ error: "agent authorization required" }, 401);
      return context.json(await agentPayments.getPayment(token, context.req.param("idempotencyKey")));
    } catch (error) {
      return agentFailure(context, error);
    }
  });
  app2.post("/api/agent/payments/:idempotencyKey/reconcile", async (context) => {
    context.header("Cache-Control", "no-store");
    try {
      const token = bearerAgentToken(context.req.raw);
      if (!token) return context.json({ error: "agent authorization required" }, 401);
      return context.json(await agentPayments.reconcilePayment(token, context.req.param("idempotencyKey")));
    } catch (error) {
      return agentFailure(context, error);
    }
  });
  app2.all("/api/mpp/agent-service", async (context) => {
    if (!mppService) return context.json({ error: "MPP service is not configured" }, 503);
    try {
      return await mppService.handle(context.req.raw);
    } catch {
      return context.json({ error: "MPP payment service unavailable" }, 503);
    }
  });
  app2.all("/api/mpp/agent-session", async (context) => {
    if (!mppService) return context.json({ error: "MPP service is not configured" }, 503);
    try {
      return await mppService.handleSession(context.req.raw);
    } catch {
      return context.json({ error: "MPP session service unavailable" }, 503);
    }
  });
  app2.post("/api/mpp/payer/request", async (context) => {
    context.header("Cache-Control", "no-store");
    try {
      const token = bearerAgentToken(context.req.raw);
      if (!token) return context.json({ error: "agent authorization required" }, 401);
      const body = await protectedJsonBody(context);
      const headers = body.headers === void 0 ? void 0 : body.headers;
      if (headers !== void 0 && (!headers || typeof headers !== "object" || Array.isArray(headers) || Object.values(headers).some((value) => typeof value !== "string"))) return context.json({ error: "headers must be a string map" }, 400);
      return context.json(await mppPayer.request(token, {
        url: String(body.url ?? ""),
        method: body.method === void 0 ? void 0 : String(body.method),
        headers,
        body: body.body === void 0 ? void 0 : String(body.body),
        idempotencyKey: String(body.idempotencyKey ?? "")
      }));
    } catch (error) {
      return agentFailure(context, error);
    }
  });
  app2.post("/api/mpp/payer/session", async (context) => {
    context.header("Cache-Control", "no-store");
    try {
      const token = bearerAgentToken(context.req.raw);
      if (!token) return context.json({ error: "agent authorization required" }, 401);
      const body = await protectedJsonBody(context);
      const headers = body.headers === void 0 ? void 0 : body.headers;
      if (headers !== void 0 && (!headers || typeof headers !== "object" || Array.isArray(headers) || Object.values(headers).some((value) => typeof value !== "string"))) return context.json({ error: "headers must be a string map" }, 400);
      return context.json(await mppPayer.sessionRequest(token, {
        url: String(body.url ?? ""),
        method: body.method === void 0 ? void 0 : String(body.method),
        headers,
        body: body.body === void 0 ? void 0 : String(body.body),
        idempotencyKey: String(body.idempotencyKey ?? "")
      }));
    } catch (error) {
      return agentFailure(context, error);
    }
  });
  app2.post("/api/mpp/payer/session/close", async (context) => {
    context.header("Cache-Control", "no-store");
    try {
      const token = bearerAgentToken(context.req.raw);
      if (!token) return context.json({ error: "agent authorization required" }, 401);
      const body = await protectedJsonBody(context);
      const headers = body.headers === void 0 ? void 0 : body.headers;
      if (headers !== void 0 && (!headers || typeof headers !== "object" || Array.isArray(headers) || Object.values(headers).some((value) => typeof value !== "string"))) return context.json({ error: "headers must be a string map" }, 400);
      return context.json(await mppPayer.sessionClose(token, {
        url: String(body.url ?? ""),
        method: body.method === void 0 ? void 0 : String(body.method),
        headers,
        body: body.body === void 0 ? void 0 : String(body.body),
        idempotencyKey: String(body.idempotencyKey ?? "session-close")
      }));
    } catch (error) {
      return agentFailure(context, error);
    }
  });
  app2.post("/api/mpp/payer/:idempotencyKey/reconcile", async (context) => {
    context.header("Cache-Control", "no-store");
    try {
      const token = bearerAgentToken(context.req.raw);
      if (!token) return context.json({ error: "agent authorization required" }, 401);
      return context.json(await agentPayments.mppReconcile(token, context.req.param("idempotencyKey")));
    } catch (error) {
      return agentFailure(context, error);
    }
  });
  app2.post("/api/internal/email-provider/verify", async (context) => {
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
  app2.get("/api/payouts/:sender", async (context) => {
    const sender = context.req.param("sender");
    if (!isAddress8(sender)) return context.json({ error: "invalid address" }, 400);
    try {
      const result = await discoverPublicPayouts(sender);
      return context.json({ address: sender, ...result });
    } catch {
      return context.json({ error: "payout discovery unavailable" }, 503);
    }
  });
  app2.get("/api/activity/:address", async (context) => {
    const address = context.req.param("address");
    if (!isAddress8(address)) return context.json({ error: "invalid address" }, 400);
    try {
      context.header("Cache-Control", "no-store");
      return context.json({ address, ...await discoverPublicActivity(address) });
    } catch {
      return context.json({ error: "activity discovery unavailable" }, 503);
    }
  });
  app2.get("/api/payout/:payoutId", async (context) => {
    try {
      context.header("Cache-Control", "no-store");
      return context.json(await readPayoutWithAccounting(strictPayoutId(context.req.param("payoutId"))));
    } catch (error) {
      if (/invalid payout id/i.test(error instanceof Error ? error.message : "")) return context.json({ error: "payout unavailable" }, 404);
      if (error instanceof RpcAuthorityUnavailableError) return context.json({ error: "payout authority unavailable" }, 503);
      return context.json({ error: "payout authority unavailable" }, 503);
    }
  });
  app2.get("/api/balance/:address", async (context) => {
    const address = context.req.param("address");
    if (!isAddress8(address)) return context.json({ error: "invalid address" }, 400);
    try {
      const balance = await readBalance(address);
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
      const requestedAddress = fundingAddress(parsed);
      const session = await protectedSession(context.req.raw);
      if (!session) return context.json({ error: "authentication required" }, 401);
      if (session.address.toLowerCase() !== requestedAddress.toLowerCase()) return context.json({ error: "authenticated account required" }, 403);
      return context.json(await testnetFunding.request(parsed, { networkKey: fundingNetworkKey(context.req.raw) }), 202);
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
        return await webAuthnHandlerFor(context.req.raw).fetch(context.req.raw);
      } catch (err) {
        if (err?.message?.includes("origin")) {
          return context.json({ error: "Untrusted origin" }, 403);
        }
        return context.json({ error: "authentication unavailable" }, 503);
      }
    });
  });
  app2.get("/api/protected/:payoutId", async (context) => {
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
  app2.post("/api/protected/register", async (context) => {
    context.header("Cache-Control", "no-store");
    try {
      const session = await protectedSession(context.req.raw);
      if (!session) throw new Error("authentication required");
      const body = await protectedJsonBody(context);
      const payoutId = strictPayoutId(String(body.payoutId ?? "")).toString();
      if (typeof body.sender !== "string" || !isAddress8(body.sender) || body.sender.toLowerCase() !== session.address.toLowerCase()) return context.json({ error: "authenticated sender required" }, 401);
      if (typeof body.claimSigner !== "string" || !isAddress8(body.claimSigner)) return context.json({ error: "invalid claim signer" }, 400);
      if (body.channel !== "EMAIL" && body.channel !== "SMS") return context.json({ error: "invalid verification channel" }, 400);
      if (typeof body.recipient !== "string" || typeof body.shareB !== "string" || typeof body.shareAProofAddress !== "string" || !isAddress8(body.shareAProofAddress)) return context.json({ error: "invalid protected payout" }, 400);
      await protectedClaims.register({ payoutId, sender: session.address, claimSigner: body.claimSigner, channel: body.channel, recipient: body.recipient, shareB: body.shareB, shareAProofAddress: body.shareAProofAddress });
      return context.json({ ok: true }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : "protected registration unavailable";
      const status = /authentication required/i.test(message) ? 401 : /already registered/i.test(message) ? 409 : /not configured|unavailable/i.test(message) ? 503 : 400;
      return context.json({ error: status === 400 ? message : status === 409 ? "protected payout already registered" : status === 401 ? "authentication required" : "protected verification unavailable" }, status);
    }
  });
  app2.post("/api/protected/begin", async (context) => {
    context.header("Cache-Control", "no-store");
    try {
      const session = await protectedSession(context.req.raw);
      if (!session) throw new Error("authentication required");
      const body = await protectedJsonBody(context);
      const payoutId = strictPayoutId(String(body.payoutId ?? "")).toString();
      const payout = await readPayout(BigInt(payoutId));
      return context.json(await protectedClaims.begin({ payoutId, payout: protectedPayout(payout), session }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "verification unavailable";
      const status = /authentication required/i.test(message) ? 401 : /not configured|unavailable/i.test(message) ? 503 : 400;
      return context.json({ error: status === 401 ? "authentication required" : status === 503 ? "protected verification unavailable" : message }, status);
    }
  });
  app2.post("/api/protected/prove-link", async (context) => {
    context.header("Cache-Control", "no-store");
    try {
      const session = await protectedSession(context.req.raw);
      if (!session) throw new Error("authentication required");
      const body = await protectedJsonBody(context);
      const payoutId = strictPayoutId(String(body.payoutId ?? "")).toString();
      if (typeof body.flowId !== "string" || typeof body.proof !== "string" || !/^0x[0-9a-f]+$/i.test(body.proof)) return context.json({ error: "invalid verification proof" }, 400);
      return context.json(await protectedClaims.proveLink({ payoutId, flowId: body.flowId, session, proof: body.proof }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "verification unavailable";
      if (error instanceof ProtectedProviderDeliveryError) {
        const errorMessage = error.channel === "EMAIL" ? "We couldn't send the verification email right now. Try sending the code again." : "We couldn't send the verification code right now. Try again.";
        return context.json({ error: errorMessage, retryable: true, flowId: error.flowId, expiresAt: error.expiresAt, resendAvailableAt: 0 }, 503);
      }
      const status = /authentication required/i.test(message) ? 401 : /not configured|unavailable/i.test(message) ? 503 : 400;
      return context.json({ error: status === 401 ? "authentication required" : message === "verification email unavailable" ? "We couldn't send the verification email right now. Try again shortly." : status === 503 ? "protected verification unavailable" : "claim link verification failed" }, status);
    }
  });
  app2.post("/api/protected/resend", async (context) => {
    context.header("Cache-Control", "no-store");
    try {
      const session = await protectedSession(context.req.raw);
      if (!session) throw new Error("authentication required");
      const body = await protectedJsonBody(context);
      const payoutId = strictPayoutId(String(body.payoutId ?? "")).toString();
      if (typeof body.flowId !== "string") return context.json({ error: "invalid verification flow" }, 400);
      return context.json(await protectedClaims.resend({ payoutId, flowId: body.flowId, session }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "verification unavailable";
      const status = /authentication required/i.test(message) ? 401 : /not configured|unavailable/i.test(message) ? 503 : 429;
      return context.json({ error: status === 401 ? "authentication required" : message === "verification email unavailable" ? "We couldn't send the verification email right now. Try again shortly." : status === 503 ? "protected verification unavailable" : "please wait before requesting another code" }, status);
    }
  });
  app2.post("/api/protected/verify-code", async (context) => {
    context.header("Cache-Control", "no-store");
    try {
      const session = await protectedSession(context.req.raw);
      if (!session) throw new Error("authentication required");
      const body = await protectedJsonBody(context);
      const payoutId = strictPayoutId(String(body.payoutId ?? "")).toString();
      if (typeof body.flowId !== "string" || typeof body.code !== "string") return context.json({ error: "invalid verification code" }, 400);
      return context.json(await protectedClaims.verifyCode({ payoutId, flowId: body.flowId, session, code: body.code }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "verification unavailable";
      const status = /authentication required/i.test(message) ? 401 : /not configured|unavailable/i.test(message) ? 503 : 400;
      return context.json({ error: status === 401 ? "authentication required" : status === 503 ? "protected verification unavailable" : "verification code is invalid or expired" }, status);
    }
  });
  app2.post("/api/protected/release", async (context) => {
    context.header("Cache-Control", "no-store");
    try {
      const session = await protectedSession(context.req.raw);
      if (!session) throw new Error("authentication required");
      const body = await protectedJsonBody(context);
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
  app2.all("/relay*", async (context) => {
    if (!relayHandler) return context.json({ error: "sponsorship is not configured" }, 503);
    if (context.req.method !== "POST") return context.json({ error: "sponsorship request rejected" }, 405);
    try {
      const contentType = context.req.header("content-type");
      if (!contentType?.startsWith("application/json")) return context.json({ error: "sponsorship request rejected" }, 400);
      const body = await context.req.raw.clone().text();
      if (body.length > 65536) return context.json({ error: "sponsorship request rejected" }, 413);
      parseClaimCall(JSON.parse(body), vaultAddress);
      const res = await relayHandler.fetch(context.req.raw);
      return res;
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
