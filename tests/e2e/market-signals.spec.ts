import { expect, test } from "@playwright/test";
import { getMarketTerminalSnapshot, type MarketTerminalSnapshot } from "../../src/data/providers";
import { MARKET_SIGNAL_ICONS } from "../../src/components/base-terminal/MarketSignalBadges";
import {
  MARKET_SIGNAL_THRESHOLDS,
  computeMarketSignalSnapshot,
  reconcileMarketSignalSnapshots,
  selectVisibleMarketSignals,
  type MarketSignalSnapshot,
  type SecurityFacts
} from "../../src/lib/base-terminal/marketSignals";

const NOW = Date.UTC(2026, 0, 10, 12, 0, 0);

test.describe("canonical market signal badge engine", () => {
  test("uses exact UTC launch boundaries and rejects missing, invalid, and future timestamps", async () => {
    expect(types(await fixture({ ageMs: 24 * 60 * 60_000 }))).toContain("just_launched");
    const after24h = types(await fixture({ ageMs: 24 * 60 * 60_000 + 1 }));
    expect(after24h).not.toContain("just_launched");
    expect(after24h).toContain("new_market");
    expect(types(await fixture({ ageMs: 7 * 24 * 60 * 60_000 }))).toContain("new_market");
    expect(types(await fixture({ ageMs: 7 * 24 * 60 * 60_000 + 1 }))).not.toContain("new_market");
    expect(types(await fixture({ createdAt: undefined }))).not.toContain("just_launched");
    expect(types(await fixture({ createdAt: "invalid" }))).not.toContain("new_market");
    expect(types(await fixture({ createdAt: new Date(NOW + 1).toISOString() }))).not.toContain("just_launched");
  });

  test("applies inclusive gaining and breakout thresholds without treating missing or non-finite values as zero", async () => {
    const exact = await fixture({ change5m: 3, change1h: 15, volume5m: 5_000, volume1h: 25_000, liquidity: 50_000 });
    expect(types(exact)).toEqual(expect.arrayContaining(["gaining_fast", "breakout"]));
    const visible = selectVisibleMarketSignals(badges(exact));
    expect(visible.market.map((badge) => badge.type)).toContain("breakout");
    expect(visible.market.map((badge) => badge.type)).not.toContain("gaining_fast");
    expect(visible.all.map((badge) => badge.type)).toContain("gaining_fast");

    for (const value of [undefined, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const snapshot = await fixture({ change5m: value, change1h: value, volume5m: value, volume1h: value, liquidity: value });
      expect(types(snapshot)).not.toEqual(expect.arrayContaining(["gaining_fast", "breakout", "thin_liquidity"]));
    }
  });

  test("requires ordered comparable snapshots for a real two-times volume surge", async () => {
    const warming = await fixture({ volume1h: 50_000, comparison: "warming" });
    expect(types(warming)).not.toContain("volume_surge");
    const ready = await fixture({ volume1h: 50_000, previousVolume1h: 25_000, comparison: "ready" });
    expect(types(ready)).toContain("volume_surge");
    const outOfOrder = await fixture({ volume1h: 50_000, previousVolume1h: 25_000, comparison: "ready", previousGeneratedAt: new Date(NOW + 1).toISOString() });
    expect(types(outOfOrder)).not.toContain("volume_surge");
  });

  test("uses deterministic percentile ranks and never emits percentile-only claims for a small universe", async () => {
    const small = await universeFixture(7);
    expect(Object.values(computeMarketSignalSnapshot(small).byOpportunityId).flat().some((badge) => ["high_volume", "most_traded", "deep_liquidity", "moving_now"].includes(badge.type))).toBeFalsy();
    const large = await universeFixture(12, true);
    const first = computeMarketSignalSnapshot(large);
    const reversed = computeMarketSignalSnapshot({ ...large, opportunities: [...large.opportunities].reverse(), allPairs: [...large.allPairs].reverse() });
    const ranked = (result: MarketSignalSnapshot, type: string) => Object.entries(result.byOpportunityId).filter(([, rows]) => rows.some((badge) => badge.type === type)).map(([id]) => id).sort();
    for (const type of ["high_volume", "most_traded", "deep_liquidity", "moving_now"]) expect(ranked(first, type)).toEqual(ranked(reversed, type));
    expect(ranked(first, "high_volume").length).toBeGreaterThan(0);
  });

  test("keeps multi-pool opportunities canonical and same-symbol different addresses separate", async () => {
    const snapshot = await fixture({ poolCount: 3 });
    expect(types(snapshot)).toContain("multi_pool");
    expect(snapshot.opportunities).toHaveLength(1);
    const second = structuredClone(snapshot.opportunities[0]);
    second.id = `8453:token:${address(999)}`;
    second.focusTokenAddress = address(999);
    second.focusTokenSymbol = snapshot.opportunities[0].focusTokenSymbol;
    const result = computeMarketSignalSnapshot({ ...snapshot, opportunities: [...snapshot.opportunities, second] });
    expect(Object.keys(result.byOpportunityId)).toHaveLength(2);
  });

  test("treats unknown security as unknown, contract verification as limited, and confirmed risk as highest priority", async () => {
    const snapshot = await fixture({});
    const opportunity = snapshot.opportunities[0];
    const unknown = badges(snapshot);
    expect(unknown.find((badge) => badge.type === "security_unknown")?.tone).toBe("neutral");
    expect(unknown.some((badge) => badge.type === "contract_verified")).toBeFalsy();

    const verifiedFacts = facts(opportunity.focusTokenAddress, { contractVerified: true });
    const verified = computeMarketSignalSnapshot(snapshot, { [opportunity.focusTokenAddress]: verifiedFacts }).byOpportunityId[opportunity.id];
    expect(verified.find((badge) => badge.type === "contract_verified")?.reasonCode).toBe("exact_address_contract_verified_not_overall_safe");
    expect(verified.some((badge) => badge.type === "security_unknown")).toBeFalsy();

    const risk = computeMarketSignalSnapshot(snapshot, { [opportunity.focusTokenAddress]: facts(opportunity.focusTokenAddress, { contractVerified: true, honeypotStatus: "flagged" }) }).byOpportunityId[opportunity.id];
    expect(risk[0]).toMatchObject({ type: "risk_flagged", priority: 0, tone: "critical" });
    expect(risk[0].reasonCode).toBe("honeypot_flagged");
  });

  test("enforces thin-liquidity and volatility boundaries without turning unknown values into warnings", async () => {
    expect(types(await fixture({ liquidity: 24_999.99 }))).toContain("thin_liquidity");
    expect(badges(await fixture({ liquidity: 4_999.99 })).find((badge) => badge.type === "thin_liquidity")?.tone).toBe("critical");
    expect(types(await fixture({ liquidity: undefined }))).not.toContain("thin_liquidity");
    expect(types(await fixture({ change5m: 8 }))).toContain("volatile");
    expect(types(await fixture({ change1h: -20 }))).toContain("volatile");
    expect(badges(await fixture({ change1h: -20 })).find((badge) => badge.type === "volatile")?.reasonCode).toBe("large_negative_absolute_price_move");
    expect(badges(await fixture({ change1h: -20 })).find((badge) => badge.type === "volatile")?.metric).toMatchObject({ freshness: "fresh" });
  });

  test("applies 36-second dwell, hysteresis, TTL, cooldown, and out-of-order rejection", async () => {
    const enteringSource = await fixture({ change5m: 3.1, volume5m: 6_000, liquidity: 40_000 });
    const computed = computeMarketSignalSnapshot(enteringSource);
    const entering = reconcileMarketSignalSnapshots(undefined, computed, NOW);
    expect(signal(entering, "gaining_fast")?.state).toBe("entering");
    const persistentSource = { ...enteringSource, generatedAt: new Date(NOW + MARKET_SIGNAL_THRESHOLDS.minimumDwellMs).toISOString() };
    const persistent = reconcileMarketSignalSnapshots(entering, computeMarketSignalSnapshot(persistentSource, {}, entering), NOW + MARKET_SIGNAL_THRESHOLDS.minimumDwellMs);
    expect(signal(persistent, "gaining_fast")?.state).toBe("active");

    const hysteresisSource = await fixture({ change5m: 2.5, volume5m: 6_000, liquidity: 40_000, generatedAt: NOW + 48_000 });
    const held = reconcileMarketSignalSnapshots(persistent, computeMarketSignalSnapshot(hysteresisSource, {}, persistent), NOW + 48_000);
    expect(signal(held, "gaining_fast")?.state).toBe("active");
    const exitSource = await fixture({ change5m: 2.3, volume5m: 6_000, liquidity: 40_000, generatedAt: NOW + 60_000 });
    const cooling = reconcileMarketSignalSnapshots(held, computeMarketSignalSnapshot(exitSource, {}, held), NOW + 60_000);
    expect(signal(cooling, "gaining_fast")?.state).toBe("cooldown");
    const expired = reconcileMarketSignalSnapshots(cooling, computeMarketSignalSnapshot({ ...exitSource, generatedAt: new Date(NOW + 120_000).toISOString() }, {}, cooling), NOW + 120_000);
    expect(signal(expired, "gaining_fast")).toBeUndefined();
    expect(reconcileMarketSignalSnapshots(persistent, computed, NOW)).toBe(persistent);
  });

  test("uses a static Lucide registry and bounds rendered badge candidates", async () => {
    expect(Object.values(MARKET_SIGNAL_ICONS).every((icon) => typeof icon === "object" || typeof icon === "function")).toBeTruthy();
    const result = badges(await fixture({ poolCount: 3, change5m: 9, change1h: 21, volume5m: 100_000, volume1h: 500_000, liquidity: 4_000, previousVolume1h: 25_000, comparison: "ready" }));
    expect(result.length).toBeLessThanOrEqual(MARKET_SIGNAL_THRESHOLDS.maximumBadgesPerSubject);
    expect(selectVisibleMarketSignals(result).visible.length).toBeLessThanOrEqual(3);
  });
});

async function fixture(options: {
  ageMs?: number;
  createdAt?: string;
  generatedAt?: number;
  change5m?: number;
  change1h?: number;
  volume5m?: number;
  volume1h?: number;
  volume24h?: number;
  liquidity?: number;
  poolCount?: number;
  comparison?: "warming" | "ready";
  previousVolume1h?: number;
  previousGeneratedAt?: string;
}): Promise<MarketTerminalSnapshot> {
  const base = await getMarketTerminalSnapshot("mock");
  const generatedAt = options.generatedAt ?? NOW;
  const poolId = address(700);
  const tokenAddress = address(701);
  const opportunityId = `8453:token:${tokenAddress}`;
  const createdAt = "createdAt" in options ? options.createdAt : new Date(generatedAt - (options.ageMs ?? 60_000)).toISOString();
  const pair = {
    ...base.allPairs[0], id: poolId, pairAddress: poolId, opportunityId, focusTokenAddress: tokenAddress,
    baseTokenAddress: tokenAddress, quoteTokenAddress: address(702), stale: false,
    pairCreatedAt: createdAt, pairCreatedAtMs: createdAt ? Date.parse(createdAt) : undefined,
    priceChanges: { ...base.allPairs[0].priceChanges, m5: options.change5m, h1: options.change1h },
    volumes: { ...base.allPairs[0].volumes, m5: options.volume5m, h1: options.volume1h, h24: options.volume24h ?? 300_000 },
    liquidityUsd: options.liquidity, liquidity: options.liquidity ?? Number.NaN,
    txns: { m5: { buys: 10, sells: 10 }, h1: { buys: 70, sells: 50 }, h6: { buys: 200, sells: 180 }, h24: { buys: 700, sells: 500 } }
  };
  const opportunity = {
    ...base.opportunities[0], id: opportunityId, focusTokenAddress: tokenAddress, focusTokenSymbol: "SIG", focusTokenName: "Signal fixture",
    poolMarketIds: Array.from({ length: options.poolCount ?? 1 }, (_, index) => address(700 + index)), poolCount: options.poolCount ?? 1,
    primaryMarketId: poolId, executionCandidates: [poolId], newestPoolCreatedAt: createdAt, oldestPoolCreatedAt: createdAt,
    aggregate: { liquidityUsd: options.liquidity, volumes: pair.volumes, transactions: pair.txns, contributingPoolCount: options.poolCount ?? 1 },
    freshness: { newestSourceAt: new Date(generatedAt).toISOString(), oldestSourceAt: new Date(generatedAt).toISOString(), stalePoolCount: 0 }, quality: "active" as const,
    categoryEligibility: { newlyCreated: true, justLaunched: true, moving: true, liquidity: true }
  };
  const pool = { ...base.poolMarkets[0], id: poolId, poolAddress: poolId, baseTokenAddress: tokenAddress, poolCreatedAt: createdAt, liquidityUsd: options.liquidity, volumes: pair.volumes, priceChanges: pair.priceChanges, transactions: pair.txns, quality: "active" as const };
  const previousAt = options.previousGeneratedAt ?? new Date(generatedAt - 12_000).toISOString();
  return {
    ...base, generatedAt: new Date(generatedAt).toISOString(), sourceUpdatedAt: new Date(generatedAt).toISOString(), freshness: "fresh",
    allPairs: [pair], opportunities: [opportunity], poolMarkets: [pool], defaultPairId: poolId,
    universe: { ...base.universe, rawPoolCount: 1, uniqueTokenCount: 1, activeOpportunityCount: 1, freshOpportunityCount: 1, qualityCounts: { active: 1, thin: 0, incomplete: 0, expired: 0 } },
    comparison: { status: options.comparison ?? "warming", previousGeneratedAt: previousAt, opportunityVolume1h: options.previousVolume1h === undefined ? {} : { [opportunityId]: options.previousVolume1h } }
  };
}

async function universeFixture(count: number, equalMetrics = false) {
  const seed = await fixture({ change5m: 1, change1h: 4, volume5m: 10_000, volume1h: 40_000, volume24h: 300_000, liquidity: 300_000 });
  const opportunities = Array.from({ length: count }, (_, index) => {
    const id = `8453:token:${address(10_000 + index)}`;
    const value = equalMetrics ? 500_000 : 300_000 + index * 10_000;
    return { ...structuredClone(seed.opportunities[0]), id, focusTokenAddress: address(10_000 + index), primaryMarketId: address(20_000 + index), poolMarketIds: [address(20_000 + index)], aggregate: { ...structuredClone(seed.opportunities[0].aggregate), liquidityUsd: value, volumes: { ...seed.opportunities[0].aggregate.volumes, h24: value }, transactions: { ...seed.opportunities[0].aggregate.transactions, h24: { buys: 500 + index, sells: 500 } } } };
  });
  const allPairs = opportunities.map((opportunity, index) => ({ ...structuredClone(seed.allPairs[0]), id: opportunity.primaryMarketId, pairAddress: opportunity.primaryMarketId, opportunityId: opportunity.id, focusTokenAddress: opportunity.focusTokenAddress, liquidityUsd: opportunity.aggregate.liquidityUsd, volumes: opportunity.aggregate.volumes, txns: opportunity.aggregate.transactions, priceChanges: { ...seed.allPairs[0].priceChanges, h1: 4 + index / 10 } }));
  return { ...seed, opportunities, allPairs, universe: { ...seed.universe, rawPoolCount: count, uniqueTokenCount: count, activeOpportunityCount: count, freshOpportunityCount: count, qualityCounts: { active: count, thin: 0, incomplete: 0, expired: 0 } } };
}

function badges(snapshot: MarketTerminalSnapshot) { return computeMarketSignalSnapshot(snapshot).byOpportunityId[snapshot.opportunities[0].id]; }
function types(snapshot: MarketTerminalSnapshot) { return badges(snapshot).map((badge) => badge.type); }
function signal(snapshot: MarketSignalSnapshot, type: string) { return Object.values(snapshot.byOpportunityId).flat().find((badge) => badge.type === type); }
function facts(tokenAddress: string, values: Partial<SecurityFacts>): SecurityFacts { return { tokenAddress, source: "fixture-security", observedAt: new Date(NOW - 1_000).toISOString(), expiresAt: new Date(NOW + 60_000).toISOString(), ...values }; }
function address(value: number) { return `0x${value.toString(16).padStart(40, "0")}`; }
