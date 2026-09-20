import { parseStrictFiniteNumber } from "@/lib/marketMath";
import type { BasePair, PairActivity } from "@/types/baseTerminal";
import { fetchJsonWithTimeout, readArray, readRecord, readString } from "./responseValidation";

const PUBLIC_API_BASE = "https://api.geckoterminal.com/api/v2";
const PRO_API_BASE = "https://pro-api.coingecko.com/api/v3/onchain";
const BASE_NETWORK_ID = "base";
const REQUEST_TIMEOUT_MS = 8_000;
const REVALIDATE_SECONDS = 30;
const MAX_PAGES = { new: 5, trending: 2, top: 5 } as const;
export const GECKO_DISCOVERY_REQUEST_BUDGET = MAX_PAGES.new + MAX_PAGES.trending + MAX_PAGES.top;
const REQUEST_CONCURRENCY = 3;
const UNKNOWN_AGE_MINUTES = Number.MAX_SAFE_INTEGER;

type GeckoRelationship = { data?: { id?: string; type?: string } };
type GeckoPool = {
  id: string;
  attributes: Record<string, unknown>;
  relationships: {
    base_token?: GeckoRelationship;
    quote_token?: GeckoRelationship;
    dex?: GeckoRelationship;
  };
};

type GeckoIncluded = {
  id: string;
  type: string;
  attributes: Record<string, unknown>;
};

export type GeckoDiscoveryCoverage = {
  source: "geckoterminal";
  pagesRequested: number;
  pagesLoaded: number;
  endpoints: Array<"new_pools" | "trending_pools" | "pools">;
  updateFrequencySeconds: number;
};

export async function loadGeckoTerminalDiscovery() {
  const requests = [
    ...pageRequests("new_pools", MAX_PAGES.new),
    ...pageRequests("trending_pools", MAX_PAGES.trending),
    ...pageRequests("pools", MAX_PAGES.top)
  ];
  const payloads = await mapWithConcurrency(requests, REQUEST_CONCURRENCY, fetchGeckoPage);
  const loadedPayloads = payloads.filter((payload): payload is unknown => payload !== undefined);
  const pairs = mergeGeckoPages(loadedPayloads);
  return {
    pairs,
    coverage: {
      source: "geckoterminal",
      pagesRequested: requests.length,
      pagesLoaded: loadedPayloads.length,
      endpoints: ["new_pools", "trending_pools", "pools"],
      updateFrequencySeconds: REVALIDATE_SECONDS
    } satisfies GeckoDiscoveryCoverage
  };
}

export function parseGeckoTerminalPools(payload: unknown, firstSeenAt = new Date().toISOString()) {
  const response = readRecord(payload);
  if (!response) return [];
  const included = new Map(
    readArray(response.included)
      .map(toIncluded)
      .filter((item): item is GeckoIncluded => Boolean(item))
      .map((item) => [item.id, item])
  );
  return readArray(response.data)
    .map(toPool)
    .filter((pool): pool is GeckoPool => Boolean(pool))
    .map((pool) => normalizeGeckoPool(pool, included, firstSeenAt))
    .filter((pair): pair is BasePair => Boolean(pair));
}

function pageRequests(endpoint: "new_pools" | "trending_pools" | "pools", pageCount: number) {
  return Array.from({ length: pageCount }, (_, index) => ({ endpoint, page: index + 1 }));
}

async function fetchGeckoPage({ endpoint, page }: { endpoint: string; page: number }) {
  const apiKey = process.env.COINGECKO_API_KEY?.trim();
  const apiBase = apiKey ? PRO_API_BASE : PUBLIC_API_BASE;
  const headers: Record<string, string> = {
    accept: "application/json",
    "user-agent": "Mergen-Base-Terminal/1.0"
  };
  if (apiKey) headers["x-cg-pro-api-key"] = apiKey;
  const query = new URLSearchParams({
    include: "base_token,quote_token,dex",
    page: String(page)
  });
  return fetchJsonWithTimeout(
    `${apiBase}/networks/${BASE_NETWORK_ID}/${endpoint}?${query}`,
    { headers, next: { revalidate: REVALIDATE_SECONDS } },
    REQUEST_TIMEOUT_MS
  );
}

export function mergeGeckoPages(payloads: unknown[]) {
  const unique = new Map<string, BasePair>();
  const firstSeenAt = new Date().toISOString();
  for (const payload of payloads) {
    for (const pair of parseGeckoTerminalPools(payload, firstSeenAt)) {
      const current = unique.get(pair.id);
      if (!current || pairQuality(pair) > pairQuality(current)) unique.set(pair.id, pair);
    }
  }
  return [...unique.values()]
    .sort((left, right) => pairQuality(right) - pairQuality(left) || left.id.localeCompare(right.id));
}

function normalizeGeckoPool(pool: GeckoPool, included: Map<string, GeckoIncluded>, firstSeenAt: string): BasePair | undefined {
  const poolAddress = readAddress(pool.attributes.address) ?? readAddress(pool.id.split("_").at(-1));
  const base = included.get(pool.relationships.base_token?.data?.id ?? "");
  const quote = included.get(pool.relationships.quote_token?.data?.id ?? "");
  const dex = included.get(pool.relationships.dex?.data?.id ?? "");
  const baseAddress = readAddress(base?.attributes.address) ?? readAddress(pool.relationships.base_token?.data?.id?.split("_").at(-1));
  const quoteAddress = readAddress(quote?.attributes.address) ?? readAddress(pool.relationships.quote_token?.data?.id?.split("_").at(-1));
  const baseSymbol = readBounded(base?.attributes.symbol, 32);
  const quoteSymbol = readBounded(quote?.attributes.symbol, 32);
  if (!poolAddress || !baseAddress || !quoteAddress || !baseSymbol || !quoteSymbol) return undefined;

  const sourceUpdatedAt = new Date().toISOString();
  const poolCreatedAt = readValidTimestamp(pool.attributes.pool_created_at);
  const priceUsd = readPositive(pool.attributes.base_token_price_usd);
  const liquidity = readNonNegative(pool.attributes.reserve_in_usd);
  const volumes = readNumberWindows(pool.attributes.volume_usd);
  const changes = readSignedWindows(pool.attributes.price_change_percentage);
  const transactions = readTransactionWindows(pool.attributes.transactions);
  const volume24h = volumes.h24 ?? 0;
  const volume6h = volumes.h6 ?? 0;
  const liquidityValue = liquidity ?? 0;
  const change24h = changes.h24 ?? 0;
  const ageMinutes = poolCreatedAt ? Math.max(0, Math.floor((Date.now() - Date.parse(poolCreatedAt)) / 60_000)) : UNKNOWN_AGE_MINUTES;
  const dexId = readBounded(pool.relationships.dex?.data?.id, 80) ?? "unknown";
  const dexName = readBounded(dex?.attributes.name, 80) ?? formatDexName(dexId);
  const baseName = readBounded(base?.attributes.name, 120) ?? `${baseSymbol} on Base`;
  const imageUrl = readImageUrl(base?.attributes.image_url);
  const quoteImageUrl = readImageUrl(quote?.attributes.image_url);
  const pairName = `${baseSymbol} / ${quoteSymbol}`;

  return {
    dataSource: "geckoterminal",
    dataProviders: ["geckoterminal"],
    sourceUpdatedAt,
    firstSeenAt,
    pairAddress: poolAddress,
    baseTokenAddress: baseAddress,
    quoteTokenAddress: quoteAddress,
    chainId: BASE_NETWORK_ID,
    dexId,
    dexName,
    sourceUrl: `https://www.geckoterminal.com/base/pools/${poolAddress}`,
    tokenLogoUrl: imageUrl,
    quoteTokenLogoUrl: quoteImageUrl,
    priceNative: readBounded(pool.attributes.base_token_price_quote_token, 80),
    priceUsdValue: priceUsd,
    liquidityUsd: liquidity,
    volumes,
    priceChanges: changes,
    txns: transactions,
    fdv: readPositive(pool.attributes.fdv_usd),
    marketCap: readPositive(pool.attributes.market_cap_usd),
    pairCreatedAt: poolCreatedAt,
    pairCreatedAtMs: poolCreatedAt ? Date.parse(poolCreatedAt) : undefined,
    id: poolAddress,
    pair: pairName,
    baseToken: baseSymbol,
    quoteToken: quoteSymbol,
    project: baseName,
    address: shortenAddress(baseAddress),
    route: `${quoteSymbol} / ${baseSymbol}`,
    dex: dexName,
    age: formatAgeLabel(ageMinutes),
    ageMinutes,
    price: readBounded(pool.attributes.base_token_price_quote_token, 80) ?? "N/A",
    priceUsd: priceUsd === undefined ? "N/A" : formatUsd(priceUsd, 6),
    change24h,
    volume24h,
    liquidity: liquidityValue,
    inflow24h: Math.max(0, volume24h - volume6h),
    momentumScore: getMomentumScore(change24h, liquidityValue, volume24h, transactions.h24),
    volumeMultiple: liquidityValue > 0 ? Number((volume24h / liquidityValue).toFixed(2)) : 0,
    chart: [],
    holders: {
      top10: "Not provided",
      top50: "Not provided",
      top100: "Not provided",
      total: "Not provided",
      active24h: "Not provided"
    },
    poolAge: formatAgeLabel(ageMinutes),
    flags: ["Contract checks not performed", "Unknown does not mean safe"],
    taxes: { buy: "Unknown", sell: "Unknown" },
    lpLock: { status: "Unknown", provider: "Not provided", expires: "N/A" },
    riskChecks: [
      { label: "Contract verified", value: "Not checked", ok: false },
      { label: "Mint function", value: "Not checked", ok: false },
      { label: "Blacklist", value: "Not checked", ok: false },
      { label: "Honeypot", value: "Not checked", ok: false },
      { label: "LP lock", value: "Unknown", ok: false },
      { label: "Holder concentration", value: "Not provided", ok: false },
      { label: "Deployer activity", value: "Not provided", ok: false }
    ],
    liquidityDetail: {
      poolLiquidity: liquidity === undefined ? "N/A" : formatUsd(liquidity),
      lpChange: "Not provided",
      depth: "Not provided",
      routeSource: dexName
    },
    activity: buildActivity(transactions, volumes, baseSymbol)
  };
}

function toPool(value: unknown): GeckoPool | undefined {
  const record = readRecord(value);
  const attributes = readRecord(record?.attributes);
  const relationships = readRecord(record?.relationships);
  const id = readString(record?.id);
  if (!id || !attributes || !relationships) return undefined;
  return {
    id,
    attributes,
    relationships: {
      base_token: toRelationship(relationships.base_token),
      quote_token: toRelationship(relationships.quote_token),
      dex: toRelationship(relationships.dex)
    }
  };
}

function toRelationship(value: unknown): GeckoRelationship | undefined {
  const record = readRecord(value);
  const data = readRecord(record?.data);
  if (!data) return undefined;
  return { data: { id: readString(data.id), type: readString(data.type) } };
}

function toIncluded(value: unknown): GeckoIncluded | undefined {
  const record = readRecord(value);
  const id = readString(record?.id);
  const type = readString(record?.type);
  const attributes = readRecord(record?.attributes);
  return id && type && attributes ? { id, type, attributes } : undefined;
}

function readNumberWindows(value: unknown) {
  const record = readRecord(value);
  return {
    m5: readNonNegative(record?.m5),
    h1: readNonNegative(record?.h1),
    h6: readNonNegative(record?.h6),
    h24: readNonNegative(record?.h24)
  };
}

function readSignedWindows(value: unknown) {
  const record = readRecord(value);
  return {
    m5: readFinite(record?.m5),
    h1: readFinite(record?.h1),
    h6: readFinite(record?.h6),
    h24: readFinite(record?.h24)
  };
}

function readTransactionWindows(value: unknown) {
  const record = readRecord(value);
  return {
    m5: readTxn(record?.m5),
    h1: readTxn(record?.h1),
    h6: readTxn(record?.h6),
    h24: readTxn(record?.h24)
  };
}

function readTxn(value: unknown) {
  const record = readRecord(value);
  const buys = readNonNegative(record?.buys);
  const sells = readNonNegative(record?.sells);
  return buys === undefined || sells === undefined ? undefined : { buys, sells };
}

function buildActivity(transactions: BasePair["txns"], volumes: BasePair["volumes"], symbol: string): PairActivity[] {
  return (["h24", "h6", "h1"] as const).map((window) => {
    const txns = transactions?.[window];
    return {
      time: window === "h24" ? "24h" : window === "h6" ? "6h" : "1h",
      side: (txns?.buys ?? 0) >= (txns?.sells ?? 0) ? "buy" : "sell",
      amount: txns ? `${txns.buys} buys / ${txns.sells} sells` : "Not provided",
      value: volumes?.[window] === undefined ? "N/A" : formatUsd(volumes[window]!),
      wallet: `${symbol} aggregate`
    };
  });
}

function getMomentumScore(change: number, liquidity: number, volume: number, txns: { buys: number; sells: number } | undefined) {
  const activity = (txns?.buys ?? 0) + (txns?.sells ?? 0);
  return Math.max(1, Math.min(100, Math.round(Math.abs(change) + Math.log10(volume + 1) * 5 + Math.log10(liquidity + 1) * 3 + activity / 20)));
}

function pairQuality(pair: BasePair) {
  return (pair.liquidityUsd ?? 0) + (pair.volumes?.h24 ?? 0) * 2 + (pair.priceUsdValue ? 10_000 : 0);
}

function readValidTimestamp(value: unknown) {
  const text = readString(value);
  if (!text) return undefined;
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) && timestamp <= Date.now() ? new Date(timestamp).toISOString() : undefined;
}

function readAddress(value: unknown) {
  const text = readString(value);
  return text && /^0x[0-9a-f]{40}$/i.test(text) ? text.toLowerCase() : undefined;
}

function readBounded(value: unknown, maximum: number) {
  const text = readString(value);
  return text ? text.slice(0, maximum) : undefined;
}

function readFinite(value: unknown) {
  return parseStrictFiniteNumber(value);
}

function readNonNegative(value: unknown) {
  const parsed = readFinite(value);
  return parsed !== undefined && parsed >= 0 ? parsed : undefined;
}

function readPositive(value: unknown) {
  const parsed = readFinite(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
}

function readImageUrl(value: unknown) {
  const text = readString(value);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function formatAgeLabel(minutes: number) {
  if (minutes === UNKNOWN_AGE_MINUTES) return "N/A";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1_440)}d`;
}

function formatDexName(value: string) {
  return value.split(/[_-]/).filter(Boolean).map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(" ") || "Unknown DEX";
}

function formatUsd(value: number, maximumFractionDigits = 1) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: value >= 1_000 ? "compact" : "standard", maximumFractionDigits }).format(value);
}

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, operation: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await operation(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}
