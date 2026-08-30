import type { BasePair, PairActivity, PairRiskCheck } from "@/types/baseTerminal";
import type { DiscoveryUniverse, PoolMarket, TokenOpportunity } from "@/lib/base-terminal/opportunityModel";
import type { PulseSignal } from "@/lib/base-terminal/pulse";

export type MarketDataMode = "mock" | "dexscreener" | "geckoterminal";
export type FeedStatusLabel =
  | "MOCK"
  | "READ-ONLY DATA"
  | "READ-ONLY DATA + DEMO FALLBACK";
export type MaybePromise<T> = T | Promise<T>;

export type PairRiskDetails = {
  riskScore?: number;
  riskLabel?: string;
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
  coverage?: {
    providers: string[];
    pagesRequested: number;
    pagesLoaded: number;
    capabilities: string[];
  };
  getAllPairs: () => MaybePromise<BasePair[]>;
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
  version: string;
  receivedAt: string;
  generatedAt: string;
  sourceUpdatedAt: string;
  freshness: "fresh" | "delayed" | "static";
  defaultPairId: string;
  allPairs: BasePair[];
  poolMarkets: PoolMarket[];
  opportunities: TokenOpportunity[];
  universe: DiscoveryUniverse;
  recentSignals: PulseSignal[];
  historyStatus: "warming" | "ready" | "static";
  comparison: {
    status: "warming" | "ready" | "static";
    previousGeneratedAt?: string;
    opportunityVolume1h: Record<string, number>;
  };
  providerCoverage?: MarketDataProvider["coverage"];
  newPairs: BasePair[];
  volumeInflows: BasePair[];
  momentumPairs: BasePair[];
  fallbackReason?: string;
};
