const FAILURE_CLASSES = [
  "ORIGIN_MISMATCH",
  "RP_ID_MISMATCH",
  "CHALLENGE_MISSING_OR_EXPIRED",
  "CREDENTIAL_ALREADY_EXISTS",
  "UNKNOWN_CREDENTIAL",
  "AUTHENTICATION_FAILED",
  "INVALID_CREDENTIAL",
  "PUBLIC_KEY_INVALID",
  "KV_FAILURE",
] as const;

export type AuthFailureClass = (typeof FAILURE_CLASSES)[number] | "UNCLASSIFIED_ERROR" | "NONE";

export function authStageForPath(pathname: string): string {
  if (pathname.endsWith("/register/options")) return "REGISTER_OPTIONS";
  if (pathname.endsWith("/register/reconcile")) return "REGISTER_RECONCILE";
  if (pathname.endsWith("/register")) return "REGISTER_COMPLETE";
  if (pathname.endsWith("/login/options")) return "LOGIN_OPTIONS";
  if (pathname.endsWith("/login")) return "LOGIN_COMPLETE";
  if (pathname.endsWith("/logout")) return "LOGOUT";
  return "AUTH";
}

export function classifyAuthFailure(message: unknown): AuthFailureClass {
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

export function createAuthReference(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const suffix = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `RCH-${suffix}`;
}

