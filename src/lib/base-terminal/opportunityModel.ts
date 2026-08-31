import type { BasePair, PairTxnWindow } from "@/types/baseTerminal";
import { calculateReverseChangePercent, invertPositiveValue, reverseOhlcvCandle } from "@/lib/marketMath";
import { calculateOpportunityUsdcPrice, type CanonicalPrice } from "@/lib/base-terminal/canonicalPricing";

export const BASE_DISCOVERY_CHAIN_ID = 8453 as const;
export const NEW_POOL_MAX_AGE_MINUTES = 7 * 24 * 60;
export const JUST_LAUNCHED_MAX_AGE_MINUTES = 24 * 60;
export const DISCOVERY_RESERVOIR_CAPACITY = 1_000;
export const DISCOVERY_OPPORTUNITY_CAPACITY = 600;

export type MarketProviderId = "mock" | "dexscreener" | "geckoterminal" | "onchain";
export type PoolQualityTier = "active" | "thin" | "incomplete" | "expired";
export type PoolOrientation = "direct" | "inverted" | "pair";

export type PoolMarket = {
  id: string;
  chainId: typeof BASE_DISCOVERY_CHAIN_ID;
  poolAddress: string;
  dex: string;
  baseTokenAddress: string;
  quoteTokenAddress: string;
  orientation: PoolOrientation;
  poolCreatedAt?: string;
  firstSeenAt: string;
  sourceUpdatedAt: string;
  liquidityUsd?: number;
  volumes?: BasePair["volumes"];
  priceChanges?: BasePair["priceChanges"];
  transactions?: BasePair["txns"];
  priceUsd?: number;
  fdvUsd?: number;
  verifiedMarketCapUsd?: number;
  blockNumber?: number;
  factoryId?: string;
  factoryAddress?: string;
  protocolVersion?: string;
  transactionHash?: string;
  logIndex?: number;
  confirmedAt?: string;
  metadataStatus?: "complete" | "partial" | "unavailable";
  sourceProviders: MarketProviderId[];
  quality: PoolQualityTier;
};

export type OpportunityAggregate = {
  liquidityUsd?: number;
  volumes?: BasePair["volumes"];
  transactions?: BasePair["txns"];
  contributingPoolCount: number;
};

export type TokenOpportunity = {
  id: string;
  chainId: typeof BASE_DISCOVERY_CHAIN_ID;
  kind: "token";
  focusTokenAddress: string;
  focusTokenSymbol: string;
  focusTokenName: string;
  focusTokenLogoUrl?: string;
  ambiguousPair: boolean;
  poolMarketIds: string[];
  poolCount: number;
  primaryMarketId: string;
  primarySelection: {
    code: "highest_quality" | "unchanged" | "hysteresis_retained" | "previous_invalid" | "material_quality_improvement";
    previousMarketId?: string;
    challengerMarketId?: string;
  };
  executionCandidates: string[];
  aggregate: OpportunityAggregate;
  newestPoolCreatedAt?: string;
  oldestPoolCreatedAt?: string;
  sourceProviders: MarketProviderId[];
  canonicalPrice: CanonicalPrice;
  metadataStatus: "complete" | "partial" | "unavailable";
  tradeability: "market_data_only" | "wallet_required" | "quote_required" | "quote_loading" | "quote_available" | "no_route" | "provider_unavailable" | "wrong_network" | "approval_required" | "simulation_required" | "review_ready" | "transaction_ready" | "expired";
  freshness: {
    newestSourceAt: string;
    oldestSourceAt: string;
    stalePoolCount: number;
  };
  quality: PoolQualityTier;
  categoryEligibility: {
    newlyCreated: boolean;
    justLaunched: boolean;
    moving: boolean;
    liquidity: boolean;
  };
};

export type DiscoveryProviderCoverage = {
  provider: MarketProviderId;
  poolCount: number;
  opportunityCount: number;
};

export type DiscoveryUniverse = {
  rawPoolCount: number;
  uniqueTokenCount: number;
  activeOpportunityCount: number;
  freshOpportunityCount: number;
  newPools24h: number;
  capacity: {
    pools: number;
    opportunities: number;
  };
  qualityCounts: Record<PoolQualityTier, number>;
  providerCoverage: DiscoveryProviderCoverage[];
};

type FocusIdentity = {
  id: string;
  kind: TokenOpportunity["kind"];
  address: string;
  symbol: string;
  name: string;
  logoUrl?: string;
  orientation: PoolOrientation;
  ambiguousPair: boolean;
};

const EVM_ADDRESS = /^0x[0-9a-f]{40}$/i;
const VERIFIED_QUOTE_TOKENS = new Map([
  ["0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", { symbol: "USDC", priority: 1 }],
  ["0x4200000000000000000000000000000000000006", { symbol: "WETH", priority: 2 }],
  ["0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf", { symbol: "cbBTC", priority: 3 }],
  ["0x940181a94a35a4569e4529a3cdfb74e38fd98631", { symbol: "AERO", priority: 4 }],
  ["0xd9aa321b86b65d86f6a7b5b1b0c42ffa531710b6ca", { symbol: "USDbC", priority: 5 }],
  ["0x50c5725949a6f0c72e6c4a641f24049a917db0cb", { symbol: "DAI", priority: 6 }]
] as const);

export function buildDiscoveryUniverse(
  inputPairs: BasePair[],
  previousOpportunities: TokenOpportunity[] = [],
  now = new Date()
) {
  const nowMs = now.getTime();
  const uniquePairs = dedupePoolPairs(inputPairs).slice(0, DISCOVERY_RESERVOIR_CAPACITY);
  const firstSeenAt = now.toISOString();
  const pools = uniquePairs.map((pair) => toPoolMarket(pair, firstSeenAt, nowMs));
  const poolsById = new Map(pools.map((pool) => [pool.id, pool]));
  const pairsById = new Map(uniquePairs.map((pair) => [pair.id, pair]));
  const groups = new Map<string, { focus: FocusIdentity; pairs: BasePair[] }>();

  for (const pair of uniquePairs) {
    const focus = resolveFocusIdentity(pair);
    if (!focus) continue;
    const group = groups.get(focus.id) ?? { focus, pairs: [] };
    group.pairs.push(pair);
    groups.set(focus.id, group);
  }

  const previousById = new Map(previousOpportunities.map((opportunity) => [opportunity.id, opportunity]));
  const opportunities = [...groups.values()]
    .map(({ focus, pairs }) => buildTokenOpportunity(focus, pairs, poolsById, previousById.get(focus.id), nowMs))
    .filter((opportunity): opportunity is TokenOpportunity => Boolean(opportunity))
    .sort(compareOpportunities)
    .slice(0, DISCOVERY_OPPORTUNITY_CAPACITY);
  const opportunitiesById = new Map(opportunities.map((opportunity) => [opportunity.id, opportunity]));
  const annotatedPairs = uniquePairs.map((pair) => {
    const focus = resolveFocusIdentity(pair);
    if (!focus) return pair;
    const opportunity = opportunitiesById.get(focus.id);
    const pool = poolsById.get(pair.id);
    return {
      ...pair,
      dataProviders: getPairProviders(pair),
      sourceUpdatedAt: pair.sourceUpdatedAt ?? firstSeenAt,
      firstSeenAt: pair.firstSeenAt ?? firstSeenAt,
      qualityTier: pool?.quality,
      opportunityId: opportunity?.id,
      opportunityKind: opportunity?.kind,
      focusTokenAddress: opportunity?.focusTokenAddress,
      focusTokenSymbol: opportunity?.focusTokenSymbol,
      focusTokenName: opportunity?.focusTokenName,
      focusTokenLogoUrl: opportunity?.focusTokenLogoUrl,
      poolCount: opportunity?.poolCount,
      isPrimaryMarket: opportunity?.primaryMarketId === pair.id,
      poolOrientation: focus.orientation
    } satisfies BasePair;
  });

  return {
    pairs: annotatedPairs,
    poolMarkets: pools,
    opportunities,
    universe: summarizeUniverse(pools, opportunities, nowMs),
    primaryPairs: opportunities
      .map((opportunity) => pairsById.get(opportunity.primaryMarketId))
      .filter((pair): pair is BasePair => Boolean(pair))
  };
}

export function getOpportunityPrimaryPair(opportunity: TokenOpportunity, pairs: BasePair[]) {
  return pairs.find((pair) => pair.id === opportunity.primaryMarketId);
}

export function getOpportunityForPair(pair: BasePair, opportunities: TokenOpportunity[]) {
  return pair.opportunityId ? opportunities.find((opportunity) => opportunity.id === pair.opportunityId) : undefined;
}

export function orientPairToOpportunity(pair: BasePair, opportunity: TokenOpportunity | undefined): BasePair {
  const focusAddress = normalizeAddress(opportunity?.focusTokenAddress);
  const quoteAddress = normalizeAddress(pair.quoteTokenAddress);
  if (!opportunity || !focusAddress || focusAddress !== quoteAddress) return pair;
  const nativePrice = Number(pair.priceNative);
  const invertedNative = invertPositiveValue(Number.isFinite(nativePrice) ? nativePrice : undefined);
  const focusPriceUsd = invertedNative && pair.priceUsdValue ? invertedNative * pair.priceUsdValue : undefined;
  const reverseChanges = Object.fromEntries(
    Object.entries(pair.priceChanges ?? {}).map(([window, value]) => [window, calculateReverseChangePercent(value)])
  ) as BasePair["priceChanges"];
  return {
    ...pair,
    pair: `${pair.quoteToken} / ${pair.baseToken}`,
    baseToken: pair.quoteToken,
    quoteToken: pair.baseToken,
    baseTokenAddress: pair.quoteTokenAddress,
    quoteTokenAddress: pair.baseTokenAddress,
    tokenLogoUrl: pair.quoteTokenLogoUrl,
    quoteTokenLogoUrl: pair.tokenLogoUrl,
    project: opportunity.focusTokenName,
    address: shortenAddress(opportunity.focusTokenAddress),
    route: `${pair.baseToken} / ${pair.quoteToken}`,
    priceNative: invertedNative?.toPrecision(10),
    price: invertedNative === undefined ? "N/A" : invertedNative.toPrecision(8),
    priceUsdValue: focusPriceUsd,
    priceUsd: focusPriceUsd === undefined ? "N/A" : formatOpportunityUsd(focusPriceUsd),
    priceChanges: reverseChanges,
    change24h: calculateReverseChangePercent(pair.change24h) ?? pair.change24h,
    chartCandles: pair.chartCandles?.map(reverseOhlcvCandle).filter((candle): candle is NonNullable<typeof candle> => Boolean(candle))
  };
}

export function isValidNewPoolTimestamp(value: string | undefined, now = Date.now()) {
  if (!value) return false;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp > now) return false;
  return now - timestamp <= NEW_POOL_MAX_AGE_MINUTES * 60_000;
}

export function getPoolAgeMinutes(value: string | undefined, now = Date.now()) {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp > now) return undefined;
  return Math.floor((now - timestamp) / 60_000);
}

export function choosePrimaryMarket(
  pairs: BasePair[],
  previousPrimaryMarketId?: string
) {
  const ranked = [...pairs]
    .filter(hasExactPoolBinding)
    .sort((left, right) => marketQualityScore(right) - marketQualityScore(left) || comparePoolAddress(left, right));
  const best = ranked[0] ?? [...pairs].sort(comparePoolAddress)[0];
  if (!best || !previousPrimaryMarketId) return best;
  const previous = pairs.find((pair) => pair.id === previousPrimaryMarketId);
  if (!previous || previous.stale || classifyPoolQuality(previous) === "expired" || !hasExactPoolBinding(previous)) return best;
  if (!best || best.id === previous.id) return previous;
  const previousScore = marketQualityScore(previous);
  const bestScore = marketQualityScore(best);
  return bestScore >= previousScore * 1.12 + 25 ? best : previous;
}

export function mergePoolPairs(pairs: BasePair[]) {
  return dedupePoolPairs(pairs);
}

function buildTokenOpportunity(
  focus: FocusIdentity,
  pairs: BasePair[],
  poolsById: Map<string, PoolMarket>,
  previous: TokenOpportunity | undefined,
  nowMs: number
): TokenOpportunity | undefined {
  const uniquePairs = dedupePoolPairs(pairs);
  const primary = choosePrimaryMarket(uniquePairs, previous?.primaryMarketId);
  if (!primary) return undefined;
  const pools = uniquePairs.map((pair) => poolsById.get(pair.id)).filter((pool): pool is PoolMarket => Boolean(pool));
  const timestamps = pools.map((pool) => pool.poolCreatedAt).filter((value): value is string => Boolean(value)).sort();
  const sourceTimes = pools.map((pool) => pool.sourceUpdatedAt).filter(isValidDateString).sort();
  const quality = getOpportunityQuality(pools);
  const newestPoolCreatedAt = timestamps.at(-1);
  const newestAgeMinutes = getPoolAgeMinutes(newestPoolCreatedAt, nowMs);
  const primarySelection = explainPrimarySelection(uniquePairs, primary, previous?.primaryMarketId);
  const canonicalPrice = calculateOpportunityUsdcPrice(focus.address, uniquePairs, new Date(nowMs));
  const metadataStatus = metadataQuality(uniquePairs);
  return {
    id: focus.id,
    chainId: BASE_DISCOVERY_CHAIN_ID,
    kind: focus.kind,
    focusTokenAddress: focus.address,
    focusTokenSymbol: focus.symbol,
    focusTokenName: focus.name,
    focusTokenLogoUrl: focus.logoUrl,
    ambiguousPair: focus.ambiguousPair,
    poolMarketIds: pools.map((pool) => pool.id).sort(),
    poolCount: pools.length,
    primaryMarketId: primary.id,
    primarySelection,
    executionCandidates: [...uniquePairs]
      .filter((pair) => classifyPoolQuality(pair) === "active")
      .sort((left, right) => marketQualityScore(right) - marketQualityScore(left) || comparePoolAddress(left, right))
      .map((pair) => pair.id),
    aggregate: buildAggregate(uniquePairs),
    newestPoolCreatedAt,
    oldestPoolCreatedAt: timestamps[0],
    sourceProviders: uniqueProviders(pools.flatMap((pool) => pool.sourceProviders)),
    canonicalPrice,
    metadataStatus,
    tradeability: "market_data_only",
    freshness: {
      newestSourceAt: sourceTimes.at(-1) ?? new Date(nowMs).toISOString(),
      oldestSourceAt: sourceTimes[0] ?? new Date(nowMs).toISOString(),
      stalePoolCount: uniquePairs.filter((pair) => pair.stale).length
    },
    quality,
    categoryEligibility: {
      newlyCreated: newestAgeMinutes !== undefined && newestAgeMinutes <= NEW_POOL_MAX_AGE_MINUTES,
      justLaunched: newestAgeMinutes !== undefined && newestAgeMinutes <= JUST_LAUNCHED_MAX_AGE_MINUTES,
      moving: getMovingInputs(primary) !== undefined && quality === "active",
      liquidity: quality === "active" && (buildAggregate(uniquePairs).liquidityUsd ?? 0) > 0
    }
  };
}

function toPoolMarket(pair: BasePair, fallbackTime: string, nowMs: number): PoolMarket {
  const focus = resolveFocusIdentity(pair);
  return {
    id: pair.id,
    chainId: BASE_DISCOVERY_CHAIN_ID,
    poolAddress: normalizeAddress(pair.pairAddress) ?? pair.id,
    dex: pair.dexId ?? pair.dexName ?? pair.dex,
    baseTokenAddress: normalizeAddress(pair.baseTokenAddress) ?? "",
    quoteTokenAddress: normalizeAddress(pair.quoteTokenAddress) ?? "",
    orientation: focus?.orientation ?? "pair",
    poolCreatedAt: getPoolAgeMinutes(pair.pairCreatedAt, nowMs) === undefined ? undefined : pair.pairCreatedAt,
    firstSeenAt: isValidDateString(pair.firstSeenAt) ? pair.firstSeenAt! : fallbackTime,
    sourceUpdatedAt: isValidDateString(pair.sourceUpdatedAt) ? pair.sourceUpdatedAt! : fallbackTime,
    liquidityUsd: readNonNegative(pair.liquidityUsd),
    volumes: pair.volumes,
    priceChanges: pair.priceChanges,
    transactions: pair.txns,
    priceUsd: readPositive(pair.priceUsdValue),
    fdvUsd: readPositive(pair.fdv),
    verifiedMarketCapUsd: readPositive(pair.marketCap),
    blockNumber: pair.blockNumber,
    factoryId: pair.onchainProvenance?.factoryId,
    factoryAddress: pair.onchainProvenance?.factoryAddress,
    protocolVersion: pair.onchainProvenance?.protocolVersion,
    transactionHash: pair.onchainProvenance?.transactionHash,
    logIndex: pair.onchainProvenance?.logIndex,
    confirmedAt: pair.onchainProvenance?.confirmedAt,
    metadataStatus: pair.metadataStatus,
    sourceProviders: getPairProviders(pair),
    quality: classifyPoolQuality(pair)
  };
}

function resolveFocusIdentity(pair: BasePair): FocusIdentity | undefined {
  const baseAddress = normalizeAddress(pair.baseTokenAddress);
  const quoteAddress = normalizeAddress(pair.quoteTokenAddress);
  const baseQuote = baseAddress ? VERIFIED_QUOTE_TOKENS.get(baseAddress as never) : undefined;
  const quoteQuote = quoteAddress ? VERIFIED_QUOTE_TOKENS.get(quoteAddress as never) : undefined;

  if (baseAddress && quoteAddress && Boolean(baseQuote) !== Boolean(quoteQuote)) {
    const inverted = Boolean(baseQuote);
    const address = inverted ? quoteAddress : baseAddress;
    return {
      id: `${BASE_DISCOVERY_CHAIN_ID}:token:${address}`,
      kind: "token",
      address,
      symbol: inverted ? pair.quoteToken : pair.baseToken,
      name: inverted ? `${pair.quoteToken} on Base` : pair.project,
      logoUrl: inverted ? pair.quoteTokenLogoUrl : pair.tokenLogoUrl,
      orientation: inverted ? "inverted" : "direct",
      ambiguousPair: false
    };
  }

  if (!baseAddress && !quoteAddress) return undefined;
  const bothQuotes = Boolean(baseQuote && quoteQuote);
  const focusBase = !quoteAddress || Boolean(baseAddress && (!bothQuotes || baseQuote!.priority > quoteQuote!.priority));
  const address = focusBase ? baseAddress! : quoteAddress;
  return {
    id: `${BASE_DISCOVERY_CHAIN_ID}:token:${address}`,
    kind: "token",
    address,
    symbol: focusBase ? pair.baseToken : pair.quoteToken,
    name: focusBase ? pair.project : `${pair.quoteToken} on Base`,
    logoUrl: focusBase ? pair.tokenLogoUrl : pair.quoteTokenLogoUrl,
    orientation: focusBase ? "direct" : "inverted",
    ambiguousPair: false
  };
}

function buildAggregate(pairs: BasePair[]): OpportunityAggregate {
  return {
    liquidityUsd: completeSum(pairs, (pair) => readNonNegative(pair.liquidityUsd)),
    volumes: {
      m5: completeSum(pairs, (pair) => readNonNegative(pair.volumes?.m5)),
      h1: completeSum(pairs, (pair) => readNonNegative(pair.volumes?.h1)),
      h6: completeSum(pairs, (pair) => readNonNegative(pair.volumes?.h6)),
      h24: completeSum(pairs, (pair) => readNonNegative(pair.volumes?.h24))
    },
    transactions: {
      m5: completeTransactions(pairs, "m5"),
      h1: completeTransactions(pairs, "h1"),
      h6: completeTransactions(pairs, "h6"),
      h24: completeTransactions(pairs, "h24")
    },
    contributingPoolCount: pairs.length
  };
}

function completeSum(pairs: BasePair[], read: (pair: BasePair) => number | undefined) {
  const values = pairs.map(read);
  return values.length > 0 && values.every((value): value is number => value !== undefined)
    ? values.reduce((sum, value) => sum + value, 0)
    : undefined;
}

function completeTransactions(pairs: BasePair[], window: "m5" | "h1" | "h6" | "h24"): PairTxnWindow | undefined {
  const values = pairs.map((pair) => pair.txns?.[window]);
  if (!values.length || values.some((value) => !value || readNonNegative(value.buys) === undefined || readNonNegative(value.sells) === undefined)) return undefined;
  return values.reduce<PairTxnWindow>((total, value) => ({ buys: total.buys + value!.buys, sells: total.sells + value!.sells }), { buys: 0, sells: 0 });
}

function classifyPoolQuality(pair: BasePair): PoolQualityTier {
  if (pair.stale) return "expired";
  if (!hasExactPoolBinding(pair) || readPositive(pair.priceUsdValue) === undefined) return "incomplete";
  const liquidity = readNonNegative(pair.liquidityUsd);
  const volume = readNonNegative(pair.volumes?.h24);
  if (liquidity === undefined || volume === undefined) return "incomplete";
  return liquidity >= 10_000 && volume >= 5_000 ? "active" : "thin";
}

function getOpportunityQuality(pools: PoolMarket[]): PoolQualityTier {
  for (const tier of ["active", "thin", "incomplete", "expired"] as const) {
    if (pools.some((pool) => pool.quality === tier)) return tier;
  }
  return "incomplete";
}

function summarizeUniverse(pools: PoolMarket[], opportunities: TokenOpportunity[], nowMs: number): DiscoveryUniverse {
  const qualityCounts = { active: 0, thin: 0, incomplete: 0, expired: 0 } satisfies Record<PoolQualityTier, number>;
  for (const opportunity of opportunities) qualityCounts[opportunity.quality] += 1;
  const providerCoverage = (["onchain", "geckoterminal", "dexscreener", "mock"] as const)
    .map((provider) => ({
      provider,
      poolCount: pools.filter((pool) => pool.sourceProviders.includes(provider)).length,
      opportunityCount: opportunities.filter((opportunity) => opportunity.sourceProviders.includes(provider)).length
    }))
    .filter((coverage) => coverage.poolCount > 0);
  return {
    rawPoolCount: pools.length,
    uniqueTokenCount: opportunities.filter((opportunity) => opportunity.kind === "token").length,
    activeOpportunityCount: qualityCounts.active,
    freshOpportunityCount: opportunities.filter((opportunity) => opportunity.freshness.stalePoolCount === 0).length,
    newPools24h: pools.filter((pool) => {
      const age = getPoolAgeMinutes(pool.poolCreatedAt, nowMs);
      return age !== undefined && age <= JUST_LAUNCHED_MAX_AGE_MINUTES;
    }).length,
    capacity: { pools: DISCOVERY_RESERVOIR_CAPACITY, opportunities: DISCOVERY_OPPORTUNITY_CAPACITY },
    qualityCounts,
    providerCoverage
  };
}

function dedupePoolPairs(pairs: BasePair[]) {
  const unique = new Map<string, BasePair>();
  for (const pair of pairs) {
    const key = normalizeAddress(pair.pairAddress) ?? pair.id.toLowerCase();
    const current = unique.get(key);
    if (!current) {
      unique.set(key, { ...pair, dataProviders: getPairProviders(pair) });
      continue;
    }
    const preferred = marketQualityScore(pair) > marketQualityScore(current) ? pair : current;
    const fallback = preferred === pair ? current : pair;
    unique.set(key, {
      ...fallback,
      ...preferred,
      id: key,
      pairAddress: normalizeAddress(preferred.pairAddress) ?? normalizeAddress(fallback.pairAddress),
      dataProviders: uniqueProviders([...getPairProviders(current), ...getPairProviders(pair)]),
      firstSeenAt: earliestDate(current.firstSeenAt, pair.firstSeenAt),
      sourceUpdatedAt: latestDate(current.sourceUpdatedAt, pair.sourceUpdatedAt)
    });
  }
  return [...unique.values()].sort((left, right) => marketQualityScore(right) - marketQualityScore(left) || comparePoolAddress(left, right));
}

function getPairProviders(pair: BasePair): MarketProviderId[] {
  const providers = pair.dataProviders?.filter(isProvider) ?? [];
  if (pair.dataSource && isProvider(pair.dataSource)) providers.push(pair.dataSource);
  return uniqueProviders(providers);
}

function uniqueProviders(providers: MarketProviderId[]) {
  return [...new Set(providers)].sort();
}

function isProvider(value: string): value is MarketProviderId {
  return value === "mock" || value === "dexscreener" || value === "geckoterminal" || value === "onchain";
}

function hasExactPoolBinding(pair: BasePair) {
  return Boolean(normalizeAddress(pair.pairAddress) && normalizeAddress(pair.baseTokenAddress) && normalizeAddress(pair.quoteTokenAddress));
}

function marketQualityScore(pair: BasePair) {
  const liquidity = readNonNegative(pair.liquidityUsd) ?? 0;
  const volume = readNonNegative(pair.volumes?.h24) ?? 0;
  const completeness = [pair.priceUsdValue, pair.priceChanges?.m5, pair.priceChanges?.h1, pair.priceChanges?.h24, pair.pairCreatedAtMs]
    .filter((value) => typeof value === "number" && Number.isFinite(value)).length;
  const quoteBonus = normalizeAddress(pair.baseTokenAddress) && VERIFIED_QUOTE_TOKENS.has(normalizeAddress(pair.baseTokenAddress)! as never)
    || normalizeAddress(pair.quoteTokenAddress) && VERIFIED_QUOTE_TOKENS.has(normalizeAddress(pair.quoteTokenAddress)! as never) ? 20 : 0;
  return (pair.stale ? -10_000 : 0) + Math.log1p(liquidity) * 100 + Math.log1p(volume) * 55 + completeness * 20 + quoteBonus;
}

function explainPrimarySelection(pairs: BasePair[], selected: BasePair, previousMarketId?: string): TokenOpportunity["primarySelection"] {
  if (!previousMarketId) return { code: "highest_quality" };
  const previous = pairs.find((pair) => pair.id === previousMarketId);
  if (!previous || previous.stale || !hasExactPoolBinding(previous)) {
    return { code: "previous_invalid", previousMarketId };
  }
  if (selected.id === previousMarketId) {
    const challenger = [...pairs].filter((pair) => pair.id !== previousMarketId).sort((left, right) => marketQualityScore(right) - marketQualityScore(left) || comparePoolAddress(left, right))[0];
    return challenger && marketQualityScore(challenger) > marketQualityScore(previous)
      ? { code: "hysteresis_retained", previousMarketId, challengerMarketId: challenger.id }
      : { code: "unchanged", previousMarketId };
  }
  return { code: "material_quality_improvement", previousMarketId, challengerMarketId: selected.id };
}

function metadataQuality(pairs: BasePair[]): TokenOpportunity["metadataStatus"] {
  const states = pairs.map((pair) => pair.metadataStatus).filter(Boolean);
  if (states.length === pairs.length && states.every((state) => state === "complete")) return "complete";
  if (states.length > 0) return "partial";
  return "unavailable";
}

function getMovingInputs(pair: BasePair) {
  const change = pair.priceChanges?.h1;
  const activity = [pair.volumes?.h1, pair.volumes?.h24, pair.txns?.h1?.buys, pair.txns?.h1?.sells, pair.txns?.h24?.buys, pair.txns?.h24?.sells];
  return typeof change === "number" && Number.isFinite(change)
    && activity.every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0)
    ? [change, ...activity]
    : undefined;
}

function compareOpportunities(left: TokenOpportunity, right: TokenOpportunity) {
  const tier = { active: 0, thin: 1, incomplete: 2, expired: 3 } as const;
  return tier[left.quality] - tier[right.quality]
    || (right.aggregate.volumes?.h24 ?? -1) - (left.aggregate.volumes?.h24 ?? -1)
    || (right.aggregate.liquidityUsd ?? -1) - (left.aggregate.liquidityUsd ?? -1)
    || left.id.localeCompare(right.id);
}

function comparePoolAddress(left: BasePair, right: BasePair) {
  return (normalizeAddress(left.pairAddress) ?? left.id).localeCompare(normalizeAddress(right.pairAddress) ?? right.id);
}

function normalizeAddress(value: string | undefined) {
  return value && EVM_ADDRESS.test(value) ? value.toLowerCase() : undefined;
}

function readPositive(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function readNonNegative(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function isValidDateString(value: string | undefined): value is string {
  return Boolean(value && Number.isFinite(Date.parse(value)));
}

function earliestDate(left: string | undefined, right: string | undefined) {
  const values = [left, right].filter(isValidDateString).sort();
  return values[0];
}

function latestDate(left: string | undefined, right: string | undefined) {
  const values = [left, right].filter(isValidDateString).sort();
  return values.at(-1);
}

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatOpportunityUsd(value: number) {
  if (value >= 1) return `$${value.toLocaleString("en-US", { maximumFractionDigits: 6 })}`;
  return `$${value.toPrecision(6)}`;
}
