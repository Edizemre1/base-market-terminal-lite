import type { BasePair, PairActivity } from "@/types/baseTerminal";
import {
  fetchJsonWithTimeout,
  readArray,
  readAllowedHttpsUrl,
  readNumber,
  readRecord,
  readString
} from "./responseValidation";
import type { MarketDataProvider, PairRiskDetails } from "./types";
import { parseStrictFiniteNumber } from "@/lib/marketMath";
import { mergePoolPairs } from "@/lib/base-terminal/opportunityModel";
import { loadGeckoTerminalDiscovery } from "./geckoTerminalDiscoveryProvider";

const DEXSCREENER_API_BASE = "https://api.dexscreener.com";
const BASE_CHAIN_ID = "base";
const REVALIDATE_SECONDS = 60;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_PROFILE_TOKENS = 36;
const REQUEST_CONCURRENCY = 6;
const FEED_LIMIT = 8;
const MARKET_UNIVERSE_LIMIT = 1_000;
const MIN_LIQUIDITY_USD = 10_000;
const MIN_VOLUME_24H_USD = 5_000;
const MIN_VOLUME_INFLOW_24H_USD = 10_000;
const MAX_NEW_PAIR_AGE_MINUTES = 7 * 24 * 60;
const UNKNOWN_AGE_MINUTES = Number.MAX_SAFE_INTEGER;
const CURATED_BASE_QUERIES = [
  "WETH USDC",
  "AERO USDC",
  "DEGEN WETH",
  "BRETT WETH",
  "TOSHI WETH",
  "VIRTUAL WETH",
  "CLANKER WETH",
  "USDC WETH",
  "CBBTC WETH",
  "EURC USDC",
  "WETH USDBC",
  "CBBTC USDC",
  "CBETH WETH",
  "AERO WETH",
  "WELL USDC",
  "MORPHO USDC",
  "BRETT USDC",
  "HIGHER WETH",
  "KEYCAT WETH",
  "MOG WETH",
  "SKI WETH",
  "VIRTUAL USDC",
  "ZORA WETH",
  "DAI USDC",
  "USDS USDC"
];

type DexToken = {
  address?: string;
  name?: string;
  symbol?: string;
};

type DexTxnWindow = {
  buys?: number;
  sells?: number;
};

type DexPair = {
  chainId?: string;
  dexId?: string;
  pairAddress?: string;
  url?: string;
  info?: {
    imageUrl?: string;
  };
  baseToken?: DexToken;
  quoteToken?: DexToken;
  priceNative?: string;
  priceUsd?: string | null;
  fdv?: number | null;
  marketCap?: number | null;
  txns?: Record<string, DexTxnWindow | undefined>;
  volume?: Record<string, number | undefined>;
  priceChange?: Record<string, number | undefined> | null;
  liquidity?: {
    usd?: number | null;
    base?: number | null;
    quote?: number | null;
  } | null;
  pairCreatedAt?: number | null;
};

type DexTokenProfile = {
  chainId?: string;
  tokenAddress?: string;
};

type DexPairBucket = {
  searchPairs: DexPair[];
  profilePairs: DexPair[];
};

export function parseDexSearchResponse(payload: unknown): DexPair[] {
  const response = readRecord(payload);
  return response ? parseDexPairList(response.pairs) : [];
}

export function parseDexTokenProfiles(payload: unknown): DexTokenProfile[] {
  return readArray(payload)
    .map(toDexTokenProfile)
    .filter((profile): profile is DexTokenProfile => Boolean(profile));
}

export function parseDexPairList(payload: unknown): DexPair[] {
  return readArray(payload)
    .map(toDexPair)
    .filter((pair): pair is DexPair => Boolean(pair));
}

export function normalizeDexScreenerPair(payload: unknown): BasePair | undefined {
  const pair = toDexPair(payload);
  return pair ? normalizePair(pair) : undefined;
}

export async function createDexScreenerProvider(): Promise<MarketDataProvider> {
  const [{ searchPairs, profilePairs }, geckoDiscovery] = await Promise.all([
    loadDexScreenerPairs(),
    loadGeckoTerminalDiscovery()
  ]);
  const normalizedSearchPairs = normalizePairs(searchPairs);
  const normalizedProfilePairs = normalizePairs(profilePairs);
  const allPairs = mergePoolPairs([...geckoDiscovery.pairs, ...normalizedProfilePairs, ...normalizedSearchPairs])
    .sort((left, right) => getBasePairQualityScore(right) - getBasePairQualityScore(left) || left.id.localeCompare(right.id))
    .slice(0, MARKET_UNIVERSE_LIMIT);
  const pairsById = new Map(allPairs.map((pair) => [pair.id, pair]));

  return {
    mode: "dexscreener",
    name: "GeckoTerminal + DexScreener read-only Base data",
    readOnly: true,
    coverage: {
      providers: geckoDiscovery.pairs.length > 0 ? ["GeckoTerminal", "DexScreener"] : ["DexScreener"],
      pagesRequested: geckoDiscovery.coverage.pagesRequested,
      pagesLoaded: geckoDiscovery.coverage.pagesLoaded,
      capabilities: ["new_pools", "trending_pools", "top_pools", "token_profiles", "pair_enrichment"]
    },
    getAllPairs: () => allPairs,
    getNewPairs: () => {
      const freshProfilePairs = normalizedProfilePairs.filter(isFreshPair);
      const freshPairs = allPairs.filter(isFreshPair);
      const source = freshProfilePairs.length > 0 ? freshProfilePairs : freshPairs;
      return [...source]
        .sort((left, right) => (left.ageMinutes ?? Number.POSITIVE_INFINITY) - (right.ageMinutes ?? Number.POSITIVE_INFINITY) || (right.volume24h ?? 0) - (left.volume24h ?? 0) || left.id.localeCompare(right.id))
        .slice(0, FEED_LIMIT);
    },
    getVolumeInflows: () =>
      [...allPairs]
        .filter((pair) => hasMinimumMarketQuality(pair, MIN_VOLUME_INFLOW_24H_USD))
        .sort((left, right) => (right.volume24h ?? 0) - (left.volume24h ?? 0) || left.id.localeCompare(right.id))
        .slice(0, FEED_LIMIT),
    getMomentumPairs: () =>
      [...allPairs]
        .filter((pair) => hasMinimumMarketQuality(pair))
        .sort((left, right) => getMomentumRank(right) - getMomentumRank(left) || left.id.localeCompare(right.id))
        .slice(0, FEED_LIMIT),
    getPairById: async (id) => {
      const cachedPair = pairsById.get(id);

      if (cachedPair) {
        return cachedPair;
      }

      const livePair = await fetchPairById(id);
      return livePair ? normalizePair(livePair) : undefined;
    },
    getPairChart: (id) => pairsById.get(id)?.chart ?? [],
    getRiskDetails: (id) => {
      const pair = pairsById.get(id);
      return pair ? getUnverifiedRiskDetails(pair) : undefined;
    },
    getLiquidityDetails: (id) => pairsById.get(id)?.liquidityDetail,
    getActivityFeed: (id) => pairsById.get(id)?.activity ?? []
  };
}

async function loadDexScreenerPairs(): Promise<DexPairBucket> {
  const [searchPairs, profilePairs] = await Promise.all([
    loadCuratedSearchPairs(),
    loadProfilePairs()
  ]);

  return { searchPairs, profilePairs };
}

async function loadCuratedSearchPairs() {
  const searchResults = await mapWithConcurrency(
    CURATED_BASE_QUERIES,
    REQUEST_CONCURRENCY,
    async (query) => {
      const response = await fetchDexJson(
        `/latest/dex/search?q=${encodeURIComponent(query)}`
      );
      return filterBasePairs(parseDexSearchResponse(response));
    }
  );

  return dedupeDexPairs(searchResults.flat());
}

async function loadProfilePairs() {
  const profilePayloads = await Promise.all([
    fetchDexJson("/token-profiles/latest/v1"),
    fetchDexJson("/token-boosts/latest/v1"),
    fetchDexJson("/token-boosts/top/v1")
  ]);
  const profiles = dedupeTokenProfiles(profilePayloads.flatMap(parseDexTokenProfiles));
  const baseProfiles = profiles
    .filter((profile) => profile.chainId === BASE_CHAIN_ID && profile.tokenAddress)
    .slice(0, MAX_PROFILE_TOKENS);
  const pairResults = await mapWithConcurrency(
    baseProfiles,
    REQUEST_CONCURRENCY,
    async (profile) => {
      const pairs = parseDexPairList(
        await fetchDexJson(
          `/token-pairs/v1/${BASE_CHAIN_ID}/${profile.tokenAddress}`
        )
      );
      return selectProfilePairs(filterBasePairs(pairs));
    }
  );

  return dedupeDexPairs(pairResults.flat());
}

async function fetchPairById(pairId: string) {
  const response = await fetchDexJson(
    `/latest/dex/pairs/${BASE_CHAIN_ID}/${pairId}`
  );
  return filterBasePairs(parseDexSearchResponse(response))[0];
}

async function fetchDexJson(path: string): Promise<unknown | undefined> {
  return fetchJsonWithTimeout(
    `${DEXSCREENER_API_BASE}${path}`,
    {
      headers: { accept: "application/json" },
      next: { revalidate: REVALIDATE_SECONDS }
    },
    REQUEST_TIMEOUT_MS
  );
}

function toDexPair(payload: unknown): DexPair | undefined {
  const pair = readRecord(payload);

  if (!pair) {
    return undefined;
  }

  const normalized = {
    chainId: readBoundedString(pair.chainId, 32),
    dexId: readBoundedString(pair.dexId, 64),
    pairAddress: readEvmAddress(pair.pairAddress),
    url: readAllowedHttpsUrl(pair.url, ["dexscreener.com"]),
    info: toDexPairInfo(pair.info),
    baseToken: toDexToken(pair.baseToken),
    quoteToken: toDexToken(pair.quoteToken),
    priceNative: readStrictNumericString(pair.priceNative),
    priceUsd: readStrictNumericString(pair.priceUsd) ?? readNumber(pair.priceUsd)?.toString() ?? null,
    fdv: readNumber(pair.fdv) ?? null,
    marketCap: readNumber(pair.marketCap) ?? null,
    txns: toDexTxnWindows(pair.txns),
    volume: toNumberWindows(pair.volume),
    priceChange: toNumberWindows(pair.priceChange) ?? null,
    liquidity: toDexLiquidity(pair.liquidity),
    pairCreatedAt: readNumber(pair.pairCreatedAt) ?? null
  };

  if (
    !normalized.chainId &&
    !normalized.pairAddress &&
    !normalized.baseToken &&
    !normalized.quoteToken
  ) {
    return undefined;
  }

  return normalized;
}

function toDexPairInfo(payload: unknown): DexPair["info"] {
  const info = readRecord(payload);

  if (!info) {
    return undefined;
  }

  const imageUrl = readAllowedHttpsUrl(info.imageUrl, ["dexscreener.com", "coingecko.com"]);
  return imageUrl ? { imageUrl } : undefined;
}

function toDexToken(payload: unknown): DexToken | undefined {
  const token = readRecord(payload);

  if (!token) {
    return undefined;
  }

  const address = readEvmAddress(token.address);
  const name = readBoundedString(token.name, 120);
  const symbol = readBoundedString(token.symbol, 32);

  if (!address && !name && !symbol) {
    return undefined;
  }

  return { address, name, symbol };
}

function toDexTokenProfile(payload: unknown): DexTokenProfile | undefined {
  const profile = readRecord(payload);

  if (!profile) {
    return undefined;
  }

  const chainId = readBoundedString(profile.chainId, 32);
  const tokenAddress = readEvmAddress(profile.tokenAddress);

  if (!chainId && !tokenAddress) {
    return undefined;
  }

  return { chainId, tokenAddress };
}

function toDexLiquidity(payload: unknown): DexPair["liquidity"] {
  const liquidity = readRecord(payload);

  if (!liquidity) {
    return null;
  }

  return {
    usd: readNumber(liquidity.usd) ?? null,
    base: readNumber(liquidity.base) ?? null,
    quote: readNumber(liquidity.quote) ?? null
  };
}

function toNumberWindows(payload: unknown): Record<string, number | undefined> | undefined {
  const windows = readRecord(payload);

  if (!windows) {
    return undefined;
  }

  const normalized: Record<string, number | undefined> = {};

  for (const key of ["m5", "h1", "h6", "h24"]) {
    normalized[key] = readNumber(windows[key]);
  }

  return normalized;
}

function toDexTxnWindows(payload: unknown): Record<string, DexTxnWindow | undefined> | undefined {
  const windows = readRecord(payload);

  if (!windows) {
    return undefined;
  }

  const normalized: Record<string, DexTxnWindow | undefined> = {};

  for (const key of ["m5", "h1", "h6", "h24"]) {
    normalized[key] = toDexTxnWindow(windows[key]);
  }

  return normalized;
}

function toDexTxnWindow(payload: unknown): DexTxnWindow | undefined {
  const window = readRecord(payload);

  if (!window) {
    return undefined;
  }

  const buys = readNumber(window.buys);
  const sells = readNumber(window.sells);

  if (buys === undefined && sells === undefined) {
    return undefined;
  }

  return { buys, sells };
}

function filterBasePairs(pairs: DexPair[], minVolume24h = MIN_VOLUME_24H_USD) {
  return dedupeDexPairs(
    pairs.filter((pair) => isQualityBasePair(pair, minVolume24h))
  );
}

function selectProfilePairs(pairs: DexPair[]) {
  return [...pairs]
    .sort((left, right) => {
      const leftAge = getAgeMinutes(left.pairCreatedAt);
      const rightAge = getAgeMinutes(right.pairCreatedAt);
      const leftVolume = toNumber(left.volume?.h24);
      const rightVolume = toNumber(right.volume?.h24);

      return leftAge - rightAge || rightVolume - leftVolume;
    })
    .slice(0, 2);
}

function normalizePairs(pairs: DexPair[]) {
  return dedupeDexPairs(pairs)
    .map(normalizePair)
    .filter((pair): pair is BasePair => Boolean(pair));
}

function normalizePair(pair: DexPair): BasePair | undefined {
  const pairAddress = pair.pairAddress;
  const baseToken = pair.baseToken;
  const quoteToken = pair.quoteToken;

  if (!isQualityBasePair(pair) || !pairAddress || !baseToken?.symbol || !quoteToken?.symbol) {
    return undefined;
  }

  const volume24h = toNumber(pair.volume?.h24);
  const volume6h = toNumber(pair.volume?.h6);
  const liquidity = toNumber(pair.liquidity?.usd);
  const change24h = toNumber(pair.priceChange?.h24);
  const pairCreatedAtMs = getValidPairCreatedAtMs(pair.pairCreatedAt);
  const ageMinutes = getAgeMinutes(pairCreatedAtMs);
  const h24Txns = pair.txns?.h24;
  const buys = toNumber(h24Txns?.buys);
  const sells = toNumber(h24Txns?.sells);
  const totalTxns = buys + sells;
  const momentumScore = getMomentumScore({ change24h, liquidity, volume24h, totalTxns });
  const priceNative = pair.priceNative ?? pair.priceUsd ?? "0";
  const priceUsd = toNumber(pair.priceUsd);
  const fdv = toNumber(pair.fdv);
  const marketCap = toNumber(pair.marketCap);

  return {
    dataSource: "dexscreener",
    dataProviders: ["dexscreener"],
    sourceUpdatedAt: new Date().toISOString(),
    firstSeenAt: new Date().toISOString(),
    pairAddress: pairAddress.toLowerCase(),
    baseTokenAddress: baseToken.address?.toLowerCase(),
    quoteTokenAddress: quoteToken.address?.toLowerCase(),
    chainId: pair.chainId,
    dexId: pair.dexId,
    dexName: formatDexName(pair.dexId),
    sourceUrl: pair.url ?? `https://dexscreener.com/base/${pairAddress}`,
    tokenLogoUrl: pair.info?.imageUrl,
    quoteTokenLogoUrl: getKnownTokenLogoUrl(quoteToken.symbol),
    priceNative,
    priceUsdValue: priceUsd,
    liquidityUsd: liquidity,
    volumes: normalizeNumberWindows(pair.volume),
    priceChanges: normalizeSignedNumberWindows(pair.priceChange ?? undefined),
    txns: normalizeTxnWindows(pair.txns),
    fdv: fdv > 0 ? fdv : undefined,
    marketCap: marketCap > 0 ? marketCap : undefined,
    pairCreatedAt: pairCreatedAtMs > 0 ? new Date(pairCreatedAtMs).toISOString() : undefined,
    pairCreatedAtMs: pairCreatedAtMs > 0 ? pairCreatedAtMs : undefined,
    id: pairAddress.toLowerCase(),
    pair: `${baseToken.symbol} / ${quoteToken.symbol}`,
    baseToken: baseToken.symbol,
    quoteToken: quoteToken.symbol,
    project: baseToken.name ?? `${baseToken.symbol} on Base`,
    address: shortenAddress(baseToken.address ?? pairAddress),
    route: `${quoteToken.symbol} / ${baseToken.symbol}`,
    dex: formatDexName(pair.dexId),
    age: formatAgeLabel(ageMinutes),
    ageMinutes,
    price: formatNativePrice(priceNative),
    priceUsd: priceUsd > 0 ? formatUsd(priceUsd, 6) : "$0",
    change24h,
    volume24h,
    liquidity,
    inflow24h: Math.max(0, volume24h - volume6h),
    momentumScore,
    volumeMultiple: liquidity > 0 ? Number((volume24h / liquidity).toFixed(2)) : 0,
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
    riskChecks: getUnverifiedRiskDetails().riskChecks,
    liquidityDetail: {
      poolLiquidity: formatUsd(liquidity),
      lpChange: "Not provided",
      depth: "Not provided",
      routeSource: pair.dexId ?? "DexScreener"
    },
    activity: buildActivityFeed(pair, baseToken.symbol)
  };
}

function getUnverifiedRiskDetails(pair?: BasePair): PairRiskDetails {
  return {
    flags: pair?.flags ?? ["Contract checks not performed", "Unknown does not mean safe"],
    holders: {
      top10: "Not provided",
      top50: "Not provided",
      top100: "Not provided",
      total: "Not provided",
      active24h: "Not provided"
    },
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
    ]
  };
}

function dedupeTokenProfiles(profiles: DexTokenProfile[]) {
  const unique = new Map<string, DexTokenProfile>();
  for (const profile of profiles) {
    if (!profile.chainId || !profile.tokenAddress) continue;
    unique.set(`${profile.chainId}:${profile.tokenAddress}`.toLowerCase(), profile);
  }
  return [...unique.values()];
}

async function mapWithConcurrency<T, R>(items: readonly T[], concurrency: number, operation: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await operation(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function buildActivityFeed(pair: DexPair, symbol: string): PairActivity[] {
  return [
    getActivityRow("24h", pair.txns?.h24, pair.volume?.h24, symbol),
    getActivityRow("6h", pair.txns?.h6, pair.volume?.h6, symbol),
    getActivityRow("1h", pair.txns?.h1, pair.volume?.h1, symbol)
  ];
}

function getActivityRow(
  time: string,
  txns: DexTxnWindow | undefined,
  volume: number | undefined,
  symbol: string
): PairActivity {
  const buys = toNumber(txns?.buys);
  const sells = toNumber(txns?.sells);

  return {
    time,
    side: buys >= sells ? "buy" : "sell",
    amount: `${buys} buys / ${sells} sells`,
    value: formatUsd(toNumber(volume)),
    wallet: `${symbol} aggregate`
  };
}

function normalizeNumberWindows(windows: Record<string, number | undefined> | undefined | null) {
  return {
    m5: getNonNegativeWindowValue(windows?.m5),
    h1: getNonNegativeWindowValue(windows?.h1),
    h6: getNonNegativeWindowValue(windows?.h6),
    h24: getNonNegativeWindowValue(windows?.h24)
  };
}

function normalizeSignedNumberWindows(
  windows: Record<string, number | undefined> | undefined | null
) {
  return {
    m5: getFiniteWindowValue(windows?.m5),
    h1: getFiniteWindowValue(windows?.h1),
    h6: getFiniteWindowValue(windows?.h6),
    h24: getFiniteWindowValue(windows?.h24)
  };
}

function normalizeTxnWindows(windows: Record<string, DexTxnWindow | undefined> | undefined) {
  return {
    m5: normalizeTxnWindow(windows?.m5),
    h1: normalizeTxnWindow(windows?.h1),
    h6: normalizeTxnWindow(windows?.h6),
    h24: normalizeTxnWindow(windows?.h24)
  };
}

function normalizeTxnWindow(window: DexTxnWindow | undefined) {
  if (!window) {
    return undefined;
  }

  const buys = toNumber(window.buys);
  const sells = toNumber(window.sells);

  return { buys, sells };
}

function getNonNegativeWindowValue(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function getFiniteWindowValue(value: number | undefined) {
  if (value === undefined) {
    return undefined;
  }

  const parsed = toNumber(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getMomentumScore({
  change24h,
  liquidity,
  volume24h,
  totalTxns
}: {
  change24h: number;
  liquidity: number;
  volume24h: number;
  totalTxns: number;
}) {
  const priceSignal = clamp(change24h + 20, 0, 45);
  const volumeSignal = clamp(Math.log10(Math.max(volume24h, 0) + 1) * 4, 0, 25);
  const matchedActivitySignal = clamp(Math.log10(Math.max(Math.min(volume24h, liquidity), 0) + 1) * 2, 0, 10);
  const txnSignal = clamp(totalTxns / 10, 0, 20);

  return clamp(Math.round(priceSignal + volumeSignal + matchedActivitySignal + txnSignal), 1, 100);
}

function getMomentumRank(pair: BasePair) {
  const priceSignal = clamp(pair.change24h ?? 0, -35, 85);
  const volumeSignal = clamp(Math.log10(Math.max(pair.volume24h ?? 0, 0) + 1) * 6, 0, 45);
  const matchedActivitySignal = clamp(Math.log10(Math.max(Math.min(pair.volume24h ?? 0, pair.liquidity ?? 0), 0) + 1) * 3, 0, 24);
  const liquiditySignal = clamp(Math.log10(Math.max(pair.liquidity ?? 0, 1)) * 3, 0, 18);

  return priceSignal + volumeSignal + matchedActivitySignal + liquiditySignal + (pair.momentumScore ?? 0) * 0.2;
}

function dedupeDexPairs(pairs: DexPair[]) {
  const pairsByAddress = new Map<string, DexPair>();

  for (const pair of pairs) {
    if (!pair.pairAddress) {
      continue;
    }

    const key = pair.pairAddress.toLowerCase();
    const current = pairsByAddress.get(key);

    if (!current || getDexPairQualityScore(pair) > getDexPairQualityScore(current)) {
      pairsByAddress.set(key, pair);
    }
  }

  return [...pairsByAddress.values()];
}

function isQualityBasePair(pair: DexPair, minVolume24h = MIN_VOLUME_24H_USD) {
  return (
    pair.chainId === BASE_CHAIN_ID &&
    Boolean(pair.pairAddress) &&
    Boolean(pair.baseToken?.symbol && pair.baseToken.address) &&
    Boolean(pair.quoteToken?.symbol && pair.quoteToken.address) &&
    toNumber(pair.priceUsd) > 0 &&
    toNumber(pair.liquidity?.usd) >= MIN_LIQUIDITY_USD &&
    toNumber(pair.volume?.h24) >= minVolume24h
  );
}

function hasMinimumMarketQuality(pair: BasePair, minVolume24h = MIN_VOLUME_24H_USD) {
  return (pair.liquidity ?? Number.NEGATIVE_INFINITY) >= MIN_LIQUIDITY_USD && (pair.volume24h ?? Number.NEGATIVE_INFINITY) >= minVolume24h;
}

function isFreshPair(pair: BasePair) {
  return pair.ageMinutes !== undefined && pair.ageMinutes >= 0 && pair.ageMinutes <= MAX_NEW_PAIR_AGE_MINUTES;
}

function getDexPairQualityScore(pair: DexPair) {
  const volume24h = toNumber(pair.volume?.h24);
  const liquidity = toNumber(pair.liquidity?.usd);
  const change24h = Math.abs(toNumber(pair.priceChange?.h24));

  return volume24h * 2 + liquidity + change24h * 1_000;
}

function getBasePairQualityScore(pair: BasePair) {
  return (pair.volume24h ?? 0) * 2 + (pair.liquidity ?? 0) + Math.abs(pair.change24h ?? 0) * 1_000;
}

function getAgeMinutes(pairCreatedAt: number | null | undefined) {
  const createdAt = toNumber(pairCreatedAt);

  if (createdAt <= 0 || createdAt > Date.now() + 60_000) {
    return UNKNOWN_AGE_MINUTES;
  }

  return Math.max(0, Math.floor((Date.now() - createdAt) / 60_000));
}

function getValidPairCreatedAtMs(pairCreatedAt: number | null | undefined) {
  const createdAt = toNumber(pairCreatedAt);
  return createdAt > 0 && createdAt <= Date.now() + 60_000 ? createdAt : 0;
}

function formatAgeLabel(minutes: number) {
  if (minutes === UNKNOWN_AGE_MINUTES) {
    return "N/A";
  }

  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h ${minutes % 60}m`;
  }

  return `${Math.floor(hours / 24)}d`;
}

function formatNativePrice(value: string) {
  const parsed = parseStrictFiniteNumber(value);

  if (parsed === undefined) {
    return "N/A";
  }

  if (parsed > 0 && parsed < 0.0001) {
    return parsed.toFixed(10);
  }

  if (parsed < 1) {
    return parsed.toFixed(6);
  }

  return parsed.toFixed(4);
}

function formatUsd(value: number, maximumFractionDigits = 1) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: value >= 100_000 ? "compact" : "standard",
    maximumFractionDigits
  }).format(value);
}

function formatDexName(dexId: string | undefined) {
  if (!dexId) {
    return "DexScreener";
  }

  return dexId
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function shortenAddress(address: string) {
  if (address.length <= 12) {
    return address;
  }

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function getKnownTokenLogoUrl(symbol: string | undefined) {
  const normalized = symbol?.toUpperCase();

  if (normalized === "WETH" || normalized === "ETH") {
    return "https://assets.coingecko.com/coins/images/279/small/ethereum.png";
  }

  if (normalized === "USDC") {
    return "https://assets.coingecko.com/coins/images/6319/small/usdc.png";
  }

  return undefined;
}

function toNumber(value: number | string | null | undefined) {
  return parseStrictFiniteNumber(value) ?? 0;
}

function readEvmAddress(value: unknown) {
  const address = readString(value);
  return address && /^0x[0-9a-f]{40}$/i.test(address) ? address : undefined;
}

function readBoundedString(value: unknown, maximumLength: number) {
  const text = readString(value)?.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return text ? text.slice(0, maximumLength) : undefined;
}

function readStrictNumericString(value: unknown) {
  const number = parseStrictFiniteNumber(value);
  return number === undefined ? undefined : String(number);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
