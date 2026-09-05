import type { BasePair } from "@/types/baseTerminal";
import { buildDiscoveryUniverse, mergePoolPairs } from "@/lib/base-terminal/opportunityModel";
import { collectorFreshness, getOnchainPricingStatus, mergeOnchainPoolsIntoPairs, readOnchainStoreSnapshot, type OnchainStoreReadResult } from "@/lib/base-terminal/onchainDiscovery";
import { recordDiscoveryHistory } from "@/lib/base-terminal/discoveryHistory";
import { createDexScreenerProvider } from "./dexScreenerProvider";
import { mockMarketDataProvider } from "./mockProvider";
import type {
  FeedStatusLabel,
  MarketDataMode,
  MarketDataProvider,
  MarketTerminalSnapshot
} from "./types";

export { createDexScreenerProvider } from "./dexScreenerProvider";
export { createGeckoTerminalProvider } from "./geckoTerminalProvider";
export type {
  FeedStatusLabel,
  MarketDataMode,
  MarketDataProvider,
  MarketTerminalSnapshot,
  PairLiquidityDetails,
  PairRiskDetails
} from "./types";

const DEFAULT_MARKET_DATA_MODE: MarketDataMode = "dexscreener";
const READ_ONLY_DATA_UNAVAILABLE_LABEL =
  "Read-only market data is temporarily unavailable. No sample prices were substituted.";
const SNAPSHOT_CACHE_TTL_MS = 12_000;
const SNAPSHOT_FAIL_SOFT_MS = 3 * 60_000;
const SNAPSHOT_REFRESH_DEADLINE_MS = 2 * 60_000;
const SNAPSHOT_RETRY_BACKOFF_MS = 5_000;
const RESERVOIR_TTL_MS = 30 * 60_000;
const ACTIVE_RESERVOIR_GRACE_MS = 3 * 60_000;
type SnapshotCacheEntry = {
  snapshot?: MarketTerminalSnapshot;
  cachedAt?: number;
  retryAfter?: number;
  inFlight?: Promise<MarketTerminalSnapshot>;
  bootstrap?: boolean;
};
const snapshotCache = new Map<MarketDataMode, SnapshotCacheEntry>();
export const MARKET_SNAPSHOT_RESILIENCE_POLICY = Object.freeze({
  cacheTtlMs: SNAPSHOT_CACHE_TTL_MS,
  failSoftMs: SNAPSHOT_FAIL_SOFT_MS,
  refreshDeadlineMs: SNAPSHOT_REFRESH_DEADLINE_MS,
  retryBackoffMs: SNAPSHOT_RETRY_BACKOFF_MS
});
const NEUTRAL_DEFAULT_PAIR_ORDER = [
  ["WETH", "USDC"],
  ["USDC", "WETH"],
  ["AERO", "USDC"],
  ["WETH", "USDBC"],
  ["CBBTC", "WETH"]
] as const;

export function resolveMarketDataMode(
  mode = process.env.MARKET_DATA_MODE ?? process.env.NEXT_PUBLIC_MARKET_DATA_MODE
): MarketDataMode {
  const normalized = mode?.trim().toLowerCase();

  if (normalized === "dexscreener") {
    return "dexscreener";
  }

  if (normalized === "mock") {
    return "mock";
  }

  return DEFAULT_MARKET_DATA_MODE;
}

export function resolveUrlMarketDataMode(
  data: string | string[] | undefined | null
): MarketDataMode {
  const mode = Array.isArray(data) ? data[0] : data;
  return resolveMarketDataMode(mode ?? DEFAULT_MARKET_DATA_MODE);
}

export function getMarketFeedStatusLabel(
  mode: MarketDataMode = resolveMarketDataMode()
): FeedStatusLabel {
  return mode === "dexscreener" ? "READ-ONLY DATA" : "MOCK";
}

export async function getMarketDataProvider(
  mode: MarketDataMode = resolveMarketDataMode()
): Promise<MarketDataProvider> {
  if (mode === "dexscreener") {
    return createDexScreenerProvider();
  }

  return mockMarketDataProvider;
}

export async function getMarketTerminalSnapshot(
  mode: MarketDataMode = resolveMarketDataMode(),
  options: { force?: boolean; preferLastGood?: boolean } = {}
): Promise<MarketTerminalSnapshot> {
  if (mode === "mock") {
    return buildMarketTerminalSnapshot(mockMarketDataProvider);
  }

  const now = Date.now();
  let entry = snapshotCache.get(mode) ?? {};
  if (!options.force && options.preferLastGood && !entry.snapshot) {
    const bootstrap = buildOnchainLastGoodSnapshot();
    if (bootstrap) {
      entry = { snapshot: bootstrap, cachedAt: now, bootstrap: true };
      snapshotCache.set(mode, entry);
    }
  }
  if (!options.force && !entry.bootstrap && entry.snapshot && entry.cachedAt && now - entry.cachedAt < SNAPSHOT_CACHE_TTL_MS) {
    return entry.snapshot;
  }
  if (!options.force && entry.inFlight) {
    return entry.snapshot && isMarketSnapshotWithinFailSoftWindow(entry.cachedAt, now)
      ? markMarketSourceState(entry.snapshot, "refreshing", "Provider refresh is in progress; using the last healthy snapshot.")
      : entry.inFlight;
  }
  if (!options.force && entry.snapshot && entry.retryAfter && now < entry.retryAfter && isMarketSnapshotWithinFailSoftWindow(entry.cachedAt, now)) {
    return markMarketSourceState(entry.snapshot, "delayed", "Provider retry is temporarily backed off; using the last healthy snapshot.");
  }

  const inFlight = withSnapshotRefreshDeadline(loadLiveMarketTerminalSnapshot(mode, entry.snapshot))
    .then((snapshot) => {
      snapshotCache.set(mode, { snapshot, cachedAt: Date.now() });
      return snapshot;
    })
    .catch(() => {
      const cached = entry.snapshot;
      const cachedAt = entry.cachedAt ?? 0;
      snapshotCache.set(mode, {
        ...entry,
        inFlight: undefined,
        bootstrap: false,
        retryAfter: Date.now() + SNAPSHOT_RETRY_BACKOFF_MS
      });
      if (cached && isMarketSnapshotWithinFailSoftWindow(cachedAt)) {
        return markMarketSourceState(cached, "delayed", "Provider refresh failed; using the last healthy snapshot.");
      }
      return buildDexScreenerFallbackSnapshot();
    });

  snapshotCache.set(mode, { ...entry, inFlight });
  if (!options.force && entry.snapshot && isMarketSnapshotWithinFailSoftWindow(entry.cachedAt, now)) {
    return markMarketSourceState(entry.snapshot, "refreshing", "Provider refresh is running in the background; using the last healthy snapshot.");
  }
  return inFlight;
}

export function isMarketSnapshotWithinFailSoftWindow(cachedAt: number | undefined, now = Date.now()) {
  return typeof cachedAt === "number" && Number.isFinite(cachedAt) && now >= cachedAt && now - cachedAt <= SNAPSHOT_FAIL_SOFT_MS;
}

async function withSnapshotRefreshDeadline(task: Promise<MarketTerminalSnapshot>) {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error("Market snapshot refresh deadline exceeded.")), SNAPSHOT_REFRESH_DEADLINE_MS);
      })
    ]);
  } finally {
    if (deadline) clearTimeout(deadline);
  }
}

async function loadLiveMarketTerminalSnapshot(mode: MarketDataMode, previous?: MarketTerminalSnapshot) {
  const provider = await getMarketDataProvider(mode);
  const snapshot = await buildMarketTerminalSnapshot(provider, undefined, previous);
  if (mode === "dexscreener" && snapshot.allPairs.length === 0) {
    throw new Error("Provider returned no qualified Base pairs");
  }
  return mode === "dexscreener" ? fillDexScreenerSnapshot(snapshot) : snapshot;
}

async function buildMarketTerminalSnapshot(
  provider: MarketDataProvider,
  fallbackReason?: string,
  previous?: MarketTerminalSnapshot
): Promise<MarketTerminalSnapshot> {
  const receivedAt = new Date().toISOString();
  const [allPairInputs, newPairInputs, volumeInflowInputs, momentumPairInputs] = await Promise.all([
    provider.getAllPairs(),
    provider.getNewPairs(),
    provider.getVolumeInflows(),
    provider.getMomentumPairs()
  ]);
  const hydratedPairs = await hydratePairs(
    provider,
    dedupePairs([...allPairInputs, ...newPairInputs, ...volumeInflowInputs, ...momentumPairInputs])
  );
  // Explicit sample mode stays isolated from the staging collector store. The
  // live provider alone may merge the persisted on-chain discovery reservoir.
  const storeResult = provider.mode === "dexscreener" ? readOnchainStoreSnapshot() : undefined;
  const providerPairs = provider.mode === "dexscreener"
    ? mergeOnchainPoolsIntoPairs(hydratedPairs, storeResult)
    : hydratedPairs;
  const discoveryInput = mergeWithPreviousReservoir(providerPairs, previous, receivedAt);
  const discovery = buildDiscoveryUniverse(
    discoveryInput.map((pair) => ({
      ...pair,
      sourceUpdatedAt: pair.sourceUpdatedAt ?? receivedAt,
      firstSeenAt: pair.firstSeenAt ?? receivedAt
    })),
    previous?.opportunities,
    new Date(receivedAt)
  );
  const allPairs = discovery.pairs;
  const pairsById = new Map(allPairs.map((pair) => [pair.id, pair]));
  const newPairs = selectHydratedPairs(newPairInputs, pairsById);
  const volumeInflows = selectHydratedPairs(volumeInflowInputs, pairsById);
  const momentumPairs = selectHydratedPairs(momentumPairInputs, pairsById);
  const providerDefaultPairId = allPairInputs[0]?.id;
  const defaultPairId = provider.mode === "mock" && providerDefaultPairId && pairsById.has(providerDefaultPairId)
    ? providerDefaultPairId
    : discovery.primaryPairs[0]?.id ?? allPairs[0]?.id ?? "";

  const generatedAt = provider.mode === "mock" ? "mock-static" : receivedAt;
  const snapshot: MarketTerminalSnapshot = {
    mode: provider.mode,
    providerName: provider.name,
    feedStatusLabel: getMarketFeedStatusLabel(provider.mode),
    version: provider.mode === "mock" ? "mock-static-v3" : generatedAt,
    receivedAt,
    generatedAt,
    sourceUpdatedAt: generatedAt,
    freshness: provider.mode === "mock" ? "static" : "fresh",
    sourceHealth: provider.mode === "mock" ? { marketProvider: "static", collector: "static" } : buildSourceHealth(storeResult, "fresh"),
    defaultPairId,
    allPairs,
    poolMarkets: discovery.poolMarkets,
    opportunities: discovery.opportunities,
    universe: discovery.universe,
    recentSignals: [],
    historyStatus: provider.mode === "mock" ? "static" : "warming",
    comparison: buildOpportunityComparison(provider.mode, previous),
    providerCoverage: provider.coverage,
    onchainPricing: getOnchainPricingStatus(storeResult),
    newPairs,
    volumeInflows,
    momentumPairs,
    fallbackReason
  };
  const history = recordDiscoveryHistory(snapshot);
  return compactMarketTerminalSnapshot({ ...snapshot, recentSignals: history.signals, historyStatus: history.status });
}

async function hydratePairs(provider: MarketDataProvider, pairs: BasePair[]) {
  return Promise.all(pairs.map((pair) => hydratePair(provider, pair)));
}

async function hydratePair(
  provider: MarketDataProvider,
  pair: BasePair
): Promise<BasePair> {
  const [activity, liquidityDetail, risk] = await Promise.all([
    provider.getActivityFeed(pair.id),
    provider.getLiquidityDetails(pair.id),
    provider.getRiskDetails(pair.id)
  ]);

  return {
    ...pair,
    dataSource: pair.dataSource ?? (provider.mode === "dexscreener" ? "dexscreener" : "mock"),
    chart: [],
    chartCandles: [],
    chartSource: "unavailable",
    chartLabel: "OHLCV loads for the selected pair",
    chartUpdatedAt: undefined,
    chartUnavailableReason: "Select a pair to request cached read-only OHLCV.",
    activity,
    liquidityDetail: liquidityDetail ?? pair.liquidityDetail,
    riskScore: risk?.riskScore ?? pair.riskScore,
    riskLabel: risk?.riskLabel ?? pair.riskLabel,
    riskChecks: risk?.riskChecks ?? pair.riskChecks,
    flags: risk?.flags ?? pair.flags,
    holders: risk?.holders ?? pair.holders,
    taxes: risk?.taxes ?? pair.taxes,
    lpLock: risk?.lpLock ?? pair.lpLock
  };
}

function dedupePairs(pairs: BasePair[]) {
  const pairsById = new Map<string, BasePair>();

  for (const pair of pairs) {
    if (!pairsById.has(pair.id)) {
      pairsById.set(pair.id, pair);
    }
  }

  return [...pairsById.values()];
}

async function fillDexScreenerSnapshot(
  snapshot: MarketTerminalSnapshot
): Promise<MarketTerminalSnapshot> {
  return {
    ...snapshot,
    defaultPairId: getDefaultPairId(snapshot) || snapshot.defaultPairId
  };
}

function selectHydratedPairs(inputs: BasePair[], pairsById: Map<string, BasePair>) {
  return inputs
    .map((pair) => pairsById.get(pair.id))
    .filter((pair): pair is BasePair => Boolean(pair));
}

function buildDexScreenerFallbackSnapshot(): MarketTerminalSnapshot {
  const generatedAt = new Date().toISOString();
  return {
    mode: "dexscreener",
    providerName: "DexScreener read-only market data",
    feedStatusLabel: "READ-ONLY DATA",
    version: generatedAt,
    receivedAt: generatedAt,
    generatedAt,
    sourceUpdatedAt: generatedAt,
    freshness: "delayed",
    sourceHealth: { marketProvider: "delayed", collector: "unavailable", reason: READ_ONLY_DATA_UNAVAILABLE_LABEL },
    defaultPairId: "",
    allPairs: [],
    poolMarkets: [],
    opportunities: [],
    universe: {
      rawPoolCount: 0,
      uniqueTokenCount: 0,
      activeOpportunityCount: 0,
      freshOpportunityCount: 0,
      newPools24h: 0,
      capacity: { pools: 1_000, opportunities: 600 },
      qualityCounts: { active: 0, thin: 0, incomplete: 0, expired: 0 },
      qualityBandCounts: { RANKED: 0, EMERGING: 0, DETECTED: 0, REJECTED: 0 },
      observedPriceCount: 0,
      canonicalPriceCount: 0,
      providerCoverage: []
    },
    recentSignals: [],
    historyStatus: "warming",
    comparison: { status: "warming", opportunityVolume1h: {} },
    newPairs: [],
    volumeInflows: [],
    momentumPairs: [],
    fallbackReason: READ_ONLY_DATA_UNAVAILABLE_LABEL
  };
}

function markMarketSourceState(snapshot: MarketTerminalSnapshot, status: "refreshing" | "delayed", reason: string): MarketTerminalSnapshot {
  return {
    ...snapshot,
    receivedAt: new Date().toISOString(),
    sourceHealth: {
      ...(snapshot.sourceHealth ?? { collector: "unavailable" as const }),
      marketProvider: status,
      reason,
      observedAt: snapshot.sourceUpdatedAt
    }
  };
}

function buildOnchainLastGoodSnapshot(): MarketTerminalSnapshot | undefined {
  const storeResult = readOnchainStoreSnapshot();
  if (!storeResult.ok) return undefined;
  const receivedAt = new Date().toISOString();
  const sourceUpdatedAt = storeResult.state.updatedAt;
  const providerPairs = mergeOnchainPoolsIntoPairs([], storeResult);
  if (!providerPairs.length) return undefined;
  const discovery = buildDiscoveryUniverse(providerPairs.map((pair) => ({
    ...pair,
    sourceUpdatedAt: pair.sourceUpdatedAt ?? sourceUpdatedAt,
    firstSeenAt: pair.firstSeenAt ?? sourceUpdatedAt
  })), undefined, new Date(receivedAt));
  const health = collectorFreshness(storeResult.state);
  const fallbackReason = health.delayedReason ? `Collector snapshot delayed: ${health.delayedReason}.` : undefined;
  return compactMarketTerminalSnapshot({
    mode: "dexscreener",
    providerName: "Collector snapshot + read-only market data",
    feedStatusLabel: "READ-ONLY DATA",
    version: `collector-${sourceUpdatedAt}`,
    receivedAt,
    generatedAt: sourceUpdatedAt,
    sourceUpdatedAt,
    freshness: health.ready ? "fresh" : "delayed",
    sourceHealth: buildSourceHealth(storeResult, "refreshing", fallbackReason),
    defaultPairId: discovery.primaryPairs[0]?.id ?? discovery.pairs[0]?.id ?? "",
    allPairs: discovery.pairs,
    poolMarkets: discovery.poolMarkets,
    opportunities: discovery.opportunities,
    universe: discovery.universe,
    recentSignals: [],
    historyStatus: "warming",
    comparison: { status: "warming", opportunityVolume1h: {} },
    onchainPricing: getOnchainPricingStatus(storeResult),
    newPairs: [],
    volumeInflows: [],
    momentumPairs: [],
    fallbackReason
  });
}

function buildSourceHealth(result: OnchainStoreReadResult | undefined, marketProvider: "fresh" | "refreshing" | "delayed", reason?: string): NonNullable<MarketTerminalSnapshot["sourceHealth"]> {
  if (!result?.ok) return { marketProvider, collector: "unavailable", reason };
  const health = collectorFreshness(result.state);
  return {
    marketProvider,
    collector: health.ready ? "fresh" : "delayed",
    reason: reason ?? (health.delayedReason ? `Collector snapshot delayed: ${health.delayedReason}.` : undefined),
    observedAt: result.state.updatedAt
  };
}

function compactMarketTerminalSnapshot(snapshot: MarketTerminalSnapshot): MarketTerminalSnapshot {
  if (snapshot.mode === "mock" || snapshot.opportunities.length === 0) return snapshot;
  const excludedReasons: Record<string, number> = {};
  const opportunities = snapshot.opportunities.filter((opportunity) => {
    const reason = opportunity.qualityBand === "REJECTED" ? "quality_rejected" : opportunity.quality === "expired" ? "quality_expired" : undefined;
    if (!reason) return true;
    excludedReasons[reason] = (excludedReasons[reason] ?? 0) + 1;
    return false;
  });
  const marketIds = new Set(opportunities.flatMap((opportunity) => opportunity.poolMarketIds));
  const allPairs = snapshot.allPairs.filter((pair) => marketIds.has(pair.id));
  const pairIds = new Set(allPairs.map((pair) => pair.id));
  const defaultPairId = pairIds.has(snapshot.defaultPairId) ? snapshot.defaultPairId : opportunities[0]?.primaryMarketId ?? allPairs[0]?.id ?? "";
  return {
    ...snapshot,
    defaultPairId,
    allPairs,
    poolMarkets: snapshot.poolMarkets.filter((market) => marketIds.has(market.id)),
    opportunities,
    recentSignals: snapshot.recentSignals.filter((signal) => !signal.pairId || pairIds.has(signal.pairId)),
    newPairs: snapshot.newPairs.filter((pair) => pairIds.has(pair.id)),
    volumeInflows: snapshot.volumeInflows.filter((pair) => pairIds.has(pair.id)),
    momentumPairs: snapshot.momentumPairs.filter((pair) => pairIds.has(pair.id)),
    visibilityFunnel: {
      totalOpportunityCount: snapshot.opportunities.length,
      clientOpportunityCount: opportunities.length,
      excludedReasons
    }
  };
}

function getDefaultPairId({
  newPairs,
  volumeInflows,
  momentumPairs
}: {
  newPairs: BasePair[];
  volumeInflows: BasePair[];
  momentumPairs: BasePair[];
}) {
  const orderedPairs = [...newPairs, ...volumeInflows, ...momentumPairs];
  const livePairs = orderedPairs.filter(isLivePair);
  const preferredLivePair =
    findPreferredNeutralPair(livePairs) ?? getHighestQualityPair(livePairs);

  if (preferredLivePair) {
    return preferredLivePair.id;
  }

  return volumeInflows[0]?.id ?? momentumPairs[0]?.id ?? "";
}

function isLivePair(pair: BasePair) {
  return pair.dataSource === "dexscreener" || pair.dataSource === "geckoterminal";
}

function findPreferredNeutralPair(pairs: BasePair[]) {
  for (const [baseToken, quoteToken] of NEUTRAL_DEFAULT_PAIR_ORDER) {
    const match = pairs.find(
      (pair) =>
        normalizePairToken(pair.baseToken) === baseToken &&
        normalizePairToken(pair.quoteToken) === quoteToken
    );

    if (match) {
      return match;
    }
  }

  return undefined;
}

function getHighestQualityPair(pairs: BasePair[]) {
  return [...pairs].sort((left, right) => getPairQualityScore(right) - getPairQualityScore(left))[0];
}

function getPairQualityScore(pair: BasePair) {
  return (pair.liquidity ?? 0) * 0.65 + (pair.volume24h ?? 0) * 0.35;
}

function normalizePairToken(symbol: string) {
  return symbol.trim().replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function mergeWithPreviousReservoir(current: BasePair[], previous: MarketTerminalSnapshot | undefined, receivedAt: string) {
  if (!previous) return current;
  const currentKeys = new Set(current.map((pair) => (pair.pairAddress ?? pair.id).toLowerCase()));
  const now = Date.parse(receivedAt);
  const retained = previous.allPairs.flatMap((pair) => {
    const key = (pair.pairAddress ?? pair.id).toLowerCase();
    if (currentKeys.has(key)) return [];
    const updatedAt = Date.parse(pair.sourceUpdatedAt ?? previous.sourceUpdatedAt);
    if (!Number.isFinite(updatedAt) || now - updatedAt > RESERVOIR_TTL_MS) return [];
    const delayed = now - updatedAt > ACTIVE_RESERVOIR_GRACE_MS;
    return [{
      ...pair,
      stale: pair.stale || delayed,
      staleReason: pair.stale || delayed ? "Pool was not present in recent provider refreshes; retained only in the bounded reservoir." : undefined
    }];
  });
  const previousByKey = new Map(previous.allPairs.map((pair) => [(pair.pairAddress ?? pair.id).toLowerCase(), pair]));
  return mergePoolPairs([
    ...current.map((pair) => {
      const before = previousByKey.get((pair.pairAddress ?? pair.id).toLowerCase());
      return { ...pair, firstSeenAt: before?.firstSeenAt ?? pair.firstSeenAt ?? receivedAt, stale: false, staleReason: undefined };
    }),
    ...retained
  ]);
}

function buildOpportunityComparison(mode: MarketDataMode, previous?: MarketTerminalSnapshot): MarketTerminalSnapshot["comparison"] {
  if (mode === "mock") return { status: "static", opportunityVolume1h: {}, opportunityMetrics: {} };
  if (!previous || previous.freshness !== "fresh") return { status: "warming", opportunityVolume1h: {}, opportunityMetrics: {} };
  return {
    status: "ready",
    previousGeneratedAt: previous.generatedAt,
    opportunityVolume1h: Object.fromEntries(previous.opportunities.flatMap((opportunity) => {
      const value = opportunity.aggregate.volumes?.h1;
      return typeof value === "number" && Number.isFinite(value) && value >= 0 ? [[opportunity.id, value]] : [];
    })),
    opportunityMetrics: Object.fromEntries(previous.opportunities.map((opportunity) => [opportunity.id, {
      canonicalPriceUsd: opportunity.canonicalPrice.tier === "UNPRICED" ? undefined : opportunity.canonicalPrice.value,
      liquidityUsd: opportunity.aggregate.liquidityUsd,
      volumes: opportunity.aggregate.volumes,
      transactions: opportunity.aggregate.transactions
    }]))
  };
}
