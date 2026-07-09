export type PairChartSource = "synthetic" | "geckoterminal";
export type ChartTimeframe = "15m" | "1h" | "4h" | "1d";

export type PairChartCandle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type ChartPairInput = {
  id: string;
  dataSource?: "mock" | "dexscreener";
  pairAddress?: string;
  timeframe?: ChartTimeframe;
  chart: number[];
  volume24h: number;
};

export type PairChartResult = {
  candles: PairChartCandle[];
  source: PairChartSource;
  label: string;
  updatedAt: string;
  unavailableReason?: string;
};

export type PairChartProvider = {
  name: string;
  readOnly: true;
  getPairChart: (pair: ChartPairInput) => Promise<PairChartResult> | PairChartResult;
};
