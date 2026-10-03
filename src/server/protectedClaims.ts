import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { recoverMessageAddress, type Address, type Hex } from "viem";
import type { Kv } from "accounts/server";
import type { ClaimProtectionChannel, ProtectedClaimPublicMetadata } from "../shared/claimProtection.js";

const RECORD_PREFIX = "protected:claim:";
const ACTIVE_FLOW_PREFIX = "protected:active-flow:";
const FLOW_PREFIX = "protected:flow:";
const GRANT_PREFIX = "protected:grant:";
const FLOW_TTL_SECONDS = 10 * 60;
const GRANT_TTL_SECONDS = 60;
const MAX_OTP_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 30;

type ProtectedRecord = {
  version: 1;
  payoutId: string;
  sender: Address;
  claimSigner: Address;
  channel: ClaimProtectionChannel;
  encryptedRecipient: string;
  encryptedShareB: string;
  shareAProofAddress: Address;
  createdAt: string;
};

type ProtectedFlow = {
  version: 1;
  flowId: string;
  payoutId: string;
  sessionAddress: Address;
  challenge: string;
  expiresAt: number;
  proofVerified: boolean;
  otpAttempts: number;
  lastSentAt?: number;
};

type ProtectedGrant = {
  version: 1;
  payoutId: string;
  sessionAddress: Address;
  expiresAt: number;
};

export type ProtectedClaimProvider = {
  sendVerificationCode(input: { channel: ClaimProtectionChannel; recipient: string }): Promise<void>;
  verifyCode(input: { channel: ClaimProtectionChannel; recipient: string; code: string }): Promise<boolean>;
};

export type ProtectedClaimPayout = {
  status: number;
  amount: bigint;
  expiresAt: bigint;
  claimSigner: Address;
};

export type ProtectedClaimServiceOptions = {
  kv: Kv.Kv;
  encryptionKey?: string;
  provider?: ProtectedClaimProvider | null;
  now?: () => number;
};

export type ProtectedClaimSession = {
  address: Address;
};

export type ProtectedClaimService = ReturnType<typeof createProtectedClaimService>;

function hexBytes(value: unknown, name: string): Buffer {
  if (typeof value !== "string") throw new Error(`${name} must be 32 bytes`);
  const normalized = value.startsWith("0x") ? value.slice(2) : value;
  if (!/^[0-9a-f]{64}$/i.test(normalized)) throw new Error(`${name} must be 32 bytes`);
  return Buffer.from(normalized, "hex");
}

function keyFromEnv(value: string | undefined): Buffer | null {
  if (!value) return null;
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error("protected claims encryption key must be 32-byte hex");
  return Buffer.from(value, "hex");
}

function encrypt(value: Buffer, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("hex")}.${tag.toString("hex")}.${ciphertext.toString("hex")}`;
}

function decrypt(envelope: string, key: Buffer): Buffer {
  const parts = envelope.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("invalid protected envelope");
  const iv = Buffer.from(parts[1]!, "hex");
  const tag = Buffer.from(parts[2]!, "hex");
  const ciphertext = Buffer.from(parts[3]!, "hex");
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) throw new Error("invalid protected envelope");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function normalizeRecipient(channel: ClaimProtectionChannel, value: unknown): string {
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

export function maskProtectedRecipient(channel: ClaimProtectionChannel, normalized: string): string {
  if (channel === "EMAIL") {
    const [local, domain] = normalized.split("@");
    if (!local || !domain) return "your email address";
    return `${local.slice(0, 1)}${"•".repeat(Math.min(3, Math.max(2, local.length - 1)))}@${domain}`;
  }
  return `${normalized.slice(0, 3)}${"•".repeat(Math.max(4, normalized.length - 7))}${normalized.slice(-4)}`;
}

function publicMetadata(record: ProtectedRecord, key: Buffer): ProtectedClaimPublicMetadata {
  const recipient = decrypt(record.encryptedRecipient, key).toString("utf8");
  return { mode: "PROTECTED", channel: record.channel, maskedRecipient: maskProtectedRecipient(record.channel, recipient) };
}

function requirePayoutEligibility(payout: ProtectedClaimPayout, nowMs = Date.now()): void {
  if (payout.status !== 1) throw new Error("payout is not claimable");
  if (BigInt(Math.floor(nowMs / 1000)) >= payout.expiresAt) throw new Error("payout has expired");
}

function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function grantKey(token: string, address: Address): string {
  return `${GRANT_PREFIX}${hashToken(token)}:${address.toLowerCase()}`;
}

function challengeText(flowId: string, challenge: string): string {
  return `Reach protected claim verification\nFlow: ${flowId}\nChallenge: ${challenge}`;
}

export function createProtectedClaimService(options: ProtectedClaimServiceOptions) {
  let key: Buffer | null = null;
  try {
    key = keyFromEnv(options.encryptionKey ?? process.env.REACH_PROTECTED_CLAIMS_ENCRYPTION_KEY);
  } catch {
    // Protected routes fail closed while Instant Claims and the health surface
    // remain available when an optional protected configuration is malformed.
    key = null;
  }
  const now = options.now ?? (() => Date.now());

  function requireConfigured(): { key: Buffer; provider: ProtectedClaimProvider } {
    if (!key || !options.provider) throw new Error("protected verification is not configured");
    return { key, provider: options.provider };
  }

  async function readRecord(payoutId: string): Promise<ProtectedRecord | undefined> {
    return options.kv.get<ProtectedRecord>(`${RECORD_PREFIX}${payoutId}`);
  }

  async function register(input: {
    payoutId: string;
    sender: Address;
    claimSigner: Address;
    channel: ClaimProtectionChannel;
    recipient: string;
    shareB: string;
    shareAProofAddress: Address;
  }): Promise<void> {
    const { key } = requireConfigured();
    const recipient = normalizeRecipient(input.channel, input.recipient);
    const shareB = hexBytes(input.shareB, "shareB");
    const record: ProtectedRecord = {
      version: 1,
      payoutId: input.payoutId,
      sender: input.sender,
      claimSigner: input.claimSigner,
      channel: input.channel,
      encryptedRecipient: encrypt(Buffer.from(recipient, "utf8"), key),
      encryptedShareB: encrypt(shareB, key),
      shareAProofAddress: input.shareAProofAddress,
      createdAt: new Date(now()).toISOString(),
    };
    const created = options.kv.create
      ? await options.kv.create(`${RECORD_PREFIX}${input.payoutId}`, record)
      : false;
    if (!created) throw new Error("protected payout already registered");
  }

  async function metadata(payoutId: string): Promise<ProtectedClaimPublicMetadata | null> {
    const configured = requireConfigured();
    const record = await readRecord(payoutId);
    return record ? publicMetadata(record, configured.key) : null;
  }

  async function begin(input: { payoutId: string; payout: ProtectedClaimPayout; session: ProtectedClaimSession }): Promise<{ flowId: string; challenge: string; metadata: ProtectedClaimPublicMetadata }> {
    const configured = requireConfigured();
    const nowMs = now();
    requirePayoutEligibility(input.payout, nowMs);
    const record = await readRecord(input.payoutId);
    if (!record) throw new Error("protected payout not found");
    if (record.claimSigner.toLowerCase() !== input.payout.claimSigner.toLowerCase()) throw new Error("protected payout does not match vault");
    const existingFlowId = await options.kv.get<string>(`${ACTIVE_FLOW_PREFIX}${input.payoutId}`);
    if (existingFlowId) {
      const existing = await options.kv.get<ProtectedFlow>(`${FLOW_PREFIX}${existingFlowId}`);
      if (existing && existing.expiresAt > nowMs) throw new Error("verification already in progress");
      await options.kv.delete(`${ACTIVE_FLOW_PREFIX}${input.payoutId}`);
    }
    const flowId = randomToken(18);
    const challenge = randomToken(32);
    const flow: ProtectedFlow = {
      version: 1,
      flowId,
      payoutId: input.payoutId,
      sessionAddress: input.session.address,
      challenge,
      expiresAt: nowMs + FLOW_TTL_SECONDS * 1000,
      proofVerified: false,
      otpAttempts: 0,
    };
    const activeCreated = options.kv.create
      ? await options.kv.create(`${ACTIVE_FLOW_PREFIX}${input.payoutId}`, flowId, { ttl: FLOW_TTL_SECONDS })
      : false;
    if (!activeCreated) throw new Error("verification already in progress");
    try {
      await options.kv.set(`${FLOW_PREFIX}${flowId}`, flow, { ttl: FLOW_TTL_SECONDS });
    } catch (error) {
      await options.kv.delete(`${ACTIVE_FLOW_PREFIX}${input.payoutId}`);
      throw error;
    }
    return { flowId, challenge: challengeText(flowId, challenge), metadata: publicMetadata(record, configured.key) };
  }

  async function proveLink(input: { payoutId: string; flowId: string; session: ProtectedClaimSession; proof: Hex }): Promise<{ maskedRecipient: string; expiresAt: number; resendAvailableAt: number }> {
    const configured = requireConfigured();
    const flow = await options.kv.get<ProtectedFlow>(`${FLOW_PREFIX}${input.flowId}`);
    if (!flow || flow.payoutId !== input.payoutId || flow.expiresAt <= now() || flow.sessionAddress.toLowerCase() !== input.session.address.toLowerCase()) throw new Error("verification session expired");
    const record = await readRecord(input.payoutId);
    if (!record) throw new Error("protected payout not found");
    const recovered = await recoverMessageAddress({ message: challengeText(flow.flowId, flow.challenge), signature: input.proof }).catch(() => null);
    if (!recovered || recovered.toLowerCase() !== record.shareAProofAddress.toLowerCase()) throw new Error("claim link verification failed");
    await configured.provider.sendVerificationCode({ channel: record.channel, recipient: decrypt(record.encryptedRecipient, configured.key).toString("utf8") });
    const sentAt = now();
    await options.kv.set(`${FLOW_PREFIX}${flow.flowId}`, { ...flow, proofVerified: true, lastSentAt: sentAt }, { ttl: FLOW_TTL_SECONDS });
    return { maskedRecipient: maskProtectedRecipient(record.channel, decrypt(record.encryptedRecipient, configured.key).toString("utf8")), expiresAt: flow.expiresAt, resendAvailableAt: sentAt + RESEND_COOLDOWN_SECONDS * 1000 };
  }

  async function resend(input: { payoutId: string; flowId: string; session: ProtectedClaimSession }): Promise<{ resendAvailableAt: number }> {
    const configured = requireConfigured();
    const flow = await options.kv.get<ProtectedFlow>(`${FLOW_PREFIX}${input.flowId}`);
    if (!flow || flow.payoutId !== input.payoutId || !flow.proofVerified || flow.expiresAt <= now() || flow.sessionAddress.toLowerCase() !== input.session.address.toLowerCase()) throw new Error("verification session expired");
    if (flow.lastSentAt && now() - flow.lastSentAt < RESEND_COOLDOWN_SECONDS * 1000) throw new Error("please wait before requesting another code");
    const record = await readRecord(input.payoutId);
    if (!record) throw new Error("protected payout not found");
    await configured.provider.sendVerificationCode({ channel: record.channel, recipient: decrypt(record.encryptedRecipient, configured.key).toString("utf8") });
    const sentAt = now();
    await options.kv.set(`${FLOW_PREFIX}${flow.flowId}`, { ...flow, lastSentAt: sentAt }, { ttl: FLOW_TTL_SECONDS });
    return { resendAvailableAt: sentAt + RESEND_COOLDOWN_SECONDS * 1000 };
  }

  async function verifyCode(input: { payoutId: string; flowId: string; session: ProtectedClaimSession; code: string }): Promise<{ grantToken: string; expiresAt: number }> {
    const configured = requireConfigured();
    const flow = await options.kv.get<ProtectedFlow>(`${FLOW_PREFIX}${input.flowId}`);
    if (!flow || flow.payoutId !== input.payoutId || !flow.proofVerified || flow.expiresAt <= now() || flow.sessionAddress.toLowerCase() !== input.session.address.toLowerCase()) throw new Error("verification session expired");
    if (!/^[0-9]{4,10}$/.test(input.code) || flow.otpAttempts >= MAX_OTP_ATTEMPTS) throw new Error("verification code is invalid or expired");
    const record = await readRecord(input.payoutId);
    if (!record) throw new Error("protected payout not found");
    const accepted = await configured.provider.verifyCode({ channel: record.channel, recipient: decrypt(record.encryptedRecipient, configured.key).toString("utf8"), code: input.code });
    if (!accepted) {
      await options.kv.set(`${FLOW_PREFIX}${flow.flowId}`, { ...flow, otpAttempts: flow.otpAttempts + 1 }, { ttl: FLOW_TTL_SECONDS });
      throw new Error("verification code is invalid or expired");
    }
    const grantToken = randomToken();
    const expiresAt = now() + GRANT_TTL_SECONDS * 1000;
    await options.kv.set(grantKey(grantToken, input.session.address), { version: 1, payoutId: input.payoutId, sessionAddress: input.session.address, expiresAt } satisfies ProtectedGrant, { ttl: GRANT_TTL_SECONDS });
    await options.kv.delete(`${FLOW_PREFIX}${flow.flowId}`);
    await options.kv.delete(`${ACTIVE_FLOW_PREFIX}${input.payoutId}`);
    return { grantToken, expiresAt };
  }

  async function releaseShare(input: { payoutId: string; payout: ProtectedClaimPayout; grantToken: string; session: ProtectedClaimSession }): Promise<{ shareB: `0x${string}` }> {
    const configured = requireConfigured();
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(input.grantToken)) throw new Error("invalid verification grant");
    const grant = options.kv.take ? await options.kv.take<ProtectedGrant>(grantKey(input.grantToken, input.session.address)) : undefined;
    if (!grant || grant.payoutId !== input.payoutId || grant.expiresAt <= now() || grant.sessionAddress.toLowerCase() !== input.session.address.toLowerCase()) throw new Error("verification grant expired");
    requirePayoutEligibility(input.payout, now());
    const record = await readRecord(input.payoutId);
    if (!record || record.claimSigner.toLowerCase() !== input.payout.claimSigner.toLowerCase()) throw new Error("protected payout does not match vault");
    return { shareB: `0x${decrypt(record.encryptedShareB, configured.key).toString("hex")}` };
  }

  return { register, metadata, begin, proveLink, resend, verifyCode, releaseShare, readRecord };
}

export function createTwilioVerifyProvider(env: NodeJS.ProcessEnv = process.env): ProtectedClaimProvider | null {
  const accountSid = env.TWILIO_ACCOUNT_SID;
  const authToken = env.TWILIO_AUTH_TOKEN;
  const serviceSid = env.TWILIO_VERIFY_SERVICE_SID;
  if (!accountSid || !authToken || !serviceSid) return null;
  const endpoint = `https://verify.twilio.com/v2/Services/${encodeURIComponent(serviceSid)}`;
  async function request(path: string, values: Record<string, string>): Promise<any> {
    const body = new URLSearchParams(values);
    const response = await fetch(`${endpoint}/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error("verification provider unavailable");
    return json;
  }
  return {
    async sendVerificationCode(input) {
      await request("Verifications", { To: input.recipient, Channel: input.channel === "EMAIL" ? "email" : "sms" });
    },
    async verifyCode(input) {
      const result = await request("VerificationCheck", { To: input.recipient, Code: input.code });
      return result?.status === "approved";
    },
  };
}
