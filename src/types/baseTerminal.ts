import type { PairChartCandle, PairChartSource } from "@/data/providers/chart/types";

export type PairRiskCheck = {
  label: string;
  value: string;
  ok: boolean;
};

export type PairActivity = {
  time: string;
  side: "buy" | "sell";
  amount: string;
  value: string;
  wallet: string;
};

export type PairTxnWindow = {
  buys: number;
  sells: number;
};

export type BasePair = {
  dataSource?: "mock" | "dexscreener";
  stale?: boolean;
  staleReason?: string;
  pairAddress?: string;
  baseTokenAddress?: string;
  quoteTokenAddress?: string;
  chainId?: string;
  dexId?: string;
  dexName?: string;
  sourceUrl?: string;
  tokenLogoUrl?: string;
  quoteTokenLogoUrl?: string;
  priceNative?: string;
  priceUsdValue?: number;
  liquidityUsd?: number;
  volumes?: Partial<Record<"m5" | "h1" | "h6" | "h24", number>>;
  priceChanges?: Partial<Record<"m5" | "h1" | "h6" | "h24", number>>;
  txns?: Partial<Record<"m5" | "h1" | "h6" | "h24", PairTxnWindow>>;
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: string;
  pairCreatedAtMs?: number;
  id: string;
  pair: string;
  baseToken: string;
  quoteToken: string;
  project: string;
  address: string;
  route: string;
  dex: string;
  age: string;
  ageMinutes: number;
  price: string;
  priceUsd: string;
  change24h: number;
  volume24h: number;
  liquidity: number;
  inflow24h: number;
  momentumScore: number;
  volumeMultiple: number;
  riskScore: number;
  riskLabel: string;
  chart: number[];
  chartCandles?: PairChartCandle[];
  chartSource?: PairChartSource;
  chartLabel?: string;
  chartUpdatedAt?: string;
  chartUnavailableReason?: string;
  pressure: {
    buy: number;
    sell: number;
  };
  holders: {
    top10: string;
    top50: string;
    top100: string;
    total: string;
    active24h: string;
  };
  poolAge: string;
  flags: string[];
  taxes: {
    buy: string;
    sell: string;
  };
  lpLock: {
    status: string;
    provider: string;
    expires: string;
  };
  riskChecks: PairRiskCheck[];
  liquidityDetail: {
    poolLiquidity: string;
    lpChange: string;
    depth: string;
    routeSource: string;
  };
  activity: PairActivity[];
};
