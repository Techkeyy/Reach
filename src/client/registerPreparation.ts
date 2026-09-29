/**
 * Clear the Tempo Accounts provider before a fresh registration attempt.
 *
 * The provider persists account snapshots and treats a register request with
 * an existing label as a login. Disconnect is intentionally best effort: the
 * provider must still clear its local snapshot when a stale logout endpoint
 * or an already-expired session makes the network call fail.
 */
export async function prepareFreshRegistration(disconnect: () => Promise<unknown>): Promise<void> {
  await disconnect().catch(() => undefined);
}
