import type { MarketDataProvider } from "./types";

// Future integration placeholder:
// Add read-only DexScreener market data behind a server/backend boundary.
// This file intentionally performs no live requests and contains no credentials.
export function createDexScreenerProvider(): MarketDataProvider {
  return {
    mode: "dexscreener",
    name: "DexScreener placeholder",
    readOnly: true,
    getNewPairs: () => [],
    getVolumeInflows: () => [],
    getMomentumPairs: () => [],
    getPairById: () => undefined,
    getPairChart: () => [],
    getRiskDetails: () => undefined,
    getLiquidityDetails: () => undefined,
    getActivityFeed: () => []
  };
}
