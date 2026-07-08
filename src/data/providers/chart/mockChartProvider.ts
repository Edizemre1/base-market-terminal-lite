import type { ChartPairInput, PairChartProvider } from "./types";

const SYNTHETIC_INTERVAL_SECONDS = 60 * 60;

export const mockChartProvider: PairChartProvider = {
  name: "Synthetic chart preview",
  readOnly: true,
  getPairChart: (pair) => ({
    source: "synthetic",
    label: "Chart preview \u00b7 OHLCV unavailable",
    updatedAt: new Date().toISOString(),
    candles: buildSyntheticCandles(pair),
    unavailableReason: "Read-only OHLCV is not connected for this pair."
  })
};

export function buildSyntheticCandles(pair: ChartPairInput) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const points = pair.chart.length > 0 ? pair.chart : [1];
  const volumePerPoint = pair.volume24h / Math.max(points.length, 1);

  return points.map((close, index) => {
    const previous = points[index - 1] ?? close;
    const movement = Math.abs(close - previous);
    const wick = Math.max(movement * 0.45, Math.abs(close) * 0.006, 0.0001);

    return {
      timestamp: nowSeconds - (points.length - index - 1) * SYNTHETIC_INTERVAL_SECONDS,
      open: previous,
      high: Math.max(previous, close) + wick,
      low: Math.max(0, Math.min(previous, close) - wick),
      close,
      volume: volumePerPoint
    };
  });
}
