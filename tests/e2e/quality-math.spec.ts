import { expect, test } from "@playwright/test";
import { getMarketTerminalSnapshot, type MarketTerminalSnapshot } from "../../src/data/providers";
import { createAlertRule, evaluateAlertRules } from "../../src/lib/base-terminal/alerts";
import {
  buildDiscoveryRows,
  calculateActivityScore,
  DEFAULT_DISCOVERY_FILTERS,
  DISCOVERY_MIN_LIQUIDITY_USD,
  DISCOVERY_MIN_VOLUME_24H_USD,
  getChange24h,
  getLiquidityUsd,
  getVolume24h
} from "../../src/lib/base-terminal/discovery";
import { shouldAcceptMarketSnapshot } from "../../src/lib/base-terminal/providerHealth";
import { diffMarketSnapshots, mergePulseSignals, parseVisitSnapshot } from "../../src/lib/base-terminal/pulse";
import {
  aggregateOhlcvCandles,
  calculatePercentChange,
  calculateReverseChangePercent,
  canonicalPairKey,
  invertPositiveValue,
  normalizeOhlcvCandles,
  parseLocaleDecimalInput,
  parseStrictFiniteNumber,
  reverseOhlcvCandle
} from "../../src/lib/marketMath";
import { parseChainId, readWalletBalance, ReadOnlyWalletController, type Eip1193Provider } from "../../src/lib/wallet";
import type { BasePair } from "../../src/types/baseTerminal";
import { getBaseScanAddressUrl, sanitizeTokenLogoUrl } from "../../src/lib/safeUrl";
import { getNormalizedMarketModel } from "../../src/lib/base-terminal/marketModel";

test.describe("financial math invariants", () => {
  test("rejects partial and ambiguous numbers while preserving real zero", () => {
    expect(parseStrictFiniteNumber("1abc")).toBeUndefined();
    expect(parseStrictFiniteNumber("1,5")).toBeUndefined();
    expect(parseStrictFiniteNumber(" 1.5e2 ")).toBe(150);
    expect(parseStrictFiniteNumber("-0")).toBe(0);
    expect(Object.is(parseStrictFiniteNumber("-0"), -0)).toBeFalsy();
    expect(parseLocaleDecimalInput("1,5")).toBe(1.5);
    expect(parseLocaleDecimalInput("1.5")).toBe(1.5);
    expect(parseLocaleDecimalInput("1,2.3")).toBeUndefined();
    expect(parseLocaleDecimalInput("1 000")).toBeUndefined();
  });

  test("computes direct and reverse prices and returns without sign-flipping", () => {
    expect(calculatePercentChange(100, 125)).toBe(25);
    expect(calculatePercentChange(0, 125)).toBeUndefined();
    expect(calculatePercentChange(undefined, 125)).toBeUndefined();
    expect(calculatePercentChange(2, 2)).toBe(0);
    expect(Object.is(calculatePercentChange(2, 2), -0)).toBeFalsy();
    expect(invertPositiveValue(4)).toBe(0.25);
    expect(invertPositiveValue(0)).toBeUndefined();
    expect(calculateReverseChangePercent(25)).toBeCloseTo(-20, 12);
    expect(calculateReverseChangePercent(-20)).toBeCloseTo(25, 12);
    expect(calculateReverseChangePercent(-100)).toBeUndefined();
  });

  test("reverses OHLC high and low and rejects invalid input", () => {
    expect(reverseOhlcvCandle({ timestamp: 100, open: 2, high: 4, low: 1, close: 2.5, volume: 50 })).toEqual({
      timestamp: 100,
      open: 0.5,
      high: 1,
      low: 0.25,
      close: 0.4,
      volume: 50
    });
    expect(reverseOhlcvCandle({ timestamp: 100, open: 0, high: 4, low: 1, close: 2, volume: 1 })).toBeUndefined();
  });

  test("normalizes, deduplicates and aggregates OHLCV without fake gaps", () => {
    const candles = [
      { timestamp: 3_700, open: 3, high: 4, low: 2.5, close: 3.5, volume: 30 },
      { timestamp: 100, open: 1, high: 2, low: 0.8, close: 1.5, volume: 10 },
      { timestamp: 200, open: 1.5, high: 2.2, low: 1.2, close: 2, volume: 20 },
      { timestamp: 200, open: 1.5, high: 2.4, low: 1.1, close: 2.1, volume: 25 },
      { timestamp: 400, open: 2, high: 1.9, low: 1.5, close: 1.8, volume: 10 },
      { timestamp: 20_000, open: 1, high: 1, low: 1, close: 1, volume: 1 }
    ];
    const normalized = normalizeOhlcvCandles(candles, 10_000);
    expect(normalized.map((candle) => candle.timestamp)).toEqual([100, 200, 3_700]);
    expect(normalized.find((candle) => candle.timestamp === 200)?.high).toBe(2.4);
    expect(aggregateOhlcvCandles(candles, 3_600, 10_000)).toEqual([
      { timestamp: 0, open: 1, high: 2.4, low: 0.8, close: 2.1, volume: 35 },
      { timestamp: 3_600, open: 3, high: 4, low: 2.5, close: 3.5, volume: 30 }
    ]);
  });
});

test.describe("normalized market and ranking invariants", () => {
  test("keeps missing fields distinct from known zero across selectors", async () => {
    const snapshot = await getMarketTerminalSnapshot("mock");
    const base = snapshot.allPairs[0];
    const live = { ...base, dataSource: "dexscreener" as const, volumes: { h24: 0 }, liquidityUsd: 0, priceChanges: { h24: 0 } };
    expect(getVolume24h(live)).toBe(0);
    expect(getLiquidityUsd(live)).toBe(0);
    expect(getChange24h(live)).toBe(0);
    expect(getVolume24h({ ...live, volumes: undefined })).toBeUndefined();
    expect(getLiquidityUsd({ ...live, liquidityUsd: undefined })).toBeUndefined();
    expect(getChange24h({ ...live, priceChanges: undefined })).toBeUndefined();
  });

  test("uses inclusive documented boundaries and monotonic score inputs", async () => {
    const snapshot = await getMarketTerminalSnapshot("mock");
    const base = scoredPair(snapshot.allPairs[0], DISCOVERY_MIN_VOLUME_24H_USD, DISCOVERY_MIN_LIQUIDITY_USD);
    expect(calculateActivityScore(base)).toBeDefined();
    expect(calculateActivityScore(scoredPair(base, DISCOVERY_MIN_VOLUME_24H_USD - 1, DISCOVERY_MIN_LIQUIDITY_USD))).toBeUndefined();
    const moreVolume = scoredPair(base, 500_000, DISCOVERY_MIN_LIQUIDITY_USD);
    const moreLiquidity = scoredPair(moreVolume, 500_000, 500_000);
    expect(calculateActivityScore(moreVolume)).toBeGreaterThanOrEqual(calculateActivityScore(base)!);
    expect(calculateActivityScore(moreLiquidity)).toBeGreaterThanOrEqual(calculateActivityScore(moreVolume)!);
  });

  test("uses a stable canonical tie-breaker and orientation-independent token fallback", async () => {
    const snapshot = await getMarketTerminalSnapshot("mock");
    const first = scoredPair({ ...snapshot.allPairs[0], id: "z", pairAddress: undefined, baseTokenAddress: "0xbbb", quoteTokenAddress: "0xaaa" }, 100_000, 100_000);
    const second = scoredPair({ ...first, id: "a", baseTokenAddress: "0xddd", quoteTokenAddress: "0xccc" }, 100_000, 100_000);
    const orderA = buildDiscoveryRows({ pairs: [first, second], category: "trending", filters: DEFAULT_DISCOVERY_FILTERS, isPairPinned: () => false, recentPairIds: [] }).map((row) => row.pair.id);
    const orderB = buildDiscoveryRows({ pairs: [second, first], category: "trending", filters: DEFAULT_DISCOVERY_FILTERS, isPairPinned: () => false, recentPairIds: [] }).map((row) => row.pair.id);
    expect(orderA).toEqual(orderB);
    const direct = canonicalPairKey({ chainId: "base", baseTokenAddress: "0xbbb", quoteTokenAddress: "0xaaa", fallbackId: "one" });
    const reverse = canonicalPairKey({ chainId: "base", baseTokenAddress: "0xaaa", quoteTokenAddress: "0xbbb", fallbackId: "two" });
    expect(direct).toBe(reverse);
  });

  test("keeps one economic model across provider source and reverse orientation fixtures", async () => {
    const snapshot = await getMarketTerminalSnapshot("mock");
    const directPair = scoredPair({ ...snapshot.allPairs[0], pairAddress: undefined, baseTokenAddress: "0xbbb", quoteTokenAddress: "0xaaa" }, 123_456, 654_321);
    const sourceChanged = { ...directPair, dataSource: "dexscreener" as const, id: "provider-specific-id" };
    const reversePair = { ...sourceChanged, baseToken: directPair.quoteToken, quoteToken: directPair.baseToken, baseTokenAddress: directPair.quoteTokenAddress, quoteTokenAddress: directPair.baseTokenAddress };
    const direct = getNormalizedMarketModel(directPair);
    const changed = getNormalizedMarketModel(sourceChanged);
    const reverse = getNormalizedMarketModel(reversePair);
    expect(changed.key).toBe(direct.key);
    expect(reverse.key).toBe(direct.key);
    expect(changed).toMatchObject({ priceUsd: direct.priceUsd, change24h: 5, volume24hUsd: 123_456, liquidityUsd: 654_321 });
  });
});

test.describe("ordering, alert and wallet boundaries", () => {
  test("rejects duplicate, malformed and out-of-order live snapshots", async () => {
    const base = await getMarketTerminalSnapshot("mock");
    const current = liveSnapshot(base, "2026-08-29T10:00:00.000Z");
    expect(shouldAcceptMarketSnapshot(current, current)).toBeFalsy();
    expect(shouldAcceptMarketSnapshot(current, liveSnapshot(base, "2026-08-29T09:59:59.000Z"))).toBeFalsy();
    expect(shouldAcceptMarketSnapshot(current, { ...liveSnapshot(base, "2026-08-29T10:00:01.000Z"), sourceUpdatedAt: "bad" })).toBeFalsy();
    expect(shouldAcceptMarketSnapshot(current, liveSnapshot(base, "2026-08-29T10:00:01.000Z"))).toBeTruthy();
    expect(shouldAcceptMarketSnapshot(current, liveSnapshot(base, "2026-08-29T20:00:00.000Z"), Date.parse("2026-08-29T10:00:00.000Z"))).toBeFalsy();
  });

  test("fires alert exact boundaries once, observes cooldown, and rearms after crossing back", async () => {
    const base = await getMarketTerminalSnapshot("mock");
    const pair = scoredPair(base.allPairs[0], 100_000, 100_000);
    const rule = createAlertRule({ pairId: pair.id, metric: "change_24h", threshold: 5 }, new Date("2026-08-29T09:00:00Z"));
    const below = withPair(base, { ...pair, priceChanges: { ...pair.priceChanges, h24: 4.999 } }, "2026-08-29T10:00:00Z");
    const exact = withPair(base, { ...pair, priceChanges: { ...pair.priceChanges, h24: 5 } }, "2026-08-29T10:00:01Z");
    const first = evaluateAlertRules({ rules: [rule], previous: below, current: exact, signals: [], now: new Date("2026-08-29T10:00:01Z") });
    expect(first.triggers).toHaveLength(1);
    const repeated = evaluateAlertRules({ rules: first.rules, previous: exact, current: exact, signals: [], now: new Date("2026-08-29T10:20:01Z") });
    expect(repeated.triggers).toHaveLength(0);
    const above = withPair(base, { ...pair, priceChanges: { ...pair.priceChanges, h24: 5.001 } }, "2026-08-29T10:20:02Z");
    expect(evaluateAlertRules({ rules: repeated.rules, previous: exact, current: above, signals: [], now: new Date("2026-08-29T10:20:02Z") }).triggers).toHaveLength(0);
    const rearmed = evaluateAlertRules({ rules: repeated.rules, previous: below, current: exact, signals: [], now: new Date("2026-08-29T10:20:03Z") });
    expect(rearmed.triggers).toHaveLength(1);
  });

  test("parses Base chain ids exactly and converts huge wei without float loss", async () => {
    expect(parseChainId("0x2105")).toBe(8453);
    expect(parseChainId("8453")).toBe(8453);
    expect(parseChainId("0x2105junk")).toBeUndefined();
    expect(parseChainId("8453.0")).toBeUndefined();
    const hugeWei = BigInt(10) ** BigInt(50) + BigInt("123456789000000000");
    const provider: Eip1193Provider = { request: async () => `0x${hugeWei.toString(16)}` };
    const balance = await readWalletBalance(provider, "0x1111111111111111111111111111111111111111");
    expect(balance).toBe("100000000000000000000000000000000.1234");
    expect(balance).not.toMatch(/[eE+]/);
  });

  test("keeps logo and explorer URLs inside explicit trust boundaries", () => {
    expect(sanitizeTokenLogoUrl("javascript:alert(1)")).toBeUndefined();
    expect(sanitizeTokenLogoUrl("https://evil.example/token.png")).toBeUndefined();
    expect(sanitizeTokenLogoUrl("https://assets.coingecko.com/coins/token.png")).toBe("https://assets.coingecko.com/coins/token.png");
    expect(getBaseScanAddressUrl("0x1111111111111111111111111111111111111111")).toBe("https://basescan.org/address/0x1111111111111111111111111111111111111111");
    expect(getBaseScanAddressUrl("javascript:alert(1)")).toBeUndefined();
  });

  test("does not let a late balance overwrite a newer account", async () => {
    const firstAccount = "0x1111111111111111111111111111111111111111";
    const secondAccount = "0x2222222222222222222222222222222222222222";
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    let accounts = [firstAccount];
    let releaseFirstBalance: ((value: unknown) => void) | undefined;
    let balanceReads = 0;
    const provider: Eip1193Provider = {
      request: async ({ method }) => {
        if (method === "eth_requestAccounts" || method === "eth_accounts") return accounts;
        if (method === "eth_chainId") return "0x2105";
        if (method === "eth_getBalance") {
          balanceReads += 1;
          if (balanceReads === 1) return new Promise((resolve) => { releaseFirstBalance = resolve; });
          return "0x1bc16d674ec80000";
        }
        throw new Error(`Unexpected method ${method}`);
      },
      on: (event, listener) => {
        const current = listeners.get(event) ?? new Set();
        current.add(listener);
        listeners.set(event, current);
      },
      removeListener: (event, listener) => listeners.get(event)?.delete(listener)
    };
    const target = Object.assign(new EventTarget(), { ethereum: provider });
    const controller = new ReadOnlyWalletController();
    controller.start(target);
    controller.selectProvider("legacy:injected");
    const connecting = controller.connect();
    while (!releaseFirstBalance) await new Promise((resolve) => setTimeout(resolve, 0));
    accounts = [secondAccount];
    for (const listener of listeners.get("accountsChanged") ?? []) listener(accounts);
    releaseFirstBalance("0xde0b6b3a7640000");
    await connecting;
    for (let attempt = 0; attempt < 20 && controller.getState().balanceEth !== "2"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(controller.getState()).toMatchObject({ address: secondAccount, balanceEth: "2", chainId: 8453 });
    controller.stop();
  });

  test("keeps 100 snapshot and alert evaluations deterministic and bounded", async () => {
    const base = await getMarketTerminalSnapshot("mock");
    let previous = withPair(base, scoredPair(base.allPairs[0], 100_000, 100_000), "2026-08-29T10:00:00Z");
    let signals = [] as ReturnType<typeof diffMarketSnapshots>;
    let totalAlertTriggers = 0;
    for (let index = 1; index <= 100; index += 1) {
      const pair = { ...previous.allPairs[0], priceUsdValue: 1 + index * 0.03, priceChanges: { ...previous.allPairs[0].priceChanges, h24: 5 } };
      const current = withPair(base, pair, new Date(Date.parse("2026-08-29T10:00:00Z") + index * 60_000).toISOString());
      signals = mergePulseSignals(signals, diffMarketSnapshots(previous, current), Date.parse(current.generatedAt));
      const rule = createAlertRule({ pairId: pair.id, metric: "price_above", threshold: pair.priceUsdValue }, new Date(Date.parse(current.generatedAt) - 60_000));
      const below = withPair(base, { ...pair, priceUsdValue: pair.priceUsdValue - 0.01 }, new Date(Date.parse(current.generatedAt) - 1_000).toISOString());
      totalAlertTriggers += evaluateAlertRules({ rules: [rule], previous: below, current, signals: [], now: new Date(current.generatedAt) }).triggers.length;
      previous = current;
    }
    expect(totalAlertTriggers).toBe(100);
    expect(signals.length).toBeLessThanOrEqual(40);
    expect(new Set(signals.map((signal) => signal.key)).size).toBe(signals.length);
  });

  test("treats persisted visit state as bounded untrusted input", () => {
    expect(parseVisitSnapshot({ savedAt: "bad", pairs: [] })).toBeUndefined();
    expect(parseVisitSnapshot({ savedAt: "2099-01-01T00:00:00Z", pairs: [] }, Date.parse("2026-08-29T10:00:00Z"))).toBeUndefined();
    const parsed = parseVisitSnapshot({
      savedAt: "2026-08-29T09:00:00Z",
      pairs: Array.from({ length: 100 }, (_, index) => ({ id: `id-${index}`, identity: `key-${index}`, pair: `P${index}/USD`, priceUsd: index === 0 ? Number.NaN : 1, volume24h: 0, liquidityUsd: 0 }))
    }, Date.parse("2026-08-29T10:00:00Z"));
    expect(parsed?.pairs).toHaveLength(40);
    expect(parsed?.pairs[0].priceUsd).toBeUndefined();
    expect(parsed?.pairs[0].volume24h).toBe(0);
  });
});

function scoredPair(pair: BasePair, volume: number, liquidity: number): BasePair {
  return {
    ...pair,
    stale: false,
    priceUsdValue: pair.priceUsdValue ?? 1,
    volumes: { ...pair.volumes, h24: volume },
    liquidityUsd: liquidity,
    priceChanges: { ...pair.priceChanges, h24: 5 },
    txns: { ...pair.txns, h24: { buys: 10, sells: 10 } }
  };
}

function liveSnapshot(base: MarketTerminalSnapshot, timestamp: string): MarketTerminalSnapshot {
  return { ...base, mode: "dexscreener", generatedAt: timestamp, sourceUpdatedAt: timestamp, freshness: "fresh" };
}

function withPair(base: MarketTerminalSnapshot, pair: BasePair, timestamp: string): MarketTerminalSnapshot {
  return { ...base, generatedAt: timestamp, sourceUpdatedAt: timestamp, defaultPairId: pair.id, allPairs: [pair], newPairs: [pair], volumeInflows: [pair], momentumPairs: [pair] };
}
