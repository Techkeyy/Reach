export type DiagnosticStage =
  | "REGISTER_OPTIONS"
  | "WEBAUTHN_CREATE"
  | "REGISTER_COMPLETE"
  | "LOGIN_OPTIONS"
  | "WEBAUTHN_GET"
  | "LOGIN_COMPLETE"
  | "ACCOUNT_RESOLUTION"
  | "SESSION_READY"
  | "NAVIGATION"
  | "RELAY"
  | "CONFIRMATION";

type DiagnosticOutcome = "STARTED" | "SUCCEEDED" | "FAILED";

type DiagnosticRecord = {
  stage: DiagnosticStage;
  outcome: DiagnosticOutcome;
  errorName: string;
  errorMessage: string;
};

function redactDiagnosticText(value: string): string {
  return value
    .replace(/#[^\s"'<>]*/g, "#<redacted>")
    .replace(/[A-Za-z0-9_-]{43,}/g, "<redacted>");
}

function toErrorDetails(error: unknown): Pick<DiagnosticRecord, "errorName" | "errorMessage"> {
  if (error instanceof Error) {
    return {
      errorName: error.name || "Error",
      errorMessage: redactDiagnosticText(error.message || "Unknown error"),
    };
  }

  return {
    errorName: "Error",
    errorMessage: redactDiagnosticText(String(error)),
  };
}

function emitDiagnostic(stage: DiagnosticStage, outcome: DiagnosticOutcome, error?: unknown) {
  if (!import.meta.env.DEV) return;

  const record: DiagnosticRecord = {
    stage,
    outcome,
    ...(error ? toErrorDetails(error) : { errorName: "", errorMessage: "" }),
  };

  if (outcome === "FAILED") {
    console.error("[Reach diagnostic]", record);
  } else {
    console.info("[Reach diagnostic]", record);
  }
}

export function recordAuthStage(
  stage: Extract<
    DiagnosticStage,
    "LOGIN_OPTIONS" | "WEBAUTHN_GET" | "LOGIN_COMPLETE" | "ACCOUNT_RESOLUTION" | "SESSION_READY" | "NAVIGATION"
  >,
  outcome: DiagnosticOutcome,
  error?: unknown,
) {
  emitDiagnostic(stage, outcome, error);
}

function recordDiagnostic(stage: DiagnosticStage, error: unknown) {
  emitDiagnostic(stage, "FAILED", error);
}

function pathFor(input: RequestInfo | URL): string {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return new URL(url, window.location.href).pathname;
}

function stageFor(pathname: string): DiagnosticStage | undefined {
  if (pathname.endsWith("/auth/register/options")) return "REGISTER_OPTIONS";
  if (pathname.endsWith("/auth/register")) return "REGISTER_COMPLETE";
  if (pathname.endsWith("/auth/login/options")) return "LOGIN_OPTIONS";
  if (pathname.endsWith("/auth/login")) return "LOGIN_COMPLETE";
  if (pathname === "/relay" || pathname.startsWith("/relay/")) return "RELAY";
  if (pathname.startsWith("/api/payout/")) return "CONFIRMATION";
  return undefined;
}

function isAuthStage(stage: DiagnosticStage | undefined): stage is Extract<
  DiagnosticStage,
  "LOGIN_OPTIONS" | "LOGIN_COMPLETE"
> {
  return stage === "LOGIN_OPTIONS" || stage === "LOGIN_COMPLETE";
}

export function installDevelopmentDiagnostics() {
  if (!import.meta.env.DEV || typeof window === "undefined") return;

  const marker = "__reachDevelopmentDiagnosticsInstalled";
  const windowWithMarker = window as unknown as Window & Record<string, boolean | undefined>;
  if (windowWithMarker[marker]) return;
  windowWithMarker[marker] = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const stage = stageFor(pathFor(input));
    if (isAuthStage(stage)) emitDiagnostic(stage, "STARTED");

    try {
      const response = await originalFetch(input, init);
      if (isAuthStage(stage)) {
        emitDiagnostic(stage, response.ok ? "SUCCEEDED" : "FAILED", response.ok ? undefined : new Error("HTTP " + response.status));
      } else if (stage && !response.ok) {
        recordDiagnostic(stage, new Error("HTTP " + response.status));
      }
      return response;
    } catch (error) {
      if (isAuthStage(stage)) emitDiagnostic(stage, "FAILED", error);
      else if (stage) recordDiagnostic(stage, error);
      throw error;
    }
  };

  const credentials = navigator.credentials;
  const originalCreate = credentials.create.bind(credentials);
  credentials.create = async (options) => {
    try {
      return await originalCreate(options);
    } catch (error) {
      recordDiagnostic("WEBAUTHN_CREATE", error);
      throw error;
    }
  };

  const originalGet = credentials.get.bind(credentials);
  credentials.get = async (options) => {
    emitDiagnostic("WEBAUTHN_GET", "STARTED");
    try {
      const result = await originalGet(options);
      emitDiagnostic("WEBAUTHN_GET", "SUCCEEDED");
      return result;
    } catch (error) {
      emitDiagnostic("WEBAUTHN_GET", "FAILED", error);
      throw error;
    }
  };
}
