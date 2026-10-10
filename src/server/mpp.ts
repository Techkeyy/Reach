import { createHmac, timingSafeEqual } from "node:crypto";
import { Mppx, Store, tempo } from "mppx/server";
import { createWalletClient, http, isAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { tempoModerato } from "viem/chains";
import { PATH_USD_ADDRESS, TEMPO_MODERATO_CHAIN_ID } from "../shared/reach.js";
import type { ReachKv } from "./kvAdapter.js";

const MPP_PREFIX = "reach:mpp:v1:";
const RECEIPT_TTL_SECONDS = 30 * 24 * 60 * 60;
const IDENTITY_HEADER = "x-reach-mpp-identity";
const localLocks = new Map<string, Promise<void>>();

function safeJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, nested) => typeof nested === "bigint" ? nested.toString() : nested));
}

async function withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = localLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  localLocks.set(key, previous.then(() => current));
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (localLocks.get(key) === current) localLocks.delete(key);
  }
}

function createMppStore(kv: ReachKv): Store.AtomicStore {
  return Store.upstash({
    async get(key) {
      return (await kv.get(key)) ?? null;
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
          const current = (await kv.get(key)) ?? null;
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
          // MPPx replay records are only deleted by expiry. Refusing an
          // unguarded delete avoids deleting a newer record after a CAS race.
          const tombstone = await kv.compareAndSet(key, current === undefined ? null : JSON.stringify(current), { deleted: true }, { ttl: 1 });
          if (tombstone) return change.result;
          continue;
        }
        const updated = await kv.compareAndSet(key, current === undefined ? null : JSON.stringify(current), change.value, { ttl: RECEIPT_TTL_SECONDS });
        if (updated) return change.result;
      }
      throw new Error("durable MPP store is contended");
    },
  }, { keyPrefix: MPP_PREFIX });
}

export type MppService = {
  recipient: Address;
  price: string;
  chainId: number;
  handle: (request: Request) => Promise<Response>;
  handleSession: (request: Request) => Promise<Response>;
};

export function createMppService(kv: ReachKv): MppService | undefined {
  const secretKey = process.env.MPP_SECRET_KEY;
  const recipientValue = process.env.REACH_MPP_RECIPIENT_ADDRESS;
  if (!secretKey || !recipientValue || !isAddress(recipientValue)) return undefined;

  const recipient = recipientValue as Address;
  const price = process.env.REACH_MPP_PRICE ?? "0.01";
  const identitySecret = process.env.REACH_MPP_IDENTITY_SECRET ?? secretKey;
  const settlementPrivateKey = process.env.REACH_MPP_SETTLEMENT_PRIVATE_KEY as Hex | undefined;
  const settlementAccount = settlementPrivateKey ? privateKeyToAccount(settlementPrivateKey) : undefined;
  if (settlementAccount && settlementAccount.address.toLowerCase() !== recipient.toLowerCase()) throw new Error("MPP settlement signer must equal the configured recipient");
  const settlementClient = settlementAccount
    ? createWalletClient({ account: settlementAccount, chain: tempoModerato, transport: http(process.env.REACH_RPC_URL ?? "https://rpc.moderato.tempo.xyz", { retryCount: 0, retryDelay: 0, timeout: 10_000 }) })
    : undefined;
  const store = createMppStore(kv);
  const sessionIdentity = async (parameters: { request?: { headers: Headers }; source?: string }) => {
    const value = parameters.request?.headers.get(IDENTITY_HEADER);
    const sourceAddress = parameters.source?.match(/(0x[0-9a-fA-F]{40})$/)?.[1];
    if (!value || !sourceAddress) return null;
    const separator = value.indexOf(".");
    if (separator <= 0) return null;
    const identity = value.slice(0, separator);
    const supplied = value.slice(separator + 1);
    const expected = createHmac("sha256", identitySecret).update(`${identity}:${sourceAddress.toLowerCase()}:${recipient.toLowerCase()}`).digest("base64url");
    const suppliedBytes = Buffer.from(supplied);
    const expectedBytes = Buffer.from(expected);
    if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) return null;
    return await kv.get<string>(`${MPP_PREFIX}identity:${identity}:${recipient.toLowerCase()}`) ?? null;
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
        waitForConfirmation: true,
      }),
      tempo.session({
        chainId: TEMPO_MODERATO_CHAIN_ID,
        currency: PATH_USD_ADDRESS,
        recipient,
        store,
        sse: false,
        minVoucherDelta: "0",
        account: settlementAccount,
        feePayer: settlementAccount ? true : undefined,
        bootstrap: true,
        resolveChannelId: sessionIdentity,
        ...(settlementClient ? { getClient: async () => settlementClient as any } : {}),
        ...(settlementAccount ? { settlementSchedule: { intervalMs: 60_000 } } : {}),
        onSessionSettlement: async (settlement) => {
          await kv.set(`${MPP_PREFIX}settlement:${settlement.txHash}`, safeJson({ status: "CONFIRMED", ...settlement, recordedAt: new Date().toISOString() }), { ttl: RECEIPT_TTL_SECONDS });
        },
        onSessionSettlementFailure: async (failure) => {
          await kv.set(`${MPP_PREFIX}settlement-failure:${failure.channelId}:${failure.trigger}`, safeJson({ status: "UNKNOWN", ...failure, error: failure.error instanceof Error ? failure.error.message : String(failure.error), recordedAt: new Date().toISOString() }), { ttl: RECEIPT_TTL_SECONDS });
        },
      } as any),
    ],
    realm: process.env.MPP_REALM ?? "Reach agent service",
    secretKey,
  });

  mppx.onPaymentSuccess(async ({ receipt, challenge, request }) => {
    const reference = typeof (receipt as { reference?: unknown }).reference === "string"
      ? (receipt as { reference: string }).reference
      : challenge.id;
    await kv.set(`${MPP_PREFIX}receipt:${reference}`, safeJson({
      status: "CONFIRMED",
      chainId: TEMPO_MODERATO_CHAIN_ID,
      receipt,
      challenge,
      request,
      recordedAt: new Date().toISOString(),
    }), { ttl: RECEIPT_TTL_SECONDS });
    const identity = request instanceof Request ? request.headers.get(IDENTITY_HEADER) : undefined;
    const channelId = typeof (receipt as { channelId?: unknown }).channelId === "string" ? (receipt as unknown as { channelId: string }).channelId : undefined;
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
        description: "Reach agent service charge",
      })(request);
      if (result.status === 402) return result.challenge;
      return result.withReceipt(Response.json({
        ok: true,
        service: "Reach agent service",
        payment: "CONFIRMED",
        chainId: TEMPO_MODERATO_CHAIN_ID,
      }));
    },
    async handleSession(request) {
      const result = await mppx.tempo.session({
        amount: price,
        unitType: "request",
        suggestedDeposit: price,
        currency: PATH_USD_ADDRESS,
        recipient,
      })(request);
      if (result.status === 402) return result.challenge;
      return result.withReceipt(Response.json({
        ok: true,
        service: "Reach agent session service",
        payment: "CONFIRMED",
        chainId: TEMPO_MODERATO_CHAIN_ID,
      }));
    },
  };
}
