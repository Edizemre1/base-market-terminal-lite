import type { BasePair } from "@/types/baseTerminal";
import { mockMarketDataProvider } from "./mockProvider";
import type {
  MarketDataMode,
  MarketDataProvider,
  MarketTerminalSnapshot
} from "./types";

export { createDexScreenerProvider } from "./dexScreenerProvider";
export { createGeckoTerminalProvider } from "./geckoTerminalProvider";
export type {
  MarketDataMode,
  MarketDataProvider,
  MarketTerminalSnapshot,
  PairLiquidityDetails,
  PairRiskDetails
} from "./types";

const DEFAULT_MARKET_DATA_MODE: MarketDataMode = "mock";

export function resolveMarketDataMode(mode = process.env.NEXT_PUBLIC_MARKET_DATA_MODE) {
  const normalized = mode?.trim().toLowerCase();

  if (normalized === "dexscreener" || normalized === "geckoterminal") {
    return DEFAULT_MARKET_DATA_MODE;
  }

  return DEFAULT_MARKET_DATA_MODE;
}

export function getMarketDataProvider(
  mode: MarketDataMode = resolveMarketDataMode()
): MarketDataProvider {
  if (mode === "mock") {
    return mockMarketDataProvider;
  }

  return mockMarketDataProvider;
}

export function getMarketTerminalSnapshot(
  provider: MarketDataProvider = getMarketDataProvider()
): MarketTerminalSnapshot {
  const newPairs = hydratePairs(provider, provider.getNewPairs());
  const volumeInflows = hydratePairs(provider, provider.getVolumeInflows());
  const momentumPairs = hydratePairs(provider, provider.getMomentumPairs());
  const allPairs = dedupePairs([...newPairs, ...volumeInflows, ...momentumPairs]);
  const defaultPairId = allPairs[0]?.id ?? "";

  return {
    mode: provider.mode,
    providerName: provider.name,
    generatedAt: "mock-static",
    defaultPairId,
    allPairs,
    newPairs,
    volumeInflows,
    momentumPairs
  };
}

function hydratePairs(provider: MarketDataProvider, pairs: BasePair[]) {
  return pairs.map((pair) => hydratePair(provider, pair));
}

function hydratePair(provider: MarketDataProvider, pair: BasePair): BasePair {
  const risk = provider.getRiskDetails(pair.id);

  return {
    ...pair,
    chart: provider.getPairChart(pair.id),
    activity: provider.getActivityFeed(pair.id),
    liquidityDetail: provider.getLiquidityDetails(pair.id) ?? pair.liquidityDetail,
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
