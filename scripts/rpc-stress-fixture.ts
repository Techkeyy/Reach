import { createTempoRpcReadCoordinator } from "../src/server/rpcCoordinator.js";

const coordinator = createTempoRpcReadCoordinator({
  concurrency: 3,
  maxRetries: 1,
  retryBaseMs: 10,
  retryMaxMs: 50,
  retryTotalMs: 100,
  random: () => 0,
  sleep: async () => {},
  logger: () => {},
});

const payoutRead = (id: string) => coordinator.read(async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, 1));
  if (id === "7") throw Object.assign(new Error("Tempo rate limited"), { status: 429 });
  return { id, status: "FUNDED" };
}, { key: `vault:getPayout:${id}`, kind: "getPayout" });

const payoutIds = Array.from({ length: 14 }, (_, index) => String(index + 1));
const activityIds = ["1", "3", "7", "9", "12", "14"];
const reads = [
  ...payoutIds.map(payoutRead),
  ...activityIds.map(payoutRead),
  coordinator.read(async () => "balance", { key: "token:balanceOf:pathUSD:sender", kind: "balanceOf" }),
  coordinator.read(async () => "block", { key: "block:latest", kind: "latestBlock" }),
];
const results = await Promise.allSettled(reads);
const unresolved = results.filter((result) => result.status === "rejected").length;
if (unresolved > 0) coordinator.markUnresolved(unresolved);
const metrics = coordinator.metrics();
console.log(JSON.stringify({
  logicalReads: metrics.logicalReads,
  underlyingRpcExecutions: metrics.underlyingRpcCalls,
  maxConcurrency: metrics.maxConcurrency,
  retryCount: metrics.retryCount,
  dedupHits: metrics.dedupHits,
  unresolvedAuthority: metrics.unresolvedAuthority,
  routeResult: unresolved === 0 ? "COMPLETE_AUTHORITY" : "PARTIAL_AUTHORITY",
}));
