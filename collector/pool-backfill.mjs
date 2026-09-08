import { BASE_USDC, BASE_WETH } from "./factory-registry.mjs";
import { ONCHAIN_STATE_REFRESH_MS, resolveOnchainAdapter, validTokenDecimals } from "./onchain-state.mjs";

export const BACKFILL_QUEUE_LIMIT = 512;

export function selectBackfillRpcBatch(queue, pools, maximum = 1, attempts = 0) {
  const remaining = [...queue];
  const selected = [];
  for (let index = 0; index < Math.max(1, maximum) && remaining.length; index += 1) {
    // Initial legacy proofs can all be overdue by many hours. Their refresh
    // age must not consume every slot after metadata unlocks an unproved pool.
    // Reserve one of four existing slots; keep the normal priority order in
    // both groups and persist cadence through the cumulative attempt counter.
    const unproved = (attempts + index) % 4 === 3
      ? remaining.findIndex((job) => !pools[job.poolKey]?.backfill?.lastSuccessfulHash)
      : -1;
    // A dedicated oldest-due slot provides fairness without letting hours of
    // accumulated age erase every high-value priority on every other slot.
    const oldest = (attempts + index) % 4 === 2
      ? remaining.reduce((best, job, i) => Date.parse(job.waitingSince ?? "") < Date.parse(remaining[best].waitingSince ?? "") ? i : best, 0) : 0;
    selected.push(...remaining.splice(unproved < 0 ? oldest : unproved, 1));
  }
  return selected;
}

export function backfillPriority(pool, now = new Date(), metadata) {
  const tokens = [pool.token0, pool.token1];
  if (!resolveOnchainAdapter(pool) || !pool.poolAddress) return 8;
  if (tokens.includes(BASE_WETH) && tokens.includes(BASE_USDC)) return 0;
  const verified = metadata ? tokens.every(token => validTokenDecimals(metadata[token]?.decimals) && metadata[token]?.verificationState === "verified") : pool.decimalsVerified === true;
  if (pool.providerEnrichment?.status === "matched" && verified) return 1;
  if (tokens.includes(BASE_USDC) || tokens.includes(BASE_WETH)) return 2;
  if (pool.providerEnrichment?.status === "matched" && ((pool.providerLiquidityUsd ?? 0) > 0 || (pool.volume24hUsd ?? 0) > 0)) return 3;
  if (now.getTime() - Date.parse(pool.firstSeenAt ?? "") < 10 * 60_000) return 4;
  if (pool.backfill?.lastSuccessfulHash || pool.onchainState?.status === "complete") return 5;
  if (pool.backfill?.lastStatus === "retryable" || pool.onchainState?.status === "retryable") return 6;
  return 7;
}

export function proofWorkValue(pool) {
  // These are scheduling hints, never canonical liquidity/price evidence.
  const matched = pool.providerEnrichment?.status === "matched";
  const liquidity = matched ? pool.providerLiquidityUsd : pool.onchainLiquidityUsd;
  return Math.log1p(Math.max(0, liquidity ?? 0)) * 4
    + (matched ? Math.log1p(Math.max(0, pool.volume24hUsd ?? 0)) : 0);
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
    if (pool.onchainState?.status === "complete" && now.getTime() - Date.parse(pool.onchainState.observedAt) < ONCHAIN_STATE_REFRESH_MS) continue;
    const priority = backfillPriority(pool, now, state.tokenMetadata);
    const waitingSince = history.nextAttemptAt ?? history.createdAt;
    const ageMs = Math.max(0, now.getTime() - Date.parse(waitingSince));
    const score = priority - Math.min(0.5, ageMs / (60 * 60_000));
    jobs.push({ poolKey: pool.poolKey, poolAddress: pool.poolAddress, ...history, priority, score, value: proofWorkValue(pool), waitingSince });
  }
  const ordered = jobs.sort((a, b) => a.priority - b.priority || b.value - a.value || a.score - b.score || a.poolKey.localeCompare(b.poolKey));
  const oldest = [...jobs].sort((a,b) => Date.parse(a.waitingSince) - Date.parse(b.waitingSince) || a.poolKey.localeCompare(b.poolKey)).slice(0,64);
  const admitted = new Set([...ordered.slice(0,BACKFILL_QUEUE_LIMIT-64),...oldest].map(job => job.poolKey));
  for (const job of ordered) { if (admitted.size >= BACKFILL_QUEUE_LIMIT) break; admitted.add(job.poolKey); }
  state.onchainQueue = ordered.filter(job => admitted.has(job.poolKey));
  state.health ??= {};
  state.health.onchainQueueDepth = state.onchainQueue.length;
}

export function recordBackfillOutcome(pool, observed, now = new Date(), { usedRpc = false } = {}) {
  const old = pool.backfill ?? {};
  const temporary = observed.status === "retryable" || observed.status === "pending";
  const consecutiveFailures = temporary ? (old.consecutiveFailures ?? 0) + 1 : 0;
  const persistentFailure = /reverted|empty_response|malformed|invalid_decimals|mismatch/.test(observed.reasonCode ?? "");
  const cooldownMs = observed.status === "complete" ? ONCHAIN_STATE_REFRESH_MS
    : observed.status === "unsupported" ? 6 * 60 * 60_000
      : observed.status === "rejected" ? 60 * 60_000
        : Math.min(15 * 60_000, (persistentFailure ? 60_000 : 15_000) * 2 ** Math.min(consecutiveFailures, 6));
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
  result.priorityDistribution = {};
  result.oldestHighPriorityPendingMs = 0;
  for (const job of state.onchainQueue ?? []) {
    result.priorityDistribution[job.priority] = (result.priorityDistribution[job.priority] ?? 0) + 1;
    if (job.priority <= 2) result.oldestHighPriorityPendingMs = Math.max(result.oldestHighPriorityPendingMs, now.getTime() - Date.parse(job.waitingSince));
  }
  return result;
}
