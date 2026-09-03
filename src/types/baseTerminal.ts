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
  dataSource?: "mock" | "dexscreener" | "geckoterminal" | "onchain";
  dataProviders?: Array<"mock" | "dexscreener" | "geckoterminal" | "onchain">;
  sourceUpdatedAt?: string;
  firstSeenAt?: string;
  qualityTier?: "active" | "thin" | "incomplete" | "expired";
  qualityBand?: "RANKED" | "EMERGING" | "DETECTED" | "REJECTED";
  liquidityState?: "usable_liquidity" | "thin_liquidity" | "liquidity_unknown" | "zero_liquidity" | "conflicting_liquidity" | "stale_liquidity";
  observedPriceUsd?: number;
  observedPriceProvider?: string;
  observedPricePoolAddress?: string;
  observedPriceAt?: string;
  providerDiscoveryState?: "matched" | "pending" | "not_found" | "conflicting" | "detected";
  providerIndexedAt?: string;
  opportunityId?: string;
  opportunityKind?: "token";
  focusTokenAddress?: string;
  focusTokenSymbol?: string;
  focusTokenName?: string;
  focusTokenLogoUrl?: string;
  poolCount?: number;
  isPrimaryMarket?: boolean;
  poolOrientation?: "direct" | "inverted" | "pair";
  metadataStatus?: "complete" | "partial" | "unavailable";
  metadataVerificationState?: "verified" | "legacy_verified" | "pending" | "quarantined" | "rejected";
  onchainStateEvidence?: {
    token0?: string;
    token1?: string;
    decimals0?: number;
    decimals1?: number;
    status?: "complete" | "pending" | "retryable" | "rejected" | "unsupported";
    adapterFamily?: string;
    protocolFamily?: string;
    reasonCode?: string;
    confidence?: string;
    sourceMethod?: string;
    blockNumber?: number;
    blockHash?: string;
    observedAt?: string;
    observedPrice0In1?: number;
    observedPrice1In0?: number;
    reserve0Raw?: string;
    reserve1Raw?: string;
    balance0Raw?: string;
    balance1Raw?: string;
  };
  priceReconciliation?: { status?: "agreement" | "conflict" | "provider_only" | "onchain_only" | "unavailable"; provider?: number; onchain?: number; deviation?: number; reasonCode?: string; providerObservedAt?: string; onchainObservedAt?: string; onchainBlockNumber?: number; onchainBlockHash?: string };
  liquidityReconciliation?: { status?: "agreement" | "conflict" | "provider_only" | "onchain_only" | "unavailable"; provider?: number; onchain?: number; deviation?: number; reasonCode?: string; providerObservedAt?: string; onchainObservedAt?: string; onchainBlockNumber?: number };
  blockNumber?: number;
  onchainProvenance?: {
    factoryId: string;
    factoryAddress: string;
    protocolVersion: string;
    transactionHash?: string;
    logIndex?: number;
    confirmedAt: string;
    bindingKind?: "factory_event" | "registered_pool_identity";
    decimalsVerified?: boolean;
  };
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
  ageMinutes?: number;
  price: string;
  priceUsd: string;
  change24h?: number;
  volume24h?: number;
  liquidity?: number;
  inflow24h?: number;
  momentumScore?: number;
  volumeMultiple?: number;
  riskScore?: number;
  riskLabel?: string;
  chart: number[];
  chartCandles?: PairChartCandle[];
  chartSource?: PairChartSource;
  chartLabel?: string;
  chartUpdatedAt?: string;
  chartUnavailableReason?: string;
  pressure?: {
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
