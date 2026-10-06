import { isAddress, type Address } from "viem";

export const PROTECTED_REAUTH_REQUIRED = "Sign in again to continue.";
export const PROTECTED_AUTH_CANCELLED = "Sign-in was cancelled. Try again.";
export const PROTECTED_AUTH_FAILED = "We couldn't verify your Reach account. Try again.";
export const PROTECTED_SESSION_ADDRESS_MISMATCH = "Your Reach account changed. Sign in again to continue.";

export type ProtectedAuthErrorCode = "AUTH_REQUIRED" | "AUTH_CANCELLED" | "AUTH_FAILED" | "ADDRESS_MISMATCH";

export class ProtectedAuthError extends Error {
  readonly code: ProtectedAuthErrorCode;

  constructor(code: ProtectedAuthErrorCode, message: string) {
    super(message);
    this.name = "ProtectedAuthError";
    this.code = code;
  }
}

export type ProtectedRecipientConnectionMethod = "register" | "login";

export type ProtectedRecipientAuthOptions = {
  initialAddress?: string;
  connect: (method: ProtectedRecipientConnectionMethod) => Promise<string | undefined>;
  disconnect?: () => Promise<void>;
  begin: () => Promise<Response>;
  onRegistrationStarted?: () => void;
  onReauthenticationRequired?: () => void;
  onAuthenticationStarted?: () => void;
  onAuthenticationRestored?: () => void;
};

function normalizeAddress(value: string | undefined): Address | undefined {
  if (!value || !isAddress(value)) return undefined;
  return value as Address;
}

function isCancellation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "AbortError"
    || error.name === "NotAllowedError"
    || /cancel/i.test(error.message);
}

async function connectAddress(options: ProtectedRecipientAuthOptions, method: ProtectedRecipientConnectionMethod): Promise<Address> {
  try {
    const address = normalizeAddress(await options.connect(method));
    if (!address) throw new ProtectedAuthError("AUTH_FAILED", PROTECTED_AUTH_FAILED);
    return address;
  } catch (error) {
    if (error instanceof ProtectedAuthError) throw error;
    throw new ProtectedAuthError(
      isCancellation(error) ? "AUTH_CANCELLED" : "AUTH_FAILED",
      isCancellation(error) ? PROTECTED_AUTH_CANCELLED : PROTECTED_AUTH_FAILED,
    );
  }
}

/**
 * Starts Protected recipient verification only with a server-backed session.
 * A 401 is the sole signal that permits one fresh passkey authentication and
 * one retry. The server remains the authentication authority.
 */
export async function beginProtectedRecipientVerification(options: ProtectedRecipientAuthOptions): Promise<{ response: Response; address: Address }> {
  const initialAddress = options.initialAddress
    ? normalizeAddress(options.initialAddress)
    : undefined;
  if (options.initialAddress && !initialAddress) {
    throw new ProtectedAuthError("AUTH_FAILED", PROTECTED_AUTH_FAILED);
  }

  let activeAddress = initialAddress;
  if (!activeAddress) {
    options.onRegistrationStarted?.();
    activeAddress = await connectAddress(options, "register");
  }

  let response = await options.begin();
  if (response.status !== 401) return { response, address: activeAddress };

  options.onReauthenticationRequired?.();
  options.onAuthenticationStarted?.();
  try {
    await options.disconnect?.();
  } catch {
    // The server session may already be gone; login below is authoritative.
  }

  const restoredAddress = await connectAddress(options, "login");
  if (restoredAddress.toLowerCase() !== activeAddress.toLowerCase()) {
    throw new ProtectedAuthError("ADDRESS_MISMATCH", PROTECTED_SESSION_ADDRESS_MISMATCH);
  }

  options.onAuthenticationRestored?.();
  response = await options.begin();
  if (response.status === 401) {
    throw new ProtectedAuthError("AUTH_REQUIRED", PROTECTED_REAUTH_REQUIRED);
  }
  return { response, address: restoredAddress };
}

export function sameProtectedAddress(left: string | undefined, right: Address): boolean {
  return Boolean(left && isAddress(left) && left.toLowerCase() === right.toLowerCase());
}
