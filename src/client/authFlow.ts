export const AUTH_CONNECT_TIMEOUT_MS = 30_000;
export const AUTH_FAILURE_MESSAGE = "We couldn't finish signing you in.";

export function hasAuthenticatedAccount(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const accounts = (result as { accounts?: unknown }).accounts;
  return Array.isArray(accounts) && accounts.length > 0;
}

export function authFailureMessage(_error: unknown): string {
  return AUTH_FAILURE_MESSAGE;
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
