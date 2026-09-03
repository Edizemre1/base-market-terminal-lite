import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { BasePair } from "@/types/baseTerminal";

export const ONCHAIN_STORE_SCHEMA_VERSION = 1;
export const ONCHAIN_COLLECTOR_VERSION = "base-market-quality-v3";
const BASE_WETH_ADDRESS = "0x4200000000000000000000000000000000000006";
const BASE_USDC_ADDRESS = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

type StoredPool = {
  poolKey: string;
  poolAddress?: string;
  poolId?: string;
  chainId: 8453;
  dexId: string;
  factoryId: string;
  factoryAddress: string;
  protocolVersion: string;
  token0: string;
  token1: string;
  status: "provisional" | "confirmed" | "orphaned";
  verifiedSource: boolean;
  replay?: boolean;
  firstSeenAt: string;
  confirmedAt?: string;
  observedAt: string;
  blockTimestamp?: string;
  blockNumber: number;
  transactionHash?: string;
  logIndex?: number;
  providers?: string[];
  priceToken1PerToken0?: number;
  providerPriceToken1PerToken0?: number;
  onchainPriceToken1PerToken0?: number;
  liquidityUsd?: number;
  providerLiquidityUsd?: number;
  onchainLiquidityUsd?: number;
  liquidityResolutionState?: BasePair["liquidityState"];
  priceReconciliation?: BasePair["priceReconciliation"];
  liquidityReconciliation?: BasePair["liquidityReconciliation"];
  onchainObservedPricesUsd?: Record<string, number>;
  onchainState?: {
    decimals0?: number; decimals1?: number;
    status?: "complete" | "pending" | "retryable" | "rejected" | "unsupported";
    adapterFamily?: string; protocolFamily?: string; reasonCode?: string; confidence?: string; sourceMethod?: string;
    blockNumber?: number; blockHash?: string; observedAt?: string; observedPrice0In1?: number; observedPrice1In0?: number;
    reserveEvidence?: { reserve0Raw?: string; reserve1Raw?: string };
    balanceEvidence?: { balance0Raw?: string; balance1Raw?: string };
  };
  volume24hUsd?: number;
  trades24h?: number;
  transactions?: Partial<Record<"m5" | "h1" | "h6" | "h24", { buys: number; sells: number }>>;
  decimalsVerified?: boolean;
  anchorConsensus?: boolean;
  sourcePoolKeys?: string[];
  observedPricesUsd?: Record<string, number>;
  providerSnapshots?: Array<{ provider?: string; poolAddress?: string; baseTokenAddress?: string; quoteTokenAddress?: string; priceUsd?: number; priceNative?: number; observedAt?: string; receivedAt?: string; liquidityUsd?: number }>;
  providerIndexedAt?: string;
  providerIndexingLatencyMs?: number;
  providerEnrichment?: { status?: "matched" | "pending" | "unmatched" | "conflicting" | "discarded"; decimalsVerified?: boolean; selectedProvider?: string; observedAt?: string };
};

type StoredMetadata = {
  address: string;
  name?: string;
  symbol?: string;
  decimals?: number;
  status: "complete" | "partial" | "unavailable";
  verificationState?: "verified" | "pending" | "quarantined" | "rejected";
};

export type OnchainStoreState = {
  schemaVersion: number;
  collectorVersion: string;
  updatedAt: string;
  mode: "websocket" | "confirmed_polling" | "reconnecting";
  currentHead: number;
  confirmedHead: number;
  cursors: Record<string, { blockNumber: number; updatedAt: string }>;
  events: Record<string, { status: "provisional" | "confirmed" | "orphaned"; replay?: boolean }>;
  pools: Record<string, StoredPool>;
  tokenMetadata: Record<string, StoredMetadata>;
  opportunities: Array<Record<string, unknown>>;
  priceAnchors?: {
    wethUsdc?: Record<string, unknown> & {
      status?: string;
      value?: number;
      observedAt?: string;
      freshness?: string;
      reasonCode?: string;
      sourcePoolCount?: number;
      selectedPool?: string;
      consensusPools?: string[];
      deviation?: number;
      candidates?: Array<Record<string, unknown> & {
        poolAddress?: string;
        token0?: string;
        token1?: string;
        factoryId?: string;
        factoryAddress?: string;
        protocolVersion?: string;
        observedAt?: string;
        blockNumber?: number;
        providers?: string[];
        decimalsVerified?: boolean;
      }>;
      pricingPool?: Record<string, unknown> & {
        onchainState?: StoredPool["onchainState"];
        poolKey?: string;
        poolAddress?: string;
        token0?: string;
        token1?: string;
        factoryId?: string;
        factoryAddress?: string;
        protocolVersion?: string;
        observedAt?: string;
        blockNumber?: number;
        providers?: string[];
        priceToken1PerToken0?: number;
        liquidityUsd?: number;
        volume24hUsd?: number;
        trades24h?: number;
        sourcePoolKeys?: string[];
        anchorConsensus?: boolean;
      };
    };
  };
  eventRing: Array<{ id: string; type: string; at: string; data: Record<string, unknown> }>;
  replayEvidence?: Array<Record<string, unknown>>;
  counters: { reconnectCount: number; reorgCount: number; duplicateDropped: number; malformedRejected: number };
  health: Record<string, unknown> & { ready?: boolean; mode?: string; storeIntegrity?: string };
  integrity: { algorithm: "sha256"; digest: string };
};

export type OnchainStoreReadResult =
  | { ok: true; state: OnchainStoreState }
  | { ok: false; reason: "store_unavailable" | "store_invalid" | "digest_mismatch" | "schema_unsupported" };

export function getOnchainStoreDirectory() {
  return process.env.ONCHAIN_STORE_PATH?.trim() || path.resolve(process.cwd(), ".data/onchain-discovery");
}

export function readOnchainStoreSnapshot(): OnchainStoreReadResult {
  try {
    const file = path.join(getOnchainStoreDirectory(), "state.json");
    const state = JSON.parse(readFileSync(file, "utf8")) as OnchainStoreState;
    if (state.schemaVersion !== ONCHAIN_STORE_SCHEMA_VERSION) return { ok: false, reason: "schema_unsupported" };
    const expected = digestState(state);
    if (state.integrity?.digest !== expected) return { ok: false, reason: "digest_mismatch" };
    return { ok: true, state };
  } catch (error) {
    return { ok: false, reason: isMissingFile(error) ? "store_unavailable" : "store_invalid" };
  }
}

export function mergeOnchainPoolsIntoPairs(providerPairs: BasePair[], result = readOnchainStoreSnapshot()) {
  if (!result.ok) return providerPairs;
  const pairsByPool = new Map(providerPairs.map((pair) => [normalizePoolKey(pair.pairAddress ?? pair.id), pair]));
  const anchor = result.state.priceAnchors?.wethUsdc;
  const anchorUsd = anchor?.status === "ready" ? positive(anchor.value) : undefined;
  const anchorBindings = [anchor?.pricingPool].flatMap((pricingPool) => {
    if (anchor?.status !== "ready" || !pricingPool?.poolAddress || !pricingPool.token0 || !pricingPool.token1 || !pricingPool.factoryId || !pricingPool.factoryAddress || !pricingPool.protocolVersion || !pricingPool.observedAt || !positive(pricingPool.priceToken1PerToken0)) return [];
    return [{
      poolKey: pricingPool.poolAddress,
      poolAddress: pricingPool.poolAddress,
      chainId: 8453 as const,
      dexId: pricingPool.factoryId.split("-")[0],
      factoryId: pricingPool.factoryId,
      factoryAddress: pricingPool.factoryAddress,
      protocolVersion: pricingPool.protocolVersion,
      token0: pricingPool.token0,
      token1: pricingPool.token1,
      status: "confirmed" as const,
      verifiedSource: true,
      replay: false,
      firstSeenAt: pricingPool.observedAt,
      confirmedAt: pricingPool.observedAt,
      observedAt: pricingPool.observedAt,
      blockNumber: pricingPool.blockNumber ?? result.state.confirmedHead,
      transactionHash: undefined,
      logIndex: undefined,
      providers: [...new Set([...(pricingPool.providers ?? []), "onchain"])],
      decimalsVerified: true,
      anchorConsensus: true,
      sourcePoolKeys: pricingPool.sourcePoolKeys,
      priceToken1PerToken0: pricingPool.priceToken1PerToken0,
      liquidityUsd: pricingPool.liquidityUsd,
      volume24hUsd: pricingPool.volume24hUsd,
      trades24h: pricingPool.trades24h,
      onchainState: pricingPool.onchainState
    } satisfies StoredPool];
  });
  const bindingsByPool = new Map<string, StoredPool>();
  for (const pool of [...Object.values(result.state.pools), ...anchorBindings]) {
    if (pool.status !== "confirmed" || !pool.verifiedSource || pool.replay) continue;
    const key = normalizePoolKey(pool.poolAddress ?? pool.poolKey);
    bindingsByPool.set(key, pool);
  }
  for (const [key, pool] of bindingsByPool) {
    const current = pairsByPool.get(key);
    if (current) {
      const providers = [...new Set([...(current.dataProviders ?? (current.dataSource ? [current.dataSource] : [])), "onchain" as const])];
      const currentBase = normalizeAddress(current.baseTokenAddress) ?? "";
      const onchainObserved = positive(pool.onchainObservedPricesUsd?.[currentBase]);
      const poolRate = positive(pool.priceToken1PerToken0);
      const resolvedNative = currentBase === pool.token0 ? poolRate : currentBase === pool.token1 && poolRate ? 1 / poolRate : undefined;
      pairsByPool.set(key, {
        ...current,
        dataProviders: providers,
        firstSeenAt: earliestIso(current.firstSeenAt, pool.firstSeenAt),
        blockNumber: pool.blockNumber,
        onchainProvenance: provenance(pool),
        metadataVerificationState: metadataVerification(result.state.tokenMetadata?.[pool.token0], result.state.tokenMetadata?.[pool.token1]),
        observedPriceUsd: onchainObserved ?? positive(pool.observedPricesUsd?.[currentBase]),
        observedPriceProvider: onchainObserved ? "onchain" : pool.providerEnrichment?.selectedProvider,
        observedPricePoolAddress: pool.poolAddress,
        observedPriceAt: onchainObserved ? pool.onchainState?.observedAt : pool.providerEnrichment?.observedAt,
        providerDiscoveryState: mapProviderDiscoveryState(pool.providerEnrichment?.status),
        providerIndexedAt: pool.providerIndexedAt,
        priceNative: resolvedNative?.toPrecision(15) ?? current.priceNative,
        price: resolvedNative?.toPrecision(8) ?? current.price,
        liquidityUsd: pool.liquidityUsd ?? current.liquidityUsd,
        liquidity: pool.liquidityUsd ?? current.liquidity,
        liquidityState: pool.liquidityResolutionState,
        onchainStateEvidence: stateEvidence(pool),
        priceReconciliation: pool.priceReconciliation,
        liquidityReconciliation: pool.liquidityReconciliation,
        volume24h: pool.anchorConsensus && pool.volume24hUsd !== undefined ? pool.volume24hUsd : current.volume24h,
        volumes: pool.anchorConsensus && pool.volume24hUsd !== undefined ? { ...current.volumes, h24: pool.volume24hUsd } : current.volumes
      });
      continue;
    }
    pairsByPool.set(key, toDiscoveryPair(pool, result.state.tokenMetadata));
  }
  return [...pairsByPool.values()].map((pair) => anchorUsd === undefined
    ? pair
    : applyCanonicalWethUsdcAnchor(pair, anchorUsd, anchor?.observedAt));
}

export function getOnchainCollectorHealth(sseClients: number) {
  const result = readOnchainStoreSnapshot();
  if (!result.ok) {
    return {
      ready: false,
      mode: "confirmed_polling",
      storeIntegrity: result.reason,
      collectorVersion: ONCHAIN_COLLECTOR_VERSION,
      sseClients
    };
  }
  const state = result.state;
  const confirmedEvents = Object.values(state.events ?? {}).filter((event) => event.status === "confirmed" && !event.replay);
  const confirmedPools = Object.values(state.pools).filter((pool) => pool.status === "confirmed" && !pool.replay);
  const pricingTierCounts = { A: 0, B: 0, C: 0, UNPRICED: 0 };
  for (const opportunity of state.opportunities) {
    const tier = readPricingTier(opportunity.canonicalPrice);
    pricingTierCounts[tier] += 1;
  }
  return {
    ...state.health,
    ...collectorFreshness(state),
    mode: state.health.mode ?? state.mode,
    currentHead: state.currentHead,
    confirmedCursor: Math.min(...Object.values(state.cursors).map((cursor) => cursor.blockNumber)),
    reconnectCount: state.counters.reconnectCount,
    reorgCount: state.counters.reorgCount,
    duplicateDropped: state.counters.duplicateDropped,
    malformedRejected: state.counters.malformedRejected,
    rawPoolCount: confirmedEvents.length,
    uniquePoolCount: confirmedPools.length,
    tokenOpportunityCount: state.opportunities.length,
    pricingTierCounts,
    pricedOpportunities: pricingTierCounts.A + pricingTierCounts.B + pricingTierCounts.C,
    rankedOpportunities: state.opportunities.filter((opportunity) => opportunity.ranked === true).length,
    anchorStatus: state.priceAnchors?.wethUsdc?.status ?? "unavailable",
    anchorUsdPrice: state.priceAnchors?.wethUsdc?.value,
    anchorSourcePoolCount: state.priceAnchors?.wethUsdc?.sourcePoolCount ?? 0,
    anchorObservedAt: state.priceAnchors?.wethUsdc?.observedAt,
    anchorFreshness: state.priceAnchors?.wethUsdc?.freshness ?? "unavailable",
    anchorReasonCode: state.priceAnchors?.wethUsdc?.reasonCode,
    collectorVersion: state.collectorVersion,
    storeSchemaVersion: state.schemaVersion,
    sseClients
  };
}

export function collectorFreshness(state: OnchainStoreState, nowMs = Date.now()) {
  const cursorRows = Object.values(state.cursors ?? {});
  const confirmedCursor = cursorRows.length ? Math.min(...cursorRows.map((row) => row.blockNumber)) : 0;
  const snapshotAgeMs = Math.max(0, nowMs - Date.parse(state.updatedAt));
  const headAt = typeof state.health.lastHeadObservedAt === "string" ? state.health.lastHeadObservedAt : cursorRows.map((row) => row.updatedAt).sort()[0];
  const headAgeMs = headAt ? Math.max(0, nowMs - Date.parse(headAt)) : Infinity;
  const lagBlocks = Math.max(0, state.confirmedHead - confirmedCursor);
  const delayedReason = !Number.isFinite(snapshotAgeMs) || snapshotAgeMs > 60_000 ? "snapshot_stale"
    : !Number.isFinite(headAgeMs) || headAgeMs > 45_000 ? "head_observation_stale"
      : confirmedCursor <= 0 || lagBlocks > 16 ? "confirmed_cursor_behind" : undefined;
  return { ready: Boolean(!delayedReason && state.health.ready && state.health.storeIntegrity === "ok"), lagBlocks, lagSeconds: lagBlocks * 2, snapshotAgeMs: Number.isFinite(snapshotAgeMs) ? snapshotAgeMs : null, headAgeMs: Number.isFinite(headAgeMs) ? headAgeMs : null, snapshotFreshness: delayedReason ? "delayed" : "fresh", delayedReason, snapshotReceivedAt: state.updatedAt };
}

export function getOnchainPricingStatus() {
  const result = readOnchainStoreSnapshot();
  if (!result.ok) return { available: false as const, reasonCode: result.reason };
  return { available: true as const, wethUsdcAnchor: result.state.priceAnchors?.wethUsdc };
}

function toDiscoveryPair(pool: StoredPool, metadata: Record<string, StoredMetadata>): BasePair {
  const token0 = metadata[pool.token0];
  const token1 = metadata[pool.token1];
  const createdAt = pool.blockTimestamp ?? pool.confirmedAt ?? pool.firstSeenAt;
  const ageMinutes = Math.max(0, Math.floor((Date.now() - Date.parse(createdAt)) / 60_000));
  const symbol0 = safeLabel(token0?.symbol, pool.token0);
  const symbol1 = safeLabel(token1?.symbol, pool.token1);
  const nativePrice = positive(pool.priceToken1PerToken0);
  const directUsd = positive(pool.onchainObservedPricesUsd?.[pool.token0]) ?? positive(pool.observedPricesUsd?.[pool.token0]) ?? (nativePrice === undefined ? undefined
    : pool.token1 === BASE_USDC_ADDRESS ? nativePrice
      : pool.token0 === BASE_USDC_ADDRESS ? 1 : undefined);
  return {
    id: normalizePoolKey(pool.poolAddress ?? pool.poolKey),
    pairAddress: pool.poolAddress,
    baseTokenAddress: pool.token0,
    quoteTokenAddress: pool.token1,
    chainId: "base",
    dexId: pool.dexId,
    dexName: pool.dexId,
    dataSource: "onchain",
    dataProviders: [...new Set([...(pool.providers ?? []).filter((provider): provider is "dexscreener" | "geckoterminal" => provider === "dexscreener" || provider === "geckoterminal"), "onchain" as const])],
    sourceUpdatedAt: pool.observedAt,
    firstSeenAt: pool.firstSeenAt,
    pairCreatedAt: createdAt,
    pairCreatedAtMs: Date.parse(createdAt),
    blockNumber: pool.blockNumber,
    metadataStatus: token0?.status === "complete" && token1?.status === "complete" ? "complete" : token0?.status || token1?.status ? "partial" : "unavailable",
    metadataVerificationState: metadataVerification(token0, token1),
    onchainProvenance: provenance(pool),
    observedPriceUsd: directUsd,
    observedPriceProvider: positive(pool.onchainObservedPricesUsd?.[pool.token0]) ? "onchain" : pool.providerEnrichment?.selectedProvider,
    observedPricePoolAddress: pool.poolAddress,
    observedPriceAt: positive(pool.onchainObservedPricesUsd?.[pool.token0]) ? pool.onchainState?.observedAt : pool.providerEnrichment?.observedAt,
    providerDiscoveryState: mapProviderDiscoveryState(pool.providerEnrichment?.status),
    providerIndexedAt: pool.providerIndexedAt,
    pair: `${symbol0} / ${symbol1}`,
    baseToken: symbol0,
    quoteToken: symbol1,
    project: token0?.name || `${symbol0} on Base`,
    address: shortAddress(pool.token0),
    route: `${symbol0} / ${symbol1}`,
    dex: pool.dexId,
    age: formatAge(ageMinutes),
    ageMinutes,
    priceNative: nativePrice?.toPrecision(15),
    price: nativePrice?.toPrecision(8) ?? "N/A",
    priceUsdValue: directUsd,
    priceUsd: directUsd === undefined ? "N/A" : `$${directUsd.toPrecision(10)}`,
    liquidityUsd: pool.liquidityUsd,
    liquidity: pool.liquidityUsd,
    liquidityState: pool.liquidityResolutionState,
    onchainStateEvidence: stateEvidence(pool),
    priceReconciliation: pool.priceReconciliation,
    liquidityReconciliation: pool.liquidityReconciliation,
    volumes: pool.volume24hUsd === undefined ? undefined : { h24: pool.volume24hUsd },
    volume24h: pool.volume24hUsd,
    poolAge: formatAge(ageMinutes),
    chart: [],
    holders: { top10: "N/A", top50: "N/A", top100: "N/A", total: "N/A", active24h: "N/A" },
    flags: [],
    taxes: { buy: "N/A", sell: "N/A" },
    lpLock: { status: "Unknown", provider: "On-chain discovery", expires: "N/A" },
    riskChecks: [],
    liquidityDetail: { poolLiquidity: "N/A", lpChange: "N/A", depth: "N/A", routeSource: `${pool.factoryId} event` },
    activity: []
  };
}

function applyCanonicalWethUsdcAnchor(pair: BasePair, anchorUsd: number, observedAt: string | undefined): BasePair {
  const base = normalizeAddress(pair.baseTokenAddress);
  const quote = normalizeAddress(pair.quoteTokenAddress);
  const direct = base === BASE_WETH_ADDRESS && quote === BASE_USDC_ADDRESS;
  const inverted = base === BASE_USDC_ADDRESS && quote === BASE_WETH_ADDRESS;
  if (!direct && !inverted) return pair;
  const nativePrice = direct ? anchorUsd : 1 / anchorUsd;
  const baseUsd = direct ? anchorUsd : 1;
  return {
    ...pair,
    sourceUpdatedAt: observedAt ?? pair.sourceUpdatedAt,
    priceNative: String(nativePrice),
    price: nativePrice.toPrecision(8),
    priceUsdValue: baseUsd,
    priceUsd: `$${baseUsd.toPrecision(10)}`
  };
}

function provenance(pool: StoredPool) {
  return {
    factoryId: pool.factoryId,
    factoryAddress: pool.factoryAddress,
    protocolVersion: pool.protocolVersion,
    transactionHash: pool.transactionHash || undefined,
    logIndex: Number.isInteger(pool.logIndex) ? pool.logIndex : undefined,
    confirmedAt: pool.confirmedAt ?? pool.observedAt,
    bindingKind: pool.transactionHash ? "factory_event" as const : "registered_pool_identity" as const,
    decimalsVerified: pool.decimalsVerified === true || pool.providerEnrichment?.decimalsVerified === true
  };
}

function stateEvidence(pool: StoredPool): BasePair["onchainStateEvidence"] {
  const state = pool.onchainState;
  if (!state) return undefined;
  return {
    status: state.status,
    token0: pool.token0,
    token1: pool.token1,
    decimals0: state.decimals0,
    decimals1: state.decimals1,
    adapterFamily: state.adapterFamily,
    protocolFamily: state.protocolFamily,
    reasonCode: state.reasonCode,
    confidence: state.confidence,
    sourceMethod: state.sourceMethod,
    blockNumber: state.blockNumber,
    blockHash: state.blockHash,
    observedAt: state.observedAt,
    observedPrice0In1: state.observedPrice0In1,
    observedPrice1In0: state.observedPrice1In0,
    reserve0Raw: state.reserveEvidence?.reserve0Raw,
    reserve1Raw: state.reserveEvidence?.reserve1Raw,
    balance0Raw: state.balanceEvidence?.balance0Raw,
    balance1Raw: state.balanceEvidence?.balance1Raw
  };
}

function metadataVerification(left: StoredMetadata | undefined, right: StoredMetadata | undefined): BasePair["metadataVerificationState"] {
  if (left?.verificationState === "quarantined" || right?.verificationState === "quarantined") return "quarantined";
  if (left?.verificationState === "rejected" || right?.verificationState === "rejected") return "rejected";
  if (left?.verificationState === "verified" && right?.verificationState === "verified") return "verified";
  if (Number.isInteger(left?.decimals) && Number.isInteger(right?.decimals)) return "legacy_verified";
  return "pending";
}

function digestState(state: OnchainStoreState) {
  const clone = structuredClone(state) as Partial<OnchainStoreState>;
  delete clone.integrity;
  return createHash("sha256").update(JSON.stringify(sortValue(clone))).digest("hex");
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue((value as Record<string, unknown>)[key])]));
}

function normalizePoolKey(value: string) { return value.toLowerCase(); }
function normalizeAddress(value: string | undefined) { return value?.trim().toLowerCase(); }
function shortAddress(value: string) { return `${value.slice(0, 6)}…${value.slice(-4)}`; }
function safeLabel(value: string | undefined, address: string) { return value?.trim().slice(0, 24) || shortAddress(address); }
function formatAge(minutes: number) { return minutes < 60 ? `${minutes}m` : minutes < 1_440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1_440)}d`; }
function earliestIso(left: string | undefined, right: string) { return left && Date.parse(left) <= Date.parse(right) ? left : right; }
function isMissingFile(error: unknown): error is NodeJS.ErrnoException { return Boolean(error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT"); }
function readPricingTier(value: unknown): "A" | "B" | "C" | "UNPRICED" { if (!value || typeof value !== "object" || !("tier" in value)) return "UNPRICED"; const tier = (value as { tier?: unknown }).tier; return tier === "A" || tier === "B" || tier === "C" ? tier : "UNPRICED"; }
function positive(value: number | undefined) { return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined; }
function mapProviderDiscoveryState(value: "matched" | "pending" | "conflicting" | "unmatched" | "discarded" | undefined): BasePair["providerDiscoveryState"] {
  if (value === "matched" || value === "pending" || value === "conflicting") return value;
  if (value === "unmatched") return "not_found";
  return "detected";
}
