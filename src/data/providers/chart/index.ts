import type { MarketDataMode } from "../types";
import { geckoTerminalChartProvider } from "./geckoTerminalChartProvider";
import { mockChartProvider } from "./mockChartProvider";
import type { ChartPairInput, PairChartResult } from "./types";

export type {
  ChartPairInput,
  PairChartCandle,
  PairChartProvider,
  PairChartResult,
  PairChartSource
} from "./types";

export async function getPairChart(
  pair: ChartPairInput,
  mode: MarketDataMode
): Promise<PairChartResult> {
  if (mode !== "dexscreener" || pair.dataSource !== "dexscreener") {
    return mockChartProvider.getPairChart(pair);
  }

  return geckoTerminalChartProvider.getPairChart(pair);
}
