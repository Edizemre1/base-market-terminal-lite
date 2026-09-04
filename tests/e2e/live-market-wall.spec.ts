import { expect, test } from "@playwright/test";
import { getMarketTerminalSnapshot, type MarketTerminalSnapshot } from "../../src/data/providers";
import { buildDiscoveryUniverse } from "../../src/lib/base-terminal/opportunityModel";
import { buildLiveMarketWall } from "../../src/lib/base-terminal/liveMarketWall";
import { coalescePendingOpportunityIds, MAX_PENDING_OPPORTUNITY_UPDATES, shouldAutoApplyPendingUpdate } from "../../src/lib/base-terminal/liveUpdates";
import type { BasePair } from "../../src/types/baseTerminal";

const NOW = Date.parse("2026-08-30T12:00:00.000Z");
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

test.describe("live market wall contracts", () => {
  test("accepts only exact valid non-future seven-day pool ages", async () => {
    const snapshot = await fixture([
      market(1, { symbol: "NEW", ageMinutes: 60 }),
      market(2, { symbol: "EDGE", ageMinutes: 7 * 24 * 60 }),
      market(3, { symbol: "OLD", ageMinutes: 7 * 24 * 60 + 1 }),
      market(4, { symbol: "FUTURE", ageMinutes: -1 }),
      market(5, { symbol: "MISSING", ageMinutes: undefined })
    ]);
    const rows = lane(snapshot, "new", { allowCrossLaneRepeats: true });
    expect(rows.map((entry) => entry.opportunity.focusTokenSymbol)).toEqual(["NEW", "EDGE"]);
    expect(rows.map((entry) => entry.metric.current)).toEqual([60, 7 * 24 * 60]);
  });

  test("keeps gainers positive-only, losers negative-only, missing distinct from zero, and ordering deterministic", async () => {
    const warming = await fixture([
      market(11, { symbol: "GAIN_A", change: 5, liquidity: 200_000 }),
      market(12, { symbol: "GAIN_B", change: 5, liquidity: 300_000 }),
      market(13, { symbol: "LOSS_A", change: -9 }),
      market(14, { symbol: "LOSS_B", change: -2 }),
      market(15, { symbol: "ZERO", change: 0 }),
      market(16, { symbol: "MISS", change: undefined })
    ]);
    expect(lane(warming, "gainers", { allowCrossLaneRepeats: true })).toHaveLength(0);
    expect(lane(warming, "losers", { allowCrossLaneRepeats: true })).toHaveLength(0);
    const snapshot = withComparison(warming, {});
    const gainers = lane(snapshot, "gainers", { allowCrossLaneRepeats: true });
    const losers = lane(snapshot, "losers", { allowCrossLaneRepeats: true });
    expect(gainers.map((entry) => entry.opportunity.focusTokenSymbol)).toEqual(["GAIN_B", "GAIN_A"]);
    expect(gainers.every((entry) => entry.metric.current > 0)).toBeTruthy();
    expect(losers.map((entry) => entry.opportunity.focusTokenSymbol)).toEqual(["LOSS_A", "LOSS_B"]);
    expect(losers.every((entry) => entry.metric.current < 0)).toBeTruthy();
  });

  test("uses an honestly labeled volume-leader fallback until comparable inflow exists", async () => {
    const warming = await fixture([
      market(21, { symbol: "FAST", volume: 40_000 }),
      market(22, { symbol: "FLAT", volume: 60_000 })
    ]);
    const fallback = buildLiveMarketWall(warming, { allowCrossLaneRepeats: true }).lanes.find((item) => item.id === "volume")!;
    expect(fallback.fallback).toBeTruthy();
    expect(fallback.baselinePending).toBeTruthy();
    expect(fallback.entries[0].metric.kind).toBe("volume_leader");

    const ready = withComparison(warming, {
      FAST: { volume: 10_000, liquidity: 100_000 },
      FLAT: { volume: 60_000, liquidity: 100_000 }
    });
    const inflow = buildLiveMarketWall(ready, { allowCrossLaneRepeats: true }).lanes.find((item) => item.id === "volume")!;
    expect(inflow.fallback).toBeFalsy();
    expect(inflow.entries.map((entry) => entry.opportunity.focusTokenSymbol)).toEqual(["FAST"]);
    expect(inflow.entries[0].metric).toMatchObject({ kind: "volume_inflow", previous: 10_000, current: 40_000, delta: 30_000, ratio: 4 });
  });

  test("separates liquidity added and removed while filtering tiny denominator anomalies", async () => {
    const warming = await fixture([
      market(31, { symbol: "ADDED", liquidity: 25_000 }),
      market(32, { symbol: "REMOVED", liquidity: 25_000 }),
      market(33, { symbol: "TINY", liquidity: 15_000 })
    ]);
    const ready = withComparison(warming, {
      ADDED: { volume: 10_000, liquidity: 20_000 },
      REMOVED: { volume: 10_000, liquidity: 35_000 },
      TINY: { volume: 10_000, liquidity: 100 }
    });
    const added = lane(ready, "liquidity", { allowCrossLaneRepeats: true, liquidityDirection: "added" });
    const removed = lane(ready, "liquidity", { allowCrossLaneRepeats: true, liquidityDirection: "removed" });
    expect(added.map((entry) => [entry.opportunity.focusTokenSymbol, entry.metric.delta])).toEqual([["ADDED", 5_000]]);
    expect(removed.map((entry) => [entry.opportunity.focusTokenSymbol, entry.metric.delta])).toEqual([["REMOVED", -10_000]]);
    expect([...added, ...removed].some((entry) => entry.opportunity.focusTokenSymbol === "TINY")).toBeFalsy();
  });

  test("never infers trade count and keeps canonical snapshot direction across display timeframes", async () => {
    const warming = await fixture([
      market(41, { symbol: "COUNTED", change: 4, change24h: -3, trades: 55 }),
      market(42, { symbol: "NO_COUNT", change: 8, trades: undefined })
    ]);
    const snapshot = withComparison(warming, {});
    expect(lane(snapshot, "traded", { allowCrossLaneRepeats: true }).map((entry) => entry.opportunity.focusTokenSymbol)).toEqual(["COUNTED"]);
    expect(lane(snapshot, "gainers", { allowCrossLaneRepeats: true, timeframe: "h1" }).map((entry) => entry.opportunity.focusTokenSymbol)).toContain("COUNTED");
    expect(lane(snapshot, "gainers", { allowCrossLaneRepeats: true, timeframe: "h24" }).map((entry) => entry.opportunity.focusTokenSymbol)).toContain("COUNTED");
  });

  test("keeps canonical diversity, same-symbol contracts, multi-pool tokens, deterministic assignment, and backfill", async () => {
    const definitions = Array.from({ length: 30 }, (_, index) => market(100 + index, {
      symbol: index < 2 ? "SAME" : `T${index}`,
      change: index % 2 ? -(index + 1) : index + 1,
      ageMinutes: index < 6 ? 30 + index : 9 * 24 * 60,
      liquidity: 50_000 + index * 2_000,
      volume: 20_000 + index * 1_000,
      trades: 20 + index
    }));
    definitions.push({ ...definitions[0], id: address(999), pairAddress: address(999), dexId: "second-dex", dexName: "Second DEX", dex: "Second DEX" });
    const warming = await fixture(definitions);
    const baseline = Object.fromEntries(warming.opportunities.map((opportunity, index) => [opportunity.focusTokenSymbol === "SAME" ? `${opportunity.focusTokenSymbol}:${opportunity.focusTokenAddress}` : opportunity.focusTokenSymbol, { volume: 10_000, liquidity: (opportunity.aggregate.liquidityUsd ?? 20_000) - 2_000 - index }]));
    const ready = withComparison(warming, baseline, true);
    const first = buildLiveMarketWall(ready);
    const second = buildLiveMarketWall(ready);
    const ids = first.lanes.flatMap((item) => item.entries.map((entry) => entry.opportunity.id));
    expect(first.duplicateCount).toBe(0);
    expect(ids).toEqual(second.lanes.flatMap((item) => item.entries.map((entry) => entry.opportunity.id)));
    expect(new Set(ready.opportunities.filter((item) => item.focusTokenSymbol === "SAME").map((item) => item.focusTokenAddress)).size).toBe(2);
    expect(ready.opportunities.find((item) => item.focusTokenAddress === definitions[0].baseTokenAddress)?.poolCount).toBe(2);
    expect(first.lanes.filter((item) => item.eligibleCount > 0).every((item) => item.entries.length > 0)).toBeTruthy();
    expect(first.lanes.every((item) => item.entries.length <= 4)).toBeTruthy();
    const expanded = buildLiveMarketWall(ready, { allowCrossLaneRepeats: true, limit: 12 });
    expect(expanded.lanes.every((item) => item.entries.length <= 12)).toBeTruthy();
    expect(expanded.lanes.some((item) => item.entries.length > 4)).toBeTruthy();
  });

  test("coalesces and bounds pending updates and waits for an unlocked quiet period", () => {
    const incoming = Array.from({ length: 80 }, (_, index) => `opportunity-${index}`);
    const coalesced = coalescePendingOpportunityIds(["opportunity-1", "opportunity-2"], [...incoming, "opportunity-1"]);
    expect(coalesced).toHaveLength(MAX_PENDING_OPPORTUNITY_UPDATES);
    expect(coalesced.at(-1)).toBe("opportunity-1");
    expect(new Set(coalesced).size).toBe(coalesced.length);
    expect(shouldAutoApplyPendingUpdate({ interactionLocked: true, overlayOpen: false, quietForMs: 9_000 })).toBeFalsy();
    expect(shouldAutoApplyPendingUpdate({ interactionLocked: false, overlayOpen: true, quietForMs: 9_000 })).toBeFalsy();
    expect(shouldAutoApplyPendingUpdate({ interactionLocked: false, overlayOpen: false, quietForMs: 2_000 })).toBeTruthy();
  });
});

function lane(snapshot: MarketTerminalSnapshot, id: "new" | "gainers" | "losers" | "volume" | "liquidity" | "traded", options: Parameters<typeof buildLiveMarketWall>[1] = {}) {
  return buildLiveMarketWall(snapshot, options).lanes.find((item) => item.id === id)!.entries;
}

type Definition = BasePair & { fixtureSymbol: string };

async function fixture(definitions: Definition[]): Promise<MarketTerminalSnapshot> {
  const base = await getMarketTerminalSnapshot("mock");
  const discovery = buildDiscoveryUniverse(definitions, [], new Date(NOW));
  return {
    ...base,
    mode: "dexscreener",
    freshness: "fresh",
    receivedAt: new Date(NOW).toISOString(),
    generatedAt: new Date(NOW).toISOString(),
    sourceUpdatedAt: new Date(NOW).toISOString(),
    allPairs: discovery.pairs,
    poolMarkets: discovery.poolMarkets,
    opportunities: discovery.opportunities,
    universe: discovery.universe,
    defaultPairId: discovery.opportunities[0]?.primaryMarketId ?? base.defaultPairId,
    comparison: { status: "warming", opportunityVolume1h: {}, opportunityMetrics: {} },
    newPairs: [],
    volumeInflows: [],
    momentumPairs: []
  };
}

function withComparison(snapshot: MarketTerminalSnapshot, bySymbol: Record<string, { volume: number; liquidity: number }>, includeAddress = false): MarketTerminalSnapshot {
  const opportunityMetrics = Object.fromEntries(snapshot.opportunities.map((opportunity) => {
    const key = includeAddress && opportunity.focusTokenSymbol === "SAME" ? `${opportunity.focusTokenSymbol}:${opportunity.focusTokenAddress}` : opportunity.focusTokenSymbol;
    const before = bySymbol[key] ?? { volume: 10_000, liquidity: (opportunity.aggregate.liquidityUsd ?? 20_000) - 2_000 };
    const pair = snapshot.allPairs.find((item) => item.id === opportunity.primaryMarketId);
    const currentPrice = opportunity.canonicalPrice.value;
    const change = pair?.priceChanges?.h1 ?? 0;
    const canonicalPriceUsd = currentPrice === undefined || 1 + change / 100 <= 0 ? currentPrice : currentPrice / (1 + change / 100);
    return [opportunity.id, { canonicalPriceUsd, liquidityUsd: before.liquidity, volumes: { m5: before.volume, h1: before.volume, h24: before.volume }, transactions: opportunity.aggregate.transactions }];
  }));
  return { ...snapshot, comparison: { status: "ready", previousGeneratedAt: new Date(NOW - 12_000).toISOString(), opportunityVolume1h: {}, opportunityMetrics } };
}

function market(seed: number, options: { symbol: string; ageMinutes?: number; change?: number; change24h?: number; liquidity?: number; volume?: number; trades?: number } ): Definition {
  const ageMinutes = options.ageMinutes === undefined ? 9 * 24 * 60 : options.ageMinutes;
  const createdAt = options.ageMinutes === undefined ? undefined : new Date(NOW - ageMinutes * 60_000).toISOString();
  const liquidity = options.liquidity ?? 100_000;
  const volume = options.volume ?? 20_000;
  const txns = options.trades === undefined ? undefined : { buys: Math.ceil(options.trades / 2), sells: Math.floor(options.trades / 2) };
  return {
    fixtureSymbol: options.symbol,
    dataSource: "dexscreener",
    dataProviders: ["dexscreener", "onchain"],
    id: address(seed + 10_000),
    pairAddress: address(seed + 10_000),
    baseTokenAddress: address(seed + 20_000),
    quoteTokenAddress: USDC,
    chainId: "base",
    baseToken: options.symbol,
    quoteToken: "USDC",
    pair: `${options.symbol} / USDC`,
    project: `${options.symbol} token`,
    address: address(seed + 20_000),
    route: `${options.symbol}-USDC`,
    dexId: "aerodrome",
    dexName: "Aerodrome",
    dex: "Aerodrome",
    sourceUpdatedAt: new Date(NOW).toISOString(),
    pairCreatedAt: createdAt,
    pairCreatedAtMs: createdAt ? Date.parse(createdAt) : undefined,
    ageMinutes: ageMinutes >= 0 ? ageMinutes : 0,
    age: createdAt && ageMinutes >= 0 ? `${ageMinutes}m` : "N/A",
    priceNative: String(1 + (options.change ?? 0) / 100),
    price: `$${1 + (options.change ?? 0) / 100}`,
    priceUsd: `$${1 + (options.change ?? 0) / 100}`,
    priceUsdValue: 1 + (options.change ?? 0) / 100,
    onchainProvenance: { factoryId: "fixture", factoryAddress: address(seed + 30_000), protocolVersion: "v2", confirmedAt: new Date(NOW).toISOString(), bindingKind: "registered_pool_identity", decimalsVerified: true },
    onchainStateEvidence: { status: "complete", confidence: "exact_onchain_state", token0: address(seed + 20_000), token1: USDC, decimals0: 18, decimals1: 6, blockNumber: 50_000_000, blockHash: `0x${"a".repeat(64)}`, observedAt: new Date(NOW).toISOString(), observedPrice0In1: 1 + (options.change ?? 0) / 100, observedPrice1In0: 1 / (1 + (options.change ?? 0) / 100) },
    change24h: options.change24h ?? options.change ?? 0,
    priceChanges: { m5: options.change, h1: options.change, h24: options.change24h ?? options.change },
    liquidity,
    liquidityUsd: liquidity,
    volume24h: volume,
    volumes: { m5: volume, h1: volume, h24: volume },
    inflow24h: 0,
    momentumScore: 0,
    volumeMultiple: 1,
    txns: txns ? { m5: txns, h1: txns, h24: txns } : undefined,
    chart: [],
    holders: { top10: "N/A", top50: "N/A", top100: "N/A", total: "N/A", active24h: "N/A" },
    poolAge: "N/A",
    flags: [],
    taxes: { buy: "N/A", sell: "N/A" },
    lpLock: { status: "N/A", provider: "N/A", expires: "N/A" },
    riskChecks: [],
    liquidityDetail: { poolLiquidity: "N/A", lpChange: "N/A", depth: "N/A", routeSource: "N/A" },
    activity: [],
    stale: false
  };
}

function address(value: number) {
  return `0x${value.toString(16).padStart(40, "0")}`;
}
