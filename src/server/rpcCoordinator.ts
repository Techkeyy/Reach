/**
 * A small, process-local coordinator for Tempo JSON-RPC reads.
 *
 * Lifecycle reads are deliberately not cached after completion: vault state
 * remains authoritative and every mutation preflight can request a fresh read.
 * Callers may opt into a short completed-value cache only for immutable or
 * explicitly bounded data such as token metadata.
 */

export const DEFAULT_RPC_READ_CONCURRENCY = 3;
export const DEFAULT_RPC_MAX_RETRIES = 2;
export const DEFAULT_RPC_RETRY_BASE_MS = 150;
export const DEFAULT_RPC_RETRY_MAX_MS = 1_500;
export const DEFAULT_RPC_RETRY_TOTAL_MS = 3_000;
export const DEFAULT_RPC_CIRCUIT_FAILURE_THRESHOLD = 3;
export const DEFAULT_RPC_CIRCUIT_COOLDOWN_MS = 5_000;

export type RpcReadKind =
  | "getPayout"
  | "latestBlock"
  | "balanceOf"
  | "tokenMetadata"
  | "transaction"
  | "receipt"
  | "chainId"
  | "other";

export type RpcReadOptions = {
  /** Stable operation key. Equal keys share one in-flight request. */
  key: string;
  kind?: RpcReadKind;
  /** Essential reads may proceed while the non-essential circuit is open. */
  essential?: boolean;
  /** Explicitly opt into a bounded completed-value cache. */
  cacheTtlMs?: number;
};

export type RpcCoordinatorMetrics = {
  logicalReads: number;
  dedupHits: number;
  underlyingRpcCalls: number;
  maxConcurrency: number;
  rateLimitEvents: number;
  retryCount: number;
  circuitBreakerOpens: number;
  unresolvedAuthority: number;
  activeConcurrency: number;
  queuedReads: number;
  circuitOpenUntil: number | null;
};

export type RpcCoordinatorLogger = (event: string, fields: Record<string, number | string | boolean>) => void;

export type RpcReadCoordinatorOptions = {
  concurrency?: number;
  maxRetries?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  retryTotalMs?: number;
  circuitFailureThreshold?: number;
  circuitCooldownMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
  logger?: RpcCoordinatorLogger;
};

/** Bounded fanout helper for route-level work around coordinator reads. */
export async function mapWithConcurrency<T, R>(values: T[], limit: number, operation: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= values.length) return;
      results[index] = await operation(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, Math.floor(limit)), values.length) }, () => worker()));
  return results;
}

export class RpcAuthorityUnavailableError extends Error {
  readonly code = "AUTHORITY_UNAVAILABLE" as const;
  readonly rateLimited: boolean;
  readonly retryAfterMs?: number;

  constructor(message = "Tempo authority is temporarily unavailable", options: { rateLimited?: boolean; retryAfterMs?: number; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "RpcAuthorityUnavailableError";
    this.rateLimited = options.rateLimited ?? false;
    this.retryAfterMs = options.retryAfterMs;
  }
}

type PendingRead<T> = {
  key: string;
  kind: RpcReadKind;
  essential: boolean;
  cacheTtlMs: number;
  operation: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

type CachedValue = { value: unknown; expiresAt: number };

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function nestedErrors(error: unknown): unknown[] {
  const values: unknown[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    values.push(current);
    const record = asRecord(current);
    current = record?.cause ?? record?.error;
  }
  return values;
}

function statusOf(error: unknown): number | undefined {
  for (const candidate of nestedErrors(error)) {
    const record = asRecord(candidate);
    const value = record?.status ?? record?.statusCode ?? asRecord(record?.response)?.status;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  }
  return undefined;
}

function messageOf(error: unknown): string {
  return nestedErrors(error).map((candidate) => {
    const record = asRecord(candidate);
    return typeof record?.message === "string" ? record.message : String(candidate);
  }).join(" ");
}

/** Exported for deterministic coordinator tests and transport adapters. */
export function isRateLimitError(error: unknown): boolean {
  const status = statusOf(error);
  if (status === 429 || status === 420 || status === 503) return true;
  return /(?:\b429\b|too many requests|rate[ -]?limit|throttl|quota exceeded|resource exhausted)/i.test(messageOf(error));
}

function retryAfterValue(value: unknown, now: number, numericIsMilliseconds = false): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return numericIsMilliseconds ? value : value * 1_000;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const trimmed = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) return retryAfterValue(Number(trimmed), now, numericIsMilliseconds);
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? undefined : Math.max(0, parsed - now);
}

/** Reads Retry-After from common viem/fetch error shapes without logging values. */
export function retryAfterMsFromError(error: unknown, now = Date.now()): number | undefined {
  for (const candidate of nestedErrors(error)) {
    const record = asRecord(candidate);
    const directMs = retryAfterValue(record?.retryAfterMs, now, true);
    if (directMs !== undefined) return directMs;
    const direct = retryAfterValue(record?.retryAfter, now);
    if (direct !== undefined) return direct;
    const response = asRecord(record?.response);
    const headers = response?.headers;
    if (headers && typeof (headers as { get?: unknown }).get === "function") {
      const header = (headers as { get(name: string): string | null }).get("retry-after");
      const parsed = retryAfterValue(header, now);
      if (parsed !== undefined) return parsed;
    }
    if (headers && typeof headers === "object") {
      const headerRecord = headers as Record<string, unknown>;
      const parsed = retryAfterValue(headerRecord["retry-after"] ?? headerRecord["Retry-After"], now);
      if (parsed !== undefined) return parsed;
    }
  }
  const match = messageOf(error).match(/retry[- ]after\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
  return match ? retryAfterValue(match[1], now) : undefined;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function createTempoRpcReadCoordinator(options: RpcReadCoordinatorOptions = {}) {
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? DEFAULT_RPC_READ_CONCURRENCY));
  const maxRetries = Math.max(0, Math.floor(options.maxRetries ?? DEFAULT_RPC_MAX_RETRIES));
  const retryBaseMs = Math.max(0, options.retryBaseMs ?? DEFAULT_RPC_RETRY_BASE_MS);
  const retryMaxMs = Math.max(retryBaseMs, options.retryMaxMs ?? DEFAULT_RPC_RETRY_MAX_MS);
  const retryTotalMs = Math.max(0, options.retryTotalMs ?? DEFAULT_RPC_RETRY_TOTAL_MS);
  const circuitFailureThreshold = Math.max(1, Math.floor(options.circuitFailureThreshold ?? DEFAULT_RPC_CIRCUIT_FAILURE_THRESHOLD));
  const circuitCooldownMs = Math.max(1, options.circuitCooldownMs ?? DEFAULT_RPC_CIRCUIT_COOLDOWN_MS);
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;
  const logger = options.logger;

  const inFlight = new Map<string, Promise<unknown>>();
  const completed = new Map<string, CachedValue>();
  const queue: PendingRead<unknown>[] = [];
  let active = 0;
  let maxObserved = 0;
  let rateLimitFailures = 0;
  let circuitOpenUntil = 0;
  const metrics: RpcCoordinatorMetrics = {
    logicalReads: 0,
    dedupHits: 0,
    underlyingRpcCalls: 0,
    maxConcurrency: 0,
    rateLimitEvents: 0,
    retryCount: 0,
    circuitBreakerOpens: 0,
    unresolvedAuthority: 0,
    activeConcurrency: 0,
    queuedReads: 0,
    circuitOpenUntil: null,
  };

  const emit = (event: string, fields: Record<string, number | string | boolean> = {}) => {
    try { logger?.(event, fields); } catch { /* observability must never break authority reads */ }
  };

  const isOpen = () => {
    if (circuitOpenUntil === 0) return false;
    if (now() >= circuitOpenUntil) {
      circuitOpenUntil = 0;
      metrics.circuitOpenUntil = null;
      rateLimitFailures = 0;
      emit("tempo_rpc_circuit_half_open", {});
      return false;
    }
    return true;
  };

  const openCircuit = () => {
    if (circuitOpenUntil > now()) return;
    circuitOpenUntil = now() + circuitCooldownMs;
    metrics.circuitOpenUntil = circuitOpenUntil;
    metrics.circuitBreakerOpens += 1;
    emit("tempo_rpc_circuit_open", { cooldownMs: circuitCooldownMs });
  };

  const execute = async <T>(item: PendingRead<T>): Promise<T> => {
    if (!item.essential && isOpen()) throw new RpcAuthorityUnavailableError(undefined, { rateLimited: true });
    const startedAt = now();
    let attempt = 0;
    let waited = 0;
    while (true) {
      metrics.underlyingRpcCalls += 1;
      try {
        const value = await item.operation();
        rateLimitFailures = 0;
        if (item.cacheTtlMs > 0) completed.set(item.key, { value, expiresAt: now() + item.cacheTtlMs });
        emit("tempo_rpc_read", { kind: item.kind, attempt: attempt + 1, dedup: false });
        return value;
      } catch (error) {
        if (!isRateLimitError(error)) throw error;
        metrics.rateLimitEvents += 1;
        rateLimitFailures += 1;
        emit("tempo_rpc_rate_limited", { kind: item.kind, attempt: attempt + 1 });
        if (rateLimitFailures >= circuitFailureThreshold) openCircuit();
        if (attempt >= maxRetries) {
          throw new RpcAuthorityUnavailableError(undefined, { rateLimited: true, retryAfterMs: retryAfterMsFromError(error, now()), cause: error });
        }
        const retryAfter = retryAfterMsFromError(error, now());
        const exponential = Math.min(retryMaxMs, retryBaseMs * (2 ** attempt));
        const jitter = Math.floor(exponential * 0.25 * Math.max(0, Math.min(1, random())));
        const delay = Math.min(retryMaxMs, Math.max(retryAfter ?? 0, exponential + jitter));
        if (waited + delay > retryTotalMs || now() - startedAt + delay > retryTotalMs) {
          throw new RpcAuthorityUnavailableError(undefined, { rateLimited: true, retryAfterMs: retryAfter, cause: error });
        }
        metrics.retryCount += 1;
        emit("tempo_rpc_retry", { kind: item.kind, attempt: attempt + 1, delayMs: delay });
        await sleep(delay);
        waited += delay;
        attempt += 1;
      }
    }
  };

  const drain = () => {
    while (active < concurrency && queue.length > 0) {
      const item = queue.shift()!;
      metrics.queuedReads = queue.length;
      active += 1;
      metrics.activeConcurrency = active;
      maxObserved = Math.max(maxObserved, active);
      metrics.maxConcurrency = maxObserved;
      void execute(item).then(item.resolve, item.reject).finally(() => {
        active -= 1;
        metrics.activeConcurrency = active;
        drain();
      });
    }
  };

  const read = <T>(operation: () => Promise<T>, readOptions: RpcReadOptions): Promise<T> => {
    const kind = readOptions.kind ?? "other";
    const essential = readOptions.essential ?? false;
    const cacheTtlMs = Math.max(0, readOptions.cacheTtlMs ?? 0);
    metrics.logicalReads += 1;

    const pending = inFlight.get(readOptions.key);
    if (pending) {
      metrics.dedupHits += 1;
      emit("tempo_rpc_dedup", { kind });
      return pending as Promise<T>;
    }

    const cached = completed.get(readOptions.key);
    if (cached) {
      if (cached.expiresAt > now()) return Promise.resolve(cached.value as T);
      completed.delete(readOptions.key);
    }

    if (!essential && isOpen()) {
      metrics.unresolvedAuthority += 1;
      emit("tempo_rpc_read_blocked", { kind, reason: "circuit_open" });
      return Promise.reject(new RpcAuthorityUnavailableError(undefined, { rateLimited: true }));
    }

    const promise = new Promise<T>((resolve, reject) => {
      queue.push({ key: readOptions.key, kind, essential, cacheTtlMs, operation, resolve: resolve as (value: unknown) => void, reject });
      metrics.queuedReads = queue.length;
      drain();
    }).finally(() => {
      inFlight.delete(readOptions.key);
      metrics.queuedReads = queue.length;
    });
    inFlight.set(readOptions.key, promise);
    return promise;
  };

  return {
    read,
    markUnresolved(count = 1) {
      metrics.unresolvedAuthority += Math.max(0, count);
      emit("tempo_rpc_authority_unresolved", { count: Math.max(0, count) });
    },
    metrics(): RpcCoordinatorMetrics {
      return { ...metrics, circuitOpenUntil: circuitOpenUntil || null };
    },
    isCircuitOpen: isOpen,
    clearCompletedCache() { completed.clear(); },
  };
}

export type TempoRpcReadCoordinator = ReturnType<typeof createTempoRpcReadCoordinator>;
