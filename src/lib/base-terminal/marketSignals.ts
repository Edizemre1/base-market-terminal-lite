import type { MarketTerminalSnapshot } from "@/data/providers";
import type { BasePair } from "@/types/baseTerminal";
import { getMovingNowScore } from "@/lib/base-terminal/terminalMarket";
import type { PoolMarket, TokenOpportunity } from "@/lib/base-terminal/opportunityModel";

export type MarketSignalType =
  | "just_launched"
  | "new_market"
  | "gaining_fast"
  | "breakout"
  | "volume_surge"
  | "high_volume"
  | "most_traded"
  | "deep_liquidity"
  | "moving_now"
  | "volatile"
  | "thin_liquidity"
  | "multi_pool"
  | "contract_verified"
  | "security_unknown"
  | "risk_flagged"
  | "delayed"
  | "incomplete_data";

export type MarketSignalTone = "info" | "positive" | "warning" | "critical" | "neutral";
export type MarketSignalState = "active" | "entering" | "cooldown";
export type MarketSignalIconKey =
  | "sparkles"
  | "clock"
  | "trending"
  | "rocket"
  | "activity"
  | "bars"
  | "flame"
  | "droplets"
  | "gauge"
  | "warning"
  | "layers"
  | "shield_check"
  | "shield_question"
  | "shield_alert"
  | "clock_alert"
  | "database_alert";

export type MarketSignalMetric = {
  value: number;
  unit: "percent" | "usd" | "count" | "ratio" | "minutes" | "score";
  threshold: number;
  window: "snapshot" | "5m" | "1h" | "24h" | "pool-age";
  comparisonValue?: number;
  volumeUsd?: number;
  liquidityUsd?: number;
  primaryDex?: string;
};

export type MarketSignalBadge = {
  id: string;
  type: MarketSignalType;
  tone: MarketSignalTone;
  iconKey: MarketSignalIconKey;
  labelKey: `marketSignal.${MarketSignalType}`;
  shortLabelKey: `marketSignal.${MarketSignalType}.short`;
  reasonCode: string;
  source: string;
  observedAt: string;
  expiresAt: string;
  priority: number;
  metric?: MarketSignalMetric;
  state: MarketSignalState;
  scope: "opportunity" | "pool";
  subjectId: string;
};

export type SecurityFacts = {
  tokenAddress: string;
  contractVerified?: boolean;
  honeypotStatus?: "clear" | "flagged";
  buyTax?: number;
  sellTax?: number;
  mintAuthority?: "renounced" | "active" | "unknown";
  blacklistCapability?: "absent" | "present" | "unknown";
  holderConcentration?: number;
  liquidityLock?: "locked" | "unlocked" | "unknown";
  source: string;
  observedAt: string;
  expiresAt: string;
};

export interface SecurityFactsAdapter {
  readonly id: string;
  getFacts(tokenAddress: string): SecurityFacts | undefined | Promise<SecurityFacts | undefined>;
}

export type MarketSignalSnapshot = {
  generatedAt: string;
  byOpportunityId: Record<string, MarketSignalBadge[]>;
  byPoolId: Record<string, MarketSignalBadge[]>;
};

export const MARKET_SIGNAL_THRESHOLDS = Object.freeze({
  justLaunchedMinutes: 24 * 60,
  newMarketMinutes: 7 * 24 * 60,
  gainingFast: { change5mEnter: 3, change5mExit: 2.4, volume5mUsd: 5_000, liquidityUsd: 25_000 },
  breakout: { change1hEnter: 15, change1hExit: 12, volume1hUsd: 25_000, liquidityUsd: 50_000 },
  volumeSurge: { ratioEnter: 2, ratioExit: 1.7, minimumVolume1hUsd: 25_000 },
  highVolume: { topFraction: 0.1, minimumVolume24hUsd: 250_000, minimumUniverse: 10 },
  mostTraded: { topFraction: 0.1, minimumTransactions24h: 100, minimumUniverse: 10 },
  deepLiquidity: { topFraction: 0.25, enterUsd: 250_000, exitUsd: 225_000, minimumUniverse: 8 },
  movingNow: { topFraction: 0.2, minimumScore: 20, minimumUniverse: 10 },
  volatile: { change5mEnter: 8, change5mExit: 6.5, change1hEnter: 20, change1hExit: 16 },
  thinLiquidity: { enterUsd: 25_000, exitUsd: 30_000, criticalUsd: 5_000, criticalExitUsd: 6_500 },
  minimumDwellMs: 36_000,
  cooldownMs: 36_000,
  dynamicTtlMs: 90_000,
  structuralTtlMs: 10 * 60_000,
  securityTtlMs: 15 * 60_000,
  maximumBadgesPerSubject: 17
});

export const SIGNAL_FILTER_TYPES = [
  "just_launched",
  "new_market",
  "gaining_fast",
  "volume_surge",
  "high_volume",
  "deep_liquidity",
  "volatile",
  "thin_liquidity",
  "contract_verified",
  "security_unknown",
  "risk_flagged"
] as const satisfies readonly MarketSignalType[];

const SECURITY_TYPES = new Set<MarketSignalType>(["contract_verified", "security_unknown", "risk_flagged"]);

export function computeMarketSignalSnapshot(
  snapshot: MarketTerminalSnapshot,
  securityByTokenAddress: Readonly<Record<string, SecurityFacts | undefined>> = {},
  previous?: MarketSignalSnapshot
): MarketSignalSnapshot {
  const observedMs = parseTimestamp(snapshot.generatedAt) ?? parseTimestamp(snapshot.receivedAt) ?? Date.now();
  const observedAt = new Date(observedMs).toISOString();
  const active = snapshot.opportunities.filter((opportunity) => isFreshActiveOpportunity(snapshot, opportunity));
  const primaryByOpportunity = new Map(snapshot.opportunities.flatMap((opportunity) => {
    const pair = snapshot.allPairs.find((candidate) => candidate.id === opportunity.primaryMarketId);
    return pair ? [[opportunity.id, pair] as const] : [];
  }));
  const volumeRanks = rankSubjects(active, (opportunity) => nonNegative(opportunity.aggregate.volumes?.h24));
  const transactionRanks = rankSubjects(active, (opportunity) => transactionCount(opportunity.aggregate.transactions?.h24));
  const liquidityRanks = rankSubjects(active, (opportunity) => nonNegative(opportunity.aggregate.liquidityUsd));
  const movingRanks = rankSubjects(active, (opportunity) => {
    const pair = primaryByOpportunity.get(opportunity.id);
    return pair ? getMovingNowScore(pair) : undefined;
  });
  const previousTypes = previousBadgeTypes(previous);
  const byOpportunityId: Record<string, MarketSignalBadge[]> = {};

  for (const opportunity of snapshot.opportunities) {
    const pair = primaryByOpportunity.get(opportunity.id);
    const facts = securityByTokenAddress[opportunity.focusTokenAddress.toLowerCase()];
    const badges = computeOpportunityBadges({
      snapshot,
      opportunity,
      pair,
      facts,
      observedMs,
      observedAt,
      volumeRanks,
      transactionRanks,
      liquidityRanks,
      movingRanks,
      previousTypes: previousTypes.get(opportunity.id) ?? new Set()
    });
    byOpportunityId[opportunity.id] = badges.slice(0, MARKET_SIGNAL_THRESHOLDS.maximumBadgesPerSubject);
  }

  const pairsById = new Map(snapshot.allPairs.map((pair) => [pair.id, pair]));
  const byPoolId: Record<string, MarketSignalBadge[]> = {};
  for (const pool of snapshot.poolMarkets) {
    const pair = pairsById.get(pool.id);
    const opportunity = pair?.opportunityId ? snapshot.opportunities.find((item) => item.id === pair.opportunityId) : undefined;
    const tokenAddress = opportunity?.focusTokenAddress ?? pool.baseTokenAddress;
    byPoolId[pool.id] = computePoolBadges(snapshot, pool, pair, securityByTokenAddress[tokenAddress.toLowerCase()], observedMs, observedAt)
      .slice(0, MARKET_SIGNAL_THRESHOLDS.maximumBadgesPerSubject);
  }

  return { generatedAt: observedAt, byOpportunityId, byPoolId };
}

export function reconcileMarketSignalSnapshots(
  previous: MarketSignalSnapshot | undefined,
  next: MarketSignalSnapshot,
  now = Date.parse(next.generatedAt)
): MarketSignalSnapshot {
  const nextMs = parseTimestamp(next.generatedAt);
  const previousMs = previous ? parseTimestamp(previous.generatedAt) : undefined;
  if (previous && nextMs !== undefined && previousMs !== undefined && nextMs <= previousMs) return previous;
  if (!previous) return mapSnapshotBadges(next, (badge) => ({ ...badge, state: "entering" }));
  return {
    generatedAt: next.generatedAt,
    byOpportunityId: reconcileBadgeMaps(previous.byOpportunityId, next.byOpportunityId, now),
    byPoolId: reconcileBadgeMaps(previous.byPoolId, next.byPoolId, now)
  };
}

export function selectVisibleMarketSignals(badges: MarketSignalBadge[], maximumMarketBadges = 2) {
  const sorted = [...badges].sort(compareBadges);
  const security = sorted.find((badge) => SECURITY_TYPES.has(badge.type));
  const market = sorted.filter((badge) => !SECURITY_TYPES.has(badge.type));
  const visibleMarket = market.filter((badge) => badge.type !== "gaining_fast" || !market.some((candidate) => candidate.type === "breakout"));
  const visible = [...(security ? [security] : []), ...visibleMarket.slice(0, maximumMarketBadges)];
  return { security, market: visibleMarket.slice(0, maximumMarketBadges), visible, hiddenCount: Math.max(0, sorted.length - visible.length), all: sorted };
}

export function hasMarketSignal(badges: MarketSignalBadge[] | undefined, types: readonly MarketSignalType[]) {
  if (!types.length) return true;
  const present = new Set((badges ?? []).map((badge) => badge.type));
  return types.every((type) => present.has(type));
}

function computeOpportunityBadges(input: {
  snapshot: MarketTerminalSnapshot;
  opportunity: TokenOpportunity;
  pair?: BasePair;
  facts?: SecurityFacts;
  observedMs: number;
  observedAt: string;
  volumeRanks: RankTable;
  transactionRanks: RankTable;
  liquidityRanks: RankTable;
  movingRanks: RankTable;
  previousTypes: Set<MarketSignalType>;
}) {
  const { snapshot, opportunity, pair, facts, observedMs, observedAt, volumeRanks, transactionRanks, liquidityRanks, movingRanks, previousTypes } = input;
  const badges: MarketSignalBadge[] = [];
  const source = signalSource(opportunity.sourceProviders, "opportunity");
  addLaunchBadge(badges, opportunity.id, "opportunity", opportunity.newestPoolCreatedAt, source, observedMs, observedAt);
  const security = securityBadge(opportunity.id, "opportunity", opportunity.focusTokenAddress, facts, observedMs, observedAt);
  badges.push(security);
  if (!pair || opportunity.quality === "incomplete") {
    badges.push(makeBadge(opportunity.id, "opportunity", "incomplete_data", "neutral", "database_alert", "missing_required_market_fields", source, observedAt, dynamicExpiry(observedMs), 2));
  }
  if (snapshot.freshness !== "fresh" || opportunity.freshness.stalePoolCount > 0 || pair?.stale) {
    badges.push(makeBadge(opportunity.id, "opportunity", "delayed", "warning", "clock_alert", "snapshot_or_pool_stale", source, observedAt, dynamicExpiry(observedMs), 2));
  }
  const liquidity = nonNegative(opportunity.aggregate.liquidityUsd);
  if (liquidity !== undefined) {
    const wasThin = previousTypes.has("thin_liquidity");
    const thinLimit = wasThin ? MARKET_SIGNAL_THRESHOLDS.thinLiquidity.exitUsd : MARKET_SIGNAL_THRESHOLDS.thinLiquidity.enterUsd;
    if (liquidity < thinLimit) {
      const criticalLimit = previousTypes.has("thin_liquidity") ? MARKET_SIGNAL_THRESHOLDS.thinLiquidity.criticalExitUsd : MARKET_SIGNAL_THRESHOLDS.thinLiquidity.criticalUsd;
      const critical = liquidity < criticalLimit;
      badges.push(makeBadge(opportunity.id, "opportunity", "thin_liquidity", critical ? "critical" : "warning", "warning", critical ? "liquidity_below_critical_floor" : "liquidity_below_thin_floor", source, observedAt, dynamicExpiry(observedMs), critical ? 1 : 3, metric(liquidity, "usd", critical ? MARKET_SIGNAL_THRESHOLDS.thinLiquidity.criticalUsd : MARKET_SIGNAL_THRESHOLDS.thinLiquidity.enterUsd, "snapshot")));
    }
  }
  if (opportunity.poolCount >= 2) {
    badges.push(makeBadge(opportunity.id, "opportunity", "multi_pool", "info", "layers", "multiple_unique_execution_pools", source, observedAt, structuralExpiry(observedMs), 10, metric(opportunity.poolCount, "count", 2, "snapshot", undefined, { primaryDex: pair?.dexName ?? pair?.dex })));
  }
  if (pair && isFreshActiveOpportunity(snapshot, opportunity)) {
    addMovementBadges(badges, opportunity, pair, snapshot, source, observedMs, observedAt, previousTypes);
    addRankBadge(badges, opportunity, volumeRanks, "high_volume", "positive", "bars", "top_decile_volume_with_absolute_floor", source, observedMs, observedAt, 7, MARKET_SIGNAL_THRESHOLDS.highVolume.minimumUniverse, MARKET_SIGNAL_THRESHOLDS.highVolume.topFraction, MARKET_SIGNAL_THRESHOLDS.highVolume.minimumVolume24hUsd, "usd", "24h");
    addRankBadge(badges, opportunity, transactionRanks, "most_traded", "positive", "activity", "top_decile_transactions_with_absolute_floor", source, observedMs, observedAt, 7, MARKET_SIGNAL_THRESHOLDS.mostTraded.minimumUniverse, MARKET_SIGNAL_THRESHOLDS.mostTraded.topFraction, MARKET_SIGNAL_THRESHOLDS.mostTraded.minimumTransactions24h, "count", "24h");
    const deepFloor = previousTypes.has("deep_liquidity") ? MARKET_SIGNAL_THRESHOLDS.deepLiquidity.exitUsd : MARKET_SIGNAL_THRESHOLDS.deepLiquidity.enterUsd;
    addRankBadge(badges, opportunity, liquidityRanks, "deep_liquidity", "positive", "droplets", "top_quartile_liquidity_with_absolute_floor", source, observedMs, observedAt, 7, MARKET_SIGNAL_THRESHOLDS.deepLiquidity.minimumUniverse, MARKET_SIGNAL_THRESHOLDS.deepLiquidity.topFraction, deepFloor, "usd", "snapshot");
    addRankBadge(badges, opportunity, movingRanks, "moving_now", "positive", "flame", "top_moving_score_with_complete_inputs", source, observedMs, observedAt, 6, MARKET_SIGNAL_THRESHOLDS.movingNow.minimumUniverse, MARKET_SIGNAL_THRESHOLDS.movingNow.topFraction, MARKET_SIGNAL_THRESHOLDS.movingNow.minimumScore, "score", "1h");
  }
  return badges.sort(compareBadges);
}

function computePoolBadges(snapshot: MarketTerminalSnapshot, pool: PoolMarket, pair: BasePair | undefined, facts: SecurityFacts | undefined, observedMs: number, observedAt: string) {
  const badges: MarketSignalBadge[] = [];
  const source = signalSource(pool.sourceProviders, "pool");
  addLaunchBadge(badges, pool.id, "pool", pool.poolCreatedAt, source, observedMs, observedAt);
  badges.push(securityBadge(pool.id, "pool", pair?.focusTokenAddress ?? pool.baseTokenAddress, facts, observedMs, observedAt));
  if (pool.quality === "incomplete") badges.push(makeBadge(pool.id, "pool", "incomplete_data", "neutral", "database_alert", "pool_market_fields_incomplete", source, observedAt, dynamicExpiry(observedMs), 2));
  if (snapshot.freshness !== "fresh" || pool.quality === "expired" || pair?.stale) badges.push(makeBadge(pool.id, "pool", "delayed", "warning", "clock_alert", "pool_snapshot_delayed", source, observedAt, dynamicExpiry(observedMs), 2));
  const poolLiquidity = nonNegative(pool.liquidityUsd);
  if (poolLiquidity !== undefined && poolLiquidity < MARKET_SIGNAL_THRESHOLDS.thinLiquidity.enterUsd) {
    const critical = poolLiquidity < MARKET_SIGNAL_THRESHOLDS.thinLiquidity.criticalUsd;
    badges.push(makeBadge(pool.id, "pool", "thin_liquidity", critical ? "critical" : "warning", "warning", critical ? "pool_liquidity_below_critical_floor" : "pool_liquidity_below_thin_floor", source, observedAt, dynamicExpiry(observedMs), critical ? 1 : 3, metric(poolLiquidity, "usd", critical ? MARKET_SIGNAL_THRESHOLDS.thinLiquidity.criticalUsd : MARKET_SIGNAL_THRESHOLDS.thinLiquidity.enterUsd, "snapshot")));
  }
  if (pair) addVolatilityBadge(badges, pool.id, "pool", pair, poolLiquidity, source, observedMs, observedAt, false);
  return badges.sort(compareBadges);
}

function addMovementBadges(badges: MarketSignalBadge[], opportunity: TokenOpportunity, pair: BasePair, snapshot: MarketTerminalSnapshot, source: string, observedMs: number, observedAt: string, previousTypes: Set<MarketSignalType>) {
  const liquidity = nonNegative(opportunity.aggregate.liquidityUsd);
  const volume5m = nonNegative(opportunity.aggregate.volumes?.m5);
  const volume1h = nonNegative(opportunity.aggregate.volumes?.h1);
  const change5m = finite(pair.priceChanges?.m5);
  const change1h = finite(pair.priceChanges?.h1);
  const gainingThreshold = previousTypes.has("gaining_fast") ? MARKET_SIGNAL_THRESHOLDS.gainingFast.change5mExit : MARKET_SIGNAL_THRESHOLDS.gainingFast.change5mEnter;
  if (liquidity !== undefined && volume5m !== undefined && change5m !== undefined && liquidity >= MARKET_SIGNAL_THRESHOLDS.gainingFast.liquidityUsd && volume5m >= MARKET_SIGNAL_THRESHOLDS.gainingFast.volume5mUsd && change5m >= gainingThreshold) {
    badges.push(makeBadge(opportunity.id, "opportunity", "gaining_fast", "positive", "trending", "price_volume_liquidity_5m_threshold", source, observedAt, dynamicExpiry(observedMs), 5, metric(change5m, "percent", MARKET_SIGNAL_THRESHOLDS.gainingFast.change5mEnter, "5m", undefined, { volumeUsd: volume5m, liquidityUsd: liquidity })));
  }
  const breakoutThreshold = previousTypes.has("breakout") ? MARKET_SIGNAL_THRESHOLDS.breakout.change1hExit : MARKET_SIGNAL_THRESHOLDS.breakout.change1hEnter;
  if (liquidity !== undefined && volume1h !== undefined && change1h !== undefined && liquidity >= MARKET_SIGNAL_THRESHOLDS.breakout.liquidityUsd && volume1h >= MARKET_SIGNAL_THRESHOLDS.breakout.volume1hUsd && change1h >= breakoutThreshold) {
    badges.push(makeBadge(opportunity.id, "opportunity", "breakout", "positive", "rocket", "price_volume_liquidity_1h_breakout", source, observedAt, dynamicExpiry(observedMs), 4, metric(change1h, "percent", MARKET_SIGNAL_THRESHOLDS.breakout.change1hEnter, "1h", undefined, { volumeUsd: volume1h, liquidityUsd: liquidity })));
  }
  const previousAt = parseTimestamp(snapshot.comparison.previousGeneratedAt);
  const currentAt = parseTimestamp(snapshot.generatedAt);
  const previousVolume = nonNegative(snapshot.comparison.opportunityVolume1h[opportunity.id]);
  const surgeThreshold = previousTypes.has("volume_surge") ? MARKET_SIGNAL_THRESHOLDS.volumeSurge.ratioExit : MARKET_SIGNAL_THRESHOLDS.volumeSurge.ratioEnter;
  if (snapshot.comparison.status === "ready" && previousAt !== undefined && currentAt !== undefined && previousAt < currentAt && volume1h !== undefined && volume1h >= MARKET_SIGNAL_THRESHOLDS.volumeSurge.minimumVolume1hUsd && previousVolume !== undefined && previousVolume > 0 && volume1h / previousVolume >= surgeThreshold) {
    badges.push(makeBadge(opportunity.id, "opportunity", "volume_surge", "positive", "activity", "comparable_1h_volume_rate_ratio", source, observedAt, dynamicExpiry(observedMs), 4, metric(volume1h / previousVolume, "ratio", MARKET_SIGNAL_THRESHOLDS.volumeSurge.ratioEnter, "1h", previousVolume, { volumeUsd: volume1h, liquidityUsd: liquidity })));
  }
  addVolatilityBadge(badges, opportunity.id, "opportunity", pair, liquidity, source, observedMs, observedAt, previousTypes.has("volatile"));
}

function addVolatilityBadge(badges: MarketSignalBadge[], subjectId: string, scope: "opportunity" | "pool", pair: BasePair, liquidity: number | undefined, source: string, observedMs: number, observedAt: string, wasActive: boolean) {
  const change5m = finite(pair.priceChanges?.m5);
  const change1h = finite(pair.priceChanges?.h1);
  const threshold5m = wasActive ? MARKET_SIGNAL_THRESHOLDS.volatile.change5mExit : MARKET_SIGNAL_THRESHOLDS.volatile.change5mEnter;
  const threshold1h = wasActive ? MARKET_SIGNAL_THRESHOLDS.volatile.change1hExit : MARKET_SIGNAL_THRESHOLDS.volatile.change1hEnter;
  const by5m = change5m !== undefined && Math.abs(change5m) >= threshold5m;
  const by1h = change1h !== undefined && Math.abs(change1h) >= threshold1h;
  if (!by5m && !by1h) return;
  const value = by1h ? change1h! : change5m!;
  const window = by1h ? "1h" : "5m";
  badges.push(makeBadge(subjectId, scope, "volatile", "warning", "gauge", value < 0 ? "large_negative_absolute_price_move" : "large_positive_absolute_price_move", source, observedAt, dynamicExpiry(observedMs), 6, metric(value, "percent", by1h ? MARKET_SIGNAL_THRESHOLDS.volatile.change1hEnter : MARKET_SIGNAL_THRESHOLDS.volatile.change5mEnter, window, undefined, { liquidityUsd: liquidity })));
}

function addLaunchBadge(badges: MarketSignalBadge[], subjectId: string, scope: "opportunity" | "pool", createdAt: string | undefined, source: string, observedMs: number, observedAt: string) {
  const createdMs = parseTimestamp(createdAt);
  if (createdMs === undefined || createdMs > observedMs) return;
  const ageMinutes = (observedMs - createdMs) / 60_000;
  if (ageMinutes <= MARKET_SIGNAL_THRESHOLDS.justLaunchedMinutes) {
    badges.push(makeBadge(subjectId, scope, "just_launched", "info", "sparkles", scope === "pool" ? "pool_age_within_24h" : "canonical_newest_pool_age_within_24h", source, observedAt, new Date(createdMs + MARKET_SIGNAL_THRESHOLDS.justLaunchedMinutes * 60_000).toISOString(), 3, metric(ageMinutes, "minutes", MARKET_SIGNAL_THRESHOLDS.justLaunchedMinutes, "pool-age")));
  } else if (ageMinutes <= MARKET_SIGNAL_THRESHOLDS.newMarketMinutes) {
    badges.push(makeBadge(subjectId, scope, "new_market", "info", "clock", scope === "pool" ? "pool_age_between_24h_and_7d" : "canonical_newest_pool_age_between_24h_and_7d", source, observedAt, new Date(createdMs + MARKET_SIGNAL_THRESHOLDS.newMarketMinutes * 60_000).toISOString(), 4, metric(ageMinutes, "minutes", MARKET_SIGNAL_THRESHOLDS.newMarketMinutes, "pool-age")));
  }
}

function addRankBadge(badges: MarketSignalBadge[], opportunity: TokenOpportunity, ranks: RankTable, type: MarketSignalType, tone: MarketSignalTone, iconKey: MarketSignalIconKey, reasonCode: string, source: string, observedMs: number, observedAt: string, priority: number, minimumUniverse: number, topFraction: number, absoluteFloor: number, unit: MarketSignalMetric["unit"], window: MarketSignalMetric["window"]) {
  const rank = ranks.get(opportunity.id);
  if (!rank || ranks.size < minimumUniverse || rank.value < absoluteFloor || rank.index >= Math.ceil(ranks.size * topFraction)) return;
  badges.push(makeBadge(opportunity.id, "opportunity", type, tone, iconKey, reasonCode, source, observedAt, dynamicExpiry(observedMs), priority, metric(rank.value, unit, absoluteFloor, window)));
}

function securityBadge(subjectId: string, scope: "opportunity" | "pool", tokenAddress: string, facts: SecurityFacts | undefined, observedMs: number, observedAt: string) {
  const validFacts = facts && facts.tokenAddress.toLowerCase() === tokenAddress.toLowerCase() && (parseTimestamp(facts.observedAt) ?? Number.POSITIVE_INFINITY) <= observedMs && (parseTimestamp(facts.expiresAt) ?? Number.NEGATIVE_INFINITY) > observedMs ? facts : undefined;
  if (validFacts) {
    const riskCodes = [
      validFacts.honeypotStatus === "flagged" ? "honeypot_flagged" : undefined,
      validFacts.blacklistCapability === "present" ? "blacklist_capability_present" : undefined,
      validFacts.mintAuthority === "active" ? "mint_authority_active" : undefined,
      validFacts.liquidityLock === "unlocked" ? "liquidity_unlocked" : undefined
    ].filter((value): value is string => Boolean(value));
    if (riskCodes.length > 0) return makeBadge(subjectId, scope, "risk_flagged", "critical", "shield_alert", riskCodes.join("+"), validFacts.source, validFacts.observedAt, validFacts.expiresAt, 0, metric(riskCodes.length, "count", 1, "snapshot"));
    if (validFacts.contractVerified === true) return makeBadge(subjectId, scope, "contract_verified", "positive", "shield_check", "exact_address_contract_verified_not_overall_safe", validFacts.source, validFacts.observedAt, validFacts.expiresAt, 8);
  }
  return makeBadge(subjectId, scope, "security_unknown", "neutral", "shield_question", "connected_market_providers_do_not_assess_security", "Connected market providers · not assessed", observedAt, new Date(observedMs + MARKET_SIGNAL_THRESHOLDS.securityTtlMs).toISOString(), 9);
}

type RankTable = Map<string, { index: number; value: number }>;

function rankSubjects(opportunities: TokenOpportunity[], read: (opportunity: TokenOpportunity) => number | undefined): RankTable {
  const rows = opportunities.flatMap((opportunity) => {
    const value = read(opportunity);
    return value === undefined ? [] : [{ id: opportunity.id, value }];
  }).sort((left, right) => right.value - left.value || left.id.localeCompare(right.id));
  return new Map(rows.map((row, index) => [row.id, { index, value: row.value }]));
}

function isFreshActiveOpportunity(snapshot: MarketTerminalSnapshot, opportunity: TokenOpportunity) {
  return snapshot.freshness === "fresh" && opportunity.quality === "active" && opportunity.freshness.stalePoolCount === 0;
}

function previousBadgeTypes(previous: MarketSignalSnapshot | undefined) {
  const result = new Map<string, Set<MarketSignalType>>();
  if (!previous) return result;
  for (const [id, badges] of Object.entries(previous.byOpportunityId)) result.set(id, new Set(badges.filter((badge) => badge.state !== "cooldown").map((badge) => badge.type)));
  return result;
}

function reconcileBadgeMaps(previous: Record<string, MarketSignalBadge[]>, next: Record<string, MarketSignalBadge[]>, now: number) {
  const result: Record<string, MarketSignalBadge[]> = {};
  for (const subjectId of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    const oldById = new Map((previous[subjectId] ?? []).map((badge) => [badge.id, badge]));
    const current: MarketSignalBadge[] = (next[subjectId] ?? []).map((badge) => {
      const old = oldById.get(badge.id);
      oldById.delete(badge.id);
      if (!old) return { ...badge, state: "entering" as const };
      const firstSeen = parseTimestamp(old.observedAt) ?? now;
      return { ...badge, observedAt: old.observedAt, state: old.state === "active" || now - firstSeen >= MARKET_SIGNAL_THRESHOLDS.minimumDwellMs ? "active" as const : "entering" as const };
    });
    for (const old of oldById.values()) {
      const oldExpiry = parseTimestamp(old.expiresAt) ?? 0;
      if (old.state === "cooldown" && oldExpiry <= now) continue;
      if (old.state === "cooldown") {
        current.push(old);
        continue;
      }
      current.push({ ...old, state: "cooldown", expiresAt: new Date(now + MARKET_SIGNAL_THRESHOLDS.cooldownMs).toISOString() });
    }
    if (current.length) result[subjectId] = current.sort(compareBadges).slice(0, MARKET_SIGNAL_THRESHOLDS.maximumBadgesPerSubject);
  }
  return result;
}

function mapSnapshotBadges(snapshot: MarketSignalSnapshot, map: (badge: MarketSignalBadge) => MarketSignalBadge): MarketSignalSnapshot {
  return {
    generatedAt: snapshot.generatedAt,
    byOpportunityId: Object.fromEntries(Object.entries(snapshot.byOpportunityId).map(([id, badges]) => [id, badges.map(map)])),
    byPoolId: Object.fromEntries(Object.entries(snapshot.byPoolId).map(([id, badges]) => [id, badges.map(map)]))
  };
}

function makeBadge(subjectId: string, scope: "opportunity" | "pool", type: MarketSignalType, tone: MarketSignalTone, iconKey: MarketSignalIconKey, reasonCode: string, source: string, observedAt: string, expiresAt: string, priority: number, value?: MarketSignalMetric): MarketSignalBadge {
  return { id: `${scope}:${subjectId}:${type}`, type, tone, iconKey, labelKey: `marketSignal.${type}`, shortLabelKey: `marketSignal.${type}.short`, reasonCode, source, observedAt, expiresAt, priority, metric: value, state: "active", scope, subjectId };
}

function metric(value: number, unit: MarketSignalMetric["unit"], threshold: number, window: MarketSignalMetric["window"], comparisonValue?: number, evidence: Pick<MarketSignalMetric, "volumeUsd" | "liquidityUsd" | "primaryDex"> = {}): MarketSignalMetric {
  return { value, unit, threshold, window, comparisonValue, ...evidence };
}

function signalSource(providers: readonly string[], scope: string) {
  return `${providers.length ? providers.join(" + ") : "unknown provider"} · ${scope}`;
}

function dynamicExpiry(observedMs: number) { return new Date(observedMs + MARKET_SIGNAL_THRESHOLDS.dynamicTtlMs).toISOString(); }
function structuralExpiry(observedMs: number) { return new Date(observedMs + MARKET_SIGNAL_THRESHOLDS.structuralTtlMs).toISOString(); }

function transactionCount(value: { buys: number; sells: number } | undefined) {
  const buys = nonNegative(value?.buys); const sells = nonNegative(value?.sells);
  return buys === undefined || sells === undefined ? undefined : buys + sells;
}

function finite(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function nonNegative(value: unknown) { const parsed = finite(value); return parsed !== undefined && parsed >= 0 ? parsed : undefined; }
function parseTimestamp(value: string | undefined) { if (!value) return undefined; const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : undefined; }
function compareBadges(left: MarketSignalBadge, right: MarketSignalBadge) { return left.priority - right.priority || left.type.localeCompare(right.type); }
