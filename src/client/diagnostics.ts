export type DiagnosticStage =
  | "REGISTER_OPTIONS"
  | "WEBAUTHN_CREATE"
  | "REGISTER_COMPLETE"
  | "RELAY"
  | "CONFIRMATION";

type DiagnosticRecord = {
  stage: DiagnosticStage;
  errorName: string;
  errorMessage: string;
};

function toErrorDetails(error: unknown): Pick<DiagnosticRecord, "errorName" | "errorMessage"> {
  if (error instanceof Error) {
    return {
      errorName: error.name || "Error",
      errorMessage: error.message || "Unknown error",
    };
  }

  return {
    errorName: "Error",
    errorMessage: String(error),
  };
}

function recordDiagnostic(stage: DiagnosticStage, error: unknown) {
  if (!import.meta.env.DEV) return;

  const record: DiagnosticRecord = {
    stage,
    ...toErrorDetails(error),
  };

  console.error("[Reach diagnostic]", record);
}

function pathFor(input: RequestInfo | URL): string {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return new URL(url, window.location.href).pathname;
}

function stageFor(pathname: string): DiagnosticStage | undefined {
  if (pathname.endsWith("/auth/register/options")) return "REGISTER_OPTIONS";
  if (pathname.endsWith("/auth/register")) return "REGISTER_COMPLETE";
  if (pathname === "/relay" || pathname.startsWith("/relay/")) return "RELAY";
  if (pathname.startsWith("/api/payout/")) return "CONFIRMATION";
  return undefined;
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

    try {
      const response = await originalFetch(input, init);
      if (stage && !response.ok) {
        recordDiagnostic(stage, new Error(`HTTP ${response.status}`));
      }
      return response;
    } catch (error) {
      if (stage) recordDiagnostic(stage, error);
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
}
