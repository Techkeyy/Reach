import { parseAuthoritativeBalance } from "./senderFlow";

export class BalanceAuthorityError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "BalanceAuthorityError";
    this.status = status;
  }
}

/** The API is the only background balance path. Callers must treat failures as
 * unavailable rather than issuing a second browser-side RPC request. */
export async function readAuthoritativeBalanceApi(address: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(`/api/balance/${address}`, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
  } catch (error) {
    throw new BalanceAuthorityError(error instanceof Error ? error.message : "Balance service unavailable.");
  }
  if (!response.ok) throw new BalanceAuthorityError("Balance service unavailable.", response.status);
  try {
    return parseAuthoritativeBalance(await response.json());
  } catch {
    throw new BalanceAuthorityError("Balance response unavailable.");
  }
}
