import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { BasePair } from "@/types/baseTerminal";

export const ONCHAIN_STORE_SCHEMA_VERSION = 1;
export const ONCHAIN_COLLECTOR_VERSION = "base-market-enrichment-v2";

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
  liquidityUsd?: number;
  volume24hUsd?: number;
  trades24h?: number;
  decimalsVerified?: boolean;
  providerEnrichment?: { decimalsVerified?: boolean };
};

type StoredMetadata = {
  address: string;
  name?: string;
  symbol?: string;
  decimals?: number;
  status: "complete" | "partial" | "unavailable";
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
  const anchorBindings = (result.state.priceAnchors?.wethUsdc?.candidates ?? []).flatMap((candidate) => {
    if (!candidate.poolAddress || !candidate.token0 || !candidate.token1 || !candidate.factoryId || !candidate.factoryAddress || !candidate.protocolVersion || !candidate.observedAt) return [];
    return [{
      poolKey: candidate.poolAddress,
      poolAddress: candidate.poolAddress,
      chainId: 8453 as const,
      dexId: candidate.factoryId.split("-")[0],
      factoryId: candidate.factoryId,
      factoryAddress: candidate.factoryAddress,
      protocolVersion: candidate.protocolVersion,
      token0: candidate.token0,
      token1: candidate.token1,
      status: "confirmed" as const,
      verifiedSource: true,
      replay: false,
      firstSeenAt: candidate.observedAt,
      confirmedAt: candidate.observedAt,
      observedAt: candidate.observedAt,
      blockNumber: candidate.blockNumber ?? result.state.confirmedHead,
      transactionHash: undefined,
      logIndex: undefined,
      providers: [...new Set([...(candidate.providers ?? []), "onchain"])],
      decimalsVerified: candidate.decimalsVerified === true
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
      pairsByPool.set(key, {
        ...current,
        dataProviders: providers,
        firstSeenAt: earliestIso(current.firstSeenAt, pool.firstSeenAt),
        blockNumber: pool.blockNumber,
        onchainProvenance: provenance(pool)
      });
      continue;
    }
    pairsByPool.set(key, toDiscoveryPair(pool, result.state.tokenMetadata));
  }
  return [...pairsByPool.values()];
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
    ready: Boolean(state.health.ready && state.health.storeIntegrity === "ok"),
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
  return {
    id: normalizePoolKey(pool.poolAddress ?? pool.poolKey),
    pairAddress: pool.poolAddress,
    baseTokenAddress: pool.token0,
    quoteTokenAddress: pool.token1,
    chainId: "base",
    dexId: pool.dexId,
    dexName: pool.dexId,
    dataSource: "onchain",
    dataProviders: ["onchain"],
    sourceUpdatedAt: pool.observedAt,
    firstSeenAt: pool.firstSeenAt,
    pairCreatedAt: createdAt,
    pairCreatedAtMs: Date.parse(createdAt),
    blockNumber: pool.blockNumber,
    metadataStatus: token0?.status === "complete" && token1?.status === "complete" ? "complete" : token0?.status || token1?.status ? "partial" : "unavailable",
    onchainProvenance: provenance(pool),
    pair: `${symbol0} / ${symbol1}`,
    baseToken: symbol0,
    quoteToken: symbol1,
    project: token0?.name || `${symbol0} on Base`,
    address: shortAddress(pool.token0),
    route: `${symbol0} / ${symbol1}`,
    dex: pool.dexId,
    age: formatAge(ageMinutes),
    ageMinutes,
    price: "N/A",
    priceUsd: "N/A",
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
function shortAddress(value: string) { return `${value.slice(0, 6)}…${value.slice(-4)}`; }
function safeLabel(value: string | undefined, address: string) { return value?.trim().slice(0, 24) || shortAddress(address); }
function formatAge(minutes: number) { return minutes < 60 ? `${minutes}m` : minutes < 1_440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1_440)}d`; }
function earliestIso(left: string | undefined, right: string) { return left && Date.parse(left) <= Date.parse(right) ? left : right; }
function isMissingFile(error: unknown): error is NodeJS.ErrnoException { return Boolean(error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT"); }
function readPricingTier(value: unknown): "A" | "B" | "C" | "UNPRICED" { if (!value || typeof value !== "object" || !("tier" in value)) return "UNPRICED"; const tier = (value as { tier?: unknown }).tier; return tier === "A" || tier === "B" || tier === "C" ? tier : "UNPRICED"; }
