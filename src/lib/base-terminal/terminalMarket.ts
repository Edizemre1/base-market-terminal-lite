import { getNormalizedMarketModel } from "@/lib/base-terminal/marketModel";
import type { BasePair } from "@/types/baseTerminal";

export type TerminalLaneId = "new" | "moving" | "volume" | "liquidity";
export type TerminalLane = {
  id: TerminalLaneId;
  pairs: BasePair[];
  derived: boolean;
  fallback: boolean;
};

export type MarketSortKey = "pair" | "age" | "price" | "change5m" | "change1h" | "change24h" | "volume5m" | "volume1h" | "volume24h" | "liquidity" | "fdv" | "marketCap" | "transactions" | "freshness";
export type MarketFilters = {
  query: string;
  minimumLiquidity?: number;
  minimumVolume24h?: number;
  maximumAgeMinutes?: number;
  change: "all" | "gainers" | "losers";
  sortBy: MarketSortKey;
  sortDirection: "asc" | "desc";
};

export const DEFAULT_MARKET_FILTERS: MarketFilters = {
  query: "",
  change: "all",
  sortBy: "volume24h",
  sortDirection: "desc"
};

export function buildOpportunityLanes(current: BasePair[], previous: BasePair[] = [], limit = 6): TerminalLane[] {
  const previousByKey = new Map(previous.map((pair) => [getMarketKey(pair), pair]));
  const byNew = eligible(current, (pair) => getNormalizedMarketModel(pair).ageMinutes !== undefined)
    .sort((left, right) => compareNumbers(getNormalizedMarketModel(left).ageMinutes!, getNormalizedMarketModel(right).ageMinutes!) || compareKeys(left, right));
  const byMoving = current
    .map((pair) => ({ pair, score: getMovingNowScore(pair) }))
    .filter((entry): entry is { pair: BasePair; score: number } => entry.score !== undefined)
    .sort((left, right) => right.score - left.score || compareKeys(left.pair, right.pair))
    .map((entry) => entry.pair);
  const volumeSurges = current
    .map((pair) => ({ pair, score: getVolumeSurgeRatio(pair, previousByKey.get(getMarketKey(pair))) }))
    .filter((entry): entry is { pair: BasePair; score: number } => entry.score !== undefined)
    .sort((left, right) => right.score - left.score || compareKeys(left.pair, right.pair))
    .map((entry) => entry.pair);
  const byVolume = eligible(current, (pair) => getNormalizedMarketModel(pair).volume24hUsd !== undefined)
    .sort((left, right) => compareNumbers(getNormalizedMarketModel(right).volume24hUsd!, getNormalizedMarketModel(left).volume24hUsd!) || compareKeys(left, right));
  const byLiquidity = eligible(current, (pair) => getNormalizedMarketModel(pair).liquidityUsd !== undefined)
    .sort((left, right) => compareNumbers(getNormalizedMarketModel(right).liquidityUsd!, getNormalizedMarketModel(left).liquidityUsd!) || compareKeys(left, right));

  return [
    { id: "new", pairs: byNew.slice(0, limit), derived: false, fallback: false },
    { id: "moving", pairs: (byMoving.length ? byMoving : byVolume).slice(0, limit), derived: true, fallback: byMoving.length === 0 },
    { id: "volume", pairs: (volumeSurges.length ? volumeSurges : byVolume).slice(0, limit), derived: volumeSurges.length > 0, fallback: volumeSurges.length === 0 },
    { id: "liquidity", pairs: byLiquidity.slice(0, limit), derived: false, fallback: false }
  ];
}

/**
 * Mergen Momentum is an explainable discovery heuristic, not investment advice
 * or a safety score. It requires real 1h change, 1h and 24h volume, and 1h and
 * 24h transaction counts. Price contributes 50%, volume-rate acceleration 30%,
 * and transaction-rate acceleration 20%. Missing inputs produce no score.
 */
export function getMovingNowScore(pair: BasePair) {
  const change1h = readWindow(pair.priceChanges?.h1);
  const volume1h = readWindow(pair.volumes?.h1);
  const volume24h = readWindow(pair.volumes?.h24);
  const transactions1h = readTransactionCount(pair, "h1");
  const transactions24h = readTransactionCount(pair, "h24");
  if ([change1h, volume1h, volume24h, transactions1h, transactions24h].some((value) => value === undefined)) return undefined;
  if ((volume24h ?? 0) <= 0 || (transactions24h ?? 0) <= 0) return undefined;

  const priceSignal = clamp(Math.abs(change1h!), 0, 25) / 25;
  const volumeAcceleration = clamp((volume1h! / (volume24h! / 24)) - 1, 0, 5) / 5;
  const transactionAcceleration = clamp((transactions1h! / (transactions24h! / 24)) - 1, 0, 5) / 5;
  return Number((priceSignal * 50 + volumeAcceleration * 30 + transactionAcceleration * 20).toFixed(4));
}

export function getVolumeSurgeRatio(pair: BasePair, previous: BasePair | undefined) {
  if (!previous) return undefined;
  const current = readWindow(pair.volumes?.h1);
  const before = readWindow(previous.volumes?.h1);
  if (current === undefined || before === undefined || before <= 0) return undefined;
  return current / before;
}

export function filterAndSortMarkets(pairs: BasePair[], filters: MarketFilters) {
  const normalizedQuery = filters.query.trim().toLocaleLowerCase("en-US");
  const filtered = pairs.filter((pair) => {
    const model = getNormalizedMarketModel(pair);
    if (normalizedQuery && !marketSearchText(pair, model.key).includes(normalizedQuery)) return false;
    if (filters.minimumLiquidity !== undefined && (model.liquidityUsd === undefined || model.liquidityUsd < filters.minimumLiquidity)) return false;
    if (filters.minimumVolume24h !== undefined && (model.volume24hUsd === undefined || model.volume24hUsd < filters.minimumVolume24h)) return false;
    if (filters.maximumAgeMinutes !== undefined && (model.ageMinutes === undefined || model.ageMinutes > filters.maximumAgeMinutes)) return false;
    if (filters.change === "gainers" && (model.change24h === undefined || model.change24h <= 0)) return false;
    if (filters.change === "losers" && (model.change24h === undefined || model.change24h >= 0)) return false;
    return true;
  });

  return filtered.sort((left, right) => {
    const leftValue = getSortValue(left, filters.sortBy);
    const rightValue = getSortValue(right, filters.sortBy);
    const missingOrder = Number(leftValue === undefined) - Number(rightValue === undefined);
    if (missingOrder) return missingOrder;
    const comparison = typeof leftValue === "string" && typeof rightValue === "string"
      ? leftValue.localeCompare(rightValue, "en", { sensitivity: "base" })
      : compareNumbers(leftValue as number, rightValue as number);
    return (filters.sortDirection === "asc" ? comparison : -comparison) || compareKeys(left, right);
  });
}

export function limitPinnedMarketKeys(keys: string[], nextKey?: string, maximum = 4) {
  const normalized = keys.filter((key, index) => Boolean(key) && keys.indexOf(key) === index);
  if (!nextKey) return normalized.slice(0, maximum);
  if (normalized.includes(nextKey)) return normalized.filter((key) => key !== nextKey);
  return [...normalized, nextKey].slice(-maximum);
}

export function countReorderedMarkets(current: BasePair[], next: BasePair[]) {
  const currentIndex = new Map(current.map((pair, index) => [getMarketKey(pair), index]));
  return next.reduce((count, pair, index) => count + (currentIndex.get(getMarketKey(pair)) === index ? 0 : 1), 0);
}

function getSortValue(pair: BasePair, key: MarketSortKey): string | number | undefined {
  const model = getNormalizedMarketModel(pair);
  if (key === "pair") return pair.pair;
  if (key === "age") return model.ageMinutes;
  if (key === "price") return model.priceUsd;
  if (key === "change5m") return model.change5m;
  if (key === "change1h") return model.change1h;
  if (key === "change24h") return model.change24h;
  if (key === "volume5m") return model.volume5mUsd;
  if (key === "volume1h") return model.volume1hUsd;
  if (key === "volume24h") return model.volume24hUsd;
  if (key === "liquidity") return model.liquidityUsd;
  if (key === "fdv") return finiteNonNegative(pair.fdv);
  if (key === "marketCap") return finiteNonNegative(pair.marketCap);
  if (key === "freshness") return pair.stale ? 1 : 0;
  return readTransactionCount(pair, "h24");
}

function marketSearchText(pair: BasePair, key: string) {
  return [pair.pair, pair.project, pair.baseToken, pair.quoteToken, pair.baseTokenAddress, pair.quoteTokenAddress, pair.pairAddress, pair.dex, key]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("en-US");
}

function readTransactionCount(pair: BasePair, window: "h1" | "h24") {
  const transactions = pair.txns?.[window];
  if (!transactions || !finitePositiveOrZero(transactions.buys) || !finitePositiveOrZero(transactions.sells)) return undefined;
  return transactions.buys + transactions.sells;
}

function readWindow(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function eligible(pairs: BasePair[], predicate: (pair: BasePair) => boolean) {
  return pairs.filter(predicate);
}

function getMarketKey(pair: BasePair) {
  return getNormalizedMarketModel(pair).key;
}

function compareKeys(left: BasePair, right: BasePair) {
  return getMarketKey(left).localeCompare(getMarketKey(right));
}

function compareNumbers(left: number, right: number) {
  return left === right ? 0 : left < right ? -1 : 1;
}

function finitePositiveOrZero(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function finiteNonNegative(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
