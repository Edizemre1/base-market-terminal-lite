import { BASE_CHAIN_ID, BASE_USDC, BASE_WETH, FACTORY_REGISTRY } from "./factory-registry.mjs";
import {
  MARKET_QUALITY_THRESHOLDS,
  bestKnownLiquidityUsd,
  buildObservedPriceUsd,
  categoryEligibility as buildCategoryEligibility,
  classifyLiquidityState,
  evaluateOpportunityQuality
} from "./market-quality.mjs";

export const BASE_CBBTC = "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf";
export const BASE_AERO = "0x940181a94a35a4569e4529a3cdfb74e38fd98631";
export const NATIVE_CURRENCY = "0x0000000000000000000000000000000000000000";
export const MAX_EVENT_RING = 256;
export const MAX_HISTORY_RING = 512;
export const MAX_RECONCILIATION_RING = 128;
export const MAX_PRICE_HOPS = 3;
export const MIN_PRICE_LIQUIDITY_USD = MARKET_QUALITY_THRESHOLDS.canonicalPriceMinimumLiquidityUsd;
export const MAX_PRICE_AGE_MS = 2 * 60_000;

const EVM_ADDRESS = /^0x[0-9a-f]{40}$/;
const HASH = /^0x[0-9a-f]{64}$/;
const TRUSTED_ANCHORS = new Set([BASE_USDC, BASE_WETH, BASE_CBBTC, BASE_AERO, NATIVE_CURRENCY]);

export function decodeFactoryLog(log, registry = FACTORY_REGISTRY) {
  const address = normalizeAddress(log?.address);
  const topic0 = normalizeHash(log?.topics?.[0]);
  const binding = registry.find((item) => item.enabled && item.address === address && item.eventTopic === topic0);
  if (!binding) return undefined;
  const blockHash = normalizeHash(log.blockHash);
  const transactionHash = normalizeHash(log.transactionHash);
  const blockNumber = parseHexNumber(log.blockNumber);
  const logIndex = parseHexNumber(log.logIndex);
  if (!blockHash || !transactionHash || blockNumber === undefined || logIndex === undefined) return undefined;

  const singleton = binding.adapter === "uniswap-v4" || binding.adapter === "pancake-infinity";
  const token0 = addressFromWord(log.topics?.[singleton ? 2 : 1]);
  const token1 = addressFromWord(log.topics?.[singleton ? 3 : 2]);
  if (!token0 || !token1 || token0 === token1) return undefined;
  let poolAddress;
  let poolId;
  let fee;
  let variant;

  if (binding.adapter === "uniswap-v2") {
    poolAddress = addressFromData(log.data, 0);
  } else if (binding.adapter === "aerodrome-classic") {
    poolAddress = addressFromData(log.data, 0);
    variant = parseHexNumber(log.topics?.[3]) === 1 ? "stable" : "volatile";
  } else if (binding.adapter === "aerodrome-slipstream") {
    poolAddress = addressFromData(log.data, 0);
    fee = signedWord(log.topics?.[3], 24);
  } else if (binding.adapter === "uniswap-v3") {
    poolAddress = addressFromData(log.data, 1);
    fee = parseHexNumber(log.topics?.[3]);
  } else if (binding.adapter === "uniswap-v4" || binding.adapter === "pancake-infinity") {
    poolId = normalizeHash(log.topics?.[1]);
    if (!poolId) return undefined;
  }

  if (!poolAddress && !poolId) return undefined;
  const poolKey = poolAddress ?? `${binding.address}:${poolId}`;
  return {
    idempotencyKey: `${blockHash}:${transactionHash}:${logIndex}`,
    chainId: BASE_CHAIN_ID,
    factoryId: binding.id,
    factoryAddress: binding.address,
    dexId: binding.dexId,
    protocolVersion: binding.protocolVersion,
    poolType: binding.poolType,
    adapterVersion: binding.adapterVersion,
    poolKey,
    poolAddress,
    poolId,
    token0,
    token1,
    fee,
    variant,
    blockNumber,
    blockHash,
    transactionHash,
    logIndex,
    removed: Boolean(log.removed),
    provisional: Boolean(log.provisional),
    replay: Boolean(log.replay),
    source: "onchain"
  };
}

export function applyCanonicalEvents(state, events, { now = new Date(), replay = false } = {}) {
  const next = structuredClone(state);
  const timestamp = now.toISOString();
  next.events ??= {};
  next.pools ??= {};
  next.history ??= [];
  next.reconciliation ??= [];
  next.eventRing ??= [];
  next.counters ??= { duplicateDropped: 0, malformedRejected: 0, reorgCount: 0 };
  const seenInBatch = new Set();

  for (const event of events) {
    if (!event || seenInBatch.has(event.idempotencyKey)) {
      next.counters.duplicateDropped += 1;
      continue;
    }
    seenInBatch.add(event.idempotencyKey);
    const existingEvent = next.events[event.idempotencyKey];
    if (event.removed) {
      if (existingEvent?.status === "orphaned") next.counters.duplicateDropped += 1;
      else orphanPool(next, event.poolKey, event, timestamp);
      continue;
    }
    if (existingEvent) {
      if (existingEvent.status === "provisional" && !event.provisional && !event.removed) {
        const promoted = { ...existingEvent, ...event, status: "confirmed", provisional: false, confirmedAt: timestamp };
        next.events[event.idempotencyKey] = promoted;
        next.pools[event.poolKey] = mergePoolRecord(next.pools[event.poolKey], promoted, timestamp);
        next.history.push({ kind: "pool_confirmed", at: timestamp, eventId: event.idempotencyKey, poolKey: event.poolKey, replay: Boolean(promoted.replay) });
        if (!promoted.replay) appendRelayEvent(next, "pool_confirmed", { poolKey: event.poolKey, token0: event.token0, token1: event.token1, blockNumber: event.blockNumber }, timestamp);
      } else {
        next.counters.duplicateDropped += 1;
      }
      continue;
    }
    const status = event.provisional ? "provisional" : "confirmed";
    const canonicalEvent = {
      ...event,
      replay: replay || event.replay,
      status,
      firstSeenAt: timestamp,
      confirmedAt: status === "confirmed" ? timestamp : undefined
    };
    next.events[event.idempotencyKey] = canonicalEvent;
    const current = next.pools[event.poolKey];
    next.pools[event.poolKey] = mergePoolRecord(current, canonicalEvent, timestamp);
    next.history.push({ kind: status === "confirmed" ? "pool_confirmed" : "pool_provisional", at: timestamp, eventId: event.idempotencyKey, poolKey: event.poolKey, replay: canonicalEvent.replay });
    if (status === "confirmed" && !canonicalEvent.replay) {
      appendRelayEvent(next, "pool_confirmed", { poolKey: event.poolKey, token0: event.token0, token1: event.token1, blockNumber: event.blockNumber }, timestamp);
    }
  }
  next.history = next.history.slice(-MAX_HISTORY_RING);
  next.reconciliation = next.reconciliation.slice(-MAX_RECONCILIATION_RING);
  next.eventRing = next.eventRing.slice(-MAX_EVENT_RING);
  return next;
}

export function reconcileCanonicalWindow(state, canonicalEvents, fromBlock, toBlock, now = new Date()) {
  let next = structuredClone(state);
  const timestamp = now.toISOString();
  const canonicalIds = new Set(canonicalEvents.map((event) => event.idempotencyKey));
  for (const event of Object.values(next.events ?? {})) {
    if (event.status !== "confirmed" || event.replay || event.blockNumber < fromBlock || event.blockNumber > toBlock) continue;
    if (!canonicalIds.has(event.idempotencyKey)) orphanPool(next, event.poolKey, event, timestamp);
  }
  next = applyCanonicalEvents(next, canonicalEvents, { now });
  next.reconciliation.push({ kind: "overlap", fromBlock, toBlock, at: timestamp, canonicalCount: canonicalEvents.length });
  next.reconciliation = next.reconciliation.slice(-MAX_RECONCILIATION_RING);
  return next;
}

export function buildCanonicalOpportunities(inputPools, metadata = {}, previous = [], now = new Date()) {
  const pools = dedupePools(inputPools).filter((pool) => pool.status === "confirmed" && !pool.orphaned);
  const groups = new Map();
  for (const pool of pools) {
    for (const token of opportunityTokens(pool)) {
      const id = `${BASE_CHAIN_ID}:token:${token}`;
      const group = groups.get(id) ?? { id, tokenAddress: token, pools: [] };
      group.pools.push(pool);
      groups.set(id, group);
    }
  }
  const previousById = new Map(previous.map((item) => [item.id, item]));
  return [...groups.values()].map((group) => {
    const before = previousById.get(group.id);
    const selection = selectPrimaryPool(group.pools, before?.primaryPoolKey, now);
    const price = calculateCanonicalUsdcPrice(group.tokenAddress, pools, now);
    const tokenMetadata = metadata[group.tokenAddress];
    const observed = group.pools.map((pool) => pool.observedAt ?? pool.confirmedAt).filter(Boolean).sort();
    const ranked = price.tier !== "UNPRICED" && group.pools.some((pool) => isUsableRankedPool(pool, now));
    const observedPriceUsd = buildObservedPriceUsd(group.tokenAddress, group.pools, now);
    const bestLiquidityUsd = bestKnownLiquidityUsd(group.pools);
    const liquidityState = classifyLiquidityState(group.pools.map((pool) => pool.liquidityUsd));
    const providerState = group.pools.some((pool) => pool.providerEnrichment?.status === "matched") ? "matched"
      : group.pools.some((pool) => pool.providerEnrichment?.status === "pending") ? "pending"
        : group.pools.some((pool) => pool.providerEnrichment?.status === "conflicting") ? "conflicting"
          : group.pools.some((pool) => pool.providerEnrichment?.status === "unmatched") ? "not_found" : "detected";
    const quality = evaluateOpportunityQuality({ canonicalPrice: price, observedPriceUsd, liquidityState, bestLiquidityUsd, ranked, providerState, exclusionReason: price.reasonCode });
    const poolCreatedTimes = group.pools.map((pool) => pool.blockTimestamp ?? pool.confirmedAt).filter(Boolean).sort();
    const firstSeenTimes = group.pools.map((pool) => pool.firstSeenAt).filter(Boolean).sort();
    const providerIndexedTimes = group.pools.map((pool) => pool.providerIndexedAt).filter(Boolean).sort();
    const newestCreatedAt = poolCreatedTimes.at(-1);
    const newestCreatedMs = Date.parse(newestCreatedAt ?? "");
    const newlyCreated = Number.isFinite(newestCreatedMs) && now.getTime() >= newestCreatedMs && now.getTime() - newestCreatedMs <= 7 * 24 * 60 * 60_000;
    const aggregate = aggregateVerifiedMetrics(group.pools);
    return {
      id: group.id,
      chainId: BASE_CHAIN_ID,
      tokenAddress: group.tokenAddress,
      symbol: safeTokenLabel(tokenMetadata?.symbol, group.tokenAddress),
      name: safeTokenLabel(tokenMetadata?.name, group.tokenAddress),
      metadataStatus: tokenMetadata?.status ?? "unavailable",
      identiconSeed: group.tokenAddress,
      poolKeys: group.pools.map((pool) => pool.poolKey).sort(),
      poolCount: group.pools.length,
      primaryPoolKey: selection.pool?.poolKey,
      primarySelection: selection.reason,
      canonicalPrice: price,
      canonicalPriceUsd: price.tier === "UNPRICED" ? undefined : price.value,
      observedPriceUsd,
      qualityBand: quality.band,
      highQualityEmerging: quality.highQualityEmerging,
      liquidityState,
      bestLiquidityUsd,
      rankingEligibility: quality.rankingEligible,
      exclusionReason: quality.exclusionReason,
      displayMode: quality.displayMode,
      providerDiscoveryState: providerState,
      poolCreatedAt: poolCreatedTimes[0],
      newestPoolCreatedAt: newestCreatedAt,
      firstSeenAt: firstSeenTimes[0],
      providerIndexedAt: providerIndexedTimes[0],
      freshness: observed.at(-1) ?? now.toISOString(),
      lifecycle: quality.band === "RANKED" ? "active" : quality.band === "EMERGING" ? "emerging" : quality.band === "REJECTED" ? "rejected" : "detected",
      ranked,
      activationReason: price.tier === "UNPRICED" ? price.reasonCode : ranked ? "priced_fresh_usable_liquidity" : "ranking_metrics_pending",
      tradeability: "market_data_only",
      aggregate,
      categoryEligibility: buildCategoryEligibility({
        band: quality.band,
        canonicalPrice: price,
        bestLiquidityUsd,
        volumes: aggregate.volumes,
        transactions: aggregate.transactions,
        comparableSnapshots: false,
        newlyCreated
      })
    };
  }).sort((left, right) => opportunityRank(right) - opportunityRank(left) || left.id.localeCompare(right.id));
}

export function calculateCanonicalUsdcPrice(tokenAddress, inputPools, now = new Date(), options = {}) {
  const token = normalizeAddress(tokenAddress);
  if (!token) return unpriced("invalid_token_address");
  if (token === BASE_USDC) return { value: 1, tier: "A", kind: "direct", sourcePoolKeys: [], anchor: BASE_USDC, observedAt: now.toISOString(), freshness: "fresh", reasonCode: "canonical_usdc_unit" };
  const maxAgeMs = options.maxAgeMs ?? MAX_PRICE_AGE_MS;
  const minimumLiquidityUsd = options.minimumLiquidityUsd ?? MIN_PRICE_LIQUIDITY_USD;
  const nowMs = now.getTime();
  const accepted = [];
  const rejected = [];
  for (const pool of dedupePools(inputPools)) {
    const reason = validatePricingPool(pool, nowMs, maxAgeMs, minimumLiquidityUsd);
    if (reason) rejected.push({ pool, reason });
    else accepted.push(pool);
  }
  const graph = buildPriceGraph(accepted);
  const queue = [{ token, value: 1, path: [], visited: new Set([token]), observedAt: now.toISOString(), blockNumber: undefined }];
  const candidates = [];
  while (queue.length) {
    const current = queue.shift();
    if (current.path.length >= MAX_PRICE_HOPS) continue;
    for (const edge of graph.get(current.token) ?? []) {
      if (current.visited.has(edge.to)) continue;
      const value = current.value * edge.rate;
      if (!Number.isFinite(value) || value <= 0) continue;
      const path = [...current.path, edge];
      const observedAt = oldestIso(current.observedAt, edge.observedAt);
      const blockNumber = current.blockNumber === undefined ? edge.blockNumber : Math.min(current.blockNumber, edge.blockNumber ?? current.blockNumber);
      if (edge.to === BASE_USDC) {
        candidates.push({ value, path, observedAt, blockNumber });
        continue;
      }
      queue.push({ token: edge.to, value, path, visited: new Set([...current.visited, edge.to]), observedAt, blockNumber });
    }
  }
  if (!candidates.length) {
    const tokenRejected = rejected.filter(({ pool }) => pool.token0 === token || pool.token1 === token);
    const anchorRejected = rejected.filter(({ pool }) => sameTokenPair(pool, BASE_WETH, BASE_USDC));
    const relevant = tokenRejected.length ? tokenRejected : anchorRejected;
    if (relevant.some(({ reason }) => reason === "future_timestamp")) return unpriced("future_timestamp");
    if (relevant.some(({ reason }) => reason === "conflicting_pool_identity")) return unpriced("conflicting_pool_identity");
    if (relevant.some(({ reason }) => reason === "stale_anchor")) return unpriced("stale_anchor");
    if (relevant.some(({ reason }) => reason === "liquidity_unknown")) return unpriced("liquidity_unknown");
    if (relevant.some(({ reason }) => reason === "zero_liquidity")) return unpriced("zero_liquidity");
    if (relevant.some(({ reason }) => reason === "thin_liquidity")) return unpriced("thin_liquidity");
    if (relevant.some(({ reason }) => reason === "stale_pool")) return unpriced("stale_pool");
    return unpriced(graph.has(token) ? "no_bounded_usdc_path" : "no_trustworthy_usdc_path");
  }
  const preferredTier = Math.min(...candidates.map((candidate) => priceTierRank(candidate.path)));
  const comparable = candidates.filter((candidate) => priceTierRank(candidate.path) === preferredTier);
  const consensus = selectPriceConsensus(comparable);
  const winner = consensus.representative;
  const intermediates = winner.path.slice(0, -1).map((edge) => edge.to);
  const tier = winner.path.length === 1 ? "A" : winner.path.length === 2 && intermediates[0] === BASE_WETH ? "B" : "C";
  return {
    value: consensus.value,
    rawValue: canonicalRawValue(consensus.value),
    tier,
    kind: tier === "A" ? "direct" : "converted",
    sourcePoolKeys: [...new Set(consensus.members.flatMap((candidate) => candidate.path.flatMap((edge) => edge.sourcePoolKeys ?? [edge.poolKey])))].sort(),
    anchor: tier === "B" ? BASE_WETH : winner.path.at(-1)?.from,
    observedAt: winner.observedAt,
    blockNumber: winner.blockNumber,
    freshness: "fresh",
    qualityStatus: consensus.members.length > 1 ? "consensus" : "single_path",
    selectionReason: consensus.members.length > 1 ? "bounded_liquidity_consensus" : "highest_quality_verified_path",
    maximumDeviation: consensus.maximumDeviation,
    reasonCode: tier === "A" ? "direct_usdc_pool" : tier === "B" ? "weth_usdc_anchor" : "bounded_verified_conversion"
  };
}

function sameTokenPair(pool, left, right) {
  return pool.token0 === left && pool.token1 === right || pool.token0 === right && pool.token1 === left;
}

export function selectPrimaryPool(pools, previousPoolKey, now = new Date()) {
  const ranked = [...dedupePools(pools)].sort((left, right) => primaryScore(right, now) - primaryScore(left, now) || left.poolKey.localeCompare(right.poolKey));
  const best = ranked[0];
  if (!best) return { pool: undefined, reason: { code: "no_valid_pool" } };
  const previous = ranked.find((pool) => pool.poolKey === previousPoolKey);
  if (!previous) return { pool: best, reason: { code: "highest_quality", nextPoolKey: best.poolKey } };
  if (previous.orphaned || previous.status !== "confirmed") return { pool: best, reason: { code: "previous_invalid", previousPoolKey, nextPoolKey: best.poolKey } };
  if (best.poolKey === previous.poolKey) return { pool: previous, reason: { code: "unchanged", previousPoolKey } };
  const previousScore = primaryScore(previous, now);
  const bestScore = primaryScore(best, now);
  if (bestScore < previousScore * 1.12 + 10) return { pool: previous, reason: { code: "hysteresis_retained", previousPoolKey, challengerPoolKey: best.poolKey } };
  return { pool: best, reason: { code: "material_quality_improvement", previousPoolKey, nextPoolKey: best.poolKey } };
}

export function appendRelayEvent(state, type, data, at = new Date().toISOString()) {
  state.nextEventSequence = (state.nextEventSequence ?? 0) + 1;
  state.eventRing ??= [];
  state.eventRing.push({ id: String(state.nextEventSequence), type, at, data });
  state.eventRing = state.eventRing.slice(-MAX_EVENT_RING);
  return state.eventRing.at(-1);
}

export function eventsAfterId(ring, lastEventId) {
  if (!lastEventId) return ring.slice(-1);
  const index = ring.findIndex((event) => event.id === String(lastEventId));
  return index < 0 ? ring : ring.slice(index + 1);
}

export function coalesceBoundedQueue(existing, incoming, maximum = 64) {
  const values = new Map();
  for (const item of [...existing, ...incoming]) {
    const key = item?.poolKey ?? item?.idempotencyKey;
    if (!key) continue;
    values.delete(key);
    values.set(key, item);
  }
  return [...values.values()].slice(-Math.max(1, maximum));
}

export function dedupePools(pools) {
  const unique = new Map();
  for (const raw of pools ?? []) {
    const pool = normalizePool(raw);
    if (!pool) continue;
    const current = unique.get(pool.poolKey);
    unique.set(pool.poolKey, current ? mergeObservedPools(current, pool) : pool);
  }
  return [...unique.values()];
}

function normalizePool(pool) {
  const poolKey = typeof pool?.poolKey === "string" ? pool.poolKey.toLowerCase() : undefined;
  const token0 = normalizeAddress(pool?.token0);
  const token1 = normalizeAddress(pool?.token1);
  if (!poolKey || !token0 || !token1 || token0 === token1) return undefined;
  return { ...pool, poolKey, token0, token1 };
}

function mergeObservedPools(left, right) {
  const preferred = poolCompleteness(right) > poolCompleteness(left) ? right : left;
  const fallback = preferred === right ? left : right;
  return {
    ...fallback,
    ...preferred,
    providers: [...new Set([...(left.providers ?? []), ...(right.providers ?? [])])].sort(),
    firstSeenAt: oldestIso(left.firstSeenAt, right.firstSeenAt),
    observedAt: newestIso(left.observedAt, right.observedAt),
    confirmedAt: oldestIso(left.confirmedAt, right.confirmedAt)
  };
}

function mergePoolRecord(current, event, timestamp) {
  const wasConfirmed = current?.status === "confirmed";
  const status = event.provisional && !wasConfirmed ? "provisional" : "confirmed";
  return {
    ...current,
    poolKey: event.poolKey,
    poolAddress: event.poolAddress,
    poolId: event.poolId,
    chainId: BASE_CHAIN_ID,
    dexId: event.dexId,
    factoryId: event.factoryId,
    factoryAddress: event.factoryAddress,
    protocolVersion: event.protocolVersion,
    poolType: event.poolType,
    token0: event.token0,
    token1: event.token1,
    fee: event.fee,
    variant: event.variant,
    status,
    verifiedSource: true,
    provisional: status === "provisional",
    replay: Boolean(event.replay),
    firstSeenAt: current?.firstSeenAt ?? timestamp,
    confirmedAt: status === "confirmed" ? current?.confirmedAt ?? timestamp : undefined,
    observedAt: timestamp,
    blockTimestamp: event.blockTimestamp,
    blockNumber: event.blockNumber,
    blockHash: event.blockHash,
    transactionHash: event.transactionHash,
    logIndex: event.logIndex,
    orphaned: false,
    providers: [...new Set([...(current?.providers ?? []), "onchain"])]
  };
}

function orphanPool(state, poolKey, event, timestamp) {
  const pool = state.pools?.[poolKey];
  if (pool) state.pools[poolKey] = { ...pool, status: "orphaned", orphaned: true, provisional: false, orphanedAt: timestamp };
  if (state.events?.[event.idempotencyKey]) state.events[event.idempotencyKey] = { ...state.events[event.idempotencyKey], status: "orphaned", orphanedAt: timestamp };
  state.counters.reorgCount += 1;
  state.reconciliation.push({ kind: "orphaned", at: timestamp, poolKey, eventId: event.idempotencyKey, blockNumber: event.blockNumber });
}

function opportunityTokens(pool) {
  const tokens = [pool.token0, pool.token1];
  const nonAnchors = tokens.filter((token) => !TRUSTED_ANCHORS.has(token));
  if (nonAnchors.length) return nonAnchors;
  if (tokens.includes(BASE_USDC)) return tokens.filter((token) => token !== BASE_USDC && token !== NATIVE_CURRENCY);
  if (tokens.includes(BASE_WETH)) return tokens.filter((token) => token !== BASE_WETH && token !== NATIVE_CURRENCY);
  return tokens.filter((token) => token !== NATIVE_CURRENCY).slice(0, 1);
}

function validatePricingPool(pool, nowMs, maxAgeMs, minimumLiquidityUsd) {
  if (pool.status !== "confirmed" || pool.orphaned || !pool.verifiedSource) return "unverified_pool";
  if (pool.providerEnrichment?.status === "conflicting") return "conflicting_pool_identity";
  if (!Number.isFinite(pool.priceToken1PerToken0) || pool.priceToken1PerToken0 <= 0) return "invalid_price";
  if (!Number.isFinite(pool.liquidityUsd)) return "liquidity_unknown";
  if (pool.liquidityUsd === 0) return "zero_liquidity";
  if (pool.liquidityUsd < minimumLiquidityUsd) return "thin_liquidity";
  const observed = Date.parse(pool.observedAt ?? pool.confirmedAt ?? "");
  if (!Number.isFinite(observed)) return "invalid_timestamp";
  if (observed > nowMs + 5_000) return "future_timestamp";
  if (nowMs - observed > maxAgeMs) {
    const exactWethUsdcAnchor = pool.token0 === BASE_WETH && pool.token1 === BASE_USDC || pool.token0 === BASE_USDC && pool.token1 === BASE_WETH;
    return exactWethUsdcAnchor ? "stale_anchor" : "stale_pool";
  }
  return undefined;
}

function buildPriceGraph(pools) {
  const graph = new Map();
  for (const pool of pools) {
    const rate = pool.priceToken1PerToken0;
    const provenance = { poolKey: pool.poolKey, sourcePoolKeys: pool.sourcePoolKeys, observedAt: pool.observedAt ?? pool.confirmedAt, blockNumber: pool.blockNumber, liquidityUsd: pool.liquidityUsd };
    addEdge(graph, pool.token0, { to: pool.token1, from: pool.token0, rate, ...provenance });
    addEdge(graph, pool.token1, { to: pool.token0, from: pool.token1, rate: 1 / rate, ...provenance });
  }
  return graph;
}

function addEdge(graph, token, edge) {
  const edges = graph.get(token) ?? [];
  edges.push(edge);
  edges.sort((left, right) => right.liquidityUsd - left.liquidityUsd || left.poolKey.localeCompare(right.poolKey));
  graph.set(token, edges);
}

function comparePricePaths(left, right) {
  return left.length - right.length
    || Number(right[0]?.to === BASE_WETH) - Number(left[0]?.to === BASE_WETH)
    || Math.min(...right.map((edge) => edge.liquidityUsd)) - Math.min(...left.map((edge) => edge.liquidityUsd))
    || left.map((edge) => edge.poolKey).join(":").localeCompare(right.map((edge) => edge.poolKey).join(":"));
}

function priceTierRank(path) {
  if (path.length === 1) return 0;
  return path.length === 2 && path[0]?.to === BASE_WETH ? 1 : 2 + path.length;
}

function selectPriceConsensus(candidates) {
  const ordered = [...candidates].sort((left, right) => left.value - right.value || comparePricePaths(left.path, right.path));
  const median = ordered[Math.floor(ordered.length / 2)]?.value;
  let members = ordered.filter((candidate) => relativeDistance(candidate.value, median) <= 0.15);
  if (!members.length) members = [ordered.sort((left, right) => comparePricePaths(left.path, right.path))[0]];
  const rawWeights = members.map((candidate) => Math.sqrt(Math.max(1, Math.min(...candidate.path.map((edge) => edge.liquidityUsd)))));
  const orderedWeights = [...rawWeights].sort((left, right) => left - right);
  const medianWeight = orderedWeights[Math.floor(orderedWeights.length / 2)] || 1;
  const weights = rawWeights.map((weight) => Math.min(weight, medianWeight * 4));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const value = members.reduce((sum, candidate, index) => sum + candidate.value * weights[index], 0) / totalWeight;
  const representative = [...members].sort((left, right) => comparePricePaths(left.path, right.path))[0];
  const values = members.map((candidate) => candidate.value);
  return { value, members, representative, maximumDeviation: values.length > 1 ? Math.max(...values.map((item) => relativeDistance(item, value))) : 0 };
}

function unpriced(reasonCode) {
  return { tier: "UNPRICED", kind: "unpriced", sourcePoolKeys: [], freshness: "unavailable", reasonCode };
}

function primaryScore(pool, now) {
  const observed = Date.parse(pool.observedAt ?? pool.confirmedAt ?? "");
  const fresh = Number.isFinite(observed) && observed <= now.getTime() && now.getTime() - observed <= MAX_PRICE_AGE_MS;
  return (pool.status === "confirmed" && !pool.orphaned ? 100 : 0)
    + (pool.verifiedSource ? 40 : 0)
    + (fresh ? 30 : 0)
    + Math.log10(Math.max(1, pool.liquidityUsd ?? 0)) * 8
    + Math.log10(Math.max(1, pool.volume24hUsd ?? 0)) * 3
    + (pool.priceToken1PerToken0 ? 10 : 0)
    + (pool.token0 === BASE_USDC || pool.token1 === BASE_USDC ? 12 : pool.token0 === BASE_WETH || pool.token1 === BASE_WETH ? 8 : 0)
    + poolCompleteness(pool);
}

function aggregateVerifiedMetrics(pools) {
  const windows = ["m5", "h1", "h6", "h24"];
  const knownLiquidity = pools.map((pool) => pool.liquidityUsd).filter((value) => Number.isFinite(value) && value >= 0);
  const volumes = Object.fromEntries(windows.flatMap((window) => {
    const values = pools.map((pool) => window === "h24" ? pool.volumes?.h24 ?? pool.volume24hUsd : pool.volumes?.[window]);
    const total = knownSum(values);
    return total === undefined ? [] : [[window, total]];
  }));
  const transactionRowsByWindow = Object.fromEntries(windows.map((window) => [window, pools.map((pool) => pool.transactions?.[window]).filter((value) => Number.isFinite(value?.buys) && value.buys >= 0 && Number.isFinite(value?.sells) && value.sells >= 0)]));
  const transactions = Object.fromEntries(windows.flatMap((window) => {
    const rows = transactionRowsByWindow[window];
    return rows.length ? [[window, rows.reduce((total, value) => ({ buys: total.buys + value.buys, sells: total.sells + value.sells }), { buys: 0, sells: 0 })]] : [];
  }));
  const volume24h = volumes.h24;
  const trades24h = transactions.h24 ? transactions.h24.buys + transactions.h24.sells : undefined;
  return {
    liquidityUsd: completeSum(pools, "liquidityUsd"),
    knownLiquidityUsd: knownLiquidity.length ? knownLiquidity.reduce((sum, value) => sum + value, 0) : undefined,
    liquidityKnownPoolCount: knownLiquidity.length,
    liquidityCoverageComplete: knownLiquidity.length === pools.length,
    volume24hUsd: volume24h,
    volumes,
    trades24h,
    transactions,
    volumeKnownPoolCount: pools.filter((pool) => Number.isFinite(pool.volume24hUsd) && pool.volume24hUsd >= 0).length,
    transactionsKnownPoolCount: transactionRowsByWindow.h24.length,
    contributingPoolCount: pools.length
  };
}

function knownSum(values) {
  const known = values.filter((value) => Number.isFinite(value) && value >= 0);
  return known.length ? known.reduce((sum, value) => sum + value, 0) : undefined;
}

function completeSum(pools, key) {
  const values = pools.map((pool) => pool[key]);
  return values.length && values.every((value) => Number.isFinite(value) && value >= 0) ? values.reduce((sum, value) => sum + value, 0) : undefined;
}

function opportunityRank(opportunity) {
  const band = opportunity.qualityBand === "RANKED" ? 800 : opportunity.qualityBand === "EMERGING" ? 600 : opportunity.qualityBand === "DETECTED" ? 200 : 0;
  const tier = opportunity.canonicalPrice.tier === "A" ? 90 : opportunity.canonicalPrice.tier === "B" ? 70 : opportunity.canonicalPrice.tier === "C" ? 50 : 0;
  return band + tier + Math.log10(Math.max(1, opportunity.bestLiquidityUsd ?? 0)) * 10;
}

function isUsableRankedPool(pool, now) {
  const observed = Date.parse(pool.observedAt ?? pool.confirmedAt ?? "");
  return pool.status === "confirmed" && !pool.orphaned && pool.verifiedSource && pool.providerEnrichment?.status !== "conflicting"
    && Number.isFinite(pool.liquidityUsd) && pool.liquidityUsd >= MARKET_QUALITY_THRESHOLDS.rankingMinimumLiquidityUsd
    && Number.isFinite(pool.priceToken1PerToken0) && pool.priceToken1PerToken0 > 0
    && Number.isFinite(observed) && observed <= now.getTime() + 5_000 && now.getTime() - observed <= MAX_PRICE_AGE_MS;
}

function poolCompleteness(pool) {
  return [pool.token0, pool.token1, pool.observedAt, pool.liquidityUsd, pool.volume24hUsd, pool.priceToken1PerToken0].filter((value) => value !== undefined).length;
}

function safeTokenLabel(value, address) {
  if (typeof value === "string") {
    const clean = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 64);
    if (clean) return clean;
  }
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function parseHexNumber(value) {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) return undefined;
  const number = Number.parseInt(value, 16);
  return Number.isSafeInteger(number) ? number : undefined;
}

function signedWord(value, bits) {
  const number = parseHexNumber(value);
  if (number === undefined) return undefined;
  const maximum = 2 ** bits;
  return number >= maximum / 2 ? number - maximum : number;
}

function addressFromWord(value) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/i.test(value)) return undefined;
  return normalizeAddress(`0x${value.slice(-40)}`);
}

function addressFromData(data, wordIndex) {
  if (typeof data !== "string" || !/^0x[0-9a-f]*$/i.test(data)) return undefined;
  const start = 2 + wordIndex * 64;
  return addressFromWord(`0x${data.slice(start, start + 64)}`);
}

function normalizeAddress(value) {
  if (typeof value !== "string") return undefined;
  const normalized = value.toLowerCase();
  return EVM_ADDRESS.test(normalized) ? normalized : undefined;
}

function relativeDistance(value, reference) { return Number.isFinite(value) && Number.isFinite(reference) && reference > 0 ? Math.abs(value / reference - 1) : Number.POSITIVE_INFINITY; }
function canonicalRawValue(value) { return Number.isFinite(value) && value > 0 ? value.toPrecision(15) : undefined; }

function normalizeHash(value) {
  if (typeof value !== "string") return undefined;
  const normalized = value.toLowerCase();
  return HASH.test(normalized) ? normalized : undefined;
}

function oldestIso(left, right) {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(left) <= Date.parse(right) ? left : right;
}

function newestIso(left, right) {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(left) >= Date.parse(right) ? left : right;
}
