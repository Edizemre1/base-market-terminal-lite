import { BASE_USDC, BASE_WETH } from "./factory-registry.mjs";
import { ONCHAIN_STATE_REFRESH_MS, resolveOnchainAdapter } from "./onchain-state.mjs";

export const BACKFILL_QUEUE_LIMIT = 512;

export function backfillPriority(pool, now = new Date()) {
  const tokens = [pool.token0, pool.token1];
  if (!resolveOnchainAdapter(pool) || !pool.poolAddress) return 8;
  if (tokens.includes(BASE_WETH) && tokens.includes(BASE_USDC)) return 0;
  if (pool.providerEnrichment?.status === "matched") return 1;
  if (tokens.includes(BASE_USDC) || tokens.includes(BASE_WETH)) return 2;
  if (now.getTime() - Date.parse(pool.firstSeenAt ?? "") < 10 * 60_000) return 3;
  if ((pool.volume24hUsd ?? 0) > 0 || (pool.liquidityUsd ?? 0) > 0 || (pool.trades24h ?? 0) > 0) return 4;
  if (pool.backfill?.lastStatus === "retryable" || pool.onchainState?.status === "retryable") return 5;
  return 6;
}

export function seedBackfillQueue(state, now = new Date()) {
  const existing = new Map((state.onchainQueue ?? []).map((job) => [job.poolKey, job]));
  const jobs = [];
  for (const pool of Object.values(state.pools ?? {})) {
    if (pool.status !== "confirmed" || pool.orphaned || pool.replay) continue;
    const previous = existing.get(pool.poolKey);
    // History lives with the bounded pool universe, not a disposable queue row.
    pool.backfill ??= {
      attempts: previous?.attempts ?? 0, consecutiveFailures: previous?.attempts ?? 0,
      createdAt: previous?.createdAt ?? now.toISOString(),
      nextAttemptAt: pool.onchainState?.nextRetryAt ?? previous?.nextAttemptAt ?? now.toISOString(),
      lastSuccessfulBlock: pool.onchainState?.status === "complete" ? pool.onchainState.blockNumber : undefined,
      lastSuccessfulHash: pool.onchainState?.status === "complete" ? pool.onchainState.blockHash : undefined,
      lastSuccessAt: pool.onchainState?.status === "complete" ? pool.onchainState.observedAt : undefined
    };
    const history = pool.backfill;
    if (Date.parse(history.nextAttemptAt) > now.getTime()) continue;
    const priority = backfillPriority(pool, now);
    const waitingSince = history.nextAttemptAt ?? history.createdAt;
    const ageMs = Math.max(0, now.getTime() - Date.parse(waitingSince));
    // Aging eventually outranks recurring high-priority jobs. Unsupported local
    // classification never takes a network slot.
    const score = priority - Math.floor(ageMs / 60_000);
    jobs.push({ poolKey: pool.poolKey, poolAddress: pool.poolAddress, ...history, priority, score, waitingSince });
  }
  state.onchainQueue = jobs.sort((a, b) => a.score - b.score || Date.parse(a.waitingSince) - Date.parse(b.waitingSince) || a.poolKey.localeCompare(b.poolKey)).slice(0, BACKFILL_QUEUE_LIMIT);
  state.health ??= {};
  state.health.onchainQueueDepth = state.onchainQueue.length;
}

export function recordBackfillOutcome(pool, observed, now = new Date(), { usedRpc = false } = {}) {
  const old = pool.backfill ?? {};
  const temporary = observed.status === "retryable" || observed.status === "pending";
  const consecutiveFailures = temporary ? (old.consecutiveFailures ?? 0) + 1 : 0;
  const cooldownMs = observed.status === "complete" ? ONCHAIN_STATE_REFRESH_MS
    : observed.status === "unsupported" ? 6 * 60 * 60_000
      : observed.status === "rejected" ? 60 * 60_000
        : Math.min(15 * 60_000, 15_000 * 2 ** Math.min(consecutiveFailures, 6));
  const nextAttemptAt = new Date(now.getTime() + cooldownMs).toISOString();
  pool.backfill = {
    ...old, createdAt: old.createdAt ?? now.toISOString(), attempts: (old.attempts ?? 0) + Number(usedRpc),
    processed: (old.processed ?? 0) + 1, consecutiveFailures, nextAttemptAt, cooldownMs,
    lastAttemptAt: now.toISOString(), lastStatus: observed.status, lastReason: observed.reasonCode,
    lastErrorClass: temporary ? observed.reasonCode : undefined,
    lastEndpointLabel: observed.endpointLabel ?? old.lastEndpointLabel,
    lastSuccessfulBlock: observed.status === "complete" ? observed.blockNumber : old.lastSuccessfulBlock,
    lastSuccessfulHash: observed.status === "complete" ? observed.blockHash : old.lastSuccessfulHash,
    lastSuccessAt: observed.status === "complete" ? now.toISOString() : old.lastSuccessAt
  };
  return nextAttemptAt;
}

export function backfillHealth(state, now = new Date()) {
  const pools = Object.values(state.pools ?? {});
  const result = { queueDepth: state.onchainQueue?.length ?? 0, processed: state.counters?.backfillProcessed ?? 0, attempts: state.counters?.backfillRpcAttempts ?? 0, succeeded: state.counters?.onchainStateSuccess ?? 0, latestSucceeded: 0, retryable: 0, rejected: 0, unsupported: 0, pending: 0, successfulCoverage: 0, oldestPendingAgeMs: 0, lastPoolStateSuccess: undefined };
  for (const pool of pools) {
    const row = pool.backfill;
    if (!row) continue;
    if (row.lastStatus === "complete") result.latestSucceeded += 1;
    else if (Object.hasOwn(result, row.lastStatus)) result[row.lastStatus] += 1;
    if (row.lastSuccessfulHash) result.successfulCoverage += 1;
    if (row.lastSuccessAt && (!result.lastPoolStateSuccess || row.lastSuccessAt > result.lastPoolStateSuccess)) result.lastPoolStateSuccess = row.lastSuccessAt;
    if (row.nextAttemptAt && row.lastStatus !== "complete") result.oldestPendingAgeMs = Math.max(result.oldestPendingAgeMs, now.getTime() - Date.parse(row.nextAttemptAt));
  }
  return result;
}
