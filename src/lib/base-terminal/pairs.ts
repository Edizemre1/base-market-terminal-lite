import type { BasePair } from "@/types/baseTerminal";

export function getPairFromParam(pairs: BasePair[], pairParam: string | undefined | null) {
  if (!pairParam) {
    return undefined;
  }

  const normalizedParam = normalizePairParam(pairParam);
  const compactParam = normalizePairIdentity(pairParam);

  return pairs.find((pair) =>
    [pair.id, pair.pairAddress, pair.address, pair.pair]
      .filter(Boolean)
      .some((value) => {
        const candidate = String(value);
        return (
          normalizePairParam(candidate) === normalizedParam ||
          normalizePairIdentity(candidate) === compactParam
        );
      })
  );
}

export function getShareablePairKey(pair: BasePair) {
  return pair.pairAddress ?? pair.id;
}

export function getChartCacheKey(pair: BasePair) {
  return pair.pairAddress ?? pair.id;
}

export function normalizePairParam(value: string) {
  return value.trim().toLowerCase();
}

export function normalizePairIdentity(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function pairsRepresentSamePair(left: BasePair, right: BasePair) {
  const leftPairAddress = left.pairAddress?.toLowerCase();
  const rightPairAddress = right.pairAddress?.toLowerCase();

  // A pool address is the canonical identity. Equal symbols can describe many
  // distinct pools, so never fall back to the route label when both are known.
  if (leftPairAddress && rightPairAddress) {
    return leftPairAddress === rightPairAddress;
  }

  const hasExactTokenRoutes = Boolean(
    left.baseTokenAddress && left.quoteTokenAddress &&
    right.baseTokenAddress && right.quoteTokenAddress
  );
  if (hasExactTokenRoutes) {
    return (
      left.baseTokenAddress?.toLowerCase() === right.baseTokenAddress?.toLowerCase() &&
      left.quoteTokenAddress?.toLowerCase() === right.quoteTokenAddress?.toLowerCase()
    );
  }

  return (
    left.id === right.id ||
    normalizePairIdentity(left.pair) === normalizePairIdentity(right.pair)
  );
}
