import type { MarketTerminalSnapshot } from "@/data/providers";
import {
  DISCOVERY_MIN_LIQUIDITY_USD,
  DISCOVERY_MIN_VOLUME_24H_USD,
  calculateActivityScore,
  getChange24h,
  getLiquidityUsd,
  getPairAgeMinutes,
  getVolume24h
} from "@/lib/base-terminal/discovery";
import type { BasePair } from "@/types/baseTerminal";
import { canonicalPairKey, calculatePercentChange } from "@/lib/marketMath";
import { shouldAcceptMarketSnapshot } from "@/lib/base-terminal/providerHealth";

export type PulseEventType =
  | "new_pool"
  | "new_opportunity"
  | "primary_market_changed"
  | "entered_trending"
  | "entered_top_gainers"
  | "price_move"
  | "volume_burst"
  | "liquidity_change"
  | "watchlist_move"
  | "data_recovered"
  | "data_delayed";

export type PulseSignal = {
  key: string;
  type: PulseEventType;
  pairId?: string;
  pair?: string;
  headline: string;
  detail: string;
  createdAt: string;
  source: string;
  sourceUpdatedAt: string;
  timeframe?: "snapshot" | "5m" | "24h";
  direction?: "up" | "down" | "neutral";
  value?: number;
};

export type VisitPairSnapshot = {
  id: string;
  identity: string;
  pair: string;
  priceUsd?: number;
  volume24h?: number;
  liquidityUsd?: number;
  activityRank?: number;
};

export type VisitSnapshot = {
  savedAt: string;
  pairs: VisitPairSnapshot[];
};

const SIGNAL_TTL_MS = 30 * 60_000;
const PRICE_MOVE_THRESHOLD_PERCENT = 2;
const WATCHLIST_MOVE_THRESHOLD_PERCENT = 1;
const LIQUIDITY_MOVE_THRESHOLD_PERCENT = 5;
const MIN_M5_VOLUME_BURST_USD = 5_000;
const VOLUME_BURST_MULTIPLE = 1.8;

export function diffMarketSnapshots(
  previous: MarketTerminalSnapshot,
  current: MarketTerminalSnapshot,
  {
    watchedPairIds = [],
    now = new Date(current.generatedAt === "mock-static" ? Date.now() : current.generatedAt)
  }: { watchedPairIds?: string[]; now?: Date } = {}
) {
  if (!shouldAcceptMarketSnapshot(previous, current)) return [];
  const events: PulseSignal[] = [];
  const previousPairs = new Map(previous.allPairs.map((pair) => [getPairIdentity(pair), pair]));
  const watched = new Set(watchedPairIds);
  const createdAt = now.toISOString();
  const common = {
    createdAt,
    source: current.providerName,
    sourceUpdatedAt: current.sourceUpdatedAt
  };

  if (isDelayedSnapshot(current) && !isDelayedSnapshot(previous)) {
    events.push({
      ...common,
      key: "data_delayed:market-feed",
      type: "data_delayed",
      headline: "Market data delayed",
      detail: current.fallbackReason ?? "The last healthy snapshot is being retained.",
      direction: "neutral"
    });
  }
  if (!isDelayedSnapshot(current) && isDelayedSnapshot(previous)) {
    events.push({
      ...common,
      key: "data_recovered:market-feed",
      type: "data_recovered",
      headline: "Market data recovered",
      detail: `${current.providerName} returned a healthy snapshot.`,
      direction: "neutral"
    });
  }

  const previousTrending = new Set(getTrendingPairIds(previous.allPairs));
  const currentTrending = new Set(getTrendingPairIds(current.allPairs));
  const previousGainers = new Set(getTopGainerPairIds(previous.allPairs));
  const currentGainers = new Set(getTopGainerPairIds(current.allPairs));

  for (const pair of current.allPairs) {
    if (pair.stale) continue;
    const identity = getPairIdentity(pair);
    const before = previousPairs.get(identity);
    const liquidity = getLiquidityUsd(pair);
    const volume24h = getVolume24h(pair);
    const qualified = isQualifiedMarket(pair);

    if (!before && qualified && (getPairAgeMinutes(pair) ?? Number.POSITIVE_INFINITY) <= 24 * 60) {
      events.push(
        createPairSignal(pair, common, {
          type: "new_pool",
          headline: "New qualified Base pool",
          detail: `${pair.pair} appeared with ${formatUsd(liquidity)} liquidity and ${formatUsd(volume24h)} 24h volume.`,
          timeframe: "snapshot"
        })
      );
      continue;
    }
    if (!before) continue;

    if (currentTrending.has(pair.id) && !previousTrending.has(before.id)) {
      const score = calculateActivityScore(pair);
      if (score !== undefined) {
        events.push(
          createPairSignal(pair, common, {
            type: "entered_trending",
            headline: "Entered Trending Activity",
            detail: `${pair.pair} reached Activity Score ${score} from complete verified fields.`,
            timeframe: "snapshot",
            value: score
          })
        );
      }
    }

    if (currentGainers.has(pair.id) && !previousGainers.has(before.id)) {
      const change24h = getChange24h(pair);
      if (change24h !== undefined) {
        events.push(
          createPairSignal(pair, common, {
            type: "entered_top_gainers",
            headline: "Entered Top Gainers",
            detail: `${pair.pair} is ${formatPercent(change24h)} over the provider's verified 24h window.`,
            timeframe: "24h",
            direction: change24h >= 0 ? "up" : "down",
            value: change24h
          })
        );
      }
    }

    const priceMove = percentChange(before.priceUsdValue, pair.priceUsdValue);
    const priceMoveThreshold = watched.has(pair.id) ? WATCHLIST_MOVE_THRESHOLD_PERCENT : PRICE_MOVE_THRESHOLD_PERCENT;
    if (qualified && priceMove !== undefined && Math.abs(priceMove) >= priceMoveThreshold) {
      events.push(
        createPairSignal(pair, common, {
          type: watched.has(pair.id) ? "watchlist_move" : "price_move",
          headline: watched.has(pair.id) ? "Watchlist market moved" : "Price moved between snapshots",
          detail: `${pair.pair} moved ${formatPercent(priceMove)} since the previous verified snapshot; liquidity ${formatUsd(liquidity)}.`,
          timeframe: "snapshot",
          direction: priceMove > 0 ? "up" : "down",
          value: priceMove
        })
      );
    }

    const previousM5 = before.volumes?.m5;
    const currentM5 = pair.volumes?.m5;
    if (
      qualified &&
      isFinitePositive(previousM5) &&
      isFinitePositive(currentM5) &&
      currentM5 >= MIN_M5_VOLUME_BURST_USD &&
      currentM5 / previousM5 >= VOLUME_BURST_MULTIPLE
    ) {
      const multiple = currentM5 / previousM5;
      events.push(
        createPairSignal(pair, common, {
          type: "volume_burst",
          headline: "5m volume window expanded",
          detail: `${pair.pair} 5m volume is ${multiple.toFixed(1)}× the prior provider snapshot at ${formatUsd(currentM5)}; liquidity ${formatUsd(liquidity)}.`,
          timeframe: "5m",
          direction: "up",
          value: multiple
        })
      );
    }

    const liquidityMove = percentChange(getLiquidityUsd(before), liquidity);
    if (
      qualified &&
      liquidity !== undefined &&
      liquidity >= DISCOVERY_MIN_LIQUIDITY_USD &&
      liquidityMove !== undefined &&
      Math.abs(liquidityMove) >= LIQUIDITY_MOVE_THRESHOLD_PERCENT
    ) {
      events.push(
        createPairSignal(pair, common, {
          type: "liquidity_change",
          headline: "Liquidity changed",
          detail: `${pair.pair} liquidity moved ${formatPercent(liquidityMove)} to ${formatUsd(liquidity)} between verified snapshots.`,
          timeframe: "snapshot",
          direction: liquidityMove > 0 ? "up" : "down",
          value: liquidityMove
        })
      );
    }
  }

  return events;
}

export function mergePulseSignals(
  existing: PulseSignal[],
  incoming: PulseSignal[],
  now = Date.now(),
  ttlMs = SIGNAL_TTL_MS
) {
  const byKey = new Map<string, PulseSignal>();
  for (const event of [...incoming, ...existing]) {
    const timestamp = new Date(event.createdAt).getTime();
    if (!Number.isFinite(timestamp) || now - timestamp > ttlMs || byKey.has(event.key)) continue;
    byKey.set(event.key, event);
  }
  return [...byKey.values()]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, 40);
}

export function getChangedPairIds(previous: MarketTerminalSnapshot, current: MarketTerminalSnapshot) {
  const previousPairs = new Map(previous.allPairs.map((pair) => [getPairIdentity(pair), pair]));
  return current.allPairs
    .filter((pair) => {
      const before = previousPairs.get(getPairIdentity(pair));
      return !before || [
        before.priceUsdValue !== pair.priceUsdValue,
        getVolume24h(before) !== getVolume24h(pair),
        getLiquidityUsd(before) !== getLiquidityUsd(pair),
        getChange24h(before) !== getChange24h(pair)
      ].some(Boolean);
    })
    .map((pair) => pair.id);
}

export function createVisitSnapshot(snapshot: MarketTerminalSnapshot): VisitSnapshot {
  const activityRanks = new Map(getTrendingPairIds(snapshot.allPairs).map((id, index) => [id, index + 1]));
  return {
    savedAt: new Date().toISOString(),
    pairs: snapshot.allPairs.slice(0, 40).map((pair) => ({
      id: pair.id,
      identity: getPairIdentity(pair),
      pair: pair.pair,
      priceUsd: pair.priceUsdValue,
      volume24h: getVolume24h(pair),
      liquidityUsd: getLiquidityUsd(pair),
      activityRank: activityRanks.get(pair.id)
    }))
  };
}

export function parseVisitSnapshot(value: unknown, now = Date.now()): VisitSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as { savedAt?: unknown; pairs?: unknown };
  if (typeof candidate.savedAt !== "string") return undefined;
  const savedAt = Date.parse(candidate.savedAt);
  if (!Number.isFinite(savedAt) || savedAt > now + 60_000 || !Array.isArray(candidate.pairs)) return undefined;
  const pairs = candidate.pairs.slice(0, 40).flatMap((row): VisitPairSnapshot[] => {
    if (!row || typeof row !== "object") return [];
    const pair = row as Partial<VisitPairSnapshot>;
    const id = readBoundedSnapshotText(pair.id, 128);
    const identity = readBoundedSnapshotText(pair.identity, 256);
    const label = readBoundedSnapshotText(pair.pair, 80);
    if (!id || !identity || !label) return [];
    return [{
      id,
      identity,
      pair: label,
      priceUsd: readOptionalPositiveNumber(pair.priceUsd),
      volume24h: readOptionalNonNegativeNumber(pair.volume24h),
      liquidityUsd: readOptionalNonNegativeNumber(pair.liquidityUsd),
      activityRank: typeof pair.activityRank === "number" && Number.isSafeInteger(pair.activityRank) && pair.activityRank > 0 ? pair.activityRank : undefined
    }];
  });
  return { savedAt: new Date(savedAt).toISOString(), pairs };
}

export function diffSinceLastVisit(
  previous: VisitSnapshot | undefined,
  current: MarketTerminalSnapshot,
  watchedPairIds: string[] = []
) {
  if (!previous) return [];
  const watched = new Set(watchedPairIds);
  const currentByIdentity = new Map(current.allPairs.map((pair) => [getPairIdentity(pair), pair]));
  const currentRanks = new Map(getTrendingPairIds(current.allPairs).map((id, index) => [id, index + 1]));
  const changes: PulseSignal[] = [];

  for (const before of previous.pairs) {
    const pair = currentByIdentity.get(before.identity);
    if (!pair) {
      if (watched.has(before.id)) {
        changes.push({
          key: `since-missing:${before.identity}`,
          type: "data_delayed",
          pairId: before.id,
          pair: before.pair,
          headline: "Watchlist data no longer available",
          detail: `${before.pair} is not present in the latest provider snapshot.`,
          createdAt: current.generatedAt,
          source: current.providerName,
          sourceUpdatedAt: current.sourceUpdatedAt,
          direction: "neutral"
        });
      }
      continue;
    }

    if (pair.stale) continue;

    const currentRank = currentRanks.get(pair.id);
    if (!before.activityRank && currentRank) {
      changes.push({
        ...createPairSignal(pair, {
          createdAt: current.generatedAt,
          source: current.providerName,
          sourceUpdatedAt: current.sourceUpdatedAt
        }, {
          type: "entered_trending",
          headline: "Entered Trending since your last visit",
          detail: `${pair.pair} is now Activity rank #${currentRank}.`,
          timeframe: "snapshot"
        }),
        key: `since-trending:${before.identity}`
      });
    }

    const priceMove = percentChange(before.priceUsd, pair.priceUsdValue);
    if (priceMove !== undefined && Math.abs(priceMove) >= WATCHLIST_MOVE_THRESHOLD_PERCENT) {
      changes.push({
        ...createPairSignal(pair, {
          createdAt: current.generatedAt,
          source: current.providerName,
          sourceUpdatedAt: current.sourceUpdatedAt
        }, {
          type: watched.has(pair.id) ? "watchlist_move" : "price_move",
          headline: watched.has(pair.id) ? "Watchlist move since last visit" : "Moved since last visit",
          detail: `${pair.pair} moved ${formatPercent(priceMove)} since ${formatVisitTime(previous.savedAt)}.`,
          timeframe: "snapshot",
          direction: priceMove > 0 ? "up" : "down",
          value: priceMove
        }),
        key: `since-price:${before.identity}`
      });
    }

    const liquidityMove = percentChange(before.liquidityUsd, getLiquidityUsd(pair));
    if (
      isQualifiedMarket(pair) &&
      liquidityMove !== undefined &&
      Math.abs(liquidityMove) >= LIQUIDITY_MOVE_THRESHOLD_PERCENT
    ) {
      changes.push({
        ...createPairSignal(pair, {
          createdAt: current.generatedAt,
          source: current.providerName,
          sourceUpdatedAt: current.sourceUpdatedAt
        }, {
          type: "liquidity_change",
          headline: "Liquidity changed since your last visit",
          detail: `${pair.pair} liquidity moved ${formatPercent(liquidityMove)} to ${formatUsd(getLiquidityUsd(pair))} since ${formatVisitTime(previous.savedAt)}.`,
          timeframe: "snapshot",
          direction: liquidityMove > 0 ? "up" : "down",
          value: liquidityMove
        }),
        key: `since-liquidity:${before.identity}`
      });
    }
  }

  return changes.slice(0, 20);
}

export function isQualifiedMarket(pair: BasePair) {
  const liquidity = getLiquidityUsd(pair);
  const volume = getVolume24h(pair);
  return !pair.stale && liquidity !== undefined && volume !== undefined && liquidity >= DISCOVERY_MIN_LIQUIDITY_USD && volume >= DISCOVERY_MIN_VOLUME_24H_USD;
}

function createPairSignal(
  pair: BasePair,
  common: Pick<PulseSignal, "createdAt" | "source" | "sourceUpdatedAt">,
  event: Omit<PulseSignal, "key" | "pairId" | "pair" | "createdAt" | "source" | "sourceUpdatedAt">
): PulseSignal {
  return { ...common, ...event, key: `${event.type}:${getPairIdentity(pair)}`, pairId: pair.id, pair: pair.pair };
}

function getTrendingPairIds(pairs: BasePair[]) {
  return pairs
    .map((pair) => ({ pair, score: calculateActivityScore(pair) }))
    .filter((row): row is { pair: BasePair; score: number } => row.score !== undefined)
    .sort((left, right) => right.score - left.score || getPairIdentity(left.pair).localeCompare(getPairIdentity(right.pair), "en-US"))
    .slice(0, 8)
    .map((row) => row.pair.id);
}

function getTopGainerPairIds(pairs: BasePair[]) {
  return pairs
    .filter(isQualifiedMarket)
    .map((pair) => ({ pair, change: getChange24h(pair) }))
    .filter((row): row is { pair: BasePair; change: number } => row.change !== undefined && row.change > 0)
    .sort((left, right) => right.change - left.change || getPairIdentity(left.pair).localeCompare(getPairIdentity(right.pair), "en-US"))
    .slice(0, 8)
    .map((row) => row.pair.id);
}

function getPairIdentity(pair: BasePair) {
  return canonicalPairKey({
    chainId: pair.chainId,
    pairAddress: pair.pairAddress,
    baseTokenAddress: pair.baseTokenAddress,
    quoteTokenAddress: pair.quoteTokenAddress,
    fallbackId: pair.id
  });
}

function isDelayedSnapshot(snapshot: MarketTerminalSnapshot) {
  return Boolean(snapshot.fallbackReason) || snapshot.freshness === "delayed";
}

function percentChange(previous: number | undefined, current: number | undefined) {
  return calculatePercentChange(previous, current);
}

function isFinitePositive(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function formatUsd(value: number | undefined) {
  if (!isFinitePositive(value)) return "unavailable";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function readBoundedSnapshotText(value: unknown, maximumLength: number) {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return text ? text.slice(0, maximumLength) : undefined;
}

function readOptionalPositiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function readOptionalNonNegativeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function formatVisitTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "your last visit" : date.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}
