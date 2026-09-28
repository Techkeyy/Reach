export const AUTH_CONNECT_TIMEOUT_MS = 30_000;
export const AUTH_FAILURE_MESSAGE = "We couldn't sign you in.";
export const REGISTRATION_FAILURE_MESSAGE = "We couldn't create your Reach account.";

export type AuthFlow = "register" | "login";
export type AuthFailureKind =
  | "USER_CANCELLED"
  | "OPTIONS_FAILED"
  | "WEBAUTHN_FAILED"
  | "COMPLETE_FAILED"
  | "ACCOUNT_RESOLUTION_FAILED"
  | "TIMEOUT";

export type AuthFailureStage =
  | "REGISTER_OPTIONS"
  | "WEBAUTHN_CREATE"
  | "REGISTER_COMPLETE"
  | "LOGIN_OPTIONS"
  | "WEBAUTHN_GET"
  | "LOGIN_COMPLETE"
  | "ACCOUNT_RESOLUTION";

export type AuthFailure = {
  kind: AuthFailureKind;
  message: string;
  technicalDetail: string;
};

type FailureCopy = {
  title: string;
  summary: string;
};

function errorText(error: unknown): { name: string; message: string } {
  if (error instanceof Error) return { name: error.name || "Error", message: error.message || "Unknown error" };
  return { name: "Error", message: String(error || "Unknown error") };
}

function sanitizeTechnicalDetail(error: unknown): string {
  const { message } = errorText(error);
  const sanitized = message
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[url redacted]")
    .replace(/#[^\s"'<>]*/g, "#<redacted>")
    .replace(/0x[0-9a-f]{40,}/gi, "<redacted>")
    .replace(/[A-Za-z0-9_-]{43,}/g, "<redacted>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);

  const safePattern = /^(HTTP \d{3}|Request failed|authentication unavailable|network|fetch|the operation|credential|passkey|origin|rpid|challenge|account|timed out|not allowed|cancel)/i;
  return sanitized && safePattern.test(sanitized) ? sanitized : "No additional details were provided.";
}

export function classifyAuthFailure(error: unknown, flow: AuthFlow, stage?: AuthFailureStage | null): AuthFailureKind {
  const { name, message } = errorText(error);
  const lower = message.toLowerCase();

  if (stage === "REGISTER_OPTIONS" || stage === "LOGIN_OPTIONS") return "OPTIONS_FAILED";
  if (stage === "WEBAUTHN_CREATE" || stage === "WEBAUTHN_GET") return "WEBAUTHN_FAILED";
  if (stage === "REGISTER_COMPLETE" || stage === "LOGIN_COMPLETE") return "COMPLETE_FAILED";
  if (stage === "ACCOUNT_RESOLUTION") return "ACCOUNT_RESOLUTION_FAILED";
  if (lower.includes("timed out") || lower.includes("timeout")) return "TIMEOUT";
  if (name === "AbortError" || lower.includes("cancel")) return "USER_CANCELLED";
  if (name === "NotAllowedError" && !lower.includes("timed out")) return "USER_CANCELLED";
  if (lower.includes("/options") || lower.includes("options") || /^http [45]\d\d$/i.test(message)) return "OPTIONS_FAILED";
  if (name === "NotAllowedError" || name === "SecurityError" || lower.includes("webauthn") || lower.includes("passkey")) return "WEBAUTHN_FAILED";
  if (lower.includes("no authenticated account") || lower.includes("resolve")) return "ACCOUNT_RESOLUTION_FAILED";
  return "COMPLETE_FAILED";
}

export function authFailureCopy(flow: AuthFlow, kind: AuthFailureKind): FailureCopy {
  if (flow === "register") {
    const copy: Record<AuthFailureKind, FailureCopy> = {
      USER_CANCELLED: { title: "Account setup was cancelled.", summary: "No account was changed." },
      OPTIONS_FAILED: { title: "We couldn't start account setup.", summary: "Reach couldn't prepare your device." },
      WEBAUTHN_FAILED: { title: "Your device couldn't create the passkey.", summary: "Try again or start over." },
      COMPLETE_FAILED: { title: "We couldn't finish creating your account.", summary: "Your account was not changed." },
      ACCOUNT_RESOLUTION_FAILED: { title: "Your passkey was created, but Reach couldn't open your account.", summary: "Try again or start over." },
      TIMEOUT: { title: "Account setup took too long.", summary: "Try again or start over." },
    };
    return copy[kind];
  }

  const copy: Record<AuthFailureKind, FailureCopy> = {
    USER_CANCELLED: { title: "Sign-in was cancelled.", summary: "Your account was not changed." },
    OPTIONS_FAILED: { title: "We couldn't start sign-in.", summary: "Reach couldn't prepare your device." },
    WEBAUTHN_FAILED: { title: AUTH_FAILURE_MESSAGE, summary: "Your account was not changed." },
    COMPLETE_FAILED: { title: "We couldn't finish signing you in.", summary: "Your account was not changed." },
    ACCOUNT_RESOLUTION_FAILED: { title: "We couldn't open your Reach account.", summary: "Your account was not changed." },
    TIMEOUT: { title: "Sign-in took too long.", summary: "Your account was not changed." },
  };
  return copy[kind];
}

export function authFailure(error: unknown, flow: AuthFlow, stage?: AuthFailureStage | null): AuthFailure {
  const kind = classifyAuthFailure(error, flow, stage);
  return {
    kind,
    message: authFailureCopy(flow, kind).title,
    technicalDetail: sanitizeTechnicalDetail(error),
  };
}

export function authFailureMessage(error: unknown, flow: AuthFlow = "login"): string {
  return authFailure(error, flow).technicalDetail;
}

export function hasAuthenticatedAccount(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const accounts = (result as { accounts?: unknown }).accounts;
  return Array.isArray(accounts) && accounts.length > 0;
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs = AUTH_CONNECT_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Authentication timed out")), timeoutMs);
    promise.then(
      value => {
        clearTimeout(timeout);
        resolve(value);
      },
      error => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}
