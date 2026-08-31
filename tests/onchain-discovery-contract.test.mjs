import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FACTORY_REGISTRY, BASE_USDC, BASE_WETH, assertFactoryRegistry } from "../collector/factory-registry.mjs";
import {
  MAX_EVENT_RING,
  appendRelayEvent,
  applyCanonicalEvents,
  buildCanonicalOpportunities,
  calculateCanonicalUsdcPrice,
  coalesceBoundedQueue,
  decodeFactoryLog,
  dedupePools,
  eventsAfterId,
  reconcileCanonicalWindow,
  selectPrimaryPool
} from "../collector/model.mjs";
import { DurableDiscoveryStore, initialState } from "../collector/store.mjs";
import { decodeAbiText, enrichTokenMetadata } from "../collector/rpc.mjs";

const NOW = new Date("2026-08-31T12:00:00.000Z");
const TOKEN_A = "0x1111111111111111111111111111111111111111";
const TOKEN_B = "0x2222222222222222222222222222222222222222";
const POOL_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HASH_A = `0x${"a".repeat(64)}`;
const HASH_B = `0x${"b".repeat(64)}`;

test("registry contains exact supported factories and unique bindings", () => {
  assert.equal(assertFactoryRegistry(), true);
  assert.equal(FACTORY_REGISTRY.length, 11);
  assert.equal(new Set(FACTORY_REGISTRY.map((entry) => `${entry.address}:${entry.eventTopic}`)).size, 11);
  assert.ok(FACTORY_REGISTRY.every((entry) => entry.deploymentStartBlock > 1));
});

test("registry event topics match canonical V2 and V3 topics", () => {
  assert.equal(FACTORY_REGISTRY.find((entry) => entry.id === "uniswap-v2")?.eventTopic, "0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9");
  assert.equal(FACTORY_REGISTRY.find((entry) => entry.id === "uniswap-v3")?.eventTopic, "0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118");
});

test("V2 PairCreated log decodes exact pool and provenance", () => {
  const binding = FACTORY_REGISTRY.find((entry) => entry.id === "uniswap-v2");
  const event = decodeFactoryLog(logFor(binding, [wordAddress(TOKEN_A), wordAddress(BASE_USDC)], `${wordAddress(POOL_A).slice(2)}${wordNumber(7).slice(2)}`));
  assert.equal(event.poolAddress, POOL_A);
  assert.equal(event.token0, TOKEN_A);
  assert.equal(event.token1, BASE_USDC);
  assert.equal(event.factoryId, "uniswap-v2");
});

test("V3 PoolCreated log decodes fee and second data word pool", () => {
  const binding = FACTORY_REGISTRY.find((entry) => entry.id === "uniswap-v3");
  const event = decodeFactoryLog(logFor(binding, [wordAddress(TOKEN_A), wordAddress(BASE_USDC), wordNumber(500)], `${wordNumber(10).slice(2)}${wordAddress(POOL_A).slice(2)}`));
  assert.equal(event.poolAddress, POOL_A);
  assert.equal(event.fee, 500);
});

test("unregistered or malformed logs are rejected", () => {
  assert.equal(decodeFactoryLog({ address: TOKEN_A, topics: [HASH_A], data: "0x" }), undefined);
});

test("same event twice in one batch is idempotent", () => {
  const event = canonicalEvent();
  const state = applyCanonicalEvents(initialState(NOW), [event, event], { now: NOW });
  assert.equal(Object.keys(state.pools).length, 1);
  assert.equal(state.counters.duplicateDropped, 1);
});

test("overlap replay drops an already confirmed event", () => {
  const event = canonicalEvent();
  const first = applyCanonicalEvents(initialState(NOW), [event], { now: NOW });
  const second = applyCanonicalEvents(first, [event], { now: NOW });
  assert.equal(Object.keys(second.events).length, 1);
  assert.equal(second.counters.duplicateDropped, 1);
});

test("provisional event remains non-confirmed and emits no relay event", () => {
  const state = applyCanonicalEvents(initialState(NOW), [{ ...canonicalEvent(), provisional: true }], { now: NOW });
  assert.equal(state.pools[POOL_A].status, "provisional");
  assert.equal(state.eventRing.length, 0);
});

test("confirmed copy promotes provisional event and emits relay event", () => {
  const event = canonicalEvent();
  const provisional = applyCanonicalEvents(initialState(NOW), [{ ...event, provisional: true }], { now: NOW });
  const confirmed = applyCanonicalEvents(provisional, [event], { now: NOW });
  assert.equal(confirmed.pools[POOL_A].status, "confirmed");
  assert.equal(confirmed.eventRing.at(-1).type, "pool_confirmed");
});

test("canonical overlap marks disappeared event and pool orphaned", () => {
  const event = canonicalEvent();
  const first = applyCanonicalEvents(initialState(NOW), [event], { now: NOW });
  const reconciled = reconcileCanonicalWindow(first, [], event.blockNumber, event.blockNumber, NOW);
  assert.equal(reconciled.pools[POOL_A].status, "orphaned");
  assert.equal(reconciled.counters.reorgCount, 1);
});

test("removed log immediately orphans an already known event", () => {
  const event = canonicalEvent();
  const first = applyCanonicalEvents(initialState(NOW), [event], { now: NOW });
  const removed = applyCanonicalEvents(first, [{ ...event, removed: true }], { now: NOW });
  assert.equal(removed.events[event.idempotencyKey].status, "orphaned");
  assert.equal(removed.pools[POOL_A].status, "orphaned");
});

test("overlap backfill inserts a previously missed confirmed event", () => {
  const event = canonicalEvent();
  const reconciled = reconcileCanonicalWindow(initialState(NOW), [event], event.blockNumber - 1, event.blockNumber, NOW);
  assert.equal(reconciled.pools[POOL_A].status, "confirmed");
});

test("relay ring is hard bounded", () => {
  const state = initialState(NOW);
  for (let index = 0; index < MAX_EVENT_RING + 20; index += 1) appendRelayEvent(state, "pool_confirmed", { index }, NOW.toISOString());
  assert.equal(state.eventRing.length, MAX_EVENT_RING);
  assert.equal(state.eventRing.at(-1).data.index, MAX_EVENT_RING + 19);
});

test("Last-Event-ID returns only unseen events", () => {
  const state = initialState(NOW);
  appendRelayEvent(state, "one", {}, NOW.toISOString());
  appendRelayEvent(state, "two", {}, NOW.toISOString());
  appendRelayEvent(state, "three", {}, NOW.toISOString());
  assert.deepEqual(eventsAfterId(state.eventRing, "1").map((event) => event.type), ["two", "three"]);
});

test("unknown Last-Event-ID safely replays the bounded ring", () => {
  const state = initialState(NOW);
  appendRelayEvent(state, "one", {}, NOW.toISOString());
  appendRelayEvent(state, "two", {}, NOW.toISOString());
  assert.equal(eventsAfterId(state.eventRing, "expired-id").length, 2);
});

test("bounded queue coalesces by pool key and retains newest value", () => {
  const queue = coalesceBoundedQueue([{ poolKey: "a", value: 1 }, { poolKey: "b", value: 2 }], [{ poolKey: "a", value: 3 }, { poolKey: "c", value: 4 }], 2);
  assert.deepEqual(queue, [{ poolKey: "a", value: 3 }, { poolKey: "c", value: 4 }]);
});

test("pool dedupe merges providers without double-counting pool key", () => {
  const pools = dedupePools([pricingPool({ poolKey: POOL_A, providers: ["onchain"] }), pricingPool({ poolKey: POOL_A, providers: ["dexscreener"], volume24hUsd: 10 })]);
  assert.equal(pools.length, 1);
  assert.deepEqual(pools[0].providers, ["dexscreener", "onchain"]);
});

test("direct TOKEN/USDC price is Tier A", () => {
  const price = calculateCanonicalUsdcPrice(TOKEN_A, [pricingPool({ token0: TOKEN_A, token1: BASE_USDC, priceToken1PerToken0: 2 })], NOW);
  assert.equal(price.tier, "A");
  assert.equal(price.value, 2);
});

test("reverse USDC/TOKEN orientation yields same Tier A value", () => {
  const price = calculateCanonicalUsdcPrice(TOKEN_A, [pricingPool({ token0: BASE_USDC, token1: TOKEN_A, priceToken1PerToken0: 0.5 })], NOW);
  assert.equal(price.tier, "A");
  assert.equal(price.value, 2);
});

test("TOKEN/WETH plus WETH/USDC conversion is Tier B", () => {
  const pools = [
    pricingPool({ poolKey: `${POOL_A}:1`, token0: TOKEN_A, token1: BASE_WETH, priceToken1PerToken0: 0.0005 }),
    pricingPool({ poolKey: `${POOL_A}:2`, token0: BASE_WETH, token1: BASE_USDC, priceToken1PerToken0: 3_000 })
  ];
  const price = calculateCanonicalUsdcPrice(TOKEN_A, pools, NOW);
  assert.equal(price.tier, "B");
  assert.equal(price.value, 1.5);
});

test("verified non-WETH conversion is Tier C", () => {
  const pools = [
    pricingPool({ poolKey: `${POOL_A}:1`, token0: TOKEN_A, token1: TOKEN_B, priceToken1PerToken0: 2 }),
    pricingPool({ poolKey: `${POOL_A}:2`, token0: TOKEN_B, token1: BASE_USDC, priceToken1PerToken0: 4 })
  ];
  const price = calculateCanonicalUsdcPrice(TOKEN_A, pools, NOW);
  assert.equal(price.tier, "C");
  assert.equal(price.value, 8);
});

test("cyclic graph without USDC remains UNPRICED", () => {
  const price = calculateCanonicalUsdcPrice(TOKEN_A, [pricingPool({ token0: TOKEN_A, token1: TOKEN_B, priceToken1PerToken0: 2 })], NOW);
  assert.equal(price.tier, "UNPRICED");
  assert.equal(price.reasonCode, "no_bounded_usdc_path");
});

test("dust liquidity cannot establish a canonical price", () => {
  const price = calculateCanonicalUsdcPrice(TOKEN_A, [pricingPool({ token0: TOKEN_A, token1: BASE_USDC, liquidityUsd: 999 })], NOW);
  assert.equal(price.tier, "UNPRICED");
  assert.equal(price.reasonCode, "dust_liquidity");
});

test("stale WETH anchor cannot establish a Tier B price", () => {
  const stale = new Date(NOW.getTime() - 10 * 60_000).toISOString();
  const price = calculateCanonicalUsdcPrice(TOKEN_A, [
    pricingPool({ poolKey: `${POOL_A}:1`, token0: TOKEN_A, token1: BASE_WETH, priceToken1PerToken0: 0.001 }),
    pricingPool({ poolKey: `${POOL_A}:2`, token0: BASE_WETH, token1: BASE_USDC, priceToken1PerToken0: 3_000, observedAt: stale })
  ], NOW);
  assert.equal(price.tier, "UNPRICED");
  assert.equal(price.reasonCode, "stale_anchor");
});

test("future timestamp is rejected", () => {
  const future = new Date(NOW.getTime() + 60_000).toISOString();
  const price = calculateCanonicalUsdcPrice(TOKEN_A, [pricingPool({ token0: TOKEN_A, token1: BASE_USDC, observedAt: future })], NOW);
  assert.equal(price.reasonCode, "future_timestamp");
});

test("non-finite price is rejected without coercing to zero", () => {
  const price = calculateCanonicalUsdcPrice(TOKEN_A, [pricingPool({ token0: TOKEN_A, token1: BASE_USDC, priceToken1PerToken0: Number.POSITIVE_INFINITY })], NOW);
  assert.equal(price.tier, "UNPRICED");
  assert.equal(price.value, undefined);
});

test("malformed metadata and invalid decimals degrade to partial without throwing", async () => {
  const rpc = {
    getCode: async () => "0x01",
    batch: async () => ["0xdeadbeef", "0x00", wordNumber(255)]
  };
  const metadata = await enrichTokenMetadata(rpc, TOKEN_A, 50_000_000, NOW);
  assert.equal(metadata.status, "partial");
  assert.equal(metadata.decimals, undefined);
  assert.equal(metadata.codeExists, true);
});

test("excessive ABI text length is rejected", () => {
  const dynamic = `0x${wordNumber(32).slice(2)}${wordNumber(257).slice(2)}${"00".repeat(257)}`;
  assert.equal(decodeAbiText(dynamic), undefined);
});

test("twenty pools for one token produce one contract-first opportunity", () => {
  const pools = Array.from({ length: 20 }, (_, index) => pricingPool({ poolKey: `${POOL_A}:${index}`, token0: TOKEN_A, token1: index % 2 ? BASE_WETH : BASE_USDC }));
  const opportunities = buildCanonicalOpportunities(pools, {}, [], NOW);
  const token = opportunities.find((item) => item.tokenAddress === TOKEN_A);
  assert.equal(token.poolCount, 20);
  assert.equal(opportunities.filter((item) => item.tokenAddress === TOKEN_A).length, 1);
});

test("same symbol on different contracts remains two opportunities", () => {
  const metadata = {
    [TOKEN_A]: { symbol: "SAME", name: "Same", status: "complete" },
    [TOKEN_B]: { symbol: "SAME", name: "Same", status: "complete" }
  };
  const opportunities = buildCanonicalOpportunities([
    pricingPool({ poolKey: `${POOL_A}:1`, token0: TOKEN_A, token1: BASE_USDC }),
    pricingPool({ poolKey: `${POOL_A}:2`, token0: TOKEN_B, token1: BASE_USDC })
  ], metadata, [], NOW);
  assert.equal(opportunities.filter((item) => item.symbol === "SAME").length, 2);
});

test("same pool from two provider observations counts once", () => {
  const opportunities = buildCanonicalOpportunities([
    pricingPool({ poolKey: POOL_A, providers: ["onchain"] }),
    pricingPool({ poolKey: POOL_A, providers: ["dexscreener"] })
  ], {}, [], NOW);
  assert.equal(opportunities.find((item) => item.tokenAddress === TOKEN_A).poolCount, 1);
});

test("incomplete aggregate remains undefined rather than substituting zero", () => {
  const complete = pricingPool({ poolKey: `${POOL_A}:1`, liquidityUsd: 10_000 });
  const incomplete = pricingPool({ poolKey: `${POOL_A}:2`, liquidityUsd: undefined });
  const opportunity = buildCanonicalOpportunities([complete, incomplete], {}, [], NOW).find((item) => item.tokenAddress === TOKEN_A);
  assert.equal(opportunity.aggregate.liquidityUsd, undefined);
});

test("unpriced confirmed token remains visible", () => {
  const pool = pricingPool({ priceToken1PerToken0: undefined, liquidityUsd: undefined });
  const opportunity = buildCanonicalOpportunities([pool], {}, [], NOW).find((item) => item.tokenAddress === TOKEN_A);
  assert.equal(opportunity.lifecycle, "unpriced");
  assert.equal(opportunity.canonicalPrice.tier, "UNPRICED");
});

test("primary selection hysteresis retains a near-equal incumbent", () => {
  const incumbent = pricingPool({ poolKey: `${POOL_A}:old`, liquidityUsd: 100_000 });
  const challenger = pricingPool({ poolKey: `${POOL_A}:new`, liquidityUsd: 110_000 });
  const selection = selectPrimaryPool([incumbent, challenger], incumbent.poolKey, NOW);
  assert.equal(selection.pool.poolKey, incumbent.poolKey);
  assert.equal(selection.reason.code, "hysteresis_retained");
});

test("primary selection replaces an orphaned incumbent", () => {
  const incumbent = pricingPool({ poolKey: `${POOL_A}:old`, orphaned: true, status: "orphaned" });
  const challenger = pricingPool({ poolKey: `${POOL_A}:new` });
  const selection = selectPrimaryPool([incumbent, challenger], incumbent.poolKey, NOW);
  assert.equal(selection.pool.poolKey, challenger.poolKey);
  assert.equal(selection.reason.code, "previous_invalid");
});

test("replay event produces evidence state but no live relay event", () => {
  const state = applyCanonicalEvents(initialState(NOW), [{ ...canonicalEvent(), replay: true }], { now: NOW, replay: true });
  assert.equal(state.pools[POOL_A].replay, true);
  assert.equal(state.eventRing.length, 0);
});

test("canonical market price has provenance but no executable transaction fields", () => {
  const price = calculateCanonicalUsdcPrice(TOKEN_A, [pricingPool()], NOW);
  assert.equal(price.kind, "direct");
  assert.deepEqual(Object.keys(price).filter((key) => /calldata|transaction|approval/i.test(key)), []);
});

test("Trade Dock defaults to exact USDC, offers WETH and targets exact focus contract", async () => {
  const source = await readFile(path.resolve("src/components/base-terminal/TradeDock.tsx"), "utf8");
  assert.match(source, /useState<SpendTokenKey>\("USDC"\)/);
  assert.match(source, /<option value="WETH">WETH<\/option>/);
  assert.match(source, /pair\.focusTokenAddress \?\? pair\.baseTokenAddress/);
  assert.match(source, /0x833589fcd6edb6e08f4c7c32d4f71b54bda02913/);
  assert.match(source, /0x4200000000000000000000000000000000000006/);
});

test("new on-chain Inspector labels retain explicit TR/EN parity", async () => {
  const source = await readFile(path.resolve("src/i18n/dictionaries.ts"), "utf8");
  for (const key of ["canonicalPrice", "pricingTier", "pricePath", "primaryPool", "metadataState", "tradeabilityState", "rawQuote"]) {
    assert.equal(source.match(new RegExp(`"terminalV3\\.${key}"`, "g"))?.length, 2);
  }
});

test("durable store enforces one writer, integrity and reopen", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "base-terminal-store-"));
  const first = new DurableDiscoveryStore(directory);
  const second = new DurableDiscoveryStore(directory);
  const third = new DurableDiscoveryStore(directory);
  try {
    await first.open();
    await assert.rejects(second.open(), /active owner/);
    await assert.rejects(third.open(), /active owner/);
    await first.transact("test", (draft) => { draft.health.ready = true; });
    assert.equal(first.integrityCheck().ok, true);
    await first.close();
    const reopened = new DurableDiscoveryStore(directory);
    const state = await reopened.open();
    assert.equal(state.health.ready, true);
    assert.equal(reopened.integrityCheck().ok, true);
    await reopened.close();
  } finally {
    await first.close();
    await second.close();
    await third.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("durable store rejects a tampered snapshot", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "base-terminal-store-corrupt-"));
  const store = new DurableDiscoveryStore(directory);
  try {
    await store.open();
    await store.close();
    const file = path.join(directory, "state.json");
    const state = JSON.parse(await readFile(file, "utf8"));
    state.currentHead = 123;
    await writeFile(file, JSON.stringify(state), "utf8");
    await assert.rejects(new DurableDiscoveryStore(directory).open(), /integrity digest mismatch/i);
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

function pricingPool(overrides = {}) {
  return {
    poolKey: POOL_A,
    token0: TOKEN_A,
    token1: BASE_USDC,
    status: "confirmed",
    verifiedSource: true,
    orphaned: false,
    observedAt: NOW.toISOString(),
    confirmedAt: NOW.toISOString(),
    blockNumber: 50_000_000,
    priceToken1PerToken0: 1,
    liquidityUsd: 100_000,
    volume24hUsd: 20_000,
    trades24h: 100,
    providers: ["onchain"],
    ...overrides
  };
}

function canonicalEvent(overrides = {}) {
  return {
    idempotencyKey: `${HASH_A}:${HASH_B}:7`,
    chainId: 8453,
    factoryId: "uniswap-v2",
    factoryAddress: FACTORY_REGISTRY.find((entry) => entry.id === "uniswap-v2").address,
    dexId: "uniswap",
    protocolVersion: "v2",
    poolType: "constant-product",
    poolKey: POOL_A,
    poolAddress: POOL_A,
    token0: TOKEN_A,
    token1: BASE_USDC,
    blockNumber: 50_000_000,
    blockHash: HASH_A,
    transactionHash: HASH_B,
    logIndex: 7,
    provisional: false,
    removed: false,
    replay: false,
    source: "onchain",
    ...overrides
  };
}

function logFor(binding, indexedTopics, dataWords) {
  return {
    address: binding.address,
    topics: [binding.eventTopic, ...indexedTopics],
    data: `0x${dataWords}`,
    blockNumber: "0x2faf080",
    blockHash: HASH_A,
    transactionHash: HASH_B,
    logIndex: "0x7"
  };
}

function wordAddress(address) {
  return `0x${address.slice(2).padStart(64, "0")}`;
}

function wordNumber(value) {
  return `0x${value.toString(16).padStart(64, "0")}`;
}
