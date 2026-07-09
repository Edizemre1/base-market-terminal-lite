import type { BasePair, PairActivity, PairRiskCheck } from "@/types/baseTerminal";

export type MarketDataMode = "mock" | "dexscreener" | "geckoterminal";
export type FeedStatusLabel =
  | "MOCK"
  | "READ-ONLY DATA"
  | "READ-ONLY DATA + DEMO FALLBACK";
export type MaybePromise<T> = T | Promise<T>;

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
  getNewPairs: () => MaybePromise<BasePair[]>;
  getVolumeInflows: () => MaybePromise<BasePair[]>;
  getMomentumPairs: () => MaybePromise<BasePair[]>;
  getPairById: (id: string) => MaybePromise<BasePair | undefined>;
  getPairChart: (id: string) => MaybePromise<number[]>;
  getRiskDetails: (id: string) => MaybePromise<PairRiskDetails | undefined>;
  getLiquidityDetails: (id: string) => MaybePromise<PairLiquidityDetails | undefined>;
  getActivityFeed: (id: string) => MaybePromise<PairActivity[]>;
};

export type MarketTerminalSnapshot = {
  mode: MarketDataMode;
  providerName: string;
  feedStatusLabel: FeedStatusLabel;
  generatedAt: string;
  defaultPairId: string;
  allPairs: BasePair[];
  newPairs: BasePair[];
  volumeInflows: BasePair[];
  momentumPairs: BasePair[];
  fallbackReason?: string;
};
