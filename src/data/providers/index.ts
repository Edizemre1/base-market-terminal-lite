import type { BasePair } from "@/types/baseTerminal";
import { createDexScreenerProvider } from "./dexScreenerProvider";
import { mockMarketDataProvider } from "./mockProvider";
import type {
  FeedStatusLabel,
  MarketDataMode,
  MarketDataProvider,
  MarketTerminalSnapshot
} from "./types";

export { createDexScreenerProvider } from "./dexScreenerProvider";
export { createGeckoTerminalProvider } from "./geckoTerminalProvider";
export type {
  FeedStatusLabel,
  MarketDataMode,
  MarketDataProvider,
  MarketTerminalSnapshot,
  PairLiquidityDetails,
  PairRiskDetails
} from "./types";

const DEFAULT_MARKET_DATA_MODE: MarketDataMode = "mock";
const FEED_ROW_TARGET = 8;
const LIVE_DATA_FALLBACK_LABEL = "Live data preview + demo fallback";

export function resolveMarketDataMode(
  mode = process.env.MARKET_DATA_MODE ?? process.env.NEXT_PUBLIC_MARKET_DATA_MODE
): MarketDataMode {
  const normalized = mode?.trim().toLowerCase();

  if (normalized === "dexscreener") {
    return "dexscreener";
  }

  if (normalized === "mock") {
    return "mock";
  }

  return DEFAULT_MARKET_DATA_MODE;
}

export function resolveUrlMarketDataMode(
  data: string | string[] | undefined | null
): MarketDataMode {
  const mode = Array.isArray(data) ? data[0] : data;
  return resolveMarketDataMode(mode ?? DEFAULT_MARKET_DATA_MODE);
}

export function getMarketFeedStatusLabel(
  mode: MarketDataMode = resolveMarketDataMode()
): FeedStatusLabel {
  return mode === "dexscreener" ? "LIVE DATA PREVIEW" : "MOCK FEED";
}

export async function getMarketDataProvider(
  mode: MarketDataMode = resolveMarketDataMode()
): Promise<MarketDataProvider> {
  if (mode === "dexscreener") {
    return createDexScreenerProvider();
  }

  return mockMarketDataProvider;
}

export async function getMarketTerminalSnapshot(
  mode: MarketDataMode = resolveMarketDataMode()
): Promise<MarketTerminalSnapshot> {
  if (mode === "mock") {
    return buildMarketTerminalSnapshot(mockMarketDataProvider);
  }

  try {
    const provider = await getMarketDataProvider(mode);
    const snapshot = await buildMarketTerminalSnapshot(provider);

    if (mode === "dexscreener") {
      return fillDexScreenerSnapshot(snapshot);
    }

    return snapshot;
  } catch {
    return buildDexScreenerFallbackSnapshot();
  }
}

async function buildMarketTerminalSnapshot(
  provider: MarketDataProvider,
  fallbackReason?: string
): Promise<MarketTerminalSnapshot> {
  const newPairs = await hydratePairs(provider, await provider.getNewPairs());
  const volumeInflows = await hydratePairs(provider, await provider.getVolumeInflows());
  const momentumPairs = await hydratePairs(provider, await provider.getMomentumPairs());
  const allPairs = dedupePairs([...newPairs, ...volumeInflows, ...momentumPairs]);
  const defaultPairId = allPairs[0]?.id ?? "";

  return {
    mode: provider.mode,
    providerName: provider.name,
    feedStatusLabel: getMarketFeedStatusLabel(provider.mode),
    generatedAt: provider.mode === "mock" ? "mock-static" : new Date().toISOString(),
    defaultPairId,
    allPairs,
    newPairs,
    volumeInflows,
    momentumPairs,
    fallbackReason
  };
}

async function hydratePairs(provider: MarketDataProvider, pairs: BasePair[]) {
  return Promise.all(pairs.map((pair) => hydratePair(provider, pair)));
}

async function hydratePair(
  provider: MarketDataProvider,
  pair: BasePair
): Promise<BasePair> {
  const [chart, activity, liquidityDetail, risk] = await Promise.all([
    provider.getPairChart(pair.id),
    provider.getActivityFeed(pair.id),
    provider.getLiquidityDetails(pair.id),
    provider.getRiskDetails(pair.id)
  ]);

  return {
    ...pair,
    dataSource: pair.dataSource ?? (provider.mode === "dexscreener" ? "dexscreener" : "mock"),
    chart,
    activity,
    liquidityDetail: liquidityDetail ?? pair.liquidityDetail,
    riskScore: risk?.riskScore ?? pair.riskScore,
    riskLabel: risk?.riskLabel ?? pair.riskLabel,
    riskChecks: risk?.riskChecks ?? pair.riskChecks,
    flags: risk?.flags ?? pair.flags,
    holders: risk?.holders ?? pair.holders,
    taxes: risk?.taxes ?? pair.taxes,
    lpLock: risk?.lpLock ?? pair.lpLock
  };
}

function dedupePairs(pairs: BasePair[]) {
  const pairsById = new Map<string, BasePair>();

  for (const pair of pairs) {
    if (!pairsById.has(pair.id)) {
      pairsById.set(pair.id, pair);
    }
  }

  return [...pairsById.values()];
}

async function fillDexScreenerSnapshot(
  snapshot: MarketTerminalSnapshot
): Promise<MarketTerminalSnapshot> {
  const mockSnapshot = await buildMarketTerminalSnapshot(mockMarketDataProvider);
  const newPairs = snapshot.newPairs;
  const volumeInflows = fillFeed(snapshot.volumeInflows, mockSnapshot.volumeInflows);
  const momentumPairs = fillFeed(snapshot.momentumPairs, mockSnapshot.momentumPairs);
  const allPairs = dedupePairs([...newPairs, ...volumeInflows, ...momentumPairs]);
  const usedFallback =
    volumeInflows.length > snapshot.volumeInflows.length ||
    momentumPairs.length > snapshot.momentumPairs.length;
  const defaultPairId = getDefaultPairId({ newPairs, volumeInflows, momentumPairs });

  if (!usedFallback) {
    return {
      ...snapshot,
      defaultPairId
    };
  }

  return {
    ...snapshot,
    providerName: "Read-only Base market preview + demo fallback",
    feedStatusLabel: "LIVE DATA PREVIEW + DEMO FALLBACK",
    defaultPairId,
    allPairs,
    newPairs,
    volumeInflows,
    momentumPairs,
    fallbackReason: LIVE_DATA_FALLBACK_LABEL
  };
}

async function buildDexScreenerFallbackSnapshot() {
  const mockSnapshot = await buildMarketTerminalSnapshot(mockMarketDataProvider);
  return withDexScreenerFallbackLabel(mockSnapshot);
}

function withDexScreenerFallbackLabel(snapshot: MarketTerminalSnapshot): MarketTerminalSnapshot {
  const newPairs: BasePair[] = [];
  const volumeInflows = snapshot.volumeInflows.slice(0, FEED_ROW_TARGET);
  const momentumPairs = snapshot.momentumPairs.slice(0, FEED_ROW_TARGET);
  const allPairs = dedupePairs([...volumeInflows, ...momentumPairs]);

  return {
    ...snapshot,
    mode: "dexscreener",
    providerName: "Read-only Base market preview + demo fallback",
    feedStatusLabel: "LIVE DATA PREVIEW + DEMO FALLBACK",
    generatedAt: new Date().toISOString(),
    defaultPairId: allPairs[0]?.id ?? "",
    allPairs,
    newPairs,
    volumeInflows,
    momentumPairs,
    fallbackReason: LIVE_DATA_FALLBACK_LABEL
  };
}

function fillFeed(primary: BasePair[], fallback: BasePair[]) {
  const result = primary.slice(0, FEED_ROW_TARGET);
  const seenIds = new Set(result.map((pair) => pair.id));
  const seenPairKeys = new Set(result.map(getPairKey));

  for (const pair of fallback) {
    if (result.length >= FEED_ROW_TARGET) {
      break;
    }

    const pairKey = getPairKey(pair);

    if (seenIds.has(pair.id) || seenPairKeys.has(pairKey)) {
      continue;
    }

    result.push(pair);
    seenIds.add(pair.id);
    seenPairKeys.add(pairKey);
  }

  return result;
}

function getPairKey(pair: BasePair) {
  return `${pair.baseToken.toLowerCase()}-${pair.quoteToken.toLowerCase()}`;
}

function getDefaultPairId({
  newPairs,
  volumeInflows,
  momentumPairs
}: {
  newPairs: BasePair[];
  volumeInflows: BasePair[];
  momentumPairs: BasePair[];
}) {
  const livePair =
    newPairs.find(isLivePair) ??
    volumeInflows.find(isLivePair) ??
    momentumPairs.find(isLivePair);

  if (livePair) {
    return livePair.id;
  }

  return volumeInflows[0]?.id ?? momentumPairs[0]?.id ?? "";
}

function isLivePair(pair: BasePair) {
  return pair.dataSource === "dexscreener";
}
