export type SessionRefreshGateOptions = {
  cooldownMs?: number;
  now?: () => number;
};

export type SessionRefreshGate = {
  run<T>(
    account: string,
    task: (isCurrent: () => boolean) => Promise<T>,
    options?: { force?: boolean },
  ): Promise<T | undefined>;
  invalidate(): void;
};

/**
 * Coalesces refresh triggers for one account and gives completions a
 * generation check so an older account/request cannot publish over a newer
 * one. The gate contains no React state and is therefore easy to exercise in
 * deterministic tests.
 */
export function createSessionRefreshGate(options: SessionRefreshGateOptions = {}): SessionRefreshGate {
  const cooldownMs = Math.max(0, options.cooldownMs ?? 0);
  const now = options.now ?? Date.now;
  let account: string | undefined;
  let inFlight: Promise<unknown> | undefined;
  let lastStartedAt = 0;
  let generation = 0;

  return {
    run<T>(requestedAccount, task, runOptions: { force?: boolean } = {}) {
      if (inFlight && account === requestedAccount) return inFlight as Promise<T>;
      const startedAt = now();
      if (!runOptions.force && account === requestedAccount && startedAt - lastStartedAt < cooldownMs) {
        return Promise.resolve(undefined);
      }

      account = requestedAccount;
      lastStartedAt = startedAt;
      const taskGeneration = ++generation;
      let promise!: Promise<T>;
      promise = task(() => taskGeneration === generation && account === requestedAccount).finally(() => {
        if (inFlight === promise) inFlight = undefined;
      });
      inFlight = promise;
      return promise;
    },
    invalidate() {
      generation += 1;
      account = undefined;
      lastStartedAt = 0;
    },
  };
}
