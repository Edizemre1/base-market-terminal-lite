import type { TokenOpportunity } from "@/lib/base-terminal/opportunityModel";
import type { BasePair } from "@/types/baseTerminal";
import { MARKET_QUALITY_THRESHOLDS } from "../../../collector/market-quality.mjs";

const BASE_CHAIN_ID = 8453;
const FUTURE_TIMESTAMP_TOLERANCE_MS = 5_000;
const EVM_ADDRESS = /^0x[0-9a-f]{40}$/i;
const LIVE_PROVIDER_IDS = new Set(["dexscreener", "geckoterminal"]);

export type OpportunityMarketPrice = {
  value: number;
  source: "canonical" | "observed" | "provider" | "demo";
  provider?: string;
};

export function resolveOpportunityMarketPrice(
  opportunity: TokenOpportunity,
  pair: BasePair | undefined,
  nowMs = Date.now()
): OpportunityMarketPrice | undefined {
  const canonicalValue = readPositive(opportunity.canonicalPrice.value);
  if (opportunity.canonicalPrice.tier !== "UNPRICED" && canonicalValue !== undefined) {
    return { value: canonicalValue, source: "canonical" };
  }

  const observed = opportunity.observedPriceUsd;
  const observedValue = readPositive(observed?.value);
  if (
    observed &&
    observedValue !== undefined &&
    observed.executable === false &&
    observed.freshness === "fresh" &&
    observed.provider !== "mock" &&
    EVM_ADDRESS.test(observed.poolAddress) &&
    isFreshTimestamp(observed.observedAt, nowMs)
  ) {
    return { value: observedValue, source: "observed", provider: observed.provider };
  }

  if (pair?.dataSource === "mock") {
    const demoValue = readPositive(pair.priceUsdValue);
    return demoValue === undefined ? undefined : { value: demoValue, source: "demo", provider: "mock" };
  }

  if (!pair || !isFreshValidatedProviderPair(opportunity, pair, nowMs)) return undefined;
  return { value: pair.priceUsdValue!, source: "provider", provider: pair.dataSource };
}

function isFreshValidatedProviderPair(opportunity: TokenOpportunity, pair: BasePair, nowMs: number) {
  const provider = pair.dataSource;
  const focusAddress = normalizeAddress(opportunity.focusTokenAddress);
  const baseAddress = normalizeAddress(pair.baseTokenAddress);
  const pairAddress = normalizeAddress(pair.pairAddress);
  return (
    provider !== undefined &&
    LIVE_PROVIDER_IDS.has(provider) &&
    (pair.dataProviders ?? [provider]).includes(provider) &&
    opportunity.chainId === BASE_CHAIN_ID &&
    normalizeBaseChainId(pair.chainId) === BASE_CHAIN_ID &&
    focusAddress !== undefined &&
    baseAddress === focusAddress &&
    pairAddress !== undefined &&
    opportunity.primaryMarketId === pair.id &&
    opportunity.poolMarketIds.includes(pair.id) &&
    pair.stale !== true &&
    readPositive(pair.priceUsdValue) !== undefined &&
    isFreshTimestamp(pair.sourceUpdatedAt, nowMs)
  );
}

function isFreshTimestamp(value: string | undefined, nowMs: number) {
  if (!value) return false;
  const observedMs = Date.parse(value);
  return Number.isFinite(observedMs)
    && observedMs <= nowMs + FUTURE_TIMESTAMP_TOLERANCE_MS
    && nowMs - observedMs <= MARKET_QUALITY_THRESHOLDS.observedPriceFreshMaximumAgeMs;
}

function normalizeBaseChainId(value: string | undefined) {
  const normalized = value?.trim().toLocaleLowerCase("en-US");
  return normalized === "base" || normalized === String(BASE_CHAIN_ID) ? BASE_CHAIN_ID : undefined;
}

function normalizeAddress(value: string | undefined) {
  return value && EVM_ADDRESS.test(value) ? value.toLocaleLowerCase("en-US") : undefined;
}

function readPositive(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}
