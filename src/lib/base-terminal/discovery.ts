import type { BasePair } from "@/types/baseTerminal";
import { canonicalPairKey } from "@/lib/marketMath";

export const DISCOVERY_MIN_LIQUIDITY_USD = 25_000;
export const DISCOVERY_MIN_VOLUME_24H_USD = 10_000;

export type DiscoveryCategory =
  | "trending"
  | "gainers"
  | "new"
  | "volume"
  | "liquidity"
  | "volatile"
  | "watchlist"
  | "recent";

export type DiscoverySort =
  | "category"
  | "price-change-desc"
  | "volume-desc"
  | "liquidity-desc"
  | "age-asc";

export type DiscoveryFilters = {
  minLiquidity?: number;
  minVolume?: number;
  minAgeMinutes?: number;
  maxAgeMinutes?: number;
  minChange24h?: number;
  maxChange24h?: number;
  dex: string;
  completeOnly: boolean;
  sort: DiscoverySort;
  hideStale: boolean;
  hideLowLiquidity: boolean;
  quickFresh: boolean;
  quickLiquid: boolean;
  quickMoving: boolean;
  quickHighVolume: boolean;
  quickWatched: boolean;
};

export type DiscoveryRow = {
  pair: BasePair;
  activityScore?: number;
};

export const DEFAULT_DISCOVERY_FILTERS: DiscoveryFilters = {
  dex: "all",
  completeOnly: false,
  sort: "category",
  hideStale: true,
  hideLowLiquidity: false,
  quickFresh: false,
  quickLiquid: false,
  quickMoving: false,
  quickHighVolume: false,
  quickWatched: false
};

export const DISCOVERY_CATEGORIES: Array<{
  id: DiscoveryCategory;
  label: string;
  description: string;
}> = [
  {
    id: "trending",
    label: "Trending Activity",
    description: "Deterministic activity score from verified fields; not advice or a safety score"
  },
  { id: "gainers", label: "Top Gainers", description: "Verified 24h price change" },
  { id: "new", label: "New Pairs", description: "Verified pool creation time" },
  { id: "volume", label: "Volume Leaders", description: "Verified 24h volume" },
  { id: "liquidity", label: "Liquidity Leaders", description: "Verified USD liquidity" },
  {
    id: "volatile",
    label: "Volatile",
    description: "Largest absolute 24h moves; not a bullish signal"
  },
  { id: "watchlist", label: "Watchlist", description: "Pairs saved on this device" },
  { id: "recent", label: "Recent", description: "Pairs opened on this device" }
];

export function buildDiscoveryRows({
  pairs,
  category,
  filters,
  isPairPinned,
  recentPairIds
}: {
  pairs: BasePair[];
  category: DiscoveryCategory;
  filters: DiscoveryFilters;
  isPairPinned: (pair: BasePair) => boolean;
  recentPairIds: string[];
}): DiscoveryRow[] {
  const recentOrder = new Map(recentPairIds.map((id, index) => [id, index]));
  const categorized = pairs
    .map((pair) => ({ pair, activityScore: calculateActivityScore(pair) }))
    .filter((row) => pairBelongsToCategory(row, category, isPairPinned, recentOrder));
  const filtered = categorized.filter(({ pair }) =>
    pairMatchesDiscoveryFilters(pair, filters, isPairPinned)
  );

  return filtered.sort((left, right) =>
    compareDiscoveryRows(left, right, filters.sort, category, recentOrder)
  );
}

/**
 * Activity Score is intentionally not a safety or recommendation score.
 * It is available only when every input is present and the pair clears $25k
 * liquidity and $10k 24h volume. The deterministic 0-100 formula is:
 * liquidity (0-25, log scaled) + volume (0-30, log scaled) +
 * matched market activity (0-20, monotonic in liquidity and volume) + absolute 24h move (0-15) +
 * 24h transaction count (0-10, log scaled).
 */
export function calculateActivityScore(pair: BasePair) {
  const liquidity = getLiquidityUsd(pair);
  const volume24h = getVolume24h(pair);
  const change24h = getChange24h(pair);
  const txns = pair.txns?.h24;

  if (
    liquidity === undefined ||
    volume24h === undefined ||
    change24h === undefined ||
    !txns ||
    liquidity < DISCOVERY_MIN_LIQUIDITY_USD ||
    volume24h < DISCOVERY_MIN_VOLUME_24H_USD
  ) {
    return undefined;
  }

  const transactionCount = txns.buys + txns.sells;
  if (!Number.isFinite(transactionCount) || transactionCount < 0) return undefined;
  const liquidityScore = logScale(liquidity, DISCOVERY_MIN_LIQUIDITY_USD, 5_000_000, 25);
  const volumeScore = logScale(volume24h, DISCOVERY_MIN_VOLUME_24H_USD, 10_000_000, 30);
  const matchedActivityScore = logScale(
    Math.min(volume24h, liquidity),
    DISCOVERY_MIN_VOLUME_24H_USD,
    5_000_000,
    20
  );
  const moveScore = clamp((Math.abs(change24h) / 25) * 15, 0, 15);
  const transactionScore = logScale(transactionCount, 1, 10_000, 10);

  return Math.round(
    liquidityScore + volumeScore + matchedActivityScore + moveScore + transactionScore
  );
}

export function getChange24h(pair: BasePair) {
  if (typeof pair.priceChanges?.h24 === "number" && Number.isFinite(pair.priceChanges.h24)) {
    return pair.priceChanges.h24;
  }

  return pair.dataSource === "mock" && Number.isFinite(pair.change24h)
    ? pair.change24h
    : undefined;
}

export function getVolume24h(pair: BasePair) {
  if (typeof pair.volumes?.h24 === "number" && Number.isFinite(pair.volumes.h24) && pair.volumes.h24 >= 0) {
    return pair.volumes.h24;
  }

  return pair.dataSource === "mock" && Number.isFinite(pair.volume24h) && pair.volume24h >= 0 ? pair.volume24h : undefined;
}

export function getLiquidityUsd(pair: BasePair) {
  if (typeof pair.liquidityUsd === "number" && Number.isFinite(pair.liquidityUsd) && pair.liquidityUsd >= 0) {
    return pair.liquidityUsd;
  }

  return pair.dataSource === "mock" && Number.isFinite(pair.liquidity) && pair.liquidity >= 0 ? pair.liquidity : undefined;
}

export function getPairAgeMinutes(pair: BasePair) {
  if (pair.pairCreatedAtMs && pair.pairCreatedAtMs > 0 && pair.pairCreatedAtMs <= Date.now() + 60_000 && Number.isFinite(pair.ageMinutes) && pair.ageMinutes >= 0) {
    return pair.ageMinutes;
  }

  return pair.dataSource === "mock" && Number.isFinite(pair.ageMinutes) && pair.ageMinutes >= 0 && pair.ageMinutes < 999_999
    ? pair.ageMinutes
    : undefined;
}

export function isDiscoveryDataComplete(pair: BasePair) {
  return Boolean(
    typeof pair.priceUsdValue === "number" && Number.isFinite(pair.priceUsdValue) && pair.priceUsdValue > 0 &&
      getChange24h(pair) !== undefined &&
      getVolume24h(pair) !== undefined &&
      getLiquidityUsd(pair) !== undefined &&
      getPairAgeMinutes(pair) !== undefined &&
      (pair.dexId || pair.dexName || pair.dex)
  );
}

export function pairMatchesDiscoveryFilters(
  pair: BasePair,
  filters: DiscoveryFilters,
  isPairPinned: (pair: BasePair) => boolean
) {
  const liquidity = getLiquidityUsd(pair);
  const volume = getVolume24h(pair);
  const change = getChange24h(pair);
  const age = getPairAgeMinutes(pair);

  if (filters.hideStale && pair.stale) return false;
  if (filters.hideLowLiquidity && (liquidity ?? 0) < DISCOVERY_MIN_LIQUIDITY_USD) return false;
  if (filters.completeOnly && !isDiscoveryDataComplete(pair)) return false;
  if (filters.dex !== "all" && normalizeDex(pair) !== filters.dex) return false;
  if (filters.quickWatched && !isPairPinned(pair)) return false;
  if (filters.quickFresh && (age === undefined || age > 24 * 60)) return false;
  if (filters.quickLiquid && (liquidity === undefined || liquidity < 100_000)) return false;
  if (filters.quickMoving && (change === undefined || Math.abs(change) < 5)) return false;
  if (filters.quickHighVolume && (volume === undefined || volume < 100_000)) return false;
  if (filters.minLiquidity !== undefined && (liquidity === undefined || liquidity < filters.minLiquidity)) return false;
  if (filters.minVolume !== undefined && (volume === undefined || volume < filters.minVolume)) return false;
  if (filters.minAgeMinutes !== undefined && (age === undefined || age < filters.minAgeMinutes)) return false;
  if (filters.maxAgeMinutes !== undefined && (age === undefined || age > filters.maxAgeMinutes)) return false;
  if (filters.minChange24h !== undefined && (change === undefined || change < filters.minChange24h)) return false;
  if (filters.maxChange24h !== undefined && (change === undefined || change > filters.maxChange24h)) return false;

  return true;
}

export function hasActiveDiscoveryFilters(filters: DiscoveryFilters) {
  return JSON.stringify(filters) !== JSON.stringify(DEFAULT_DISCOVERY_FILTERS);
}

export function getDiscoveryDexOptions(pairs: BasePair[]) {
  return [...new Set(pairs.map(normalizeDex).filter(Boolean))].sort();
}

export function normalizeDex(pair: BasePair) {
  return (pair.dexId ?? pair.dexName ?? pair.dex).trim().toLowerCase();
}

function pairBelongsToCategory(
  row: DiscoveryRow,
  category: DiscoveryCategory,
  isPairPinned: (pair: BasePair) => boolean,
  recentOrder: Map<string, number>
) {
  const { pair, activityScore } = row;

  switch (category) {
    case "trending":
      return activityScore !== undefined;
    case "gainers":
      return getChange24h(pair) !== undefined;
    case "new":
      return getPairAgeMinutes(pair) !== undefined;
    case "volume":
      return getVolume24h(pair) !== undefined;
    case "liquidity":
      return getLiquidityUsd(pair) !== undefined;
    case "volatile":
      return getChange24h(pair) !== undefined;
    case "watchlist":
      return isPairPinned(pair);
    case "recent":
      return recentOrder.has(pair.id);
  }
}

function compareDiscoveryRows(
  left: DiscoveryRow,
  right: DiscoveryRow,
  sort: DiscoverySort,
  category: DiscoveryCategory,
  recentOrder: Map<string, number>
) {
  let comparison = 0;
  if (sort !== "category") {
    if (sort === "price-change-desc") comparison = compareDesc(getChange24h(left.pair), getChange24h(right.pair));
    else if (sort === "volume-desc") comparison = compareDesc(getVolume24h(left.pair), getVolume24h(right.pair));
    else if (sort === "liquidity-desc") comparison = compareDesc(getLiquidityUsd(left.pair), getLiquidityUsd(right.pair));
    else comparison = compareAsc(getPairAgeMinutes(left.pair), getPairAgeMinutes(right.pair));
    return comparison || compareCanonicalPair(left.pair, right.pair);
  }

  if (category === "trending") comparison = compareDesc(left.activityScore, right.activityScore);
  else if (category === "gainers") comparison = compareDesc(getChange24h(left.pair), getChange24h(right.pair));
  else if (category === "new") comparison = compareAsc(getPairAgeMinutes(left.pair), getPairAgeMinutes(right.pair));
  else if (category === "volume") comparison = compareDesc(getVolume24h(left.pair), getVolume24h(right.pair));
  else if (category === "liquidity") comparison = compareDesc(getLiquidityUsd(left.pair), getLiquidityUsd(right.pair));
  else if (category === "volatile") comparison = compareDesc(Math.abs(getChange24h(left.pair) ?? 0), Math.abs(getChange24h(right.pair) ?? 0));
  else if (category === "recent") comparison = (recentOrder.get(left.pair.id) ?? 999) - (recentOrder.get(right.pair.id) ?? 999);
  else comparison = compareDesc(getLiquidityUsd(left.pair), getLiquidityUsd(right.pair));
  return comparison || compareCanonicalPair(left.pair, right.pair);
}

function compareCanonicalPair(left: BasePair, right: BasePair) {
  return canonicalPairKey({
    chainId: left.chainId,
    pairAddress: left.pairAddress,
    baseTokenAddress: left.baseTokenAddress,
    quoteTokenAddress: left.quoteTokenAddress,
    fallbackId: left.id
  }).localeCompare(canonicalPairKey({
    chainId: right.chainId,
    pairAddress: right.pairAddress,
    baseTokenAddress: right.baseTokenAddress,
    quoteTokenAddress: right.quoteTokenAddress,
    fallbackId: right.id
  }), "en-US");
}

function compareAsc(left: number | undefined, right: number | undefined) {
  if (left === undefined && right === undefined) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  return left - right;
}

function compareDesc(left: number | undefined, right: number | undefined) {
  if (left === undefined && right === undefined) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  return right - left;
}

function logScale(value: number, min: number, max: number, weight: number) {
  if (value <= min) return 0;
  const normalized = Math.log(value / min) / Math.log(max / min);
  return clamp(normalized * weight, 0, weight);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
