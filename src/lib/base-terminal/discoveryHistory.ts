import type { MarketTerminalSnapshot } from "@/data/providers/types";
import type { PulseSignal } from "@/lib/base-terminal/pulse";
import { getPoolAgeMinutes } from "@/lib/base-terminal/opportunityModel";

const HISTORY_TTL_MS = 30 * 60_000;
const MAX_SNAPSHOTS = 150;
const MAX_EVENTS = 80;
const PRICE_THRESHOLD_PERCENT = 2;
const LIQUIDITY_THRESHOLD_PERCENT = 5;
const VOLUME_ACCELERATION_MULTIPLE = 1.8;

type HistoryPair = {
  id: string;
  opportunityId?: string;
  pair: string;
  poolCreatedAt?: string;
  priceUsd?: number;
  volume5m?: number;
  volume1h?: number;
  liquidityUsd?: number;
};

type HistoryOpportunity = {
  id: string;
  symbol: string;
  primaryMarketId: string;
  poolIds: string[];
};

type HistorySnapshot = {
  generatedAt: string;
  sourceUpdatedAt: string;
  providerName: string;
  freshness: MarketTerminalSnapshot["freshness"];
  pairs: HistoryPair[];
  opportunities: HistoryOpportunity[];
};

const snapshots: HistorySnapshot[] = [];
let events: PulseSignal[] = [];

export function recordDiscoveryHistory(snapshot: MarketTerminalSnapshot, now = Date.now()) {
  if (snapshot.mode === "mock") return { status: "static" as const, signals: [] as PulseSignal[] };
  const compact = compactSnapshot(snapshot);
  const generatedAt = Date.parse(compact.generatedAt);
  if (!Number.isFinite(generatedAt)) return currentHistory("warming", now);
  const previous = snapshots.at(-1);
  if (previous && generatedAt <= Date.parse(previous.generatedAt)) return currentHistory(snapshots.length >= 2 ? "ready" : "warming", now);

  snapshots.push(compact);
  evictSnapshots(now);
  if (snapshot.freshness === "fresh" && previous) {
    events = mergeHistoryEvents(events, diffHistory(previous, compact), now);
  } else if (previous && previous.freshness !== compact.freshness) {
    events = mergeHistoryEvents(events, [dataStateEvent(previous, compact)], now);
  }
  return currentHistory(snapshots.filter((item) => item.freshness === "fresh").length >= 2 ? "ready" : "warming", now);
}

export function resetDiscoveryHistoryForTests() {
  snapshots.splice(0, snapshots.length);
  events = [];
}

export function getDiscoveryHistoryStats(now = Date.now()) {
  evictSnapshots(now);
  events = mergeHistoryEvents(events, [], now);
  return {
    snapshotCount: snapshots.length,
    eventCount: events.length,
    oldestSnapshotAt: snapshots[0]?.generatedAt,
    newestSnapshotAt: snapshots.at(-1)?.generatedAt,
    ttlMinutes: HISTORY_TTL_MS / 60_000,
    bounded: true
  };
}

function currentHistory(status: "warming" | "ready", now: number) {
  events = mergeHistoryEvents(events, [], now);
  return { status, signals: [...events] };
}

function compactSnapshot(snapshot: MarketTerminalSnapshot): HistorySnapshot {
  return {
    generatedAt: snapshot.generatedAt,
    sourceUpdatedAt: snapshot.sourceUpdatedAt,
    providerName: snapshot.providerName,
    freshness: snapshot.freshness,
    pairs: snapshot.allPairs.map((pair) => ({
      id: pair.id,
      opportunityId: pair.opportunityId,
      pair: pair.pair,
      poolCreatedAt: pair.pairCreatedAt,
      priceUsd: finitePositive(pair.priceUsdValue),
      volume5m: finiteNonNegative(pair.volumes?.m5),
      volume1h: finiteNonNegative(pair.volumes?.h1),
      liquidityUsd: finiteNonNegative(pair.liquidityUsd)
    })),
    opportunities: snapshot.opportunities.map((opportunity) => ({
      id: opportunity.id,
      symbol: opportunity.focusTokenSymbol,
      primaryMarketId: opportunity.primaryMarketId,
      poolIds: [...opportunity.poolMarketIds]
    }))
  };
}

function diffHistory(previous: HistorySnapshot, current: HistorySnapshot) {
  const createdAt = current.generatedAt;
  const common = { createdAt, source: current.providerName, sourceUpdatedAt: current.sourceUpdatedAt };
  const beforePairs = new Map(previous.pairs.map((pair) => [pair.id, pair]));
  const currentPairs = new Map(current.pairs.map((pair) => [pair.id, pair]));
  const beforeOpportunities = new Map(previous.opportunities.map((opportunity) => [opportunity.id, opportunity]));
  const signals: PulseSignal[] = [];

  for (const pair of current.pairs) {
    if (beforePairs.has(pair.id)) continue;
    const age = getPoolAgeMinutes(pair.poolCreatedAt, Date.parse(createdAt));
    if (age === undefined || age > 7 * 24 * 60) continue;
    signals.push({
      ...common,
      key: `new_pool:base:pool:${pair.id}`,
      type: "new_pool",
      pairId: pair.id,
      pair: pair.pair,
      headline: "New Base pool",
      detail: `${pair.pair} entered the verified Base pool reservoir.`,
      timeframe: "snapshot",
      direction: "neutral"
    });
  }

  for (const opportunity of current.opportunities) {
    const before = beforeOpportunities.get(opportunity.id);
    if (!before) {
      signals.push({
        ...common,
        key: `new_opportunity:${opportunity.id}`,
        type: "new_opportunity",
        pairId: opportunity.primaryMarketId,
        pair: opportunity.symbol,
        headline: "New token opportunity",
        detail: `${opportunity.symbol} appeared as a distinct contract-backed opportunity.`,
        timeframe: "snapshot",
        direction: "neutral"
      });
      continue;
    }
    if (before.primaryMarketId !== opportunity.primaryMarketId) {
      signals.push({
        ...common,
        key: `primary_market_changed:${opportunity.id}:${opportunity.primaryMarketId}`,
        type: "primary_market_changed",
        pairId: opportunity.primaryMarketId,
        pair: opportunity.symbol,
        headline: "Primary execution pool changed",
        detail: `${opportunity.symbol} moved to a materially stronger or healthier primary pool.`,
        timeframe: "snapshot",
        direction: "neutral"
      });
    }

    const beforePair = beforePairs.get(before.primaryMarketId);
    const pair = currentPairs.get(opportunity.primaryMarketId);
    if (!beforePair || !pair) continue;
    const priceMove = percentChange(beforePair.priceUsd, pair.priceUsd);
    if (priceMove !== undefined && Math.abs(priceMove) >= PRICE_THRESHOLD_PERCENT) {
      signals.push(marketEvent(common, pair, "price_move", `Price moved ${formatPercent(priceMove)} between verified snapshots.`, priceMove));
    }
    if (beforePair.volume5m && pair.volume5m && pair.volume5m / beforePair.volume5m >= VOLUME_ACCELERATION_MULTIPLE) {
      const multiple = pair.volume5m / beforePair.volume5m;
      signals.push(marketEvent(common, pair, "volume_burst", `5m volume accelerated to ${multiple.toFixed(1)}× the prior snapshot.`, multiple));
    }
    const liquidityMove = percentChange(beforePair.liquidityUsd, pair.liquidityUsd);
    if (liquidityMove !== undefined && Math.abs(liquidityMove) >= LIQUIDITY_THRESHOLD_PERCENT) {
      signals.push(marketEvent(common, pair, "liquidity_change", `Liquidity moved ${formatPercent(liquidityMove)} between comparable snapshots.`, liquidityMove));
    }
  }
  return signals;
}

function marketEvent(
  common: Pick<PulseSignal, "createdAt" | "source" | "sourceUpdatedAt">,
  pair: HistoryPair,
  type: "price_move" | "volume_burst" | "liquidity_change",
  detail: string,
  value: number
): PulseSignal {
  return {
    ...common,
    key: `${type}:base:pool:${pair.id}`,
    type,
    pairId: pair.id,
    pair: pair.pair,
    headline: type === "price_move" ? "Price moved" : type === "volume_burst" ? "Volume accelerated" : "Liquidity moved",
    detail,
    timeframe: type === "volume_burst" ? "5m" : "snapshot",
    direction: value > 0 ? "up" : "down",
    value
  };
}

function dataStateEvent(previous: HistorySnapshot, current: HistorySnapshot): PulseSignal {
  const recovered = previous.freshness === "delayed" && current.freshness === "fresh";
  return {
    key: `${recovered ? "data_recovered" : "data_delayed"}:market-feed`,
    type: recovered ? "data_recovered" : "data_delayed",
    headline: recovered ? "Market data recovered" : "Market data delayed",
    detail: recovered ? `${current.providerName} returned a healthy snapshot.` : "The last healthy market snapshot remains in use.",
    createdAt: current.generatedAt,
    source: current.providerName,
    sourceUpdatedAt: current.sourceUpdatedAt,
    direction: "neutral"
  };
}

function mergeHistoryEvents(existing: PulseSignal[], incoming: PulseSignal[], now: number) {
  const unique = new Map<string, PulseSignal>();
  for (const signal of [...incoming, ...existing]) {
    const timestamp = Date.parse(signal.createdAt);
    if (!Number.isFinite(timestamp) || now - timestamp > HISTORY_TTL_MS || unique.has(signal.key)) continue;
    unique.set(signal.key, signal);
  }
  return [...unique.values()]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, MAX_EVENTS);
}

function evictSnapshots(now: number) {
  while (snapshots.length && (snapshots.length > MAX_SNAPSHOTS || now - Date.parse(snapshots[0].generatedAt) > HISTORY_TTL_MS)) snapshots.shift();
}

function percentChange(previous: number | undefined, current: number | undefined) {
  return previous && current ? ((current - previous) / previous) * 100 : undefined;
}

function finitePositive(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function finiteNonNegative(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function formatPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}
