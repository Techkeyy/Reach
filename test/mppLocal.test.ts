import assert from "node:assert/strict";
import { test } from "node:test";
import { Mppx as ClientMppx, createJsonChannelStore, sessionManager, tempo as clientTempo } from "mppx/client";
import { Mppx as ServerMppx, tempo as serverTempo } from "mppx/server";
import { concatHex, createPublicClient, createWalletClient, custom, decodeFunctionData, encodeAbiParameters, encodeEventTopics, keccak256, publicActions, toFunctionSelector, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { tempoModerato } from "viem/chains";
import { Transaction } from "viem/tempo";
import { TxEnvelopeTempo } from "ox/tempo";
import { PATH_USD_ADDRESS, TEMPO_MODERATO_CHAIN_ID } from "../src/shared/reach";
import { Kv } from "accounts/server";
import { createMppPayerService } from "../src/server/mppPayer";

test("MPP deterministic local proof executes a signed Tempo charge credential through MPPx", async () => {
  const payer = privateKeyToAccount("0x59c6995e998f97a5a0044976f0945389dc9e86dae88a8c6a4c1f8c6c4d5b5b5b");
  const payee = privateKeyToAccount("0x8b3a350cf5c34c9194ca3b3e6e5cfc2a7eb5f7dc7d4e0d3a9f9a0b9c8d7e6f5a");
  const recipient = payee.address;
  const calls: string[] = [];
  const transport = custom({
    async request({ method, params }: { method: string; params?: unknown[] }) {
      calls.push(method);
      switch (method) {
        case "eth_chainId": return `0x${TEMPO_MODERATO_CHAIN_ID.toString(16)}`;
        case "eth_getTransactionCount": return "0x0";
        case "eth_estimateGas": return "0x5208";
        case "eth_gasPrice": return "0x1";
        case "eth_maxPriorityFeePerGas": return "0x1";
        case "eth_feeHistory": return { oldestBlock: "0x1", baseFeePerGas: ["0x1", "0x1"], gasUsedRatio: [0] };
        case "eth_getBlockByNumber": return { number: "0x1", baseFeePerGas: "0x1" };
        case "eth_call": return "0x";
        case "eth_getBalance": return "0xde0b6b3a7640000";
        case "eth_getCode": return "0x";
        case "eth_sendRawTransaction": return keccak256((params?.[0] ?? "0x") as `0x${string}`);
        default: return "0x0";
      }
    },
  });
  const chainClient = createPublicClient({ chain: tempoModerato, transport });
  const server = ServerMppx.create({
    secretKey: "mpp-local-deterministic-secret-key-32-bytes!!",
    methods: [serverTempo.charge({
      testnet: true,
      chainId: TEMPO_MODERATO_CHAIN_ID,
      currency: PATH_USD_ADDRESS,
      recipient,
      getClient: () => chainClient,
      waitForConfirmation: false,
    })],
  });
  const route = async (request: Request) => {
    const result = await server.tempo.charge({ amount: "1", currency: PATH_USD_ADDRESS, recipient, supportedModes: ["pull"] })(request);
    if (result.status === 402) return result.challenge;
    return result.withReceipt(Response.json({ ok: true }));
  };
  const client = ClientMppx.create({
    polyfill: false,
    fetch: async (input, init) => route(new Request(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, init)),
    methods: [clientTempo.charge({
      account: payer,
      getClient: () => chainClient,
      expectedChainId: TEMPO_MODERATO_CHAIN_ID,
      expectedRecipients: [recipient],
      mode: "pull",
    })],
  });
  const response = await client.fetch("https://paid.example/resource");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("payment-receipt") !== null, true);
  assert.equal(calls.includes("eth_sendRawTransaction"), true);

  let confirmed: any;
  const payerService = createMppPayerService({
    async getMppPayment() { return undefined; },
    async mppReserve(_token: string, input: any) {
      return { replay: false, payment: { state: "RESERVED", idempotencyKey: input.idempotencyKey }, policy: undefined };
    },
    async mppConfirm(_token: string, key: string, input: any) {
      confirmed = { state: "CONFIRMED", idempotencyKey: key, ...input };
      return { payment: confirmed, policy: undefined };
    },
    async mppFail(_token: string, _key: string, error: string) { throw new Error(error); },
    async withSigner(_token: string, _purpose: string, operation: any) {
      return operation({
        account: payer,
        publicClient: chainClient,
        policy: {
          chainId: TEMPO_MODERATO_CHAIN_ID,
          currency: PATH_USD_ADDRESS,
          maxPerPaymentRaw: "1000000",
          allowedDestinations: [recipient],
          allowedOrigins: ["https://paid.example"],
        },
      });
    },
  } as any, Kv.memory(), {
    fetch: async (input, init) => route(new Request(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, init)),
  });
  const wrapped = await payerService.request("agent-token", {
    url: "https://paid.example/resource",
    idempotencyKey: "reach-mpp-local-1",
  });
  assert.equal((wrapped as any).payment.state, "CONFIRMED");
  assert.equal(confirmed?.receipt?.status, "success");
});

test("MPP deterministic local session proof opens, meters, recovers, and closes a channel", async () => {
  const payer = privateKeyToAccount("0x59c6995e998f97a5a0044976f0945389dc9e86dae88a8c6a4c1f8c6c4d5b5b5b");
  const payee = privateKeyToAccount("0x8b3a350cf5c34c9194ca3b3e6e5cfc2a7eb5f7dc7d4e0d3a9f9a0b9c8d7e6f5a");
  const recipient = payee.address;
  const escrow = "0x4d50500000000000000000000000000000000000" as Address;
  const openAbi = [{ type: "function", name: "open", inputs: [
    { name: "payee", type: "address" }, { name: "operator", type: "address" }, { name: "token", type: "address" },
    { name: "deposit", type: "uint96" }, { name: "salt", type: "bytes32" }, { name: "authorizedSigner", type: "address" },
  ], outputs: [{ name: "channelId", type: "bytes32" }] }] as const;
  const topUpAbi = [{ type: "function", name: "topUp", inputs: [
    { name: "descriptor", type: "tuple", components: [
      { name: "payer", type: "address" }, { name: "payee", type: "address" }, { name: "operator", type: "address" },
      { name: "token", type: "address" }, { name: "salt", type: "bytes32" }, { name: "authorizedSigner", type: "address" }, { name: "expiringNonceHash", type: "bytes32" },
    ] }, { name: "additionalDeposit", type: "uint96" },
  ], outputs: [] }] as const;
  const openedEventAbi = [{ type: "event", name: "ChannelOpened", inputs: [
    { name: "channelId", type: "bytes32", indexed: true }, { name: "payer", type: "address", indexed: true }, { name: "payee", type: "address", indexed: true },
    { name: "operator", type: "address", indexed: false }, { name: "token", type: "address", indexed: false }, { name: "authorizedSigner", type: "address", indexed: false },
    { name: "salt", type: "bytes32", indexed: false }, { name: "expiringNonceHash", type: "bytes32", indexed: false }, { name: "deposit", type: "uint96", indexed: false },
  ] }] as const;
  const topUpEventAbi = [{ type: "event", name: "TopUp", inputs: [
    { name: "channelId", type: "bytes32", indexed: true }, { name: "payer", type: "address", indexed: true }, { name: "payee", type: "address", indexed: true },
    { name: "additionalDeposit", type: "uint96", indexed: false }, { name: "newDeposit", type: "uint96", indexed: false },
  ] }] as const;
  const closeEventAbi = [{ type: "event", name: "ChannelClosed", inputs: [
    { name: "channelId", type: "bytes32", indexed: true }, { name: "payer", type: "address", indexed: true }, { name: "payee", type: "address", indexed: true },
    { name: "settledToPayee", type: "uint96", indexed: false }, { name: "refundedToPayer", type: "uint96", indexed: false },
  ] }] as const;
  const closeAbi = [{ type: "function", name: "close", inputs: [
    { name: "descriptor", type: "tuple", components: [
      { name: "payer", type: "address" }, { name: "payee", type: "address" }, { name: "operator", type: "address" },
      { name: "token", type: "address" }, { name: "salt", type: "bytes32" }, { name: "authorizedSigner", type: "address" }, { name: "expiringNonceHash", type: "bytes32" },
    ] }, { name: "cumulativeAmount", type: "uint96" }, { name: "captureAmount", type: "uint96" }, { name: "signature", type: "bytes" },
  ], outputs: [] }] as const;
  let channelId: Hex | undefined;
  let descriptor: { payer: Address; payee: Address; operator: Address; token: Address; salt: Hex; authorizedSigner: Address; expiringNonceHash: Hex } | undefined;
  let deposit = 0n;
  let settled = 0n;
  let lastHash = "0x" + "11".repeat(32) as Hex;
  let lastOperation: "open" | "topUp" | "close" = "open";
  const getChannelSelector = toFunctionSelector("getChannel((address,address,address,address,bytes32,address,bytes32))");
  const getChannelStateSelector = toFunctionSelector("getChannelState(bytes32)");
  const descriptorComponents = [
    { name: "payer", type: "address" }, { name: "payee", type: "address" }, { name: "operator", type: "address" },
    { name: "token", type: "address" }, { name: "salt", type: "bytes32" }, { name: "authorizedSigner", type: "address" }, { name: "expiringNonceHash", type: "bytes32" },
  ] as const;
  const stateComponents = [{ name: "settled", type: "uint96" }, { name: "deposit", type: "uint96" }, { name: "closeRequestedAt", type: "uint32" }] as const;
  const transport = custom({
    async request({ method, params }: { method: string; params?: unknown[] }) {
      switch (method) {
        case "eth_chainId": return `0x${TEMPO_MODERATO_CHAIN_ID.toString(16)}`;
        case "eth_getTransactionCount": return "0x0";
        case "eth_estimateGas": return "0x5208";
        case "eth_gasPrice": return "0x1";
        case "eth_maxPriorityFeePerGas": return "0x1";
        case "eth_feeHistory": return { oldestBlock: "0x1", baseFeePerGas: ["0x1", "0x1"], gasUsedRatio: [0] };
        case "eth_getBlockByNumber": return { number: "0x1", baseFeePerGas: "0x1" };
        case "eth_getBalance": return "0xde0b6b3a7640000";
        case "eth_getCode": return "0x";
        case "eth_call": {
          const callData = String((params?.[0] as { data?: string } | undefined)?.data ?? "");
          if (callData.startsWith(getChannelSelector) && descriptor) {
            return encodeAbiParameters([
              { type: "tuple", components: descriptorComponents },
              { type: "tuple", components: stateComponents },
            ], [[descriptor.payer, descriptor.payee, descriptor.operator, descriptor.token, descriptor.salt, descriptor.authorizedSigner, descriptor.expiringNonceHash], [0n, deposit, 0n]]);
          }
          if (callData.startsWith(getChannelStateSelector)) return encodeAbiParameters([{ type: "tuple", components: stateComponents }], [[0n, deposit, 0n]]);
          return "0x";
        }
        case "eth_sendRawTransaction":
        case "eth_sendRawTransactionSync": {
          const raw = params?.[0] as Hex;
          lastHash = keccak256(raw);
          const tx = Transaction.deserialize(raw);
          const call = tx.calls[tx.calls.length - 1] as { data?: Hex };
          if (!call.data) throw new Error("session transaction has no call data");
          try {
            const decoded = decodeFunctionData({ abi: openAbi, data: call.data });
            const [payee, operator, token, nextDeposit, salt, authorizedSigner] = decoded.args as [Address, Address, Address, bigint, Hex, Address];
            const expiringNonceHash = keccak256(concatHex([TxEnvelopeTempo.encodeForSigning(tx as any), payer.address as Hex]));
            descriptor = { payer: payer.address, payee, operator, token, salt, authorizedSigner, expiringNonceHash };
            channelId = keccak256(encodeAbiParameters([
              { type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "bytes32" },
              { type: "address" }, { type: "bytes32" }, { type: "address" }, { type: "uint256" },
            ], [payer.address, payee, operator, token, salt, authorizedSigner, expiringNonceHash, escrow, BigInt(TEMPO_MODERATO_CHAIN_ID)]));
            deposit = nextDeposit;
            lastOperation = "open";
          } catch {
            try {
              const topUp = decodeFunctionData({ abi: topUpAbi, data: call.data });
              const additional = (topUp.args as any[])[1] as bigint;
              deposit += additional;
              lastOperation = "topUp";
            } catch {
              const close = decodeFunctionData({ abi: closeAbi, data: call.data });
              settled = (close.args as any[])[2] as bigint;
              deposit = 0n;
              lastOperation = "close";
            }
          }
          return lastHash;
        }
        case "eth_getTransactionReceipt": {
          const id = channelId ?? ("0x" + "00".repeat(32) as Hex);
          const current = descriptor ?? { payer: payer.address, payee: recipient, operator: "0x0000000000000000000000000000000000000000" as Address, token: PATH_USD_ADDRESS, salt: "0x" + "00".repeat(32) as Hex, authorizedSigner: payer.address, expiringNonceHash: "0x" + "00".repeat(32) as Hex };
          const topics = lastOperation === "open"
            ? encodeEventTopics({ abi: openedEventAbi, eventName: "ChannelOpened", args: { channelId: id, payer: current.payer, payee: current.payee } })
            : lastOperation === "topUp"
              ? encodeEventTopics({ abi: topUpEventAbi, eventName: "TopUp", args: { channelId: id, payer: current.payer, payee: current.payee } })
              : encodeEventTopics({ abi: closeEventAbi, eventName: "ChannelClosed", args: { channelId: id, payer: current.payer, payee: current.payee } });
          const data = lastOperation === "open"
            ? encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint96" }], [current.operator, current.token, current.authorizedSigner, current.salt, current.expiringNonceHash, deposit])
            : lastOperation === "topUp"
              ? encodeAbiParameters([{ type: "uint96" }, { type: "uint96" }], [0n, deposit])
              : encodeAbiParameters([{ type: "uint96" }, { type: "uint96" }], [settled, 0n]);
          return { transactionHash: lastHash, status: "0x1", blockNumber: "0x1", logs: [{ address: escrow, topics, data }] };
        }
        default: return "0x0";
      }
    },
  });
  const chainClient = createPublicClient({ chain: tempoModerato, transport });
  const serverClient = createWalletClient({ account: payee, chain: tempoModerato, transport }).extend(publicActions);
  const server = ServerMppx.create({
    secretKey: "mpp-session-local-deterministic-secret-key!!",
    methods: [serverTempo.session({
      testnet: true,
      chainId: TEMPO_MODERATO_CHAIN_ID,
      currency: PATH_USD_ADDRESS,
      recipient,
      escrowContract: escrow,
      account: payee,
      getClient: () => serverClient,
      sse: false,
      bootstrap: true,
      resolveChannelId: async ({ source }) => source?.toLowerCase().endsWith(payer.address.toLowerCase()) ? channelId ?? null : null,
    } as any)],
  });
  const route = async (request: Request) => {
    const result = await server.tempo.session({ amount: "0.000001", unitType: "request", suggestedDeposit: "0.000002", currency: PATH_USD_ADDRESS, recipient, sessionProtocol: "v2" })(request);
    if (result.status === 402) return result.challenge;
    return result.withReceipt(Response.json({ ok: true, session: "CONFIRMED" }));
  };
  const backing = new Map<string, string>();
  const channelStore = createJsonChannelStore({
    async get(key) { return backing.get(key); },
    async set(key, value) { backing.set(key, value); },
    async delete(key) { backing.delete(key); },
  });
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => route(new Request(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, init));
  const manager = sessionManager({ account: payer, getClient: () => chainClient, fetch: fetcher, allowedChainIds: [TEMPO_MODERATO_CHAIN_ID], escrow, maxDeposit: "0.000002", channelStore });
  const first = await manager.fetch("https://paid.example/session");
  const second = await manager.fetch("https://paid.example/session");
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(manager.opened, true);
  assert.equal(manager.cumulative, 2n);
  const recovered = sessionManager({ account: payer, getClient: () => chainClient, fetch: fetcher, allowedChainIds: [TEMPO_MODERATO_CHAIN_ID], escrow, bootstrap: true, maxDeposit: "0.000002", channelStore });
  const third = await recovered.fetch("https://paid.example/session");
  assert.equal(third.status, 200);
  assert.equal(recovered.opened, true);
  assert.ok(recovered.channelId);
  const closed = await recovered.close();
  assert.ok(closed);
  assert.equal(recovered.opened, false);
});
