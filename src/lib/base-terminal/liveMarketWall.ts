import type { MarketTerminalSnapshot } from "@/data/providers";
import { NEW_POOL_MAX_AGE_MINUTES, orientPairToOpportunity, type TokenOpportunity } from "@/lib/base-terminal/opportunityModel";
import type { BasePair, PairTxnWindow } from "@/types/baseTerminal";
import { MARKET_QUALITY_THRESHOLDS } from "../../../collector/market-quality.mjs";

export type LiveWallTimeframe = "m5" | "h1" | "h24";
export type LiveWallLaneId = "new" | "gainers" | "losers" | "volume" | "liquidity" | "traded";
export type LiquidityDirection = "all" | "added" | "removed";

export type LiveWallMetric = {
  kind: "age" | "change" | "volume_inflow" | "volume_leader" | "liquidity_added" | "liquidity_removed" | "liquidity_leader" | "trades";
  current: number;
  previous?: number;
  delta?: number;
  ratio?: number;
  window: LiveWallTimeframe | "snapshot";
};

export type LiveWallEntry = {
  opportunity: TokenOpportunity;
  pair: BasePair;
  metric: LiveWallMetric;
  strength: number;
};

export type LiveWallLane = {
  id: LiveWallLaneId;
  entries: LiveWallEntry[];
  eligibleCount: number;
  rejectedCount: number;
  rejectionReasons: Record<string, number>;
  fallback: boolean;
  baselinePending: boolean;
  freshness: "fresh" | "delayed" | "static";
  timeframe: LiveWallTimeframe | "age" | "snapshot";
};

export type LiveMarketWall = {
  lanes: LiveWallLane[];
  visibleOpportunityCount: number;
  duplicateCount: number;
  timeframe: LiveWallTimeframe;
  comparisonWindowSeconds?: number;
};

type Candidate = Omit<LiveWallEntry, "strength">;
type MarketRow = { opportunity: TokenOpportunity; pair: BasePair };

const LANE_ORDER: LiveWallLaneId[] = ["new", "gainers", "losers", "volume", "liquidity", "traded"];
const MOCK_LANE_MINIMUM_LIQUIDITY_USD = 10_000;
const MINIMUM_LIQUIDITY_DELTA_USD = 1_000;
const MINIMUM_VOLUME_USD: Record<LiveWallTimeframe, number> = { m5: 1_000, h1: 5_000, h24: 10_000 };
const MINIMUM_TRADES: Record<LiveWallTimeframe, number> = { m5: 3, h1: 10, h24: 20 };

export function buildLiveMarketWall(
  snapshot: MarketTerminalSnapshot,
  {
    timeframe = "h24",
    allowCrossLaneRepeats = false,
    liquidityDirection = "all",
    limit = 4,
    now = new Date(snapshot.generatedAt === "mock-static" ? Date.now() : snapshot.generatedAt)
  }: {
    timeframe?: LiveWallTimeframe;
    allowCrossLaneRepeats?: boolean;
    liquidityDirection?: LiquidityDirection;
    limit?: number;
    now?: Date;
  } = {}
): LiveMarketWall {
  const mockMode = snapshot.mode === "mock";
  const nowMs = now.getTime();
  const currentGeneratedAt = Date.parse(snapshot.generatedAt);
  const previousGeneratedAt = snapshot.comparison.previousGeneratedAt ? Date.parse(snapshot.comparison.previousGeneratedAt) : Number.NaN;
  const comparisonReady = snapshot.comparison.status === "ready"
    && Number.isFinite(currentGeneratedAt)
    && Number.isFinite(previousGeneratedAt)
    && previousGeneratedAt < currentGeneratedAt;
  const comparisonWindowSeconds = comparisonReady ? Math.max(1, Math.round((currentGeneratedAt - previousGeneratedAt) / 1_000)) : undefined;
  const previousMetrics = snapshot.comparison.opportunityMetrics ?? {};
  const rows = snapshot.opportunities.flatMap((opportunity) => {
    if (opportunity.quality === "expired" || opportunity.qualityBand === "REJECTED") return [];
    const primary = snapshot.allPairs.find((pair) => pair.id === opportunity.primaryMarketId);
    return primary ? [{ opportunity, pair: orientPairToOpportunity(primary, opportunity) }] : [];
  });

  const newCandidates = rows.flatMap(({ opportunity, pair }): Candidate[] => {
    const createdAt = opportunity.newestPoolCreatedAt ? Date.parse(opportunity.newestPoolCreatedAt) : Number.NaN;
    const ageMinutes = Number.isFinite(createdAt) ? (nowMs - createdAt) / 60_000 : Number.NaN;
    if (!Number.isFinite(ageMinutes) || ageMinutes < 0 || ageMinutes > NEW_POOL_MAX_AGE_MINUTES) return [];
    return [{ opportunity, pair, metric: { kind: "age", current: ageMinutes, window: "snapshot" } }];
  }).sort((left, right) => left.metric.current - right.metric.current || compareMarketQuality(left, right));

  // Discovery visibility is intentionally independent from canonical execution
  // proof. Exact provider changes may rank a market while Trade remains gated.
  const directionalRows = rows.filter(({ opportunity, pair }) => (mockMode ? isFreshMockSample(opportunity, pair) : isFreshExactProviderMarket(opportunity, pair))
    && finite(opportunity.aggregate.liquidityUsd)
    && opportunity.aggregate.liquidityUsd! >= (mockMode ? MOCK_LANE_MINIMUM_LIQUIDITY_USD : MARKET_QUALITY_THRESHOLDS.gainersLosersMinimumLiquidityUsd));
  const gainers = directionalRows.flatMap(({ opportunity, pair }): Candidate[] => {
    const change = readFinite(pair.priceChanges?.h24);
    return change !== undefined && change > 0 ? [{ opportunity, pair, metric: { kind: "change", current: change, window: "h24" } }] : [];
  }).sort((left, right) => right.metric.current - left.metric.current || compareMarketQuality(left, right));
  const losers = directionalRows.flatMap(({ opportunity, pair }): Candidate[] => {
    const change = readFinite(pair.priceChanges?.h24);
    return change !== undefined && change < 0 ? [{ opportunity, pair, metric: { kind: "change", current: change, window: "h24" } }] : [];
  }).sort((left, right) => left.metric.current - right.metric.current || compareMarketQuality(left, right));

  const inflowCandidates = comparisonReady ? rows.flatMap(({ opportunity, pair }): Candidate[] => {
    if (mockMode
      ? !isFreshMockSample(opportunity, pair) || (opportunity.aggregate.liquidityUsd ?? 0) < MOCK_LANE_MINIMUM_LIQUIDITY_USD
      : !isFreshDiscoveryMarket(opportunity, pair) || (opportunity.bestLiquidityUsd ?? 0) < MARKET_QUALITY_THRESHOLDS.volumeMinimumLiquidityUsd) return [];
    const current = readFiniteNonNegative(opportunity.aggregate.volumes?.[timeframe]);
    const previous = readFiniteNonNegative(previousMetrics[opportunity.id]?.volumes?.[timeframe]);
    if (current === undefined || previous === undefined || previous <= 0 || current <= previous || current < MINIMUM_VOLUME_USD[timeframe]) return [];
    return [{ opportunity, pair, metric: { kind: "volume_inflow", current, previous, delta: current - previous, ratio: current / previous, window: timeframe } }];
  }).sort((left, right) => (right.metric.ratio! - left.metric.ratio!) || (right.metric.delta! - left.metric.delta!) || compareMarketQuality(left, right)) : [];
  const volumeLeaders = rows.flatMap(({ opportunity, pair }): Candidate[] => {
    if (mockMode
      ? !isFreshMockSample(opportunity, pair) || (opportunity.aggregate.liquidityUsd ?? 0) < MOCK_LANE_MINIMUM_LIQUIDITY_USD
      : !isFreshDiscoveryMarket(opportunity, pair) || (opportunity.bestLiquidityUsd ?? 0) < MARKET_QUALITY_THRESHOLDS.volumeMinimumLiquidityUsd) return [];
    const current = readFiniteNonNegative(opportunity.aggregate.volumes?.[timeframe]);
    return current !== undefined && current >= MINIMUM_VOLUME_USD[timeframe]
      ? [{ opportunity, pair, metric: { kind: "volume_leader", current, window: timeframe } }]
      : [];
  }).sort((left, right) => right.metric.current - left.metric.current || compareMarketQuality(left, right));
  const volumeFallback = inflowCandidates.length === 0;

  const liquidityCandidates = comparisonReady ? rows.flatMap(({ opportunity, pair }): Candidate[] => {
    if (mockMode ? !isFreshMockSample(opportunity, pair) : !isFreshDiscoveryMarket(opportunity, pair)) return [];
    const current = readFiniteNonNegative(opportunity.aggregate.liquidityUsd);
    const previous = readFiniteNonNegative(previousMetrics[opportunity.id]?.liquidityUsd);
    if (current === undefined || previous === undefined || previous < MARKET_QUALITY_THRESHOLDS.liquidityLaneMinimumLiquidityUsd) return [];
    const delta = current - previous;
    if (Math.abs(delta) < MINIMUM_LIQUIDITY_DELTA_USD) return [];
    if (liquidityDirection === "added" && delta <= 0) return [];
    if (liquidityDirection === "removed" && delta >= 0) return [];
    return [{ opportunity, pair, metric: { kind: delta > 0 ? "liquidity_added" : "liquidity_removed", current, previous, delta, ratio: delta / previous, window: "snapshot" } }];
  }).sort((left, right) => Math.abs(right.metric.delta!) - Math.abs(left.metric.delta!) || Math.abs(right.metric.ratio!) - Math.abs(left.metric.ratio!) || compareMarketQuality(left, right)) : [];
  const liquidityLeaders = rows.flatMap(({ opportunity, pair }): Candidate[] => {
    if (mockMode ? !isFreshMockSample(opportunity, pair) : !isFreshDiscoveryMarket(opportunity, pair)) return [];
    const current = readFiniteNonNegative(opportunity.aggregate.liquidityUsd);
    if (current === undefined || current < (mockMode ? MOCK_LANE_MINIMUM_LIQUIDITY_USD : MARKET_QUALITY_THRESHOLDS.liquidityLaneMinimumLiquidityUsd)) return [];
    return [{ opportunity, pair, metric: { kind: "liquidity_leader", current, window: "snapshot" } }];
  }).sort((left, right) => right.metric.current - left.metric.current || compareMarketQuality(left, right));
  const liquidityFallback = liquidityCandidates.length === 0;

  const tradedCandidates = rows.flatMap(({ opportunity, pair }): Candidate[] => {
    if (mockMode
      ? !isFreshMockSample(opportunity, pair)
      : !isFreshDiscoveryMarket(opportunity, pair) || (opportunity.bestLiquidityUsd ?? 0) < MARKET_QUALITY_THRESHOLDS.mostTradedMinimumLiquidityUsd) return [];
    const transactions = opportunity.aggregate.transactions?.[timeframe];
    const count = readTransactionCount(transactions);
    if (count === undefined || count < MINIMUM_TRADES[timeframe]) return [];
    return [{ opportunity, pair, metric: { kind: "trades", current: count, window: timeframe } }];
  }).sort((left, right) => right.metric.current - left.metric.current || compareMarketQuality(left, right));

  const candidates: Record<LiveWallLaneId, Candidate[]> = {
    new: newCandidates,
    gainers,
    losers,
    volume: volumeFallback ? volumeLeaders : inflowCandidates,
    liquidity: liquidityFallback ? liquidityLeaders : liquidityCandidates,
    traded: tradedCandidates
  };
  const allocated = allocateByStrength(candidates, Math.max(1, Math.min(12, limit)), allowCrossLaneRepeats);
  const laneStatus = snapshot.freshness;
  const lanes = LANE_ORDER.map((id): LiveWallLane => ({
    id,
    entries: allocated[id],
    eligibleCount: candidates[id].length,
    rejectedCount: (snapshot.visibilityFunnel?.totalOpportunityCount ?? snapshot.opportunities.length) - candidates[id].length,
    rejectionReasons: buildRejectionReasons({ snapshot, rows, candidates: candidates[id], lane: id, timeframe, comparisonReady, volumeFallback, liquidityFallback, liquidityDirection, mockMode, nowMs, previousMetrics }),
    fallback: (id === "volume" && volumeFallback) || (id === "liquidity" && liquidityFallback),
    baselinePending: (id === "volume" || id === "liquidity") && !comparisonReady,
    freshness: laneStatus,
    timeframe: id === "new" ? "age" : id === "gainers" || id === "losers" ? "h24" : id === "liquidity" ? "snapshot" : timeframe
  }));
  const visibleIds = lanes.flatMap((lane) => lane.entries.map((entry) => entry.opportunity.id));
  return {
    lanes,
    visibleOpportunityCount: new Set(visibleIds).size,
    duplicateCount: visibleIds.length - new Set(visibleIds).size,
    timeframe,
    comparisonWindowSeconds
  };
}

function allocateByStrength(candidates: Record<LiveWallLaneId, Candidate[]>, limit: number, repeats: boolean) {
  const ranked = Object.fromEntries(LANE_ORDER.map((lane) => [lane, candidates[lane].map((candidate, index, all) => ({
    ...candidate,
    strength: all.length <= 1 ? 1 : 1 - index / (all.length - 1)
  }))])) as Record<LiveWallLaneId, LiveWallEntry[]>;
  const summaryLimit = Math.min(4, limit);

  const strongest = new Map<string, { lane: LiveWallLaneId; strength: number; tie: number }>();
  for (const lane of LANE_ORDER) {
    for (const entry of ranked[lane]) {
      const current = strongest.get(entry.opportunity.id);
      const tie = deterministicLaneTie(entry.opportunity.id, lane);
      if (!current || entry.strength > current.strength || (entry.strength === current.strength && tie > current.tie)) {
        strongest.set(entry.opportunity.id, { lane, strength: entry.strength, tie });
      }
    }
  }

  const result = Object.fromEntries(LANE_ORDER.map((lane) => [lane, [] as LiveWallEntry[]])) as Record<LiveWallLaneId, LiveWallEntry[]>;
  const useCounts = new Map<string, number>();
  const add = (lane: LiveWallLaneId, entry: LiveWallEntry) => {
    result[lane].push(entry);
    useCounts.set(entry.opportunity.id, (useCounts.get(entry.opportunity.id) ?? 0) + 1);
  };
  const used = new Set<string>();
  for (const lane of LANE_ORDER) {
    for (const entry of ranked[lane]) {
      if (result[lane].length >= summaryLimit) break;
      if (strongest.get(entry.opportunity.id)?.lane !== lane || used.has(entry.opportunity.id)) continue;
      add(lane, entry);
      used.add(entry.opportunity.id);
    }
  }
  for (const lane of LANE_ORDER) {
    for (const entry of ranked[lane]) {
      if (result[lane].length >= summaryLimit) break;
      if (used.has(entry.opportunity.id)) continue;
      add(lane, entry);
      used.add(entry.opportunity.id);
    }
  }
  // Every lane with real candidates gets its own evidence rows. Repeats are a
  // bounded fallback only and never exceed two lanes per opportunity.
  for (const lane of LANE_ORDER) {
    for (const entry of ranked[lane]) {
      if (result[lane].length >= summaryLimit) break;
      if ((useCounts.get(entry.opportunity.id) ?? 0) >= 2 || result[lane].some((item) => item.opportunity.id === entry.opportunity.id)) continue;
      add(lane, entry);
    }
  }
  if (limit > summaryLimit) {
    let added = true;
    while (added) {
      added = false;
      for (const lane of LANE_ORDER) {
        if (result[lane].length >= limit) continue;
        const next = ranked[lane].find((entry) => !result[lane].some((item) => item.opportunity.id === entry.opportunity.id) && (repeats || !used.has(entry.opportunity.id) || (useCounts.get(entry.opportunity.id) ?? 0) < 2));
        if (!next) continue;
        add(lane, next);
        used.add(next.opportunity.id);
        added = true;
      }
    }
  }
  return result;
}

function deterministicLaneTie(opportunityId: string, lane: LiveWallLaneId) {
  let hash = 2_166_136_261;
  for (const character of `${opportunityId}:${lane}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function isFreshDiscoveryMarket(opportunity: TokenOpportunity, pair: BasePair) {
  return opportunity.quality === "active" && !pair.stale;
}

function isFreshExactProviderMarket(opportunity: TokenOpportunity, pair: BasePair) {
  const providers = pair.dataProviders ?? [pair.dataSource];
  return isFreshDiscoveryMarket(opportunity, pair) && providers.some((provider) => provider === "dexscreener" || provider === "geckoterminal");
}

function isFreshMockSample(opportunity: TokenOpportunity, pair: BasePair) {
  return opportunity.quality === "active" && !pair.stale;
}

function readTransactionCount(value: PairTxnWindow | undefined) {
  if (!value || readFiniteNonNegative(value.buys) === undefined || readFiniteNonNegative(value.sells) === undefined) return undefined;
  return value.buys + value.sells;
}

function compareMarketQuality(left: Candidate, right: Candidate) {
  return (right.opportunity.aggregate.liquidityUsd ?? -1) - (left.opportunity.aggregate.liquidityUsd ?? -1)
    || (right.opportunity.aggregate.volumes?.h24 ?? -1) - (left.opportunity.aggregate.volumes?.h24 ?? -1)
    || left.opportunity.id.localeCompare(right.opportunity.id);
}

function readFiniteNonNegative(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function readFinite(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function finite(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function buildRejectionReasons({ snapshot, rows, candidates, lane, timeframe, comparisonReady, volumeFallback, liquidityFallback, liquidityDirection, mockMode, nowMs, previousMetrics }: {
  snapshot: MarketTerminalSnapshot;
  rows: MarketRow[];
  candidates: Candidate[];
  lane: LiveWallLaneId;
  timeframe: LiveWallTimeframe;
  comparisonReady: boolean;
  volumeFallback: boolean;
  liquidityFallback: boolean;
  liquidityDirection: LiquidityDirection;
  mockMode: boolean;
  nowMs: number;
  previousMetrics: NonNullable<MarketTerminalSnapshot["comparison"]["opportunityMetrics"]>;
}) {
  const counts: Record<string, number> = {};
  const increment = (reason: string) => { counts[reason] = (counts[reason] ?? 0) + 1; };
  for (const [reason, count] of Object.entries(snapshot.visibilityFunnel?.excludedReasons ?? {})) counts[reason] = count;
  const candidateIds = new Set(candidates.map((candidate) => candidate.opportunity.id));
  const rowById = new Map(rows.map((row) => [row.opportunity.id, row]));
  for (const opportunity of snapshot.opportunities) {
    if (candidateIds.has(opportunity.id)) continue;
    if (opportunity.quality === "expired") { increment("quality_expired"); continue; }
    if (opportunity.qualityBand === "REJECTED") { increment("quality_rejected"); continue; }
    const row = rowById.get(opportunity.id);
    if (!row) { increment("primary_market_missing"); continue; }
    increment(explainLaneRejection(row, { lane, timeframe, comparisonReady, volumeFallback, liquidityFallback, liquidityDirection, mockMode, nowMs, previousMetrics }));
  }
  return counts;
}

function explainLaneRejection({ opportunity, pair }: MarketRow, { lane, timeframe, comparisonReady, volumeFallback, liquidityFallback, liquidityDirection, mockMode, nowMs, previousMetrics }: {
  lane: LiveWallLaneId;
  timeframe: LiveWallTimeframe;
  comparisonReady: boolean;
  volumeFallback: boolean;
  liquidityFallback: boolean;
  liquidityDirection: LiquidityDirection;
  mockMode: boolean;
  nowMs: number;
  previousMetrics: NonNullable<MarketTerminalSnapshot["comparison"]["opportunityMetrics"]>;
}) {
  if (lane === "new") {
    const createdAt = opportunity.newestPoolCreatedAt ? Date.parse(opportunity.newestPoolCreatedAt) : Number.NaN;
    if (!Number.isFinite(createdAt)) return "creation_time_missing";
    if (createdAt > nowMs) return "creation_time_future";
    return "older_than_7d";
  }
  const sourceReason = marketDataRejection(opportunity, pair, mockMode, lane === "gainers" || lane === "losers");
  if (sourceReason) return sourceReason;
  if (lane === "gainers" || lane === "losers") {
    const liquidity = readFiniteNonNegative(opportunity.aggregate.liquidityUsd);
    if (liquidity === undefined) return "liquidity_missing";
    if (liquidity < (mockMode ? MOCK_LANE_MINIMUM_LIQUIDITY_USD : MARKET_QUALITY_THRESHOLDS.gainersLosersMinimumLiquidityUsd)) return "liquidity_below_threshold";
    const change = readFinite(pair.priceChanges?.h24);
    if (change === undefined) return "provider_change_24h_missing";
    if (change === 0) return "provider_change_24h_zero";
    return lane === "gainers" ? "provider_change_not_positive" : "provider_change_not_negative";
  }
  if (lane === "volume") {
    const liquidity = readFiniteNonNegative(opportunity.bestLiquidityUsd);
    if (liquidity === undefined) return "liquidity_missing";
    if (liquidity < (mockMode ? MOCK_LANE_MINIMUM_LIQUIDITY_USD : MARKET_QUALITY_THRESHOLDS.volumeMinimumLiquidityUsd)) return "liquidity_below_threshold";
    const current = readFiniteNonNegative(opportunity.aggregate.volumes?.[timeframe]);
    if (current === undefined) return "volume_missing";
    if (current < MINIMUM_VOLUME_USD[timeframe]) return "volume_below_threshold";
    if (volumeFallback || !comparisonReady) return "fallback_metric_not_eligible";
    const previous = readFiniteNonNegative(previousMetrics[opportunity.id]?.volumes?.[timeframe]);
    if (previous === undefined) return "volume_baseline_missing";
    if (previous <= 0) return "volume_baseline_nonpositive";
    return current <= previous ? "volume_not_inflow" : "volume_inflow_not_eligible";
  }
  if (lane === "liquidity") {
    const current = readFiniteNonNegative(opportunity.aggregate.liquidityUsd);
    if (current === undefined) return "liquidity_missing";
    if (current < (mockMode ? MOCK_LANE_MINIMUM_LIQUIDITY_USD : MARKET_QUALITY_THRESHOLDS.liquidityLaneMinimumLiquidityUsd)) return "liquidity_below_threshold";
    if (liquidityFallback || !comparisonReady) return "fallback_metric_not_eligible";
    const previous = readFiniteNonNegative(previousMetrics[opportunity.id]?.liquidityUsd);
    if (previous === undefined) return "liquidity_baseline_missing";
    if (previous < MARKET_QUALITY_THRESHOLDS.liquidityLaneMinimumLiquidityUsd) return "liquidity_baseline_below_threshold";
    const delta = current - previous;
    if (Math.abs(delta) < MINIMUM_LIQUIDITY_DELTA_USD) return "liquidity_delta_below_threshold";
    if (liquidityDirection === "added" && delta <= 0) return "liquidity_direction_not_added";
    if (liquidityDirection === "removed" && delta >= 0) return "liquidity_direction_not_removed";
    return "liquidity_delta_not_eligible";
  }
  const transactions = opportunity.aggregate.transactions?.[timeframe];
  const count = readTransactionCount(transactions);
  if (count === undefined) return "transaction_count_missing";
  return "transaction_count_below_threshold";
}

function marketDataRejection(opportunity: TokenOpportunity, pair: BasePair, mockMode: boolean, exactProviderRequired: boolean) {
  if (opportunity.quality !== "active") return "opportunity_not_active";
  if (pair.stale) return "primary_market_stale";
  if (!mockMode && exactProviderRequired && !(pair.dataProviders ?? [pair.dataSource]).some((provider) => provider === "dexscreener" || provider === "geckoterminal")) return "exact_provider_evidence_missing";
  return undefined;
}
