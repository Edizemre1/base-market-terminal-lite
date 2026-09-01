export const MARKET_QUALITY_THRESHOLDS = Object.freeze({
  observedPriceFreshMaximumAgeMs: 2 * 60_000,
  observedPriceMaximumAgeMs: 15 * 60_000,
  canonicalPriceMinimumLiquidityUsd: 1_000,
  qualityViewEmergingMinimumLiquidityUsd: 100,
  rankingMinimumLiquidityUsd: 25_000,
  gainersLosersMinimumLiquidityUsd: 50_000,
  volumeMinimumLiquidityUsd: 1_000,
  liquidityLaneMinimumLiquidityUsd: 1_000,
  mostTradedMinimumLiquidityUsd: 1_000
});

export const QUALITY_BANDS = Object.freeze(["RANKED", "EMERGING", "DETECTED", "REJECTED"]);
export const LIQUIDITY_STATES = Object.freeze(["usable_liquidity", "thin_liquidity", "liquidity_unknown", "zero_liquidity"]);

const ADDRESS = /^0x[0-9a-f]{40}$/;
const REJECTED_REASONS = new Set([
  "invalid_token_address",
  "token_identity_conflict",
  "invalid_decimals",
  "invalid_price",
  "non_finite_price",
  "future_timestamp",
  "cycle_detected",
  "conflicting_pool_identity"
]);

export function classifyLiquidityState(values, minimumLiquidityUsd = MARKET_QUALITY_THRESHOLDS.canonicalPriceMinimumLiquidityUsd) {
  const finite = (values ?? []).filter((value) => Number.isFinite(value) && value >= 0);
  if (finite.some((value) => value >= minimumLiquidityUsd)) return "usable_liquidity";
  if (finite.some((value) => value > 0)) return "thin_liquidity";
  if (finite.some((value) => value === 0)) return "zero_liquidity";
  return "liquidity_unknown";
}

export function buildObservedPriceUsd(tokenAddress, pools, now = new Date(), {
  freshMaximumAgeMs = MARKET_QUALITY_THRESHOLDS.observedPriceFreshMaximumAgeMs,
  maximumAgeMs = MARKET_QUALITY_THRESHOLDS.observedPriceMaximumAgeMs
} = {}) {
  const token = normalizeAddress(tokenAddress);
  if (!token) return undefined;
  const nowMs = now.getTime();
  const candidates = [];
  for (const pool of pools ?? []) {
    if (pool?.status !== "confirmed" || pool.orphaned || pool?.providerEnrichment?.status !== "matched") continue;
    const poolAddress = normalizeAddress(pool.poolAddress);
    if (!poolAddress) continue;
    for (const row of pool.providerSnapshots ?? []) {
      const base = normalizeAddress(row.baseTokenAddress);
      const quote = normalizeAddress(row.quoteTokenAddress);
      if (token !== base && token !== quote) continue;
      const baseUsd = positive(row.priceUsd);
      const native = positive(row.priceNative);
      const value = token === base ? baseUsd : baseUsd !== undefined && native !== undefined ? baseUsd / native : undefined;
      if (!positive(value)) continue;
      const observedAt = validIso(row.observedAt) ? row.observedAt : validIso(row.receivedAt) ? row.receivedAt : undefined;
      if (!observedAt) continue;
      const observedMs = Date.parse(observedAt);
      if (observedMs > nowMs + 5_000 || nowMs - observedMs > maximumAgeMs) continue;
      candidates.push({
        value,
        rawValue: Number(value).toPrecision(15),
        provider: row.provider,
        poolKey: pool.poolKey,
        poolAddress,
        observedAt,
        receivedAt: row.receivedAt,
        freshness: nowMs - observedMs <= freshMaximumAgeMs ? "fresh" : "delayed",
        liquidityUsd: finiteNonNegative(row.liquidityUsd),
        reasonCode: "exact_provider_observed_price",
        executable: false
      });
    }
  }
  return candidates.sort(compareObservedPrices)[0];
}

export function evaluateOpportunityQuality({ canonicalPrice, observedPriceUsd, liquidityState, bestLiquidityUsd, ranked, providerState, exclusionReason }) {
  const canonical = canonicalPrice?.tier && canonicalPrice.tier !== "UNPRICED" && positive(canonicalPrice.value);
  const observed = positive(observedPriceUsd?.value);
  const rejected = providerState === "conflicting" || REJECTED_REASONS.has(exclusionReason) || REJECTED_REASONS.has(canonicalPrice?.reasonCode);
  const band = rejected
    ? "REJECTED"
    : ranked && canonical
      ? "RANKED"
      : observed || canonical
        ? "EMERGING"
        : "DETECTED";
  const highQualityEmerging = band === "EMERGING"
    && Number.isFinite(bestLiquidityUsd)
    && bestLiquidityUsd >= MARKET_QUALITY_THRESHOLDS.qualityViewEmergingMinimumLiquidityUsd;
  return {
    band,
    highQualityEmerging,
    rankingEligible: band === "RANKED",
    exclusionReason: band === "RANKED" ? undefined : exclusionReason ?? canonicalPrice?.reasonCode ?? liquidityState,
    displayMode: canonical ? "canonical" : observed ? "observed_thin" : "pending"
  };
}

export function categoryEligibility({ band, canonicalPrice, bestLiquidityUsd, volumes, transactions, comparableSnapshots = false, newlyCreated = false }) {
  const ranked = band === "RANKED" && canonicalPrice?.tier !== "UNPRICED";
  const liquidity = finiteNonNegative(bestLiquidityUsd);
  return {
    new: newlyCreated && (band === "RANKED" || band === "EMERGING"),
    detected: newlyCreated && band === "DETECTED",
    gainersLosers: ranked && comparableSnapshots && liquidity !== undefined && liquidity >= MARKET_QUALITY_THRESHOLDS.gainersLosersMinimumLiquidityUsd,
    volume: ranked && liquidity !== undefined && liquidity >= MARKET_QUALITY_THRESHOLDS.volumeMinimumLiquidityUsd && hasPositiveWindow(volumes),
    liquidity: ranked && liquidity !== undefined && liquidity >= MARKET_QUALITY_THRESHOLDS.liquidityLaneMinimumLiquidityUsd,
    mostTraded: ranked && liquidity !== undefined && liquidity >= MARKET_QUALITY_THRESHOLDS.mostTradedMinimumLiquidityUsd && hasTransactions(transactions)
  };
}

export function bestKnownLiquidityUsd(pools) {
  const values = (pools ?? []).map((pool) => pool?.liquidityUsd).filter((value) => Number.isFinite(value) && value >= 0);
  return values.length ? Math.max(...values) : undefined;
}

function compareObservedPrices(left, right) {
  return Date.parse(right.observedAt) - Date.parse(left.observedAt)
    || (right.liquidityUsd ?? -1) - (left.liquidityUsd ?? -1)
    || left.provider.localeCompare(right.provider)
    || left.poolAddress.localeCompare(right.poolAddress);
}
function hasPositiveWindow(values) { return Object.values(values ?? {}).some((value) => Number.isFinite(value) && value > 0); }
function hasTransactions(values) { return Object.values(values ?? {}).some((value) => Number.isFinite(value?.buys) && Number.isFinite(value?.sells) && value.buys + value.sells > 0); }
function normalizeAddress(value) { const normalized = typeof value === "string" ? value.trim().toLowerCase() : ""; return ADDRESS.test(normalized) ? normalized : undefined; }
function positive(value) { return Number.isFinite(value) && value > 0 ? value : undefined; }
function finiteNonNegative(value) { return Number.isFinite(value) && value >= 0 ? value : undefined; }
function validIso(value) { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
