import { createHmac } from "node:crypto";
import { Challenge, Constants, Credential, Receipt } from "mppx";
import { Mppx, createJsonChannelStore, sessionManager, tempo } from "mppx/client";
import { formatUnits, keccak256, type Address, type Hex } from "viem";
import type { ReachKv } from "./kvAdapter.js";
import type { createAgentAuthorizationService } from "./agentAuthorization.js";

type AgentService = ReturnType<typeof createAgentAuthorizationService>;

const PAYMENT_HEADER_NAMES = [
  Constants.Headers.authorization,
  Constants.Headers.paymentAuthorization,
  Constants.Headers.paymentSession,
  Constants.Headers.paymentReceipt,
  Constants.Headers.wwwAuthenticate,
];
const MPP_SESSION_ESCROW = "0x4d50500000000000000000000000000000000000";
const MPP_IDENTITY_HEADER = "x-reach-mpp-identity";
const payerLocks = new Map<string, Promise<void>>();

type RequestInput = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  idempotencyKey: string;
};

function safeJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, nested) => typeof nested === "bigint" ? nested.toString() : nested));
}

async function withPayerLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = payerLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  payerLocks.set(key, previous.then(() => current));
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (payerLocks.get(key) === current) payerLocks.delete(key);
  }
}

function endpoint(input: RequestInput, allowedOrigins: string[] | null): { url: URL; origin: string } {
  let url: URL;
  try { url = new URL(input.url); } catch { throw new Error("MPP endpoint URL is invalid"); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("MPP endpoint must use http or https");
  const origin = url.origin.toLowerCase();
  if (!allowedOrigins?.includes(origin)) throw new Error("MPP endpoint origin is outside the authorization allowlist");
  return { url, origin };
}

function requestInit(input: RequestInput): RequestInit {
  const headers = new Headers(input.headers ?? {});
  for (const name of PAYMENT_HEADER_NAMES) headers.delete(name);
  if (headers.has("host") || headers.has("content-length")) throw new Error("MPP request contains a forbidden transport header");
  return {
    method: input.method ?? "GET",
    headers,
    ...(input.body === undefined ? {} : { body: input.body }),
    redirect: "manual",
  };
}

function guardedFetch(fetcher: typeof globalThis.fetch, allowedOrigins: string[] | null) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("MPP endpoint must use http or https");
    if (!allowedOrigins?.includes(url.origin.toLowerCase())) throw new Error("MPP endpoint origin is outside the authorization allowlist");
    const response = await fetcher(input, { ...init, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) throw new Error("MPP endpoint redirects are not permitted");
    return response;
  };
}

function validateChallenge(challenge: any, policy: any, mode: "charge" | "session", origin: string): { amountRaw: string; recipient: Address } {
  if (challenge.method !== "tempo" || challenge.intent !== mode) throw new Error("unsupported MPP challenge");
  const challengeChainId = challenge.request?.chainId ?? challenge.request?.methodDetails?.chainId;
  if (challengeChainId !== policy.chainId) throw new Error("MPP challenge chain is not authorized");
  if (String(challenge.request?.currency ?? "").toLowerCase() !== policy.currency.toLowerCase()) throw new Error("MPP challenge currency is not authorized");
  if (typeof challenge.request?.amount !== "string" || !/^[1-9][0-9]*$/.test(challenge.request.amount)) throw new Error("MPP challenge amount is invalid");
  if (BigInt(challenge.request.amount) > BigInt(policy.maxPerPaymentRaw)) throw new Error("MPP challenge exceeds the per-payment budget");
  const expiresAt = typeof challenge.expires === "string" ? Math.floor(new Date(challenge.expires).getTime() / 1000) : NaN;
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000) || expiresAt > policy.expiryTimestamp) throw new Error("MPP challenge expiry is outside the authorization window");
  const recipientValue = challenge.request?.recipient;
  if (typeof recipientValue !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(recipientValue)) throw new Error("MPP challenge recipient is invalid");
  const recipient = recipientValue.toLowerCase() as Address;
  if (!policy.allowedDestinations?.some((address: string) => address.toLowerCase() === recipient)) throw new Error("MPP challenge recipient is outside the authorization allowlist");
  if (!policy.allowedOrigins?.includes(origin)) throw new Error("MPP challenge origin is outside the authorization allowlist");
  if (mode === "charge" && !challenge.request?.methodDetails?.supportedModes?.includes("pull")) throw new Error("MPP challenge does not support the required pull mode");
  if (mode === "charge" && challenge.request?.methodDetails?.splits) throw new Error("MPP split payments are not permitted");
  if (mode === "session" && challenge.request?.methodDetails?.sessionProtocol !== "v2") throw new Error("unsupported MPP session protocol");
  if (mode === "session" && challenge.request?.methodDetails?.escrowContract?.toLowerCase() !== MPP_SESSION_ESCROW) throw new Error("MPP session escrow is not authorized");
  return { amountRaw: challenge.request.amount, recipient };
}

function receiptFromResponse(response: Response): any {
  const receipt = Receipt.fromResponse(response);
  if (receipt.status !== "success" || receipt.method !== "tempo" || typeof receipt.reference !== "string" || receipt.reference.length === 0) throw new Error("MPP response receipt is not authoritative");
  return safeJson(receipt);
}

function referenceFromCredential(credential: string): Hex | undefined {
  try {
    const parsed = Credential.deserialize(credential) as { payload?: { type?: string; hash?: unknown; signature?: unknown } };
    if (parsed.payload?.type === "hash" && typeof parsed.payload.hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(parsed.payload.hash)) return parsed.payload.hash as Hex;
    if (parsed.payload?.type === "transaction" && typeof parsed.payload.signature === "string" && /^0x[0-9a-fA-F]+$/.test(parsed.payload.signature)) return keccak256(parsed.payload.signature as Hex);
  } catch {
    // An undecodable credential cannot be used for authoritative reconciliation.
  }
  return undefined;
}

function identityHeader(policy: any, payerAddress: Address): string | undefined {
  const secret = process.env.REACH_MPP_IDENTITY_SECRET;
  const recipient = policy.allowedDestinations?.[0];
  if (!secret || typeof policy.id !== "string" || typeof recipient !== "string") return undefined;
  const identity = policy.id;
  const proof = createHmac("sha256", secret).update(`${identity}:${payerAddress.toLowerCase()}:${recipient.toLowerCase()}`).digest("base64url");
  return `${identity}.${proof}`;
}

export type MppPayerService = {
  request: (token: string, input: RequestInput) => Promise<unknown>;
  sessionRequest: (token: string, input: RequestInput) => Promise<unknown>;
  sessionClose: (token: string, input: RequestInput) => Promise<unknown>;
};

export function createMppPayerService(agentService: AgentService, kv: ReachKv, dependencies: { fetch?: typeof globalThis.fetch } = {}): MppPayerService {
  const fetcher = dependencies.fetch ?? globalThis.fetch.bind(globalThis);

  async function request(token: string, input: RequestInput): Promise<unknown> {
    const existing = await agentService.getMppPayment(token, input.idempotencyKey);
    if (existing?.payment.state === "CONFIRMED") return { payment: existing.payment, response: { status: existing.payment.responseStatus, body: existing.payment.responseBody ?? "", contentType: existing.payment.responseContentType } };
    return agentService.withSigner(token, "MPP_DIRECT", async ({ policy, account, publicClient }) => {
      const target = endpoint(input, policy.allowedOrigins);
      const init = requestInit(input);
      let reserved = false;
      let paymentReference: Hex | undefined;
      const payerFetch = guardedFetch(fetcher, policy.allowedOrigins);
      const mppx = Mppx.create({
        polyfill: false,
        fetch: payerFetch,
        methods: [tempo.charge({
          account,
          getClient: () => publicClient as any,
          expectedChainId: policy.chainId,
          expectedRecipients: (policy.allowedDestinations ?? []) as Address[],
          mode: "pull",
        })],
        maxPaymentRetries: 1,
        onChallenge: async (challenge, helpers) => {
          const checked = validateChallenge(challenge, policy, "charge", target.origin.toLowerCase());
          const reservation = await agentService.mppReserve(token, {
            amountRaw: checked.amountRaw,
            recipient: checked.recipient,
            endpointOrigin: target.origin,
            idempotencyKey: input.idempotencyKey,
            mode: "charge",
          });
          reserved = !reservation.replay;
          return helpers.createCredential();
        },
      });
      mppx.onCredentialCreated(({ credential }) => {
        paymentReference = referenceFromCredential(credential);
      });
      try {
        const response = await mppx.fetch(target.url, init);
        // Once the paid endpoint has returned, a malformed/missing receipt is
        // not a deterministic failure: the payee may already have accepted
        // the credential. Keep the reservation UNKNOWN for reconciliation.
        const receipt = receiptFromResponse(response);
        const body = await response.clone().text();
        const result = await agentService.mppConfirm(token, input.idempotencyKey, {
          receipt,
          responseStatus: response.status,
          responseBody: body.length > 128 * 1024 ? body.slice(0, 128 * 1024) : body,
          responseContentType: response.headers.get("content-type") ?? undefined,
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

  async function sessionRequest(token: string, input: RequestInput): Promise<unknown> {
    const existing = await agentService.getMppPayment(token, input.idempotencyKey);
    if (existing?.payment.state === "CONFIRMED") return { payment: existing.payment, response: { status: existing.payment.responseStatus, body: existing.payment.responseBody ?? "", contentType: existing.payment.responseContentType } };
    return agentService.withSigner(token, "MPP_SESSION", async ({ policy, account, publicClient }) => {
      const target = endpoint(input, policy.allowedOrigins);
      const init = requestInit(input);
      const identity = identityHeader(policy, account.address as Address);
      if (identity) (init.headers as Headers).set(MPP_IDENTITY_HEADER, identity);
      const lockKey = `${policy.id}:${target.origin}:${MPP_SESSION_ESCROW}`;
      return withPayerLock(lockKey, async () => {
        let reserved = false;
        const payerFetch = guardedFetch(fetcher, policy.allowedOrigins);
        const challengeFetch = async (requestInput: RequestInfo | URL, requestOptions?: RequestInit) => {
          const response = await payerFetch(requestInput, requestOptions);
          if (response.status === 402) {
            const challenges = Challenge.fromResponseList(response);
            const challenge = challenges.find((candidate: any) => candidate.method === "tempo" && candidate.intent === "session");
            if (!challenge) throw new Error("MPP session challenge is missing");
            const checked = validateChallenge(challenge, policy, "session", target.origin.toLowerCase());
            const reservation = await agentService.mppReserve(token, {
              amountRaw: checked.amountRaw,
              recipient: checked.recipient,
              endpointOrigin: target.origin,
              idempotencyKey: input.idempotencyKey,
              mode: "session",
            });
            reserved = !reservation.replay;
          }
          return response;
        };
        const manager = sessionManager({
          account,
          getClient: () => publicClient as any,
          fetch: challengeFetch,
          bootstrap: true,
          allowedChainIds: [policy.chainId],
          escrow: MPP_SESSION_ESCROW as Address,
          maxDeposit: formatUnits(BigInt(policy.maxPerPaymentRaw), 6),
          channelStore: createJsonChannelStore({
            async get(key) { return await kv.get<string>(`reach:mpp:channel:${policy.id}:${key}`); },
            async set(key, value) { await kv.set(`reach:mpp:channel:${policy.id}:${key}`, value); },
            async delete(key) { await kv.delete(`reach:mpp:channel:${policy.id}:${key}`); },
          }),
        });
        try {
          const response = await manager.fetch(target.url, init);
          const receipt = receiptFromResponse(response);
          const body = await response.clone().text();
          const result = await agentService.mppConfirm(token, input.idempotencyKey, {
            receipt,
            responseStatus: response.status,
            responseBody: body.length > 128 * 1024 ? body.slice(0, 128 * 1024) : body,
            responseContentType: response.headers.get("content-type") ?? undefined,
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

  async function sessionClose(token: string, input: RequestInput): Promise<unknown> {
    return agentService.withSigner(token, "MPP_SESSION", async ({ policy, account, publicClient }) => {
      const target = endpoint(input, policy.allowedOrigins);
      const init = requestInit(input);
      const identity = identityHeader(policy, account.address as Address);
      if (identity) (init.headers as Headers).set(MPP_IDENTITY_HEADER, identity);
      const lockKey = `${policy.id}:${target.origin}:${MPP_SESSION_ESCROW}`;
      return withPayerLock(lockKey, async () => {
        const manager = sessionManager({
          account,
          getClient: () => publicClient as any,
          fetch: guardedFetch(fetcher, policy.allowedOrigins),
          bootstrap: true,
          allowedChainIds: [policy.chainId],
          escrow: MPP_SESSION_ESCROW as Address,
          maxDeposit: formatUnits(BigInt(policy.maxPerPaymentRaw), 6),
          channelStore: createJsonChannelStore({
            async get(key) { return await kv.get<string>(`reach:mpp:channel:${policy.id}:${key}`); },
            async set(key, value) { await kv.set(`reach:mpp:channel:${policy.id}:${key}`, value); },
            async delete(key) { await kv.delete(`reach:mpp:channel:${policy.id}:${key}`); },
          }),
        });
        // A cold worker first performs MPPx's zero-charge bootstrap handshake;
        // the persisted channel is then closed with a signed close credential.
        await manager.fetch(target.url, { ...init, method: "HEAD", body: undefined });
        const receipt = await manager.close();
        if (!receipt) throw new Error("MPP session has no reusable channel to close");
        return { status: "CLOSED", receipt: safeJson(receipt), channelId: manager.channelId };
      });
    });
  }

  return { request, sessionRequest, sessionClose };
}
