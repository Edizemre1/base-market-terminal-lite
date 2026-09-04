import { mockBasePairs } from "@/data/mockBasePairs";
import type { BasePair } from "@/types/baseTerminal";
import type { MarketDataProvider, PairRiskDetails } from "./types";

function findPair(id: string) {
  return mockBasePairs.find((pair) => pair.id === id);
}

function byNewPoolAge(left: BasePair, right: BasePair) {
  return (left.ageMinutes ?? Number.POSITIVE_INFINITY) - (right.ageMinutes ?? Number.POSITIVE_INFINITY);
}

function byVolumeInflow(left: BasePair, right: BasePair) {
  return (right.inflow24h ?? 0) - (left.inflow24h ?? 0);
}

function byMomentum(left: BasePair, right: BasePair) {
  return (right.momentumScore ?? 0) - (left.momentumScore ?? 0);
}

function getRiskDetails(pair: BasePair): PairRiskDetails {
  return {
    riskScore: pair.riskScore,
    riskLabel: pair.riskLabel,
    riskChecks: pair.riskChecks,
    flags: pair.flags,
    holders: pair.holders,
    taxes: pair.taxes,
    lpLock: pair.lpLock
  };
}

export const mockMarketDataProvider: MarketDataProvider = {
  mode: "mock",
  name: "Mock Base pair data",
  readOnly: true,
  getAllPairs: () => [...mockBasePairs],
  getNewPairs: () => [...mockBasePairs].sort(byNewPoolAge),
  getVolumeInflows: () => [...mockBasePairs].sort(byVolumeInflow),
  getMomentumPairs: () => [...mockBasePairs].sort(byMomentum),
  getPairById: findPair,
  getPairChart: (id) => findPair(id)?.chart ?? [],
  getRiskDetails: (id) => {
    const pair = findPair(id);
    return pair ? getRiskDetails(pair) : undefined;
  },
  getLiquidityDetails: (id) => findPair(id)?.liquidityDetail,
  getActivityFeed: (id) => findPair(id)?.activity ?? []
};
