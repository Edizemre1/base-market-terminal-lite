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

const DEFAULT_MARKET_DATA_MODE: MarketDataMode = "dexscreener";
const READ_ONLY_DATA_UNAVAILABLE_LABEL =
  "Read-only market data is temporarily unavailable. No sample prices were substituted.";
const NEUTRAL_DEFAULT_PAIR_ORDER = [
  ["WETH", "USDC"],
  ["USDC", "WETH"],
  ["AERO", "USDC"],
  ["WETH", "USDBC"],
  ["CBBTC", "WETH"]
] as const;

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
  return mode === "dexscreener" ? "READ-ONLY DATA" : "MOCK";
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
  const [newPairInputs, volumeInflowInputs, momentumPairInputs] = await Promise.all([
    provider.getNewPairs(),
    provider.getVolumeInflows(),
    provider.getMomentumPairs()
  ]);
  const allPairs = await hydratePairs(
    provider,
    dedupePairs([...newPairInputs, ...volumeInflowInputs, ...momentumPairInputs])
  );
  const pairsById = new Map(allPairs.map((pair) => [pair.id, pair]));
  const newPairs = selectHydratedPairs(newPairInputs, pairsById);
  const volumeInflows = selectHydratedPairs(volumeInflowInputs, pairsById);
  const momentumPairs = selectHydratedPairs(momentumPairInputs, pairsById);
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
  const [activity, liquidityDetail, risk] = await Promise.all([
    provider.getActivityFeed(pair.id),
    provider.getLiquidityDetails(pair.id),
    provider.getRiskDetails(pair.id)
  ]);

  return {
    ...pair,
    dataSource: pair.dataSource ?? (provider.mode === "dexscreener" ? "dexscreener" : "mock"),
    chart: [],
    chartCandles: [],
    chartSource: "unavailable",
    chartLabel: "OHLCV loads for the selected pair",
    chartUpdatedAt: undefined,
    chartUnavailableReason: "Select a pair to request cached read-only OHLCV.",
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
  return {
    ...snapshot,
    defaultPairId: getDefaultPairId(snapshot)
  };
}

function selectHydratedPairs(inputs: BasePair[], pairsById: Map<string, BasePair>) {
  return inputs
    .map((pair) => pairsById.get(pair.id))
    .filter((pair): pair is BasePair => Boolean(pair));
}

function buildDexScreenerFallbackSnapshot(): MarketTerminalSnapshot {
  return {
    mode: "dexscreener",
    providerName: "DexScreener read-only market data",
    feedStatusLabel: "READ-ONLY DATA",
    generatedAt: new Date().toISOString(),
    defaultPairId: "",
    allPairs: [],
    newPairs: [],
    volumeInflows: [],
    momentumPairs: [],
    fallbackReason: READ_ONLY_DATA_UNAVAILABLE_LABEL
  };
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
  const orderedPairs = [...newPairs, ...volumeInflows, ...momentumPairs];
  const livePairs = orderedPairs.filter(isLivePair);
  const preferredLivePair =
    findPreferredNeutralPair(livePairs) ?? getHighestQualityPair(livePairs);

  if (preferredLivePair) {
    return preferredLivePair.id;
  }

  return volumeInflows[0]?.id ?? momentumPairs[0]?.id ?? "";
}

function isLivePair(pair: BasePair) {
  return pair.dataSource === "dexscreener";
}

function findPreferredNeutralPair(pairs: BasePair[]) {
  for (const [baseToken, quoteToken] of NEUTRAL_DEFAULT_PAIR_ORDER) {
    const match = pairs.find(
      (pair) =>
        normalizePairToken(pair.baseToken) === baseToken &&
        normalizePairToken(pair.quoteToken) === quoteToken
    );

    if (match) {
      return match;
    }
  }

  return undefined;
}

function getHighestQualityPair(pairs: BasePair[]) {
  return [...pairs].sort((left, right) => getPairQualityScore(right) - getPairQualityScore(left))[0];
}

function getPairQualityScore(pair: BasePair) {
  return pair.liquidity * 0.65 + pair.volume24h * 0.35;
}

function normalizePairToken(symbol: string) {
  return symbol.trim().replace(/[^a-z0-9]/gi, "").toUpperCase();
}
