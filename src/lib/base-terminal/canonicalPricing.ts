import type { BasePair } from "@/types/baseTerminal";
import { calculateCanonicalUsdcPrice, type CanonicalPrice } from "../../../collector/model.mjs";

export type { CanonicalPrice };

export const BASE_USDC_ADDRESS = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
export const BASE_WETH_ADDRESS = "0x4200000000000000000000000000000000000006";

export function calculateOpportunityUsdcPrice(focusTokenAddress: string, pairs: BasePair[], now = new Date()): CanonicalPrice {
  const pricingPools = pairs.flatMap((pair) => {
    const token0 = normalizeAddress(pair.baseTokenAddress);
    const token1 = normalizeAddress(pair.quoteTokenAddress);
    const poolKey = (pair.pairAddress ?? pair.id).toLowerCase();
    const observedAt = pair.sourceUpdatedAt;
    const directUsdc = token1 === BASE_USDC_ADDRESS ? positive(pair.priceUsdValue) : undefined;
    const rate = positive(Number(pair.priceNative)) ?? directUsdc;
    if (!token0 || !token1 || !rate || !observedAt) return [];
    return [{
      poolKey,
      token0,
      token1,
      status: "confirmed",
      orphaned: false,
      verifiedSource: Boolean(pair.pairAddress && pair.onchainProvenance?.decimalsVerified && pair.dataProviders?.includes("onchain")),
      priceToken1PerToken0: rate,
      liquidityUsd: nonNegative(pair.liquidityUsd),
      volume24hUsd: nonNegative(pair.volumes?.h24),
      trades24h: pair.txns?.h24 ? pair.txns.h24.buys + pair.txns.h24.sells : undefined,
      observedAt,
      confirmedAt: pair.onchainProvenance?.confirmedAt,
      blockNumber: pair.blockNumber
    }];
  });
  return calculateCanonicalUsdcPrice(focusTokenAddress, pricingPools, now);
}

function normalizeAddress(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^0x[0-9a-f]{40}$/.test(normalized) ? normalized : undefined;
}

function positive(value: number | undefined) { return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined; }
function nonNegative(value: number | undefined) { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined; }
