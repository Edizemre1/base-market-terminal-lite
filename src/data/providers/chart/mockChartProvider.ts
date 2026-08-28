import type { PairChartProvider } from "./types";

export const mockChartProvider: PairChartProvider = {
  name: "Chart unavailable",
  readOnly: true,
  getPairChart: () => ({
    source: "unavailable",
    label: "OHLCV unavailable",
    updatedAt: new Date().toISOString(),
    candles: [],
    unavailableReason: "Read-only OHLCV is not connected for this pair."
  })
};
