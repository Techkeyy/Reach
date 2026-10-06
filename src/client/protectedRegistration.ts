import { type Address, type Hex } from "viem";
import {
  PROTECTED_REAUTH_REQUIRED,
  PROTECTED_SESSION_ADDRESS_MISMATCH,
  sameProtectedAddress,
} from "./protectedAuthSession";

export { PROTECTED_REAUTH_REQUIRED, PROTECTED_SESSION_ADDRESS_MISMATCH } from "./protectedAuthSession";


export type ProtectedRegistrationPayload = {
  payoutId: string;
  sender: Address;
  claimSigner: Address;
  channel: "EMAIL" | "SMS";
  recipient: string;
  shareB: Hex;
  shareAProofAddress: Address;
};

export type ProtectedRegistrationErrorCode = "AUTH_REQUIRED" | "ADDRESS_MISMATCH";

export class ProtectedRegistrationError extends Error {
  readonly code: ProtectedRegistrationErrorCode;

  constructor(code: ProtectedRegistrationErrorCode, message: string) {
    super(message);
    this.name = "ProtectedRegistrationError";
    this.code = code;
  }
}

export type RegisterProtectedPayoutOptions = {
  payload: ProtectedRegistrationPayload;
  reauthenticate?: () => Promise<string | undefined>;
  onAuthenticationRequired?: () => void;
  onAuthenticationRestored?: () => void;
  fetcher?: typeof fetch;
};

async function responseError(response: Response): Promise<string> {
  const body = await response.json().catch(() => ({})) as { error?: unknown };
  return typeof body.error === "string" ? body.error : "Protected verification is unavailable.";
}

/**
 * Register a protected payout without weakening the server authentication gate.
 *
 * A retry is permitted only after the server explicitly returns 401. The
 * re-authenticated account must equal the active sender account, and the
 * registration request is never attempted with a client-supplied replacement
 * address. This makes a missing/expired server session recoverable while a
 * changed account fails closed.
 */
export async function registerProtectedPayout(options: RegisterProtectedPayoutOptions): Promise<void> {
  const fetcher = options.fetcher ?? fetch;

  const submit = async (): Promise<Response> => fetcher("/api/protected/register", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options.payload),
  });

  let response = await submit();
  if (response.status === 401) {
    options.onAuthenticationRequired?.();
    const restoredAddress = await options.reauthenticate?.();
    if (!restoredAddress) {
      throw new ProtectedRegistrationError("AUTH_REQUIRED", PROTECTED_REAUTH_REQUIRED);
    }
    if (!sameProtectedAddress(restoredAddress, options.payload.sender)) {
      throw new ProtectedRegistrationError("ADDRESS_MISMATCH", PROTECTED_SESSION_ADDRESS_MISMATCH);
    }
    options.onAuthenticationRestored?.();
    response = await submit();
  }

  if (response.status === 401) {
    throw new ProtectedRegistrationError("AUTH_REQUIRED", PROTECTED_REAUTH_REQUIRED);
  }
  if (!response.ok) throw new Error(await responseError(response));
}
