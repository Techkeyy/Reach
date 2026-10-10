import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { Kv } from "accounts/server";
import { isAddress, toFunctionSelector, type Address, type Hex } from "viem";
import { createPublicClient, createWalletClient, http } from "viem";
import { tempoModerato } from "viem/chains";
import { Account as TempoAccount, Actions, KeyAuthorizationManager } from "viem/tempo";
import { KeyAuthorization, SignatureEnvelope } from "ox/tempo";
import { privateKeyToAccount } from "viem/accounts";
import {
  DEFAULT_VAULT_ADDRESS,
  PATH_USD_ADDRESS,
  TEMPO_MODERATO_CHAIN_ID,
  TEMPO_MODERATO_RPC_URL,
  pathUsdAbi,
  vaultAbi,
} from "../shared/reach.js";
import type { ReachKv } from "./kvAdapter.js";

const POLICY_PREFIX = "reach:agent-policy:v1:";
const PAYMENT_PREFIX = "reach:agent-payment:v1:";
const MPP_PAYMENT_PREFIX = "reach:agent-mpp-payment:v1:";
const OWNER_POLICY_INDEX_PREFIX = "reach:agent-owner-policies:v1:";
const POLICY_PAYMENT_INDEX_PREFIX = "reach:agent-policy-payments:v1:";
const POLICY_MPP_INDEX_PREFIX = "reach:agent-policy-mpp-payments:v1:";
const POLICY_TTL_SECONDS = 366 * 24 * 60 * 60;
const MAX_POLICY_LIFETIME_SECONDS = 366 * 24 * 60 * 60;
const MAX_DESTINATIONS = 64;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const APPROVE_SELECTOR = toFunctionSelector("approve(address,uint256)");
const TRANSFER_SELECTOR = toFunctionSelector("transfer(address,uint256)");
const CREATE_PAYOUT_SELECTOR = toFunctionSelector("createPayout(uint256,uint256,address,uint64)");
const SESSION_ESCROW_ADDRESS = "0x4d50500000000000000000000000000000000000" as Address;
const SESSION_OPEN_SELECTOR = toFunctionSelector("open(address,address,address,uint96,bytes32,address)");
const SESSION_TOP_UP_SELECTOR = toFunctionSelector("topUp((address,address,address,address,bytes32,address,bytes32),uint96)");
const SESSION_CLOSE_SELECTOR = toFunctionSelector("close((address,address,address,address,bytes32,address,bytes32),uint96,uint96,bytes)");
const SESSION_REQUEST_CLOSE_SELECTOR = toFunctionSelector("requestClose((address,address,address,address,bytes32,address,bytes32))");
const SESSION_WITHDRAW_SELECTOR = toFunctionSelector("withdraw((address,address,address,address,bytes32,address,bytes32))");

export type AgentAuthorizationPurpose = "VAULT_PAYOUT" | "MPP_DIRECT" | "MPP_SESSION";

export type AgentPolicyStatus = "PENDING" | "ACTIVE" | "REVOKED" | "EXPIRED";

type EncryptedSecret = {
  algorithm: "aes-256-gcm";
  iv: string;
  tag: string;
  ciphertext: string;
};

type StoredAgentPolicy = {
  version: 1;
  id: string;
  ownerAddress: Address;
  agentAddress: Address;
  agentPublicKey: Hex;
  chainId: number;
  currency: Address;
  maxPerPaymentRaw: string;
  cumulativeBudgetRaw: string;
  reservedRaw: string;
  spentRaw: string;
  expiryTimestamp: number;
  allowedDestinations: Address[] | null;
  allowedOrigins: string[] | null;
  purpose: AgentAuthorizationPurpose;
  status: AgentPolicyStatus;
  tokenHash: string;
  encryptedPrivateKey: EncryptedSecret;
  keyAuthorization?: unknown;
  rootAddress?: Address;
  createdAt: string;
  updatedAt: string;
};

export type PublicAgentPolicy = Omit<StoredAgentPolicy, "tokenHash" | "encryptedPrivateKey" | "keyAuthorization"> & {
  remainingRaw: string;
};

export type AgentPaymentState = "RESERVED" | "SUBMITTING" | "CONFIRMED" | "FAILED" | "UNKNOWN";

export type AgentPayment = {
  version: 1;
  id: string;
  policyId: string;
  idempotencyKey: string;
  payoutId: string;
  amountRaw: string;
  destination: Address;
  claimSigner: Address;
  payoutExpiresAt: string;
  state: AgentPaymentState;
  reservedAt: string;
  approveTxHash?: Hex;
  createTxHash?: Hex;
  error?: string;
  updatedAt: string;
};

export type MppPaymentState = "RESERVED" | "CONFIRMED" | "FAILED" | "UNKNOWN";

export type AgentMppPayment = {
  version: 1;
  id: string;
  policyId: string;
  idempotencyKey: string;
  mode: "charge" | "session";
  amountRaw: string;
  recipient: Address;
  endpointOrigin: string;
  state: MppPaymentState;
  /** Transaction reference captured before an uncertain direct submission. */
  reference?: Hex;
  reservedAt: string;
  receipt?: unknown;
  responseStatus?: number;
  responseBody?: string;
  responseContentType?: string;
  error?: string;
  updatedAt: string;
};

export type AgentAuthorizationInput = {
  maxPerPaymentRaw: string;
  cumulativeBudgetRaw: string;
  expiryTimestamp: number;
  allowedDestinations?: string[];
  allowedOrigins?: string[];
  purpose?: AgentAuthorizationPurpose;
};

export type AgentAuthorizationDependencies = {
  now?: () => number;
  rpcUrl?: string;
  vaultAddress?: Address;
  submitPayout?: (input: {
    policy: StoredAgentPolicy;
    payment: AgentPayment;
    privateKey: Hex;
  }) => Promise<{ approveTxHash: Hex; createTxHash: Hex }>;
  readPayout?: (payoutId: bigint) => Promise<{ sender: Address; amount: bigint; expiresAt: bigint; claimSigner: Address; status: number }>;
  /** Test-only seam. Production verifies the signed authorization against Tempo RPC. */
  verifyOnchainAuthorization?: (policy: StoredAgentPolicy, authorization: KeyAuthorization.Signed) => Promise<void>;
  /** Authoritative receipt lookup used to resolve an ambiguous MPP submission. */
  readMppReceipt?: (payment: AgentMppPayment) => Promise<unknown | undefined>;
};

type AtomicKv = ReachKv & { compareAndSet?: NonNullable<ReachKv["compareAndSet"]> };

const processLocks = new Map<string, Promise<void>>();

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}
async function withProcessLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = processLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  processLocks.set(key, previous.then(() => current));
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (processLocks.get(key) === current) processLocks.delete(key);
  }
}

async function atomicUpdate<T>(kv: AtomicKv, key: string, mutate: (current: any | undefined) => { value?: any; result: T; delete?: boolean }, ttl?: number): Promise<T> {
  const compareAndSet = kv.compareAndSet;
  if (!compareAndSet) {
    return withProcessLock(key, async () => {
      const current = await kv.get(key);
      const change = mutate(current);
      if (change.delete) await kv.delete(key);
      else if (change.value !== undefined) await kv.set(key, change.value, ttl ? { ttl } : undefined);
      return change.result;
    });
  }

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const current = await kv.get(key);
    const change = mutate(current);
    if (change.delete) {
      // The production implementation currently only exposes compare-and-set.
      // A tombstone is safer than an unguarded delete when a concurrent writer
      // wins between the read and the attempted delete.
      const deleted = await compareAndSet(key, current === undefined ? null : stableJson(current), { deleted: true }, { ttl: 30 });
      if (deleted) {
        await kv.delete(key);
        return change.result;
      }
      continue;
    }
    if (change.value === undefined) return change.result;
    const updated = await compareAndSet(key, current === undefined ? null : stableJson(current), change.value, ttl ? { ttl } : undefined);
    if (updated) return change.result;
  }
  throw new Error("durable authorization state is contended");
}

function parseEncryptionKey(value: string | undefined): Buffer | undefined {
  if (!value) return undefined;
  if (/^[0-9a-f]{64}$/i.test(value)) return Buffer.from(value, "hex");
  try {
    const decoded = Buffer.from(value, "base64url");
    return decoded.length === 32 ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function encryptSecret(secret: string, key: Buffer): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return {
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
}

function decryptSecret(secret: EncryptedSecret, key: Buffer): Hex {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(secret.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(secret.tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(secret.ciphertext, "base64url")), decipher.final()]).toString("utf8") as Hex;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function publicPolicy(policy: StoredAgentPolicy): PublicAgentPolicy {
  const remaining = BigInt(policy.cumulativeBudgetRaw) - BigInt(policy.spentRaw) - BigInt(policy.reservedRaw);
  const {
    tokenHash: _tokenHash,
    encryptedPrivateKey: _encryptedPrivateKey,
    keyAuthorization: _keyAuthorization,
    ...safePolicy
  } = policy;
  return {
    ...safePolicy,
    remainingRaw: (remaining < 0n ? 0n : remaining).toString(),
  };
}

function policyKey(id: string) { return `${POLICY_PREFIX}${id}`; }
function paymentKey(policyId: string, idempotencyKey: string) { return `${PAYMENT_PREFIX}${policyId}:${idempotencyKey}`; }
function ownerPolicyIndexKey(ownerAddress: Address) { return `${OWNER_POLICY_INDEX_PREFIX}${ownerAddress.toLowerCase()}`; }
function policyPaymentIndexKey(policyId: string) { return `${POLICY_PAYMENT_INDEX_PREFIX}${policyId}`; }
function policyMppIndexKey(policyId: string) { return `${POLICY_MPP_INDEX_PREFIX}${policyId}`; }

function requirePositiveUint(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) throw new Error(`${field} must be a positive integer`);
  const parsed = BigInt(value);
  if (parsed > (1n << 256n) - 1n) throw new Error(`${field} is too large`);
  return parsed.toString();
}

function normalizeDestinations(values: unknown): Address[] | null {
  if (values === undefined || values === null) return null;
  if (!Array.isArray(values) || values.length > MAX_DESTINATIONS || values.length === 0) throw new Error("allowedDestinations must be a non-empty address list");
  const result = values.map((value) => {
    if (typeof value !== "string" || !isAddress(value) || value.toLowerCase() === ZERO_ADDRESS) throw new Error("allowedDestinations contains an invalid address");
    return value.toLowerCase() as Address;
  });
  return [...new Set(result)];
}

function normalizeOrigins(values: unknown): string[] | null {
  if (values === undefined || values === null) return null;
  if (!Array.isArray(values) || values.length > MAX_DESTINATIONS || values.length === 0) throw new Error("allowedOrigins must be a non-empty origin list");
  const result = values.map((value) => {
    if (typeof value !== "string") throw new Error("allowedOrigins contains an invalid origin");
    let parsed: URL;
    try { parsed = new URL(value); } catch { throw new Error("allowedOrigins contains an invalid origin"); }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("allowedOrigins must use http or https");
    if (parsed.username || parsed.password || parsed.pathname !== "/" && parsed.pathname !== "" || parsed.search || parsed.hash) throw new Error("allowedOrigins must contain origins only");
    return parsed.origin.toLowerCase();
  });
  return [...new Set(result)];
}

function selectorsForPurpose(policy: StoredAgentPolicy, vaultAddress: Address): Array<{ address: Address; selector: Hex; recipients?: Address[] }> {
  if (policy.purpose === "VAULT_PAYOUT") {
    return [
      { address: PATH_USD_ADDRESS, selector: APPROVE_SELECTOR, recipients: [vaultAddress] },
      { address: vaultAddress, selector: CREATE_PAYOUT_SELECTOR },
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
    { address: SESSION_ESCROW_ADDRESS, selector: SESSION_WITHDRAW_SELECTOR },
  ];
}

function validateKeyAuthorization(policy: StoredAgentPolicy, value: unknown, vaultAddress: Address, rootAddress: Address): KeyAuthorization.Signed {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("missing key authorization");
  const authorization = KeyAuthorization.fromRpc(value as any);
  if (authorization.account && authorization.account.toLowerCase() !== rootAddress.toLowerCase()) throw new Error("access key account binding does not match owner");
  if (authorization.address.toLowerCase() !== policy.agentAddress.toLowerCase()) throw new Error("access key does not match the server-held signer");
  if (Number(authorization.chainId) !== policy.chainId) throw new Error("access key chain is not Reach Moderato");
  if (authorization.type !== "secp256k1") throw new Error("Reach server agents require a secp256k1 access key");
  if (!authorization.expiry || Number(authorization.expiry) !== policy.expiryTimestamp) throw new Error("access key expiry does not match policy");
  if (authorization.isAdmin) throw new Error("admin access keys are not permitted");
  const limits = authorization.limits ?? [];
  if (limits.length !== 1) throw new Error("access key limits are broader than policy");
  const limit = limits[0];
  if (!limit || limit.token.toLowerCase() !== PATH_USD_ADDRESS.toLowerCase() || BigInt(limit.limit) !== BigInt(policy.cumulativeBudgetRaw) || limit.period !== undefined) throw new Error("access key cumulative budget does not match policy");
  const scopes = authorization.scopes ?? [];
  if ((authorization as any).allowAnyCalls === true || scopes.some((scope: any) => scope?.allowAnyCalls === true)) throw new Error("broad access-key calls are not permitted");
  const expectedScopes = selectorsForPurpose(policy, vaultAddress);
  if (scopes.length !== expectedScopes.length) throw new Error("access key scopes are broader than policy");
  for (const expected of expectedScopes) {
    const actual = scopes.find((scope) => scope.address.toLowerCase() === expected.address.toLowerCase() && scope.selector?.toLowerCase() === expected.selector.toLowerCase());
    if (!actual) throw new Error("access key scopes are incomplete or broader than policy");
    const expectedRecipients = expected.recipients?.map((address) => address.toLowerCase()).sort() ?? undefined;
    const actualRecipients = actual.recipients?.map((address) => address.toLowerCase()).sort() ?? undefined;
    if (JSON.stringify(actualRecipients) !== JSON.stringify(expectedRecipients)) throw new Error("access key recipient scopes are incomplete or broader than policy");
  }
  if (!authorization.signature || !SignatureEnvelope.verify(authorization.signature, { payload: KeyAuthorization.getSignPayload(authorization), address: rootAddress })) throw new Error("owner signature on access key authorization is invalid");
  return authorization;
}

function asRpcAddress(value: unknown, field: string): Address {
  if (typeof value !== "string" || !isAddress(value)) throw new Error(`${field} must be a valid address`);
  return value.toLowerCase() as Address;
}

async function verifyAccessKeyOnchain(rpcUrl: string, policy: StoredAgentPolicy, authorization: KeyAuthorization.Signed) {
  const transport = http(rpcUrl, { retryCount: 0, retryDelay: 0, timeout: 10_000 });
  const publicClient = createPublicClient({ chain: tempoModerato, transport });
  const metadata = await (Actions.accessKey.getMetadata as any)(publicClient, {
    account: policy.ownerAddress,
    accessKey: policy.agentAddress,
  }) as { address: Address; keyType: string; expiry: bigint; isRevoked: boolean };
  if (metadata.address.toLowerCase() !== policy.agentAddress.toLowerCase()) throw new Error("onchain access key identity does not match policy");
  if (metadata.keyType !== authorization.type) throw new Error("onchain access key type does not match policy");
  if (metadata.expiry !== BigInt(policy.expiryTimestamp)) throw new Error("onchain access key expiry does not match policy");
  if (metadata.isRevoked) throw new Error("onchain access key is revoked");
  const remaining = await (Actions.accessKey.getRemainingLimit as any)(publicClient, {
    account: policy.ownerAddress,
    accessKey: policy.agentAddress,
    token: PATH_USD_ADDRESS,
  }) as { remaining: bigint; periodEnd?: bigint };
  if (remaining.periodEnd !== undefined) throw new Error("onchain access key has a recurring spending limit");
  if (remaining.remaining < BigInt(policy.cumulativeBudgetRaw)) throw new Error("onchain access key has insufficient remaining budget");
}

type AgentSignerContext = {
  policy: PublicAgentPolicy;
  account: ReturnType<typeof TempoAccount.fromSecp256k1>;
  walletClient: ReturnType<typeof createWalletClient>;
  publicClient: ReturnType<typeof createPublicClient>;
};

export function createAgentAuthorizationService(kv: Kv.Kv, dependencies: AgentAuthorizationDependencies = {}) {
  const store = kv as AtomicKv;
  const now = dependencies.now ?? (() => Math.floor(Date.now() / 1000));
  const rpcUrl = dependencies.rpcUrl ?? process.env.REACH_RPC_URL ?? TEMPO_MODERATO_RPC_URL;
  const vaultAddress = (dependencies.vaultAddress ?? process.env.REACH_VAULT_ADDRESS ?? DEFAULT_VAULT_ADDRESS) as Address;
  const encryptionKey = parseEncryptionKey(process.env.REACH_AGENT_ENCRYPTION_KEY);
  const verifyAuthorization = dependencies.verifyOnchainAuthorization ?? ((policy, authorization) => verifyAccessKeyOnchain(rpcUrl, policy, authorization));

  function assertAvailable() {
    if (!encryptionKey) throw new Error("agent authorization encryption is not configured");
  }

  async function readPolicy(id: string): Promise<StoredAgentPolicy | undefined> {
    return store.get<StoredAgentPolicy>(policyKey(id));
  }

  async function appendIndex(key: string, value: string) {
    await atomicUpdate(store, key, (current: unknown) => {
      const values = Array.isArray(current) ? current.filter((item): item is string => typeof item === "string") : [];
      if (!values.includes(value)) values.push(value);
      return { value: values.slice(-2_000), result: undefined };
    }, POLICY_TTL_SECONDS);
  }

  async function listPolicies(ownerAddress: Address): Promise<PublicAgentPolicy[]> {
    const owner = asRpcAddress(ownerAddress, "ownerAddress");
    const ids = await store.get<string[]>(ownerPolicyIndexKey(owner)) ?? [];
    const policies = await Promise.all(ids.map((id) => readPolicy(id)));
    return policies
      .filter((policy): policy is StoredAgentPolicy => Boolean(policy && policy.ownerAddress.toLowerCase() === owner.toLowerCase()))
      .map(publicPolicy)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async function listPayments(ownerAddress: Address, policyId: string): Promise<{ policy: PublicAgentPolicy; payments: AgentPayment[] } | undefined> {
    const owner = asRpcAddress(ownerAddress, "ownerAddress");
    const policy = await readPolicy(policyId);
    if (!policy || policy.ownerAddress.toLowerCase() !== owner.toLowerCase()) return undefined;
    const keys = await store.get<string[]>(policyPaymentIndexKey(policyId)) ?? [];
    const payments = await Promise.all(keys.map((idempotencyKey) => store.get<AgentPayment>(paymentKey(policyId, idempotencyKey))));
    return {
      policy: publicPolicy(policy),
      payments: payments.filter((payment): payment is AgentPayment => Boolean(payment)).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    };
  }

  async function listMppPayments(ownerAddress: Address, policyId: string): Promise<{ policy: PublicAgentPolicy; payments: AgentMppPayment[] } | undefined> {
    const owner = asRpcAddress(ownerAddress, "ownerAddress");
    const policy = await readPolicy(policyId);
    if (!policy || policy.ownerAddress.toLowerCase() !== owner.toLowerCase()) return undefined;
    const keys = await store.get<string[]>(policyMppIndexKey(policyId)) ?? [];
    const payments = await Promise.all(keys.map((idempotencyKey) => store.get<AgentMppPayment>(mppPaymentKey(policyId, idempotencyKey))));
    return {
      policy: publicPolicy(policy),
      payments: payments.filter((payment): payment is AgentMppPayment => Boolean(payment)).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    };
  }

  async function create(input: AgentAuthorizationInput, ownerAddress: Address) {
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
    const privateKey = (`0x${randomBytes(32).toString("hex")}`) as Hex;
    const signer = privateKeyToAccount(privateKey);
    const id = randomBytes(16).toString("hex");
    const token = `reach_agent_${id}_${randomBytes(32).toString("base64url")}`;
    const timestamp = new Date().toISOString();
    const policy: StoredAgentPolicy = {
      version: 1,
      id,
      ownerAddress: owner,
      agentAddress: signer.address,
      agentPublicKey: signer.publicKey as Hex,
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
      updatedAt: timestamp,
    };
    if (!store.create || !(await store.create(policyKey(id), policy, { ttl: POLICY_TTL_SECONDS }))) throw new Error("could not allocate a unique authorization");
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
        keyType: "secp256k1" as const,
        publicKey: signer.publicKey,
        // This object crosses JSON before it reaches wallet_authorizeAccessKey.
        // RPC bigint values therefore use the canonical 0x-prefixed form.
        limits: [{ token: PATH_USD_ADDRESS, limit: `0x${BigInt(cumulativeBudgetRaw).toString(16)}` }],
        scopes: selectorsForPurpose(policy, vaultAddress),
      },
    };
  }

  async function activate(id: string, ownerAddress: Address, keyAuthorization: unknown, rootAddress: Address) {
    assertAvailable();
    const policy = await readPolicy(id);
    if (!policy || policy.ownerAddress.toLowerCase() !== ownerAddress.toLowerCase()) throw new Error("authorization not found");
    if (policy.status !== "PENDING") throw new Error("authorization is not pending");
    if (rootAddress.toLowerCase() !== policy.ownerAddress.toLowerCase()) throw new Error("root account does not match owner");
    const storedAuthorization = validateKeyAuthorization(policy, keyAuthorization, vaultAddress, rootAddress);
    await verifyAuthorization(policy, storedAuthorization);
    const updated = { ...policy, status: "ACTIVE" as const, rootAddress: rootAddress.toLowerCase() as Address, keyAuthorization: storedAuthorization, updatedAt: new Date().toISOString() };
    await atomicUpdate(store, policyKey(id), (current) => {
      if (!current || current.status !== "PENDING") throw new Error("authorization changed while activating");
      return { value: updated, result: publicPolicy(updated) };
    }, POLICY_TTL_SECONDS);
    return publicPolicy(updated);
  }

  async function revoke(id: string, ownerAddress: Address) {
    const policy = await readPolicy(id);
    if (!policy || policy.ownerAddress.toLowerCase() !== ownerAddress.toLowerCase()) throw new Error("authorization not found");
    if (policy.status === "REVOKED") return publicPolicy(policy);
    const updated = { ...policy, status: "REVOKED" as const, updatedAt: new Date().toISOString() };
    await atomicUpdate(store, policyKey(id), (current) => {
      if (!current || current.ownerAddress.toLowerCase() !== ownerAddress.toLowerCase()) throw new Error("authorization changed while revoking");
      return { value: { ...current, ...updated }, result: publicPolicy({ ...current, ...updated }) };
    }, POLICY_TTL_SECONDS);
    return publicPolicy(updated);
  }

  async function authenticate(token: string): Promise<StoredAgentPolicy> {
    if (typeof token !== "string" || !/^reach_agent_[a-f0-9]{32}_[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("invalid agent credential");
    const id = token.split("_")[2]!;
    const policy = await readPolicy(id);
    if (!policy || tokenHash(token) !== policy.tokenHash) throw new Error("invalid agent credential");
    if (policy.status === "ACTIVE" && policy.expiryTimestamp <= now()) {
      await atomicUpdate(store, policyKey(id), (current) => current ? { value: { ...current, status: "EXPIRED", updatedAt: new Date().toISOString() }, result: undefined } : { result: undefined });
      throw new Error("agent authorization expired");
    }
    if (policy.status !== "ACTIVE") throw new Error(`agent authorization is ${policy.status.toLowerCase()}`);
    return policy;
  }

  async function reconcilePolicy(policyId: string, payment: AgentPayment, success: boolean, error?: string) {
    await atomicUpdate(store, policyKey(policyId), (current: StoredAgentPolicy | undefined) => {
      if (!current) throw new Error("authorization not found");
      if (!success) {
        return { value: { ...current, reservedRaw: (BigInt(current.reservedRaw) - BigInt(payment.amountRaw)).toString(), updatedAt: new Date().toISOString() }, result: undefined };
      }
      return { value: { ...current, reservedRaw: (BigInt(current.reservedRaw) - BigInt(payment.amountRaw)).toString(), spentRaw: (BigInt(current.spentRaw) + BigInt(payment.amountRaw)).toString(), updatedAt: new Date().toISOString() }, result: undefined };
    }, POLICY_TTL_SECONDS);
    if (error) await store.set(paymentKey(policyId, payment.idempotencyKey), { ...payment, error, updatedAt: new Date().toISOString() }, { ttl: POLICY_TTL_SECONDS });
  }

  async function submit(policy: StoredAgentPolicy, payment: AgentPayment) {
    const privateKey = decryptSecret(policy.encryptedPrivateKey, encryptionKey!);
    if (dependencies.submitPayout) return dependencies.submitPayout({ policy, payment, privateKey });
    const authorization = KeyAuthorization.fromRpc(policy.keyAuthorization as any);
    const keyAuthorizationManager = KeyAuthorizationManager.from({ source: {
      async get(key) {
        if (key.address.toLowerCase() !== policy.ownerAddress.toLowerCase() || key.accessKey.toLowerCase() !== policy.agentAddress.toLowerCase() || key.chainId !== policy.chainId) return undefined;
        return authorization;
      },
      async remove() {},
      async set() {},
    } });
    const account = TempoAccount.fromSecp256k1(privateKey, { access: policy.ownerAddress, keyAuthorizationManager });
    const transport = http(rpcUrl, { retryCount: 0, retryDelay: 0, timeout: 10_000 });
    const walletClient = createWalletClient({ account, chain: tempoModerato, transport });
    const publicClient = createPublicClient({ chain: tempoModerato, transport });
    const approveTxHash = await walletClient.writeContract({ address: PATH_USD_ADDRESS, abi: pathUsdAbi, functionName: "approve", args: [vaultAddress, BigInt(payment.amountRaw)] } as never) as Hex;
    const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveTxHash });
    if (approveReceipt.status !== "success") throw new Error("access-key approval reverted");
    const createTxHash = await walletClient.writeContract({ address: vaultAddress, abi: vaultAbi, functionName: "createPayout", args: [BigInt(payment.payoutId), BigInt(payment.amountRaw), payment.claimSigner, BigInt(payment.payoutExpiresAt)] } as never) as Hex;
    const receipt = await publicClient.waitForTransactionReceipt({ hash: createTxHash });
    if (receipt.status !== "success") throw new Error("access-key payout creation reverted");
    return { approveTxHash, createTxHash };
  }

  async function pay(token: string, input: { amountRaw: string; destination: string; claimSigner?: string; idempotencyKey: string; payoutExpiresAt?: string }) {
    const policy = await authenticate(token);
    const amountRaw = requirePositiveUint(input.amountRaw, "amountRaw");
    if (typeof input.idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(input.idempotencyKey)) throw new Error("idempotencyKey is invalid");
    const destination = asRpcAddress(input.destination, "destination");
    const claimSigner = asRpcAddress(input.claimSigner ?? input.destination, "claimSigner");
    if (policy.allowedDestinations && !policy.allowedDestinations.includes(destination.toLowerCase() as Address)) throw new Error("destination is outside the authorization allowlist");
    if (BigInt(amountRaw) > BigInt(policy.maxPerPaymentRaw)) throw new Error("payment exceeds the per-payment budget");
    const payoutExpiresAt = input.payoutExpiresAt === undefined
      ? Math.min(policy.expiryTimestamp, now() + 7 * 24 * 60 * 60).toString()
      : requirePositiveUint(input.payoutExpiresAt, "payoutExpiresAt");
    if (BigInt(payoutExpiresAt) <= BigInt(now()) || BigInt(payoutExpiresAt) > BigInt(policy.expiryTimestamp)) throw new Error("payoutExpiresAt is outside the authorization window");
    const existing = await store.get<AgentPayment>(paymentKey(policy.id, input.idempotencyKey));
    if (existing) {
      if (existing.amountRaw !== amountRaw || existing.destination.toLowerCase() !== destination.toLowerCase() || existing.claimSigner.toLowerCase() !== claimSigner.toLowerCase()) throw new Error("idempotency key was already used for a different payment");
      if (existing.state === "UNKNOWN") throw Object.assign(new Error("payment submission is uncertain; reconcile before retrying"), { code: "UNKNOWN_SETTLEMENT", payment: existing });
      if (existing.state === "FAILED") throw Object.assign(new Error(existing.error ?? "payment failed"), { code: "PAYMENT_FAILED", payment: existing });
      return { payment: existing, policy: publicPolicy(policy) };
    }
    const id = randomBytes(16).toString("hex");
    const payment: AgentPayment = {
      version: 1,
      id,
      policyId: policy.id,
      idempotencyKey: input.idempotencyKey,
      payoutId: BigInt(`0x${randomBytes(32).toString("hex")}`).toString(),
      amountRaw,
      destination,
      claimSigner,
      payoutExpiresAt,
      state: "RESERVED",
      reservedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (!store.create || !(await store.create(paymentKey(policy.id, input.idempotencyKey), payment, { ttl: POLICY_TTL_SECONDS }))) {
      const retry = await store.get<AgentPayment>(paymentKey(policy.id, input.idempotencyKey));
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
      await atomicUpdate(store, policyKey(policy.id), (current: StoredAgentPolicy | undefined) => {
        if (!current || current.status !== "ACTIVE") throw new Error("agent authorization is no longer active");
        if (current.expiryTimestamp <= now()) throw new Error("agent authorization expired");
        const nextReserved = BigInt(current.reservedRaw) + BigInt(amountRaw);
        if (BigInt(current.spentRaw) + nextReserved > BigInt(current.cumulativeBudgetRaw)) throw new Error("payment exceeds the cumulative budget");
        return { value: { ...current, reservedRaw: nextReserved.toString(), updatedAt: new Date().toISOString() }, result: undefined };
      }, POLICY_TTL_SECONDS);
      reserved = true;
      await store.set(paymentKey(policy.id, input.idempotencyKey), { ...payment, state: "SUBMITTING", updatedAt: new Date().toISOString() }, { ttl: POLICY_TTL_SECONDS });
      const result = await submit(policy, payment);
      const confirmed = { ...payment, state: "CONFIRMED" as const, approveTxHash: result.approveTxHash, createTxHash: result.createTxHash, updatedAt: new Date().toISOString() };
      await store.set(paymentKey(policy.id, input.idempotencyKey), confirmed, { ttl: POLICY_TTL_SECONDS });
      await reconcilePolicy(policy.id, confirmed, true);
      const updatedPolicy = await readPolicy(policy.id);
      return { payment: confirmed, policy: publicPolicy(updatedPolicy ?? policy) };
    } catch (error) {
      const message = error instanceof Error ? error.message : "payment submission is uncertain";
      const unknown = /timeout|timed out|network|transport|rpc|socket|unknown|fetch/i.test(message);
      const failed = { ...payment, state: (unknown ? "UNKNOWN" : "FAILED") as AgentPaymentState, error: unknown ? "Payment submission is uncertain. Do not retry this idempotency key; reconcile it first." : message, updatedAt: new Date().toISOString() };
      await store.set(paymentKey(policy.id, input.idempotencyKey), failed, { ttl: POLICY_TTL_SECONDS });
      if (!unknown && reserved) await reconcilePolicy(policy.id, failed, false);
      throw Object.assign(new Error(failed.error), { code: unknown ? "UNKNOWN_SETTLEMENT" : "PAYMENT_FAILED", payment: failed });
    }
  }

  async function getPayment(token: string, idempotencyKey: string) {
    const policy = await authenticate(token);
    const payment = await store.get<AgentPayment>(paymentKey(policy.id, idempotencyKey));
    if (!payment) throw new Error("payment not found");
    return { payment, policy: publicPolicy(policy) };
  }

  async function reconcilePayment(token: string, idempotencyKey: string) {
    const policy = await authenticate(token);
    const payment = await store.get<AgentPayment>(paymentKey(policy.id, idempotencyKey));
    if (!payment) throw new Error("payment not found");
    if (payment.state !== "UNKNOWN") return { payment, policy: publicPolicy(policy) };
    if (!dependencies.readPayout) throw new Error("payment reconciliation authority is not configured");

    const payout = await dependencies.readPayout(BigInt(payment.payoutId));
    const matchingPayout = payout.amount === BigInt(payment.amountRaw)
      && payout.claimSigner.toLowerCase() === payment.claimSigner.toLowerCase()
      && (payout.sender.toLowerCase() === policy.ownerAddress.toLowerCase() || payout.sender.toLowerCase() === policy.agentAddress.toLowerCase());
    if (!matchingPayout || payout.status === 0) throw new Error("payment is not yet authoritative onchain");

    const confirmed: AgentPayment = {
      ...payment,
      state: "CONFIRMED",
      error: undefined,
      updatedAt: new Date().toISOString(),
    };
    await store.set(paymentKey(policy.id, idempotencyKey), confirmed, { ttl: POLICY_TTL_SECONDS });
    await reconcilePolicy(policy.id, confirmed, true);
    const updatedPolicy = await readPolicy(policy.id);
    return { payment: confirmed, policy: publicPolicy(updatedPolicy ?? policy) };
  }

  function mppPaymentKey(policyId: string, idempotencyKey: string) {
    return `${MPP_PAYMENT_PREFIX}${policyId}:${idempotencyKey}`;
  }

  async function mppReserve(token: string, input: { amountRaw: string; recipient: string; endpointOrigin: string; idempotencyKey: string; mode: "charge" | "session" }) {
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
    const existing = await store.get<AgentMppPayment>(key);
    if (existing) {
      if (existing.amountRaw !== amountRaw || existing.recipient.toLowerCase() !== recipient.toLowerCase() || existing.mode !== input.mode || existing.endpointOrigin !== input.endpointOrigin.toLowerCase()) throw new Error("MPP idempotency key was already used for a different payment");
      if (existing.state === "UNKNOWN") throw Object.assign(new Error("MPP payment submission is uncertain; reconcile before retrying"), { code: "UNKNOWN_SETTLEMENT", payment: existing });
      if (existing.state === "FAILED") throw Object.assign(new Error(existing.error ?? "MPP payment failed"), { code: "PAYMENT_FAILED", payment: existing });
      if (existing.state === "CONFIRMED") return { payment: existing, policy: publicPolicy(policy), replay: true };
      throw new Error("MPP payment is already in progress");
    }
    const payment: AgentMppPayment = {
      version: 1,
      id: randomBytes(16).toString("hex"),
      policyId: policy.id,
      idempotencyKey: input.idempotencyKey,
      mode: input.mode,
      amountRaw,
      recipient,
      endpointOrigin: input.endpointOrigin.toLowerCase(),
      state: "RESERVED",
      reservedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (!store.create || !(await store.create(key, payment, { ttl: POLICY_TTL_SECONDS }))) {
      const retry = await store.get<AgentMppPayment>(key);
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
      await atomicUpdate(store, policyKey(policy.id), (current: StoredAgentPolicy | undefined) => {
        if (!current || current.status !== "ACTIVE") throw new Error("agent authorization is no longer active");
        if (current.expiryTimestamp <= now()) throw new Error("agent authorization expired");
        const nextReserved = BigInt(current.reservedRaw) + BigInt(amountRaw);
        if (BigInt(current.spentRaw) + nextReserved > BigInt(current.cumulativeBudgetRaw)) throw new Error("MPP payment exceeds the cumulative budget");
        return { value: { ...current, reservedRaw: nextReserved.toString(), updatedAt: new Date().toISOString() }, result: undefined };
      }, POLICY_TTL_SECONDS);
      return { payment, policy: publicPolicy({ ...(await readPolicy(policy.id)) ?? policy }), replay: false };
    } catch (error) {
      await store.delete(key);
      throw error;
    }
  }

  async function mppConfirm(token: string, idempotencyKey: string, input: { receipt: unknown; responseStatus: number; responseBody?: string; responseContentType?: string }) {
    const policy = await authenticate(token);
    const key = mppPaymentKey(policy.id, idempotencyKey);
    const existing = await store.get<AgentMppPayment>(key);
    if (!existing) throw new Error("MPP payment not found");
    if (existing.state === "CONFIRMED") return { payment: existing, policy: publicPolicy(policy) };
    if (existing.state !== "RESERVED") throw new Error("MPP payment is not confirmable");
    if (!input.receipt || typeof input.receipt !== "object" || (input.receipt as any).status !== "success" || (input.receipt as any).method !== "tempo" || typeof (input.receipt as any).reference !== "string" || !(input.receipt as any).reference) throw new Error("MPP receipt is not authoritative");
    if (!Number.isInteger(input.responseStatus) || input.responseStatus < 200 || input.responseStatus >= 300) throw new Error("MPP paid response status is not successful");
    const confirmed: AgentMppPayment = { ...existing, state: "CONFIRMED", receipt: input.receipt, responseStatus: input.responseStatus, responseBody: input.responseBody, responseContentType: input.responseContentType, updatedAt: new Date().toISOString() };
    const transition = await atomicUpdate(store, key, (current: AgentMppPayment | undefined) => {
      if (!current) throw new Error("MPP payment not found");
      if (current.state === "CONFIRMED") return { result: { payment: current, transitioned: false } };
      if (current.state !== "RESERVED") throw new Error("MPP payment is not confirmable");
      return { value: confirmed, result: { payment: confirmed, transitioned: true } };
    }, POLICY_TTL_SECONDS);
    if (!transition.transitioned) return { payment: transition.payment, policy: publicPolicy(policy) };
    await atomicUpdate(store, policyKey(policy.id), (current: StoredAgentPolicy | undefined) => {
      if (!current) throw new Error("authorization not found");
      return { value: { ...current, reservedRaw: (BigInt(current.reservedRaw) - BigInt(existing.amountRaw)).toString(), spentRaw: (BigInt(current.spentRaw) + BigInt(existing.amountRaw)).toString(), updatedAt: new Date().toISOString() }, result: undefined };
    }, POLICY_TTL_SECONDS);
    await store.set(key, confirmed, { ttl: POLICY_TTL_SECONDS });
    const updatedPolicy = await readPolicy(policy.id);
    return { payment: confirmed, policy: publicPolicy(updatedPolicy ?? policy) };
  }

  async function mppReconcile(token: string, idempotencyKey: string) {
    const policy = await authenticate(token);
    const key = mppPaymentKey(policy.id, idempotencyKey);
    const existing = await store.get<AgentMppPayment>(key);
    if (!existing) throw new Error("MPP payment not found");
    if (existing.state !== "UNKNOWN") return { payment: existing, policy: publicPolicy(policy) };
    if (!dependencies.readMppReceipt) throw new Error("MPP payment reconciliation authority is not configured");
    const receipt = await dependencies.readMppReceipt(existing);
    if (!receipt || typeof receipt !== "object" || (receipt as any).status !== "success" || (receipt as any).method !== "tempo" || typeof (receipt as any).reference !== "string" || !(receipt as any).reference) throw new Error("MPP payment is not yet authoritative onchain");
    const confirmed: AgentMppPayment = { ...existing, state: "CONFIRMED", receipt, error: undefined, updatedAt: new Date().toISOString() };
    const transition = await atomicUpdate(store, key, (current: AgentMppPayment | undefined) => {
      if (!current) throw new Error("MPP payment not found");
      if (current.state === "CONFIRMED") return { result: { payment: current, transitioned: false } };
      if (current.state !== "UNKNOWN") throw new Error("MPP payment is not awaiting reconciliation");
      return { value: confirmed, result: { payment: confirmed, transitioned: true } };
    }, POLICY_TTL_SECONDS);
    if (!transition.transitioned) return { payment: transition.payment, policy: publicPolicy(policy) };
    await atomicUpdate(store, policyKey(policy.id), (current: StoredAgentPolicy | undefined) => {
      if (!current) throw new Error("authorization not found");
      return { value: { ...current, reservedRaw: (BigInt(current.reservedRaw) - BigInt(existing.amountRaw)).toString(), spentRaw: (BigInt(current.spentRaw) + BigInt(existing.amountRaw)).toString(), updatedAt: new Date().toISOString() }, result: undefined };
    }, POLICY_TTL_SECONDS);
    const updatedPolicy = await readPolicy(policy.id);
    return { payment: confirmed, policy: publicPolicy(updatedPolicy ?? policy) };
  }

  async function mppFail(token: string, idempotencyKey: string, message: string, uncertain: boolean, reference?: Hex) {
    const policy = await authenticate(token);
    const key = mppPaymentKey(policy.id, idempotencyKey);
    const existing = await store.get<AgentMppPayment>(key);
    if (!existing) throw new Error("MPP payment not found");
    if (existing.state === "CONFIRMED" || existing.state === "UNKNOWN") return { payment: existing, policy: publicPolicy(policy) };
    const failed: AgentMppPayment = { ...existing, ...(reference ? { reference } : {}), state: uncertain ? "UNKNOWN" : "FAILED", error: message, updatedAt: new Date().toISOString() };
    const transition = await atomicUpdate(store, key, (current: AgentMppPayment | undefined) => {
      if (!current) throw new Error("MPP payment not found");
      if (current.state === "CONFIRMED" || current.state === "UNKNOWN" || current.state === "FAILED") return { result: { payment: current, transitioned: false } };
      if (current.state !== "RESERVED") throw new Error("MPP payment is not fail-able");
      return { value: failed, result: { payment: failed, transitioned: true } };
    }, POLICY_TTL_SECONDS);
    if (transition.transitioned && !uncertain) {
      await atomicUpdate(store, policyKey(policy.id), (current: StoredAgentPolicy | undefined) => {
        if (!current) throw new Error("authorization not found");
        return { value: { ...current, reservedRaw: (BigInt(current.reservedRaw) - BigInt(existing.amountRaw)).toString(), updatedAt: new Date().toISOString() }, result: undefined };
      }, POLICY_TTL_SECONDS);
    }
    const updatedPolicy = await readPolicy(policy.id);
    return { payment: transition.payment, policy: publicPolicy(updatedPolicy ?? policy) };
  }

  async function getMppPayment(token: string, idempotencyKey: string) {
    const policy = await authenticate(token);
    const payment = await store.get<AgentMppPayment>(mppPaymentKey(policy.id, idempotencyKey));
    return payment ? { payment, policy: publicPolicy(policy) } : undefined;
  }

  async function withSigner<T>(token: string, purpose: "MPP_DIRECT" | "MPP_SESSION", operation: (context: AgentSignerContext) => Promise<T>) {
    const policy = await authenticate(token);
    if (policy.purpose !== purpose) throw new Error("authorization purpose does not permit this MPP operation");
    const privateKey = decryptSecret(policy.encryptedPrivateKey, encryptionKey!);
    const authorization = KeyAuthorization.fromRpc(policy.keyAuthorization as any);
    const keyAuthorizationManager = KeyAuthorizationManager.from({ source: {
      async get(key) {
        if (key.address.toLowerCase() !== policy.ownerAddress.toLowerCase() || key.accessKey.toLowerCase() !== policy.agentAddress.toLowerCase() || key.chainId !== policy.chainId) return undefined;
        return authorization;
      },
      async remove() {},
      async set() {},
    } });
    const account = TempoAccount.fromSecp256k1(privateKey, { access: policy.ownerAddress, keyAuthorizationManager });
    const transport = http(rpcUrl, { retryCount: 0, retryDelay: 0, timeout: 10_000 });
    const walletClient = createWalletClient({ account, chain: tempoModerato, transport });
    const publicClient = createPublicClient({ chain: tempoModerato, transport });
    return operation({ policy: publicPolicy(policy), account, walletClient, publicClient } as AgentSignerContext);
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
    publicPolicy,
  };
}
