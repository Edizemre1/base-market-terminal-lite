import { expect, test } from "@playwright/test";
import { getMarketTerminalSnapshot, type MarketTerminalSnapshot } from "../../src/data/providers";
import { GECKO_DISCOVERY_REQUEST_BUDGET, mergeGeckoPages, parseGeckoTerminalPools } from "../../src/data/providers/geckoTerminalDiscoveryProvider";
import {
  DISCOVERY_RESERVOIR_CAPACITY,
  JUST_LAUNCHED_MAX_AGE_MINUTES,
  NEW_POOL_MAX_AGE_MINUTES,
  buildDiscoveryUniverse,
  choosePrimaryMarket,
  mergePoolPairs
} from "../../src/lib/base-terminal/opportunityModel";
import { buildTokenOpportunityLanes } from "../../src/lib/base-terminal/terminalMarket";
import { mergeOnchainPoolsIntoPairs } from "../../src/lib/base-terminal/onchainDiscovery";
import {
  getDiscoveryHistoryStats,
  recordDiscoveryHistory,
  resetDiscoveryHistoryForTests
} from "../../src/lib/base-terminal/discoveryHistory";
import type { BasePair } from "../../src/types/baseTerminal";

const WETH = "0x4200000000000000000000000000000000000006";
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const CBBTC = address(90_001);

test.describe("pool market to token opportunity contracts", () => {
  test("deduplicates twenty cbBTC pools across DEXes, quote tokens, and orientations", async () => {
    const template = await fixtureTemplate();
    const pools = Array.from({ length: 20 }, (_, index) => fixturePool(template, {
      poolAddress: address(index + 1),
      tokenAddress: CBBTC,
      tokenSymbol: "cbBTC",
      quoteAddress: index % 2 ? WETH : USDC,
      quoteSymbol: index % 2 ? "WETH" : "USDC",
      dex: ["uniswap-v3", "aerodrome", "baseswap", "sushiswap"][index % 4],
      inverted: index % 3 === 0
    }));
    const discovery = buildDiscoveryUniverse(pools, [], new Date());
    const opportunity = discovery.opportunities.find((item) => item.focusTokenAddress === CBBTC);
    expect(opportunity?.poolCount).toBe(20);
    expect(opportunity?.poolMarketIds).toHaveLength(20);
    expect(new Set(opportunity?.poolMarketIds).size).toBe(20);
    expect(discovery.opportunities.filter((item) => item.focusTokenAddress === CBBTC)).toHaveLength(1);

    const snapshot = await snapshotFrom(template, pools);
    const lanes = buildTokenOpportunityLanes(snapshot);
    for (const lane of lanes) expect(lane.opportunities.filter((item) => item.focusTokenAddress === CBBTC).length).toBeLessThanOrEqual(1);
    expect(snapshot.opportunities.filter((item) => item.focusTokenAddress === CBBTC)).toHaveLength(1);
  });

  test("keeps the same symbol on different contract addresses separate", async () => {
    const template = await fixtureTemplate();
    const pools = [1, 2].map((index) => fixturePool(template, { poolAddress: address(100 + index), tokenAddress: address(200 + index), tokenSymbol: "ABC", quoteAddress: WETH, quoteSymbol: "WETH" }));
    const discovery = buildDiscoveryUniverse(pools);
    expect(discovery.opportunities).toHaveLength(2);
    expect(new Set(discovery.opportunities.map((item) => item.focusTokenAddress)).size).toBe(2);
  });

  test("merges one pool from two providers without double-counting", async () => {
    const template = await fixtureTemplate();
    const dex = fixturePool(template, { poolAddress: address(301), tokenAddress: address(302), tokenSymbol: "DUAL", quoteAddress: WETH, quoteSymbol: "WETH", liquidity: 120_000, volume24h: 90_000 });
    const gecko = { ...dex, dataSource: "geckoterminal" as const, dataProviders: ["geckoterminal" as const], liquidityUsd: 120_000, volumes: { ...dex.volumes, h24: 90_000 } };
    const discovery = buildDiscoveryUniverse(mergePoolPairs([dex, gecko]));
    expect(discovery.poolMarkets).toHaveLength(1);
    expect(discovery.poolMarkets[0].sourceProviders.sort()).toEqual(["dexscreener", "geckoterminal"]);
    expect(discovery.opportunities[0].aggregate.liquidityUsd).toBe(120_000);
    expect(discovery.opportunities[0].aggregate.volumes?.h24).toBe(90_000);
  });

  test("adds a new pool to an existing token row and records server-side history across visits", async () => {
    resetDiscoveryHistoryForTests();
    const template = await fixtureTemplate();
    const now = Date.now();
    const firstPool = fixturePool(template, { poolAddress: address(351), tokenAddress: address(352), tokenSymbol: "GROW", quoteAddress: WETH, quoteSymbol: "WETH" });
    const first = { ...(await snapshotFrom(template, [firstPool], now)), mode: "dexscreener" as const, freshness: "fresh" as const };
    expect(recordDiscoveryHistory(first, now).status).toBe("warming");

    const fasterFirstPool = { ...firstPool, priceUsdValue: 55_000, liquidityUsd: 300_000, liquidity: 300_000, volumes: { ...firstPool.volumes, m5: 3_000 } };
    const secondPool = fixturePool(template, { poolAddress: address(353), tokenAddress: address(352), tokenSymbol: "GROW", quoteAddress: USDC, quoteSymbol: "USDC" });
    const second = { ...(await snapshotFrom(template, [fasterFirstPool, secondPool], now + 12_000)), mode: "dexscreener" as const, freshness: "fresh" as const };
    const history = recordDiscoveryHistory(second, now + 12_000);
    expect(second.opportunities).toHaveLength(1);
    expect(second.opportunities[0].poolCount).toBe(2);
    expect(history.status).toBe("ready");
    expect(history.signals.find((signal) => signal.type === "new_pool" && signal.pairId === secondPool.id)).toMatchObject({
      metric: "liquidity_usd",
      currentValue: 250_000,
      freshness: "fresh"
    });
    expect(history.signals.find((signal) => signal.type === "price_move")).toMatchObject({
      metric: "price_usd",
      previousValue: 50_000,
      currentValue: 55_000,
      freshness: "fresh"
    });
    expect(history.signals.find((signal) => signal.type === "volume_burst")).toMatchObject({
      metric: "volume_usd",
      previousValue: 1_000,
      currentValue: 3_000,
      freshness: "fresh"
    });
    expect(history.signals.find((signal) => signal.type === "liquidity_change")).toMatchObject({
      metric: "liquidity_usd",
      previousValue: 250_000,
      currentValue: 300_000,
      freshness: "fresh"
    });
    expect(getDiscoveryHistoryStats(now + 12_000)).toMatchObject({ snapshotCount: 2, bounded: true, ttlMinutes: 30 });

    expect(getDiscoveryHistoryStats(now + 31 * 60_000).snapshotCount).toBe(0);
    resetDiscoveryHistoryForTests();
    for (let index = 0; index < 160; index += 1) {
      const generatedAt = new Date(now + index * 1_000).toISOString();
      recordDiscoveryHistory({ ...second, generatedAt, sourceUpdatedAt: generatedAt }, now + index * 1_000);
    }
    expect(getDiscoveryHistoryStats(now + 160_000).snapshotCount).toBe(150);
    const newest = getDiscoveryHistoryStats(now + 160_000).newestSnapshotAt;
    recordDiscoveryHistory({ ...second, generatedAt: new Date(now).toISOString(), sourceUpdatedAt: new Date(now).toISOString() }, now + 160_000);
    expect(getDiscoveryHistoryStats(now + 160_000).newestSnapshotAt).toBe(newest);
    resetDiscoveryHistoryForTests();
  });

  test("rejects missing, invalid, future, and 136-day timestamps from New on Base", async () => {
    const template = await fixtureTemplate();
    const now = Date.now();
    const valid = fixturePool(template, { poolAddress: address(401), tokenAddress: address(501), tokenSymbol: "NEW", quoteAddress: WETH, quoteSymbol: "WETH", createdAt: now - 60_000 });
    const missing = { ...fixturePool(template, { poolAddress: address(402), tokenAddress: address(502), tokenSymbol: "MISS", quoteAddress: WETH, quoteSymbol: "WETH" }), pairCreatedAt: undefined, pairCreatedAtMs: undefined, ageMinutes: Number.MAX_SAFE_INTEGER, age: "N/A" };
    const future = fixturePool(template, { poolAddress: address(403), tokenAddress: address(503), tokenSymbol: "FUT", quoteAddress: WETH, quoteSymbol: "WETH", createdAt: now + 60_000 });
    const old = fixturePool(template, { poolAddress: address(404), tokenAddress: address(504), tokenSymbol: "OLD", quoteAddress: WETH, quoteSymbol: "WETH", createdAt: now - 136 * 24 * 60 * 60_000 });
    const snapshot = await snapshotFrom(template, [valid, missing, future, old], now);
    const lane = buildTokenOpportunityLanes(snapshot).find((item) => item.id === "new")!;
    expect(lane.opportunities.map((item) => item.focusTokenSymbol)).toEqual(["NEW"]);
    expect(lane.opportunities[0].categoryEligibility.justLaunched).toBeTruthy();
    expect(NEW_POOL_MAX_AGE_MINUTES).toBe(7 * 24 * 60);
    expect(JUST_LAUNCHED_MAX_AGE_MINUTES).toBe(24 * 60);
  });

  test("uses Volume Leaders until a comparable baseline exists, then enables real surge", async () => {
    const template = await fixtureTemplate();
    const pools = [1, 2, 3, 4].map((index) => verifiedPool(fixturePool(template, { poolAddress: address(600 + index), tokenAddress: address(700 + index), tokenSymbol: `VOL${index}`, quoteAddress: USDC, quoteSymbol: "USDC", volume1h: index * 10_000 })));
    const warming = await snapshotFrom(template, pools);
    expect(buildTokenOpportunityLanes(warming).find((lane) => lane.id === "volume")?.fallback).toBeTruthy();
    const baseline = Object.fromEntries(warming.opportunities.map((item) => [item.id, (item.aggregate.volumes?.h1 ?? 1) / 2]));
    const ready = { ...warming, comparison: { status: "ready" as const, previousGeneratedAt: new Date(Date.now() - 12_000).toISOString(), opportunityVolume1h: baseline } };
    const volume = buildTokenOpportunityLanes(ready).find((lane) => lane.id === "volume")!;
    expect(volume.fallback).toBeFalsy();
    expect(volume.derived).toBeTruthy();
  });

  test("treats a verified negative price move as movement instead of missing data", async () => {
    const template = await fixtureTemplate();
    const pool = verifiedPool(fixturePool(template, { poolAddress: address(751), tokenAddress: address(752), tokenSymbol: "DOWN", quoteAddress: USDC, quoteSymbol: "USDC" }));
    pool.priceChanges = { ...pool.priceChanges, h1: -4.25 };
    const discovery = buildDiscoveryUniverse([pool]);
    expect(discovery.opportunities[0].categoryEligibility.moving).toBeTruthy();
    const snapshot = await snapshotFrom(template, [pool]);
    expect(buildTokenOpportunityLanes(snapshot).some((lane) => lane.opportunities.some((opportunity) => opportunity.focusTokenSymbol === "DOWN"))).toBeTruthy();
  });

  test("uses a verified global WETH/USDC anchor for an exact TOKEN/WETH Tier B path", async () => {
    const template = await fixtureTemplate();
    const tokenAddress = address(761);
    const tokenWeth = verifiedPool(fixturePool(template, { poolAddress: address(762), tokenAddress, tokenSymbol: "PATH", quoteAddress: WETH, quoteSymbol: "WETH" }));
    const wethUsdc = verifiedPool(fixturePool(template, { poolAddress: address(763), tokenAddress: WETH, tokenSymbol: "WETH", quoteAddress: USDC, quoteSymbol: "USDC" }));
    const discovery = buildDiscoveryUniverse([tokenWeth, wethUsdc]);
    const opportunity = discovery.opportunities.find((item) => item.focusTokenAddress === tokenAddress);
    expect(opportunity?.canonicalPrice.tier).toBe("B");
    expect(opportunity?.canonicalPrice.sourcePoolKeys).toEqual([tokenWeth.id, wethUsdc.id].sort());
  });

  test("pins direct and inverted WETH/USDC markets to the exact on-chain anchor consensus value", async () => {
    const template = await fixtureTemplate();
    const poolAddress = address(770);
    const providerPair = fixturePool(template, { poolAddress, tokenAddress: WETH, tokenSymbol: "WETH", quoteAddress: USDC, quoteSymbol: "USDC" });
    const invertedPair = fixturePool(template, { poolAddress: address(772), tokenAddress: WETH, tokenSymbol: "WETH", quoteAddress: USDC, quoteSymbol: "USDC", inverted: true, liquidity: 250_000_000, volume24h: 80_000_000 });
    providerPair.priceNative = "2400";
    providerPair.priceUsdValue = 2400;
    invertedPair.priceNative = "0.0004";
    invertedPair.priceUsdValue = 1;
    const anchorUsd = 2431.7203029993243;
    const merged = mergeOnchainPoolsIntoPairs([providerPair, invertedPair], {
      ok: true,
      state: {
        pools: {},
        priceAnchors: { wethUsdc: { status: "ready", value: anchorUsd, pricingPool: {
          poolKey: poolAddress,
          poolAddress,
          token0: WETH,
          token1: USDC,
          factoryId: "uniswap-v3",
          factoryAddress: address(771),
          protocolVersion: "v3",
          observedAt: new Date().toISOString(),
          blockNumber: 50_000_000,
          providers: ["dexscreener"],
          priceToken1PerToken0: anchorUsd,
          liquidityUsd: 115_000_000,
          volume24hUsd: 50_000_000,
          anchorConsensus: true,
          sourcePoolKeys: [poolAddress]
        } } },
        confirmedHead: 50_000_000
      }
    } as unknown as NonNullable<Parameters<typeof mergeOnchainPoolsIntoPairs>[1]>);
    const direct = merged.find((pair) => pair.id === poolAddress)!;
    const inverted = merged.find((pair) => pair.id === invertedPair.id)!;
    expect(direct.priceNative).toBe(String(anchorUsd));
    expect(direct.priceUsdValue).toBe(anchorUsd);
    expect(direct.liquidityUsd).toBe(115_000_000);
    expect(direct.onchainProvenance?.decimalsVerified).toBeTruthy();
    expect(Number(inverted.priceNative)).toBeCloseTo(1 / anchorUsd, 15);
    expect(inverted.priceUsdValue).toBe(1);

    const discovery = buildDiscoveryUniverse(merged, [], new Date());
    const opportunity = discovery.opportunities.find((item) => item.focusTokenAddress === WETH)!;
    const primary = discovery.pairs.find((pair) => pair.id === opportunity.primaryMarketId)!;
    const primaryFocusUsd = primary.baseTokenAddress === WETH
      ? primary.priceUsdValue
      : Number(primary.priceNative) > 0 && primary.priceUsdValue ? primary.priceUsdValue / Number(primary.priceNative) : undefined;
    expect(opportunity.canonicalPrice.value).toBe(anchorUsd);
    expect(primaryFocusUsd).toBeCloseTo(anchorUsd, 10);
  });

  test("holds a healthy primary through small changes and switches on material improvement or staleness", async () => {
    const template = await fixtureTemplate();
    const first = fixturePool(template, { poolAddress: address(801), tokenAddress: address(901), tokenSymbol: "HYST", quoteAddress: WETH, quoteSymbol: "WETH", liquidity: 200_000, volume24h: 100_000 });
    const smallLead = fixturePool(template, { poolAddress: address(802), tokenAddress: address(901), tokenSymbol: "HYST", quoteAddress: USDC, quoteSymbol: "USDC", liquidity: 205_000, volume24h: 102_000 });
    expect(choosePrimaryMarket([first, smallLead], first.id)?.id).toBe(first.id);
    const material = { ...smallLead, liquidityUsd: 2_000_000, liquidity: 2_000_000, volumes: { ...smallLead.volumes, h24: 1_500_000 }, volume24h: 1_500_000 };
    expect(choosePrimaryMarket([first, material], first.id)?.id).toBe(material.id);
    expect(choosePrimaryMarket([{ ...first, stale: true }, smallLead], first.id)?.id).toBe(smallLead.id);
  });

  test("supports a bounded 1,000-pool reservoir and at least 300 address-unique opportunities", async () => {
    const template = await fixtureTemplate();
    const pools = Array.from({ length: 1_050 }, (_, index) => fixturePool(template, { poolAddress: address(10_000 + index), tokenAddress: address(20_000 + (index % 350)), tokenSymbol: `T${index % 350}`, quoteAddress: WETH, quoteSymbol: "WETH" }));
    const forward = buildDiscoveryUniverse(pools);
    const reverse = buildDiscoveryUniverse([...pools].reverse());
    expect(forward.poolMarkets).toHaveLength(DISCOVERY_RESERVOIR_CAPACITY);
    expect(forward.opportunities.length).toBeGreaterThanOrEqual(300);
    expect(forward.opportunities.map((item) => item.id)).toEqual(reverse.opportunities.map((item) => item.id));
    expect(forward.universe.capacity.pools).toBe(1_000);
  });

  test("parses GeckoTerminal included token/DEX metadata and rejects future pool age", () => {
    const now = new Date().toISOString();
    const payload = geckoPayload(now);
    const [pair] = parseGeckoTerminalPools(payload, now);
    expect(pair.pairAddress).toBe(address(30_001));
    expect(pair.baseTokenAddress).toBe(address(30_002));
    expect(pair.quoteTokenAddress).toBe(WETH);
    expect(pair.dexId).toBe("aerodrome-slipstream");
    expect(pair.dataSource).toBe("geckoterminal");
    const future = geckoPayload(new Date(Date.now() + 60_000).toISOString());
    expect(parseGeckoTerminalPools(future)[0].pairCreatedAt).toBeUndefined();
  });

  test("merges paginated GeckoTerminal results without cursor-page duplicates inside a fixed request budget", () => {
    const createdAt = new Date().toISOString();
    const firstPage = geckoPayload(createdAt, 31_001, 31_002);
    const repeatedPage = geckoPayload(createdAt, 31_001, 31_002);
    const secondPage = geckoPayload(createdAt, 31_003, 31_004);
    const pairs = mergeGeckoPages([firstPage, repeatedPage, secondPage]);
    expect(pairs).toHaveLength(2);
    expect(new Set(pairs.map((pair) => pair.pairAddress)).size).toBe(2);
    expect(GECKO_DISCOVERY_REQUEST_BUDGET).toBe(12);
  });
});

async function fixtureTemplate() {
  return (await getMarketTerminalSnapshot("mock")).allPairs[0];
}

async function snapshotFrom(template: BasePair, pairs: BasePair[], now = Date.now()): Promise<MarketTerminalSnapshot> {
  const base = await getMarketTerminalSnapshot("mock");
  const discovery = buildDiscoveryUniverse(pairs, [], new Date(now));
  return {
    ...base,
    generatedAt: new Date(now).toISOString(),
    sourceUpdatedAt: new Date(now).toISOString(),
    allPairs: discovery.pairs,
    poolMarkets: discovery.poolMarkets,
    opportunities: discovery.opportunities,
    universe: discovery.universe,
    defaultPairId: discovery.opportunities[0]?.primaryMarketId ?? template.id,
    newPairs: [],
    volumeInflows: [],
    momentumPairs: [],
    comparison: { status: "warming", opportunityVolume1h: {} }
  };
}

function fixturePool(template: BasePair, options: { poolAddress: string; tokenAddress: string; tokenSymbol: string; quoteAddress: string; quoteSymbol: string; dex?: string; inverted?: boolean; createdAt?: number; liquidity?: number; volume24h?: number; volume1h?: number }): BasePair {
  const now = Date.now();
  const createdAt = options.createdAt ?? now - 60 * 60_000;
  const liquidity = options.liquidity ?? 250_000;
  const volume24h = options.volume24h ?? 120_000;
  const token = { address: options.tokenAddress, symbol: options.tokenSymbol };
  const quote = { address: options.quoteAddress, symbol: options.quoteSymbol };
  const baseSide = options.inverted ? quote : token;
  const quoteSide = options.inverted ? token : quote;
  return {
    ...template,
    dataSource: "dexscreener",
    dataProviders: ["dexscreener"],
    id: options.poolAddress,
    pairAddress: options.poolAddress,
    baseTokenAddress: baseSide.address,
    quoteTokenAddress: quoteSide.address,
    baseToken: baseSide.symbol,
    quoteToken: quoteSide.symbol,
    pair: `${baseSide.symbol} / ${quoteSide.symbol}`,
    project: `${options.tokenSymbol} token`,
    dexId: options.dex ?? "aerodrome",
    dexName: options.dex ?? "Aerodrome",
    dex: options.dex ?? "Aerodrome",
    pairCreatedAt: createdAt > now ? new Date(createdAt).toISOString() : new Date(createdAt).toISOString(),
    pairCreatedAtMs: createdAt,
    ageMinutes: createdAt > now ? 0 : Math.floor((now - createdAt) / 60_000),
    age: createdAt > now ? "N/A" : `${Math.floor((now - createdAt) / 60_000)}m`,
    priceNative: options.inverted ? "0.00002" : "50000",
    priceUsdValue: options.inverted ? 1 : 50_000,
    priceUsd: options.inverted ? "$1" : "$50,000",
    priceChanges: { m5: 1, h1: 2, h6: 3, h24: 4 },
    change24h: 4,
    liquidityUsd: liquidity,
    liquidity,
    volumes: { m5: 1_000, h1: options.volume1h ?? 12_000, h6: 45_000, h24: volume24h },
    volume24h,
    txns: { m5: { buys: 3, sells: 2 }, h1: { buys: 30, sells: 20 }, h6: { buys: 90, sells: 70 }, h24: { buys: 300, sells: 200 } },
    stale: false
  };
}

function verifiedPool(pool: BasePair): BasePair {
  const observedAt = new Date().toISOString();
  return {
    ...pool,
    dataProviders: [...new Set([...(pool.dataProviders ?? []), "onchain" as const])],
    sourceUpdatedAt: observedAt,
    onchainProvenance: {
      factoryId: "fixture-factory",
      factoryAddress: address(99_001),
      protocolVersion: "fixture-v2",
      confirmedAt: observedAt,
      bindingKind: "registered_pool_identity",
      decimalsVerified: true
    }
  };
}

function geckoPayload(createdAt: string, poolSeed = 30_001, tokenSeed = 30_002) {
  return {
    data: [{ id: `base_${address(poolSeed)}`, type: "pool", attributes: { address: address(poolSeed), name: "FIX / WETH", pool_created_at: createdAt, base_token_price_usd: "1.25", base_token_price_quote_token: "0.0005", reserve_in_usd: "22000", fdv_usd: "1000000", market_cap_usd: null, volume_usd: { m5: "100", h1: "1000", h6: "4000", h24: "10000" }, price_change_percentage: { m5: "1", h1: "2", h6: "3", h24: "4" }, transactions: { m5: { buys: 2, sells: 1 }, h1: { buys: 5, sells: 4 }, h6: { buys: 20, sells: 15 }, h24: { buys: 50, sells: 40 } } }, relationships: { base_token: { data: { id: `base_${address(tokenSeed)}`, type: "token" } }, quote_token: { data: { id: `base_${WETH}`, type: "token" } }, dex: { data: { id: "aerodrome-slipstream", type: "dex" } } } }],
    included: [{ id: `base_${address(tokenSeed)}`, type: "token", attributes: { address: address(tokenSeed), name: "Fixture", symbol: "FIX" } }, { id: `base_${WETH}`, type: "token", attributes: { address: WETH, name: "Wrapped Ether", symbol: "WETH" } }, { id: "aerodrome-slipstream", type: "dex", attributes: { name: "Aerodrome Slipstream" } }]
  };
}

function address(value: number) {
  return `0x${value.toString(16).padStart(40, "0")}`;
}
