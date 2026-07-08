import type { BasePair, PairActivity } from "@/types/baseTerminal";
import type { MarketDataProvider, PairRiskDetails } from "./types";

const DEXSCREENER_API_BASE = "https://api.dexscreener.com";
const BASE_CHAIN_ID = "base";
const REVALIDATE_SECONDS = 60;
const MAX_PROFILE_TOKENS = 12;
const FEED_LIMIT = 8;
const MIN_LIQUIDITY_USD = 10_000;
const MIN_VOLUME_24H_USD = 5_000;
const MIN_VOLUME_INFLOW_24H_USD = 10_000;
const MAX_NEW_PAIR_AGE_MINUTES = 7 * 24 * 60;
const CURATED_BASE_QUERIES = [
  "WETH USDC",
  "AERO USDC",
  "DEGEN WETH",
  "BRETT WETH",
  "TOSHI WETH",
  "VIRTUAL WETH",
  "CLANKER WETH"
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
  baseToken?: DexToken;
  quoteToken?: DexToken;
  priceNative?: string;
  priceUsd?: string | null;
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

type DexSearchResponse = {
  pairs?: DexPair[] | null;
};

type DexTokenProfile = {
  chainId?: string;
  tokenAddress?: string;
};

type DexPairBucket = {
  searchPairs: DexPair[];
  profilePairs: DexPair[];
};

export async function createDexScreenerProvider(): Promise<MarketDataProvider> {
  const { searchPairs, profilePairs } = await loadDexScreenerPairs();
  const normalizedSearchPairs = normalizePairs(searchPairs);
  const normalizedProfilePairs = normalizePairs(profilePairs);
  const allPairs = dedupePairs([...normalizedProfilePairs, ...normalizedSearchPairs]);
  const pairsById = new Map(allPairs.map((pair) => [pair.id, pair]));

  return {
    mode: "dexscreener",
    name: "DexScreener read-only Base data",
    readOnly: true,
    getNewPairs: () => {
      const freshProfilePairs = normalizedProfilePairs.filter(isFreshPair);
      const freshPairs = allPairs.filter(isFreshPair);
      const source = freshProfilePairs.length > 0 ? freshProfilePairs : freshPairs;
      return [...source]
        .sort(
          (left, right) =>
            left.ageMinutes - right.ageMinutes || right.volume24h - left.volume24h
        )
        .slice(0, FEED_LIMIT);
    },
    getVolumeInflows: () =>
      [...allPairs]
        .filter((pair) => hasMinimumMarketQuality(pair, MIN_VOLUME_INFLOW_24H_USD))
        .sort((left, right) => right.volume24h - left.volume24h)
        .slice(0, FEED_LIMIT),
    getMomentumPairs: () =>
      [...allPairs]
        .filter((pair) => hasMinimumMarketQuality(pair))
        .sort((left, right) => getMomentumRank(right) - getMomentumRank(left))
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
      return pair ? getDerivedRiskDetails(pair) : undefined;
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
  const searchResults = await Promise.all(
    CURATED_BASE_QUERIES.map(async (query) => {
      const response = await fetchDexJson<DexSearchResponse>(
        `/latest/dex/search?q=${encodeURIComponent(query)}`
      );
      return filterBasePairs(response?.pairs ?? []);
    })
  );

  return dedupeDexPairs(searchResults.flat());
}

async function loadProfilePairs() {
  const profiles = await fetchDexJson<DexTokenProfile[]>("/token-profiles/latest/v1");
  const baseProfiles = (profiles ?? [])
    .filter((profile) => profile.chainId === BASE_CHAIN_ID && profile.tokenAddress)
    .slice(0, MAX_PROFILE_TOKENS);
  const pairResults = await Promise.all(
    baseProfiles.map(async (profile) => {
      const pairs = await fetchDexJson<DexPair[]>(
        `/token-pairs/v1/${BASE_CHAIN_ID}/${profile.tokenAddress}`
      );
      return selectProfilePairs(filterBasePairs(pairs ?? []));
    })
  );

  return dedupeDexPairs(pairResults.flat());
}

async function fetchPairById(pairId: string) {
  const response = await fetchDexJson<DexSearchResponse>(
    `/latest/dex/pairs/${BASE_CHAIN_ID}/${pairId}`
  );
  return filterBasePairs(response?.pairs ?? [])[0];
}

async function fetchDexJson<T>(path: string): Promise<T | undefined> {
  try {
    const response = await fetch(`${DEXSCREENER_API_BASE}${path}`, {
      headers: { accept: "application/json" },
      next: { revalidate: REVALIDATE_SECONDS }
    } as RequestInit & { next: { revalidate: number } });

    if (!response.ok) {
      return undefined;
    }

    return (await response.json()) as T;
  } catch {
    return undefined;
  }
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
  const ageMinutes = getAgeMinutes(pair.pairCreatedAt);
  const h24Txns = pair.txns?.h24;
  const buys = toNumber(h24Txns?.buys);
  const sells = toNumber(h24Txns?.sells);
  const totalTxns = buys + sells;
  const buyPressure = totalTxns > 0 ? Math.round((buys / totalTxns) * 100) : 50;
  const sellPressure = 100 - buyPressure;
  const riskScore = getDerivedRiskScore({ ageMinutes, liquidity, sells, totalTxns });
  const momentumScore = getMomentumScore({ change24h, liquidity, volume24h, totalTxns });
  const priceNative = pair.priceNative ?? pair.priceUsd ?? "0";
  const priceUsd = toNumber(pair.priceUsd);

  return {
    dataSource: "dexscreener",
    pairAddress: pairAddress.toLowerCase(),
    id: pairAddress.toLowerCase(),
    pair: `${baseToken.symbol} / ${quoteToken.symbol}`,
    baseToken: baseToken.symbol,
    quoteToken: quoteToken.symbol,
    project: baseToken.name ?? `${baseToken.symbol} on Base`,
    address: shortenAddress(baseToken.address ?? pairAddress),
    route: `${quoteToken.symbol} / ${baseToken.symbol}`,
    dex: pair.dexId ?? "DexScreener",
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
    riskScore,
    riskLabel: "Derived/demo risk UI",
    chart: buildSyntheticChart(change24h, volume24h, liquidity),
    pressure: { buy: buyPressure, sell: sellPressure },
    holders: {
      top10: "N/A",
      top50: "N/A",
      top100: "N/A",
      total: "Not provided",
      active24h: totalTxns > 0 ? totalTxns.toString() : "N/A"
    },
    poolAge: formatAgeLabel(ageMinutes),
    flags: ["Derived/demo risk UI", "Not a safety guarantee"],
    taxes: { buy: "Unknown", sell: "Unknown" },
    lpLock: { status: "Unknown", provider: "Not provided", expires: "N/A" },
    riskChecks: getDerivedRiskDetailsFromValues(riskScore).riskChecks,
    liquidityDetail: {
      poolLiquidity: formatUsd(liquidity),
      lpChange: change24h === 0 ? "Not provided" : `${formatSigned(change24h)} price change`,
      depth: liquidity > 0 ? `${formatUsd(liquidity * 0.02)} within 2% est.` : "Not provided",
      routeSource: pair.dexId ?? "DexScreener"
    },
    activity: buildActivityFeed(pair, baseToken.symbol)
  };
}

function getDerivedRiskDetails(pair: BasePair): PairRiskDetails {
  return {
    ...getDerivedRiskDetailsFromValues(pair.riskScore),
    riskLabel: pair.riskLabel,
    flags: pair.flags,
    holders: pair.holders,
    taxes: pair.taxes,
    lpLock: pair.lpLock
  };
}

function getDerivedRiskDetailsFromValues(riskScore: number): PairRiskDetails {
  return {
    riskScore,
    riskLabel: "Derived/demo risk UI",
    flags: ["Derived/demo risk UI", "Not a safety guarantee"],
    holders: {
      top10: "N/A",
      top50: "N/A",
      top100: "N/A",
      total: "Not provided",
      active24h: "Dex aggregate"
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
      { label: "Deployer activity", value: "Not provided", ok: false },
      { label: "Safety score", value: `${riskScore} / 100 derived UI`, ok: false }
    ]
  };
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

function getDerivedRiskScore({
  ageMinutes,
  liquidity,
  sells,
  totalTxns
}: {
  ageMinutes: number;
  liquidity: number;
  sells: number;
  totalTxns: number;
}) {
  const agePenalty = ageMinutes < 60 ? 24 : ageMinutes < 360 ? 14 : 6;
  const liquidityPenalty = liquidity < 50_000 ? 26 : liquidity < 150_000 ? 16 : 8;
  const sellPressure = totalTxns > 0 ? sells / totalTxns : 0.5;
  const pressurePenalty = sellPressure > 0.6 ? 18 : sellPressure > 0.5 ? 10 : 4;

  return clamp(Math.round(agePenalty + liquidityPenalty + pressurePenalty), 18, 78);
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
  const volumeSignal = liquidity > 0 ? clamp((volume24h / liquidity) * 18, 0, 35) : 0;
  const txnSignal = clamp(totalTxns / 10, 0, 20);

  return clamp(Math.round(priceSignal + volumeSignal + txnSignal), 1, 100);
}

function getMomentumRank(pair: BasePair) {
  const priceSignal = clamp(pair.change24h, -35, 85);
  const volumeLiquiditySignal = clamp((pair.volume24h / Math.max(pair.liquidity, 1)) * 35, 0, 45);
  const liquiditySignal = clamp(Math.log10(Math.max(pair.liquidity, 1)) * 3, 0, 18);

  return priceSignal + volumeLiquiditySignal + liquiditySignal + pair.momentumScore * 0.2;
}

function buildSyntheticChart(change24h: number, volume24h: number, liquidity: number) {
  const direction = change24h >= 0 ? 1 : -1;
  const volatility = liquidity > 0 ? clamp(volume24h / liquidity, 0.08, 1.1) : 0.2;
  const base = 1;

  return Array.from({ length: 12 }, (_, index) => {
    const progress = index / 11;
    const trend = (Math.abs(change24h) / 100) * progress * direction;
    const wave = Math.sin(index * 1.7) * volatility * 0.025;
    return Number((base + trend + wave).toFixed(4));
  });
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

  const pairsByTokenRoute = new Map<string, DexPair>();

  for (const pair of pairsByAddress.values()) {
    const key = getDexTokenPairKey(pair);
    const current = pairsByTokenRoute.get(key);

    if (!current || getDexPairQualityScore(pair) > getDexPairQualityScore(current)) {
      pairsByTokenRoute.set(key, pair);
    }
  }

  return [...pairsByTokenRoute.values()];
}

function dedupePairs(pairs: BasePair[]) {
  const pairsById = new Map<string, BasePair>();

  for (const pair of pairs) {
    const current = pairsById.get(pair.id);

    if (!current || getBasePairQualityScore(pair) > getBasePairQualityScore(current)) {
      pairsById.set(pair.id, pair);
    }
  }

  const pairsByTokenRoute = new Map<string, BasePair>();

  for (const pair of pairsById.values()) {
    const key = `${pair.baseToken.toLowerCase()}-${pair.quoteToken.toLowerCase()}`;
    const current = pairsByTokenRoute.get(key);

    if (!current || getBasePairQualityScore(pair) > getBasePairQualityScore(current)) {
      pairsByTokenRoute.set(key, pair);
    }
  }

  return [...pairsByTokenRoute.values()];
}

function isQualityBasePair(pair: DexPair, minVolume24h = MIN_VOLUME_24H_USD) {
  return (
    pair.chainId === BASE_CHAIN_ID &&
    Boolean(pair.pairAddress) &&
    Boolean(pair.baseToken?.symbol && pair.baseToken.address) &&
    Boolean(pair.quoteToken?.symbol && pair.quoteToken.address) &&
    toNumber(pair.priceUsd) > 0 &&
    toNumber(pair.liquidity?.usd) > MIN_LIQUIDITY_USD &&
    toNumber(pair.volume?.h24) > minVolume24h
  );
}

function hasMinimumMarketQuality(pair: BasePair, minVolume24h = MIN_VOLUME_24H_USD) {
  return pair.liquidity > MIN_LIQUIDITY_USD && pair.volume24h > minVolume24h;
}

function isFreshPair(pair: BasePair) {
  return pair.ageMinutes > 0 && pair.ageMinutes <= MAX_NEW_PAIR_AGE_MINUTES;
}

function getDexPairQualityScore(pair: DexPair) {
  const volume24h = toNumber(pair.volume?.h24);
  const liquidity = toNumber(pair.liquidity?.usd);
  const change24h = Math.abs(toNumber(pair.priceChange?.h24));

  return volume24h * 2 + liquidity + change24h * 1_000;
}

function getBasePairQualityScore(pair: BasePair) {
  return pair.volume24h * 2 + pair.liquidity + Math.abs(pair.change24h) * 1_000;
}

function getDexTokenPairKey(pair: DexPair) {
  const base =
    pair.baseToken?.address?.toLowerCase() ??
    pair.baseToken?.symbol?.toLowerCase() ??
    "unknown-base";
  const quote =
    pair.quoteToken?.address?.toLowerCase() ??
    pair.quoteToken?.symbol?.toLowerCase() ??
    "unknown-quote";

  return `${base}-${quote}`;
}

function getAgeMinutes(pairCreatedAt: number | null | undefined) {
  const createdAt = toNumber(pairCreatedAt);

  if (createdAt <= 0) {
    return 999_999;
  }

  return Math.max(1, Math.floor((Date.now() - createdAt) / 60_000));
}

function formatAgeLabel(minutes: number) {
  if (minutes >= 999_999) {
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
  const parsed = Number.parseFloat(value);

  if (!Number.isFinite(parsed)) {
    return value || "0";
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

function formatSigned(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function shortenAddress(address: string) {
  if (address.length <= 12) {
    return address;
  }

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function toNumber(value: number | string | null | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
