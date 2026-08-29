import { getChange24h, getLiquidityUsd, getPairAgeMinutes, getVolume24h } from "@/lib/base-terminal/discovery";
import { canonicalPairKey } from "@/lib/marketMath";
import type { BasePair } from "@/types/baseTerminal";

export function getNormalizedMarketModel(pair: BasePair) {
  return {
    key: canonicalPairKey({
      chainId: pair.chainId,
      pairAddress: pair.pairAddress,
      baseTokenAddress: pair.baseTokenAddress,
      quoteTokenAddress: pair.quoteTokenAddress,
      fallbackId: pair.id
    }),
    direction: `${pair.baseToken}/${pair.quoteToken}`,
    priceUsd: typeof pair.priceUsdValue === "number" && Number.isFinite(pair.priceUsdValue) && pair.priceUsdValue > 0 ? pair.priceUsdValue : undefined,
    change5m: readFinite(pair.priceChanges?.m5),
    change1h: readFinite(pair.priceChanges?.h1),
    change6h: readFinite(pair.priceChanges?.h6),
    change24h: getChange24h(pair),
    volume5mUsd: readNonNegative(pair.volumes?.m5),
    volume1hUsd: readNonNegative(pair.volumes?.h1),
    volume24hUsd: getVolume24h(pair),
    liquidityUsd: getLiquidityUsd(pair),
    ageMinutes: getPairAgeMinutes(pair),
    dex: pair.dexId ?? pair.dexName ?? pair.dex,
    pairAddress: pair.pairAddress,
    baseTokenAddress: pair.baseTokenAddress,
    quoteTokenAddress: pair.quoteTokenAddress,
    source: pair.dataSource,
    freshness: pair.stale ? "stale" : "current"
  };
}

export function getMarketInvariantAttributes(pair: BasePair) {
  const model = getNormalizedMarketModel(pair);
  return {
    "data-market-key": model.key,
    "data-market-direction": model.direction,
    "data-price-usd": toAttribute(model.priceUsd),
    "data-change-24h": toAttribute(model.change24h),
    "data-volume-24h-usd": toAttribute(model.volume24hUsd),
    "data-liquidity-usd": toAttribute(model.liquidityUsd)
  };
}

function readFinite(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readNonNegative(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function toAttribute(value: number | undefined) {
  return value === undefined ? "missing" : String(value);
}
