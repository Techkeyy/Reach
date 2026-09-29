import { Storage, WebAuthnCeremony } from "accounts";
import { deriveTempoAccountAddress } from "../shared/identity";

type RegistrationCredential = Parameters<WebAuthnCeremony.WebAuthnCeremony["verifyRegistration"]>[0];

const PENDING_STORAGE_KEY = "pendingRegistration";
const pendingStorage = Storage.idb({ key: "reach.identity" });
const sdkStorage = Storage.idb({ key: "tempo" });

export const PASSKEY_CREATED_SETUP_INCOMPLETE = "PASSKEY_CREATED_SETUP_INCOMPLETE" as const;
// Keep retry material no longer-lived than accounts@0.18.4's five-minute
// server-side registration challenge.
export const PENDING_REGISTRATION_TTL_MS = 5 * 60 * 1000;
export const PASSKEY_CREATED_SERVER_NOT_COMMITTED = "PASSKEY_CREATED_SERVER_NOT_COMMITTED" as const;
export const SERVER_COMMITTED_CLIENT_NOT_PERSISTED = "SERVER_COMMITTED_CLIENT_NOT_PERSISTED" as const;

export type RegistrationRecoveryState =
  | typeof PASSKEY_CREATED_SERVER_NOT_COMMITTED
  | typeof SERVER_COMMITTED_CLIENT_NOT_PERSISTED;

export type PendingRegistration = {
  state: typeof PASSKEY_CREATED_SETUP_INCOMPLETE;
  credential: RegistrationCredential;
  name: string;
  createdAt: number;
  expiresAt: number;
};

export type PendingRegistrationCompletion =
  | { status: "COMPLETED"; recoveryState: typeof PASSKEY_CREATED_SERVER_NOT_COMMITTED; credentialId: string }
  | { status: "ALREADY_COMMITTED"; recoveryState: typeof SERVER_COMMITTED_CLIENT_NOT_PERSISTED; credentialId: string };

export class PasskeyCreatedSetupIncompleteError extends Error {
  readonly code = PASSKEY_CREATED_SETUP_INCOMPLETE;

  constructor(message = "Your passkey was created, but Reach couldn't finish setting up your account.", options?: ErrorOptions) {
    super(message, options);
    this.name = "PasskeyCreatedSetupIncompleteError";
  }
}

function isRegistrationCredential(value: unknown): value is RegistrationCredential {
  if (!value || typeof value !== "object") return false;
  const credential = value as { id?: unknown; clientDataJSON?: unknown; attestationObject?: unknown; publicKey?: unknown };
  return (
    typeof credential.id === "string" &&
    typeof credential.clientDataJSON === "string" &&
    typeof credential.attestationObject === "string" &&
    typeof credential.publicKey === "string"
  );
}

function parsePending(value: unknown): PendingRegistration | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<PendingRegistration> & { credential?: unknown };
  if (
    record.state !== PASSKEY_CREATED_SETUP_INCOMPLETE ||
    typeof record.name !== "string" ||
    typeof record.createdAt !== "number" ||
    typeof record.expiresAt !== "number" ||
    record.expiresAt !== record.createdAt + PENDING_REGISTRATION_TTL_MS ||
    !isRegistrationCredential(record.credential)
  ) {
    return null;
  }
  return record as PendingRegistration;
}

export async function readPendingRegistration(): Promise<PendingRegistration | null> {
  try {
    const raw = await pendingStorage.getItem(PENDING_STORAGE_KEY);
    const record = parsePending(raw);
    if (!record || record.expiresAt <= Date.now()) {
      if (raw !== null && raw !== undefined) await pendingStorage.removeItem(PENDING_STORAGE_KEY);
      return null;
    }
    schedulePendingExpiration(record);
    return record;
  } catch {
    return null;
  }
}

export async function hasPendingRegistration(): Promise<boolean> {
  return (await readPendingRegistration()) !== null;
}

export async function clearPendingRegistration(): Promise<void> {
  if (typeof window !== "undefined" && pendingExpiryTimer !== undefined) {
    window.clearTimeout(pendingExpiryTimer);
    pendingExpiryTimer = undefined;
  }
  await pendingStorage.removeItem(PENDING_STORAGE_KEY);
}

export async function clearPendingRegistrationIfMatches(address: string | undefined): Promise<void> {
  if (!address) return;
  const pending = await readPendingRegistration();
  if (!pending || typeof pending.credential.publicKey !== "string") return;
  const recovered = deriveTempoAccountAddress({
    id: pending.credential.id,
    publicKey: pending.credential.publicKey,
    rpId: typeof window !== "undefined" ? window.location.hostname : "localhost",
  });
  if (recovered.toLowerCase() === address.toLowerCase()) await clearPendingRegistration();
}

async function rememberPendingRegistration(credential: RegistrationCredential, name: string): Promise<void> {
  const createdAt = Date.now();
  await pendingStorage.setItem(PENDING_STORAGE_KEY, {
    state: PASSKEY_CREATED_SETUP_INCOMPLETE,
    credential,
    name,
    createdAt,
    expiresAt: createdAt + PENDING_REGISTRATION_TTL_MS,
  } satisfies PendingRegistration);
  schedulePendingExpiration({
    state: PASSKEY_CREATED_SETUP_INCOMPLETE,
    credential,
    name,
    createdAt,
    expiresAt: createdAt + PENDING_REGISTRATION_TTL_MS,
  });
}

let pendingExpiryTimer: number | undefined;

function schedulePendingExpiration(record: PendingRegistration): void {
  if (typeof window === "undefined") return;
  if (pendingExpiryTimer !== undefined) window.clearTimeout(pendingExpiryTimer);
  pendingExpiryTimer = window.setTimeout(async () => {
    try {
      const current = await pendingStorage.getItem<PendingRegistration>(PENDING_STORAGE_KEY);
      if (current?.createdAt === record.createdAt) await clearPendingRegistration();
    } catch {
      // The next read still enforces the expiry and removes stale state.
    }
  }, Math.max(0, record.expiresAt - Date.now()));
}

async function rememberSdkCredentialId(credentialId: string): Promise<void> {
  // This is the Accounts SDK's documented adapter-local hint. It is not an
  // identity authority; the server credential record remains authoritative.
  await sdkStorage.setItem("lastCredentialId", credentialId);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAlreadyCommittedError(error: unknown): boolean {
  return /credential already exists/i.test(errorMessage(error));
}

async function reconcileCommittedRegistration(url: string, pending: PendingRegistration): Promise<boolean> {
  const response = await fetch(`${url}/register/reconcile`, {
    body: JSON.stringify({
      credentialId: pending.credential.id,
      publicKey: pending.credential.publicKey,
    }),
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (response.status === 404) return false;
  const json = await response.json().catch(() => ({})) as { status?: unknown; error?: unknown };
  if (!response.ok) throw new Error(typeof json.error === "string" ? json.error : "Registration recovery unavailable");
  return json.status === "already_committed";
}

/**
 * Wrap the maintained server ceremony so a transport failure after the OS
 * passkey prompt leaves a short-lived, local completion payload available.
 * The wrapper never calls navigator.credentials.create itself.
 */
export function createRecoveryAwareCeremony(url: string): WebAuthnCeremony.WebAuthnCeremony {
  const base = WebAuthnCeremony.server({ url, credentials: "include" });

  return WebAuthnCeremony.from({
    getRegistrationOptions: base.getRegistrationOptions,
    async verifyRegistration(credential, options) {
      try {
        const result = await base.verifyRegistration(credential, options);
        await rememberSdkCredentialId(result.credentialId);
        await clearPendingRegistration();
        return result;
      } catch (error) {
        await rememberPendingRegistration(credential, options?.name ?? "Reach account");
        throw new PasskeyCreatedSetupIncompleteError(undefined, { cause: error });
      }
    },
    getAuthenticationOptions: base.getAuthenticationOptions,
    verifyAuthentication: base.verifyAuthentication,
  });
}

/**
 * Retry the exact serialized registration response captured after the same
 * passkey was created. This path never invokes navigator.credentials.create.
 */
export async function finishPendingRegistration(url: string): Promise<PendingRegistrationCompletion | null> {
  const pending = await readPendingRegistration();
  if (!pending) return null;

  const base = WebAuthnCeremony.server({ url, credentials: "include" });
  try {
    const result = await base.verifyRegistration(pending.credential, { name: pending.name });
    await rememberSdkCredentialId(result.credentialId);
    return {
      status: "COMPLETED",
      recoveryState: PASSKEY_CREATED_SERVER_NOT_COMMITTED,
      credentialId: result.credentialId,
    };
  } catch (error) {
    // A lost response can leave the durable SDK credential committed while
    // the browser still has the original response. Do not treat that as a
    // second identity; let the normal login ceremony prove the same key.
    if (isAlreadyCommittedError(error)) {
      await rememberSdkCredentialId(pending.credential.id);
      return {
        status: "ALREADY_COMMITTED",
        recoveryState: SERVER_COMMITTED_CLIENT_NOT_PERSISTED,
        credentialId: pending.credential.id,
      };
    }
    if (/missing or expired challenge/i.test(errorMessage(error))) {
      const committed = await reconcileCommittedRegistration(url, pending);
      if (committed) {
        await rememberSdkCredentialId(pending.credential.id);
        return {
          status: "ALREADY_COMMITTED",
          recoveryState: SERVER_COMMITTED_CLIENT_NOT_PERSISTED,
          credentialId: pending.credential.id,
        };
      }
    }
    throw error;
  }
}

export function isPasskeyCreatedSetupIncompleteError(error: unknown): error is PasskeyCreatedSetupIncompleteError {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if (
      current instanceof PasskeyCreatedSetupIncompleteError ||
      (current as { code?: unknown }).code === PASSKEY_CREATED_SETUP_INCOMPLETE
    ) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export function passkeySetupErrorCause(error: unknown): unknown {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if (
      current instanceof PasskeyCreatedSetupIncompleteError ||
      (current as { code?: unknown }).code === PASSKEY_CREATED_SETUP_INCOMPLETE
    ) {
      return (current as { cause?: unknown }).cause ?? current;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return error;
}
