import { expect, test } from "@playwright/test";
import { getMarketTerminalSnapshot, type MarketTerminalSnapshot } from "../../src/data/providers";
import { createAlertRule, evaluateAlertRules, type LocalAlertRule } from "../../src/lib/base-terminal/alerts";
import { getSnapshotRefreshCadence, shouldQueueMarketUpdate } from "../../src/lib/base-terminal/liveUpdates";
import { buildProviderHealth, preserveSelectedPair, shouldKeepCurrentSnapshotOnRefresh } from "../../src/lib/base-terminal/providerHealth";
import {
  createVisitSnapshot,
  diffMarketSnapshots,
  diffSinceLastVisit,
  getChangedPairIds,
  mergePulseSignals
} from "../../src/lib/base-terminal/pulse";
import type { BasePair } from "../../src/types/baseTerminal";

test.describe("verified snapshot signal engine", () => {
  test("derives price, real 5m volume and liquidity events from consecutive snapshots", async () => {
    const before = await getMarketTerminalSnapshot("mock");
    const pair = withVerifiedWindows(before.allPairs[0], { m5Volume: 10_000, liquidity: 100_000, price: 1 });
    const previous = withPairs(before, [pair]);
    const current = withPairs(before, [
      withVerifiedWindows(pair, { m5Volume: 20_000, liquidity: 110_000, price: 1.03 })
    ], "2026-08-29T10:00:12.000Z");

    const events = diffMarketSnapshots(previous, current, { now: new Date(current.generatedAt) });
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["price_move", "volume_burst", "liquidity_change"])
    );
    expect(events.find((event) => event.type === "volume_burst")?.timeframe).toBe("5m");
    expect(events.every((event) => event.source === current.providerName)).toBeTruthy();
    expect(events.every((event) => event.sourceUpdatedAt === current.sourceUpdatedAt)).toBeTruthy();
  });

  test("does not call a 24h volume delta a short-window burst or signal incomplete markets", async () => {
    const base = await getMarketTerminalSnapshot("mock");
    const pair = withVerifiedWindows(base.allPairs[0], { m5Volume: 10_000, liquidity: 100_000, price: 1 });
    const currentPair = {
      ...pair,
      volumes: { ...pair.volumes, h24: (pair.volumes?.h24 ?? 100_000) * 3 }
    };
    const events = diffMarketSnapshots(withPairs(base, [pair]), withPairs(base, [currentPair], "2026-08-29T10:00:12.000Z"));
    expect(events.some((event) => event.type === "volume_burst")).toBeFalsy();

    const incomplete = { ...currentPair, stale: true, liquidityUsd: undefined, liquidity: 0 };
    const incompleteEvents = diffMarketSnapshots(withPairs(base, [pair]), withPairs(base, [incomplete], "2026-08-29T10:00:24.000Z"));
    expect(incompleteEvents.some((event) => ["price_move", "volume_burst", "liquidity_change"].includes(event.type))).toBeFalsy();
  });

  test("deduplicates event keys, expires TTL and records only verifiable since-last-visit changes", async () => {
    const base = await getMarketTerminalSnapshot("mock");
    const pair = withVerifiedWindows(base.allPairs[0], { m5Volume: 10_000, liquidity: 100_000, price: 1 });
    const previous = withPairs(base, [pair], "2026-08-29T09:00:00.000Z");
    const current = withPairs(base, [withVerifiedWindows(pair, { m5Volume: 10_000, liquidity: 100_000, price: 1.04 })], "2026-08-29T10:00:00.000Z");
    const events = diffMarketSnapshots(previous, current);
    const merged = mergePulseSignals(events, events, Date.parse(current.generatedAt));
    expect(new Set(merged.map((event) => event.key)).size).toBe(merged.length);
    expect(mergePulseSignals(events, [], Date.parse(current.generatedAt) + 31 * 60_000)).toEqual([]);

    expect(diffSinceLastVisit(undefined, current)).toEqual([]);
    const sinceLast = diffSinceLastVisit(createVisitSnapshot(previous), current, [pair.id]);
    expect(sinceLast).toHaveLength(1);
    expect(sinceLast[0]).toMatchObject({ type: "watchlist_move", timeframe: "snapshot" });
  });

  test("reports changed pair ids for the pending update queue", async () => {
    const base = await getMarketTerminalSnapshot("mock");
    const pair = withVerifiedWindows(base.allPairs[0], { m5Volume: 10_000, liquidity: 100_000, price: 1 });
    const current = withPairs(base, [withVerifiedWindows(pair, { m5Volume: 10_000, liquidity: 100_000, price: 1.02 })]);
    expect(getChangedPairIds(withPairs(base, [pair]), current)).toEqual([pair.id]);
    expect(shouldQueueMarketUpdate(1, false)).toBeTruthy();
    expect(shouldQueueMarketUpdate(0, true)).toBeTruthy();
    expect(shouldQueueMarketUpdate(0, false)).toBeFalsy();
    expect(getSnapshotRefreshCadence("visible")).toBe(12_000);
    expect(getSnapshotRefreshCadence("hidden")).toBe(60_000);
  });

  test("filters low-liquidity markets and never fabricates an unsupported event", async () => {
    const base = await getMarketTerminalSnapshot("mock");
    const pair = withVerifiedWindows(base.allPairs[0], { m5Volume: 20_000, liquidity: 20_000, price: 1 });
    const currentPair = withVerifiedWindows(pair, { m5Volume: 50_000, liquidity: 21_500, price: 1.08 });
    const events = diffMarketSnapshots(withPairs(base, [pair]), withPairs(base, [currentPair], "2026-08-29T10:00:12.000Z"));
    expect(events).toEqual([]);
    expect(events.some((event) => /smart|whale|insider|safe/i.test(`${event.headline} ${event.detail}`))).toBeFalsy();
  });

  test("uses the lower watchlist threshold and reports feed delay and recovery without pair fabrication", async () => {
    const base = await getMarketTerminalSnapshot("mock");
    const pair = withVerifiedWindows(base.allPairs[0], { m5Volume: 10_000, liquidity: 100_000, price: 1 });
    const previous = withPairs(base, [pair], "2026-08-29T10:00:00.000Z");
    const moved = withPairs(base, [withVerifiedWindows(pair, { m5Volume: 10_000, liquidity: 100_000, price: 1.012 })], "2026-08-29T10:00:12.000Z");
    expect(diffMarketSnapshots(previous, moved).some((event) => event.type === "price_move")).toBeFalsy();
    expect(diffMarketSnapshots(previous, moved, { watchedPairIds: [pair.id] }).some((event) => event.type === "watchlist_move")).toBeTruthy();

    const delayed = { ...moved, freshness: "delayed" as const, fallbackReason: "Last healthy snapshot retained." };
    expect(diffMarketSnapshots(moved, delayed).map((event) => event.type)).toEqual(["data_delayed"]);
    expect(diffMarketSnapshots(delayed, moved).map((event) => event.type)).toEqual(["data_recovered"]);
  });

  test("keeps the last selected pair and marks delayed fail-soft snapshots clearly", async () => {
    const base = await getMarketTerminalSnapshot("mock");
    const pair = { ...withVerifiedWindows(base.allPairs[0], { m5Volume: 10_000, liquidity: 100_000, price: 1 }), dataSource: "dexscreener" as const };
    const healthy = { ...withPairs(base, [pair]), mode: "dexscreener" as const, freshness: "fresh" as const };
    const delayedEmpty = { ...healthy, allPairs: [], newPairs: [], volumeInflows: [], momentumPairs: [], freshness: "delayed" as const, fallbackReason: "Provider unavailable" };
    const preserved = preserveSelectedPair(delayedEmpty, pair);
    expect(preserved.allPairs[0]).toMatchObject({ id: pair.id, stale: true });
    expect(buildProviderHealth(delayedEmpty, "idle").stale).toBeTruthy();
    expect(shouldKeepCurrentSnapshotOnRefresh(healthy, delayedEmpty)).toBeTruthy();
  });
});

test.describe("local alert evaluation", () => {
  test("creates multiple persistent rules, triggers on crossing and enforces cooldown", async () => {
    const base = await getMarketTerminalSnapshot("mock");
    const pair = withVerifiedWindows(base.allPairs[0], { m5Volume: 10_000, liquidity: 100_000, price: 1 });
    const previous = withPairs(base, [pair], "2026-08-29T10:00:00.000Z");
    const current = withPairs(base, [withVerifiedWindows(pair, { m5Volume: 10_000, liquidity: 160_000, price: 1.2 })], "2026-08-29T10:00:12.000Z");
    const rules: LocalAlertRule[] = [
      createAlertRule({ pairId: pair.id, pairLabel: pair.pair, metric: "price_above", threshold: 1.1 }, new Date("2026-08-29T09:00:00.000Z")),
      createAlertRule({ pairId: pair.id, pairLabel: pair.pair, metric: "liquidity", threshold: 150_000 }, new Date("2026-08-29T09:00:01.000Z"))
    ];

    const first = evaluateAlertRules({ rules, previous, current, signals: [], now: new Date(current.generatedAt) });
    expect(first.triggers).toHaveLength(2);
    const second = evaluateAlertRules({ rules: first.rules, previous, current, signals: [], now: new Date("2026-08-29T10:01:00.000Z") });
    expect(second.triggers).toEqual([]);
    expect(first.rules.every((rule) => rule.lastTriggeredAt)).toBeTruthy();
  });

  test("triggers an any-pair rule from a verified new-pool signal", async () => {
    const base = await getMarketTerminalSnapshot("mock");
    const pair = withVerifiedWindows(base.allPairs[0], { m5Volume: 8_000, liquidity: 100_000, price: 1 });
    const rule = createAlertRule({ pairLabel: "Any qualified Base pair", metric: "new_pair" });
    const current = withPairs(base, [pair], "2026-08-29T10:00:12.000Z");
    const signals = diffMarketSnapshots(withPairs(base, []), current);
    const result = evaluateAlertRules({ rules: [rule], previous: withPairs(base, []), current, signals });
    expect(signals.some((event) => event.type === "new_pool")).toBeTruthy();
    expect(result.triggers).toHaveLength(1);
  });

  test("records a qualified liquidity change since the last visit", async () => {
    const base = await getMarketTerminalSnapshot("mock");
    const pair = withVerifiedWindows(base.allPairs[0], { m5Volume: 10_000, liquidity: 100_000, price: 1 });
    const previous = withPairs(base, [pair], "2026-08-29T10:00:00.000Z");
    const current = withPairs(base, [withVerifiedWindows(pair, { m5Volume: 10_000, liquidity: 110_000, price: 1 })], "2026-08-29T11:00:00.000Z");
    const events = diffSinceLastVisit(createVisitSnapshot(previous), current);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "liquidity_change", sourceUpdatedAt: current.sourceUpdatedAt });
  });
});

function withVerifiedWindows(
  pair: BasePair,
  { m5Volume, liquidity, price }: { m5Volume: number; liquidity: number; price: number }
): BasePair {
  return {
    ...pair,
    stale: false,
    priceUsdValue: price,
    priceUsd: `$${price}`,
    liquidity,
    liquidityUsd: liquidity,
    volume24h: Math.max(pair.volume24h, 50_000),
    volumes: { ...pair.volumes, m5: m5Volume, h24: Math.max(pair.volumes?.h24 ?? 0, 50_000) },
    priceChanges: { ...pair.priceChanges, h24: pair.priceChanges?.h24 ?? 4 },
    txns: { ...pair.txns, h24: pair.txns?.h24 ?? { buys: 100, sells: 80 } }
  };
}

function withPairs(
  base: MarketTerminalSnapshot,
  pairs: BasePair[],
  generatedAt = "2026-08-29T10:00:00.000Z"
): MarketTerminalSnapshot {
  return {
    ...base,
    generatedAt,
    sourceUpdatedAt: generatedAt,
    freshness: "fresh",
    defaultPairId: pairs[0]?.id ?? "",
    allPairs: pairs,
    newPairs: pairs,
    volumeInflows: pairs,
    momentumPairs: pairs
  };
}
