import type { BasePair, PairActivity, PairRiskCheck } from "@/types/baseTerminal";

export type MarketDataMode = "mock" | "dexscreener" | "geckoterminal";

export type PairRiskDetails = {
  riskScore: number;
  riskLabel: string;
  riskChecks: PairRiskCheck[];
  flags: string[];
  holders: BasePair["holders"];
  taxes: BasePair["taxes"];
  lpLock: BasePair["lpLock"];
};

export type PairLiquidityDetails = BasePair["liquidityDetail"];

export type MarketDataProvider = {
  mode: MarketDataMode;
  name: string;
  readOnly: true;
  getNewPairs: () => BasePair[];
  getVolumeInflows: () => BasePair[];
  getMomentumPairs: () => BasePair[];
  getPairById: (id: string) => BasePair | undefined;
  getPairChart: (id: string) => number[];
  getRiskDetails: (id: string) => PairRiskDetails | undefined;
  getLiquidityDetails: (id: string) => PairLiquidityDetails | undefined;
  getActivityFeed: (id: string) => PairActivity[];
};

export type MarketTerminalSnapshot = {
  mode: MarketDataMode;
  providerName: string;
  generatedAt: string;
  defaultPairId: string;
  allPairs: BasePair[];
  newPairs: BasePair[];
  volumeInflows: BasePair[];
  momentumPairs: BasePair[];
};
