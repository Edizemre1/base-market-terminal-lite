import type { MarketTerminalSnapshot } from "@/data/providers";
import { NEW_POOL_MAX_AGE_MINUTES, orientPairToOpportunity, type TokenOpportunity } from "@/lib/base-terminal/opportunityModel";
import type { BasePair, PairTxnWindow } from "@/types/baseTerminal";
import { MARKET_QUALITY_THRESHOLDS } from "../../../collector/market-quality.mjs";

export type LiveWallTimeframe = "m5" | "h1" | "h24";
export type LiveWallLaneId = "new" | "gainers" | "losers" | "volume" | "liquidity" | "traded";
export type LiquidityDirection = "all" | "added" | "removed";

export type LiveWallMetric = {
  kind: "age" | "change" | "volume_inflow" | "volume_leader" | "liquidity_added" | "liquidity_removed" | "trades";
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

const LANE_ORDER: LiveWallLaneId[] = ["new", "gainers", "losers", "volume", "liquidity", "traded"];
const MINIMUM_LIQUIDITY_DELTA_USD = 1_000;
const MINIMUM_VOLUME_USD: Record<LiveWallTimeframe, number> = { m5: 1_000, h1: 5_000, h24: 10_000 };
const MINIMUM_TRADES: Record<LiveWallTimeframe, number> = { m5: 3, h1: 10, h24: 20 };

export function buildLiveMarketWall(
  snapshot: MarketTerminalSnapshot,
  {
    timeframe = "h1",
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
    if (opportunity.qualityBand !== "RANKED" && opportunity.qualityBand !== "EMERGING") return [];
    const createdAt = opportunity.newestPoolCreatedAt ? Date.parse(opportunity.newestPoolCreatedAt) : Number.NaN;
    const ageMinutes = Number.isFinite(createdAt) ? (nowMs - createdAt) / 60_000 : Number.NaN;
    if (!Number.isFinite(ageMinutes) || ageMinutes < 0 || ageMinutes > NEW_POOL_MAX_AGE_MINUTES) return [];
    return [{ opportunity, pair, metric: { kind: "age", current: ageMinutes, window: "snapshot" } }];
  }).sort((left, right) => left.metric.current - right.metric.current || compareMarketQuality(left, right));

  const directionalRows = comparisonReady ? rows.filter(({ opportunity, pair }) => isFreshRanked(opportunity, pair)
    && finite(opportunity.bestLiquidityUsd)
    && opportunity.bestLiquidityUsd! >= MARKET_QUALITY_THRESHOLDS.gainersLosersMinimumLiquidityUsd
    && readPositive(opportunity.canonicalPrice.value) !== undefined
    && readPositive(previousMetrics[opportunity.id]?.canonicalPriceUsd) !== undefined) : [];
  const gainers = directionalRows.flatMap(({ opportunity, pair }): Candidate[] => {
    const current = opportunity.canonicalPrice.value!;
    const previous = previousMetrics[opportunity.id]!.canonicalPriceUsd!;
    const change = (current / previous - 1) * 100;
    return change > 0 ? [{ opportunity, pair, metric: { kind: "change", current: change, previous, delta: current - previous, ratio: current / previous, window: "snapshot" } }] : [];
  }).sort((left, right) => right.metric.current - left.metric.current || compareMarketQuality(left, right));
  const losers = directionalRows.flatMap(({ opportunity, pair }): Candidate[] => {
    const current = opportunity.canonicalPrice.value!;
    const previous = previousMetrics[opportunity.id]!.canonicalPriceUsd!;
    const change = (current / previous - 1) * 100;
    return change < 0 ? [{ opportunity, pair, metric: { kind: "change", current: change, previous, delta: current - previous, ratio: current / previous, window: "snapshot" } }] : [];
  }).sort((left, right) => left.metric.current - right.metric.current || compareMarketQuality(left, right));

  const inflowCandidates = comparisonReady ? rows.flatMap(({ opportunity, pair }): Candidate[] => {
    if (!isFreshRanked(opportunity, pair) || (opportunity.bestLiquidityUsd ?? 0) < MARKET_QUALITY_THRESHOLDS.volumeMinimumLiquidityUsd) return [];
    const current = readFiniteNonNegative(opportunity.aggregate.volumes?.[timeframe]);
    const previous = readFiniteNonNegative(previousMetrics[opportunity.id]?.volumes?.[timeframe]);
    if (current === undefined || previous === undefined || previous <= 0 || current <= previous || current < MINIMUM_VOLUME_USD[timeframe]) return [];
    return [{ opportunity, pair, metric: { kind: "volume_inflow", current, previous, delta: current - previous, ratio: current / previous, window: timeframe } }];
  }).sort((left, right) => (right.metric.ratio! - left.metric.ratio!) || (right.metric.delta! - left.metric.delta!) || compareMarketQuality(left, right)) : [];
  const volumeLeaders = rows.flatMap(({ opportunity, pair }): Candidate[] => {
    if (!isFreshRanked(opportunity, pair) || (opportunity.bestLiquidityUsd ?? 0) < MARKET_QUALITY_THRESHOLDS.volumeMinimumLiquidityUsd) return [];
    const current = readFiniteNonNegative(opportunity.aggregate.volumes?.[timeframe]);
    return current !== undefined && current >= MINIMUM_VOLUME_USD[timeframe]
      ? [{ opportunity, pair, metric: { kind: "volume_leader", current, window: timeframe } }]
      : [];
  }).sort((left, right) => right.metric.current - left.metric.current || compareMarketQuality(left, right));
  const volumeFallback = inflowCandidates.length === 0;

  const liquidityCandidates = comparisonReady ? rows.flatMap(({ opportunity, pair }): Candidate[] => {
    if (!isFreshRanked(opportunity, pair)) return [];
    const current = readFiniteNonNegative(opportunity.aggregate.liquidityUsd);
    const previous = readFiniteNonNegative(previousMetrics[opportunity.id]?.liquidityUsd);
    if (current === undefined || previous === undefined || previous < MARKET_QUALITY_THRESHOLDS.liquidityLaneMinimumLiquidityUsd) return [];
    const delta = current - previous;
    if (Math.abs(delta) < MINIMUM_LIQUIDITY_DELTA_USD) return [];
    if (liquidityDirection === "added" && delta <= 0) return [];
    if (liquidityDirection === "removed" && delta >= 0) return [];
    return [{ opportunity, pair, metric: { kind: delta > 0 ? "liquidity_added" : "liquidity_removed", current, previous, delta, ratio: delta / previous, window: "snapshot" } }];
  }).sort((left, right) => Math.abs(right.metric.delta!) - Math.abs(left.metric.delta!) || Math.abs(right.metric.ratio!) - Math.abs(left.metric.ratio!) || compareMarketQuality(left, right)) : [];

  const tradedCandidates = rows.flatMap(({ opportunity, pair }): Candidate[] => {
    if (!isFreshRanked(opportunity, pair) || (opportunity.bestLiquidityUsd ?? 0) < MARKET_QUALITY_THRESHOLDS.mostTradedMinimumLiquidityUsd) return [];
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
    liquidity: liquidityCandidates,
    traded: tradedCandidates
  };
  const allocated = allocateByStrength(candidates, Math.max(1, Math.min(4, limit)), allowCrossLaneRepeats);
  const laneStatus = snapshot.freshness;
  const lanes = LANE_ORDER.map((id): LiveWallLane => ({
    id,
    entries: allocated[id],
    eligibleCount: candidates[id].length,
    fallback: id === "volume" && volumeFallback,
    baselinePending: (id === "volume" || id === "liquidity") && !comparisonReady,
    freshness: laneStatus,
    timeframe: id === "new" ? "age" : id === "liquidity" || id === "gainers" || id === "losers" ? "snapshot" : timeframe
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
  if (repeats) return Object.fromEntries(LANE_ORDER.map((lane) => [lane, ranked[lane].slice(0, limit)])) as Record<LiveWallLaneId, LiveWallEntry[]>;

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
  const used = new Set<string>();
  for (const lane of LANE_ORDER) {
    for (const entry of ranked[lane]) {
      if (result[lane].length >= limit) break;
      if (strongest.get(entry.opportunity.id)?.lane !== lane || used.has(entry.opportunity.id)) continue;
      result[lane].push(entry);
      used.add(entry.opportunity.id);
    }
  }
  for (const lane of LANE_ORDER) {
    for (const entry of ranked[lane]) {
      if (result[lane].length >= limit) break;
      if (used.has(entry.opportunity.id)) continue;
      result[lane].push(entry);
      used.add(entry.opportunity.id);
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

function isFreshRanked(opportunity: TokenOpportunity, pair: BasePair) {
  return opportunity.quality === "active" && opportunity.qualityBand === "RANKED" && opportunity.canonicalPrice.tier !== "UNPRICED" && !pair.stale;
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

function readPositive(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function finite(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
