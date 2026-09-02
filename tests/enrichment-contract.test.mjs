import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { BASE_USDC, BASE_WETH, FACTORY_REGISTRY } from "../collector/factory-registry.mjs";
import { calculateCanonicalUsdcPrice } from "../collector/model.mjs";
import {
  ProviderEnrichmentClient,
  coalesceEnrichmentQueue,
  joinExactProviderPools,
  nextRetryAt,
  parseDexScreenerPayload,
  resolveWethUsdcAnchor,
  selectAnchorValidationCandidates,
  stabilizeWethUsdcAnchorRefresh
} from "../collector/provider-enrichment.mjs";
import { readSupportedPoolState } from "../collector/rpc.mjs";
import { OnchainDiscoveryCollector, trustedAnchorPoolIdentity } from "../collector/service.mjs";
import { DurableDiscoveryStore, initialState } from "../collector/store.mjs";

const NOW = new Date("2026-09-01T12:00:00.000Z");
const TOKEN = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const POOL = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

test("exact pool-address provider join is case-insensitive", () => {
  const [observation] = parseDexScreenerPayload({ pairs: [dexRow({ pairAddress: POOL.toUpperCase().replace("0X", "0x") })] }, NOW.toISOString());
  const joined = joinExactProviderPools(poolRecord(), [observation], { now: NOW });
  assert.equal(joined.status, "matched");
  assert.equal(joined.poolAddress, POOL);
});

test("direct and inverted provider orientation remain one exact pool", () => {
  const direct = providerObservation({ baseTokenAddress: TOKEN, quoteTokenAddress: BASE_WETH, priceNative: 0.5, provider: "dexscreener" });
  const inverted = providerObservation({ baseTokenAddress: BASE_WETH, quoteTokenAddress: TOKEN, priceNative: 2, provider: "geckoterminal" });
  const joined = joinExactProviderPools(poolRecord(), [direct, inverted], { now: NOW });
  assert.equal(joined.status, "matched");
  assert.equal(joined.providerSnapshots.length, 2);
  assert.equal(joined.priceToken1PerToken0, 0.5);
  assert.deepEqual(joined.providers, ["dexscreener", "geckoterminal"]);
});

test("two providers for one pool do not double liquidity or volume", () => {
  const joined = joinExactProviderPools(poolRecord(), [
    providerObservation({ provider: "dexscreener", liquidityUsd: 10_000, volumes: { h24: 2_000 } }),
    providerObservation({ provider: "geckoterminal", liquidityUsd: 12_000, volumes: { h24: 3_000 } })
  ], { now: NOW });
  assert.equal(joined.liquidityUsd, 12_000);
  assert.equal(joined.volume24hUsd, 3_000);
  assert.notEqual(joined.liquidityUsd, 22_000);
});

test("provider token conflict is RED and non-retryable", () => {
  const joined = joinExactProviderPools(poolRecord(), [providerObservation({ baseTokenAddress: OTHER, quoteTokenAddress: BASE_WETH })], { now: NOW });
  assert.equal(joined.status, "conflicting");
  assert.equal(joined.reasonCode, "token_identity_conflict");
  assert.equal(joined.retryable, false);
});

test("malformed provider address is rejected before join", () => {
  assert.deepEqual(parseDexScreenerPayload({ pairs: [dexRow({ pairAddress: "not-an-address" })] }, NOW.toISOString()), []);
});

test("provider field windows remain distinct", () => {
  const [observation] = parseDexScreenerPayload({ pairs: [dexRow({ volume: { m5: 5, h1: 60, h24: 1440 }, txns: { m5: { buys: 1, sells: 2 }, h24: { buys: 10, sells: 20 } } })] }, NOW.toISOString());
  const joined = joinExactProviderPools(poolRecord(), [observation], { now: NOW });
  assert.deepEqual(joined.volumes, { m5: 5, h1: 60, h24: 1440 });
  assert.equal(joined.transactions.m5.buys, 1);
  assert.equal(joined.transactions.h24.sells, 20);
});

test("trusted WETH/USDC anchor uses bounded liquidity consensus", () => {
  const anchor = resolveWethUsdcAnchor([
    anchorCandidate({ poolAddress: POOL, priceToken1PerToken0: 2_000, liquidityUsd: 1_000_000 }),
    anchorCandidate({ poolAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", priceToken1PerToken0: 2_010, liquidityUsd: 4_000_000 }),
    anchorCandidate({ poolAddress: "0xcccccccccccccccccccccccccccccccccccccccc", priceToken1PerToken0: 9_000, liquidityUsd: 999_000_000 })
  ], NOW);
  assert.equal(anchor.status, "ready");
  assert.equal(anchor.sourcePoolCount, 2);
  assert.ok(anchor.value > 2_000 && anchor.value < 2_010);
  assert.ok(!anchor.consensusPools.includes("0xcccccccccccccccccccccccccccccccccccccccc"));
});

test("divergent two-pool anchor is degraded/conflicting", () => {
  const anchor = resolveWethUsdcAnchor([
    anchorCandidate({ poolAddress: POOL, priceToken1PerToken0: 2_000 }),
    anchorCandidate({ poolAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", priceToken1PerToken0: 3_000 })
  ], NOW);
  assert.equal(anchor.status, "degraded");
  assert.equal(anchor.reasonCode, "anchor_price_conflict");
});

test("stale and dust anchors never become ready", () => {
  const stale = resolveWethUsdcAnchor([anchorCandidate({ observedAt: new Date(NOW.getTime() - 10 * 60_000).toISOString() })], NOW);
  const dust = resolveWethUsdcAnchor([anchorCandidate({ liquidityUsd: 999 })], NOW);
  assert.equal(stale.status, "unavailable");
  assert.equal(stale.reasonCode, "stale_anchor");
  assert.equal(dust.reasonCode, "dust_anchor_liquidity");
});

test("an empty refresh retains a still-fresh anchor and retries quickly", () => {
  const current = resolveWethUsdcAnchor([anchorCandidate({ observedAt: new Date(NOW.getTime() - 60_000).toISOString() })], NOW);
  const empty = resolveWethUsdcAnchor([], NOW);
  const retained = stabilizeWethUsdcAnchorRefresh(current, empty, NOW);
  assert.equal(retained.status, "ready");
  assert.equal(retained.value, current.value);
  assert.equal(retained.refreshStatus, "retained_last_fresh");
  assert.equal(retained.lastRefreshReasonCode, "no_verified_anchor_candidate");
  assert.equal(retained.nextRefreshAt, new Date(NOW.getTime() + 10_000).toISOString());

  const staleCurrent = { ...current, observedAt: new Date(NOW.getTime() - 121_000).toISOString() };
  const unavailable = stabilizeWethUsdcAnchorRefresh(staleCurrent, empty, NOW);
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.lastTrustedCandidates.length, 1);
});

test("a previously verified anchor pool reuses only its immutable exact identity", () => {
  const current = resolveWethUsdcAnchor([anchorCandidate()], NOW);
  const exact = trustedAnchorPoolIdentity(current, POOL);
  assert.deepEqual(exact, {
    poolKey: POOL,
    poolAddress: POOL,
    token0: BASE_WETH,
    token1: BASE_USDC,
    factoryId: "uniswap-v3",
    factoryAddress: FACTORY_REGISTRY.find((entry) => entry.id === "uniswap-v3").address,
    protocolVersion: "v3"
  });
  assert.equal(trustedAnchorPoolIdentity(current, OTHER), undefined);
  assert.equal(trustedAnchorPoolIdentity({ ...current, candidates: [{ ...current.candidates[0], registeredFactory: false }] }, POOL), undefined);
});

test("anchor validation uses lookup completion time after a slow RPC inspection", () => {
  const startedAt = new Date("2026-09-01T12:00:00.000Z");
  const observedAt = new Date(startedAt.getTime() + 6_000).toISOString();
  const completedAt = new Date(startedAt.getTime() + 20_000);
  const candidate = anchorCandidate({
    poolAddress: "0x0000000000000000000000000000000000000111",
    priceToken1PerToken0: 2_400,
    liquidityUsd: 2_000_000,
    observedAt
  });
  assert.equal(resolveWethUsdcAnchor([candidate], startedAt).status, "unavailable");
  assert.equal(resolveWethUsdcAnchor([candidate], completedAt).status, "ready");
});

test("anchor validation is bounded to the three highest-liquidity exact pools", () => {
  const candidates = selectAnchorValidationCandidates([
    anchorCandidate({ poolAddress: "0x0000000000000000000000000000000000000001", liquidityUsd: 10 }),
    anchorCandidate({ poolAddress: "0x0000000000000000000000000000000000000002", liquidityUsd: 40 }),
    anchorCandidate({ poolAddress: "0x0000000000000000000000000000000000000003", liquidityUsd: 30 }),
    anchorCandidate({ poolAddress: "0x0000000000000000000000000000000000000004", liquidityUsd: 20 }),
    anchorCandidate({ poolAddress: "0x0000000000000000000000000000000000000002", liquidityUsd: 999 })
  ]);
  assert.deepEqual(candidates.map((candidate) => candidate.poolAddress), [
    "0x0000000000000000000000000000000000000002",
    "0x0000000000000000000000000000000000000003",
    "0x0000000000000000000000000000000000000004"
  ]);
});

test("trusted anchor refresh has a dedicated loop independent of pool enrichment batches", async () => {
  let refreshes = 0;
  const subject = {
    running: true,
    refreshAnchorIfDue: async () => {
      refreshes += 1;
      subject.running = false;
    }
  };
  await OnchainDiscoveryCollector.prototype.runAnchorLoop.call(subject, new AbortController().signal);
  assert.equal(refreshes, 1);
});

test("trusted anchor loop survives an unexpected refresh rejection", async () => {
  let refreshes = 0;
  const subject = {
    running: true,
    config: { anchorCycleTimeoutMs: 50, anchorLoopIntervalMs: 1 },
    provider: { circuitSnapshot: () => ({}) },
    store: { transact: async (_reason, mutator) => { await mutator({ health: {}, priceAnchors: { wethUsdc: {} }, counters: { enrichmentFailure: 0 }, pools: {}, opportunities: [], enrichmentQueue: [] }); } },
    refreshAnchorIfDue: async () => {
      refreshes += 1;
      if (refreshes === 1) throw new Error("transient store failure");
      subject.running = false;
    }
  };
  await OnchainDiscoveryCollector.prototype.runAnchorLoop.call(subject, new AbortController().signal);
  assert.equal(refreshes, 2);
});

test("trusted anchor loop aborts a stuck refresh and advances to the next cycle", async () => {
  let refreshes = 0;
  let aborted = false;
  const subject = {
    running: true,
    config: { anchorCycleTimeoutMs: 5, anchorLoopIntervalMs: 1 },
    provider: { circuitSnapshot: () => ({}) },
    store: { transact: async (_reason, mutator) => { await mutator({ health: {}, priceAnchors: { wethUsdc: {} }, counters: { enrichmentFailure: 0 }, pools: {}, opportunities: [], enrichmentQueue: [] }); } },
    refreshAnchorIfDue: async (_now, signal) => {
      refreshes += 1;
      if (refreshes > 1) {
        subject.running = false;
        return;
      }
      signal.addEventListener("abort", () => {
        aborted = true;
      }, { once: true });
      await new Promise(() => {});
    }
  };
  await OnchainDiscoveryCollector.prototype.runAnchorLoop.call(subject, new AbortController().signal);
  assert.equal(aborted, true);
  assert.equal(refreshes, 2);
});

test("trusted anchor provider lookup receives the cycle abort signal", async () => {
  const controller = new AbortController();
  controller.abort();
  let requestSignal;
  const client = new ProviderEnrichmentClient({
    retries: 0,
    fetchImpl: async (_url, options) => {
      requestSignal = options.signal;
      throw new DOMException("aborted", "AbortError");
    }
  });
  await assert.rejects(client.lookupWethPools({ signal: controller.signal }));
  assert.equal(requestSignal.aborted, true);
});

test("trusted anchor refresh uses only bounded exact pair endpoints", async () => {
  const urls = [];
  const client = new ProviderEnrichmentClient({
    retries: 0,
    delayImpl: async () => {},
    fetchImpl: async (url) => {
      urls.push(url);
      return response(200, { pairs: [] });
    }
  });
  await client.lookupWethPools({ poolAddresses: [POOL, OTHER, POOL] });
  assert.deepEqual(urls.sort(), [
    `https://api.dexscreener.com/latest/dex/pairs/base/${OTHER}`,
    `https://api.dexscreener.com/latest/dex/pairs/base/${POOL}`
  ]);
  assert.equal(urls.some((url) => url.includes("/token-pairs/")), false);
});

test("trusted immutable anchor identity refreshes without repeating RPC validation", async () => {
  const now = new Date();
  const observedAt = now.toISOString();
  let state = initialState(now);
  state.currentHead = 1;
  state.tokenMetadata = { [BASE_WETH]: { decimals: 18 }, [BASE_USDC]: { decimals: 6 } };
  state.priceAnchors.wethUsdc = resolveWethUsdcAnchor([anchorCandidate({ observedAt })], now);
  let rpcCalls = 0;
  const subject = {
    anchorProvider: {
      lookupWethPools: async ({ poolAddresses }) => {
        assert.deepEqual(poolAddresses, [POOL]);
        return [providerObservation({
          poolAddress: POOL,
          baseTokenAddress: BASE_WETH,
          quoteTokenAddress: BASE_USDC,
          priceNative: 2_400,
          priceUsd: 2_400,
          liquidityUsd: 100_000,
          observedAt,
          receivedAt: observedAt
        })];
      }
    },
    anchorRpc: new Proxy({}, { get: () => () => { rpcCalls += 1; throw new Error("trusted refresh must not use RPC"); } }),
    provider: { circuitSnapshot: () => ({}) },
    store: {
      read: () => structuredClone(state),
      transact: async (_reason, mutator) => {
        const draft = structuredClone(state);
        await mutator(draft);
        state = draft;
        return structuredClone(state);
      }
    },
    publishSemanticDeltas: async (_before, after) => after
  };
  await OnchainDiscoveryCollector.prototype.refreshAnchorIfDue.call(subject, now);
  assert.equal(rpcCalls, 0);
  assert.equal(state.priceAnchors.wethUsdc.status, "ready");
  assert.equal(state.priceAnchors.wethUsdc.observedAt, observedAt);
});

test("trusted anchor owns isolated provider and bounded RPC clients", () => {
  const providerClient = { circuitSnapshot: () => ({}) };
  const anchorProviderClient = { lookupWethPools: async () => [] };
  const anchorRpcClient = { blockNumber: async () => 1 };
  const collector = new OnchainDiscoveryCollector({
    httpUrl: "https://mainnet.base.org",
    storeDirectory: path.join(tmpdir(), "anchor-client-contract"),
    providerTimeoutMs: 8_000,
    providerClient,
    anchorProviderClient,
    anchorRpcClient
  });
  assert.equal(collector.provider, providerClient);
  assert.equal(collector.anchorProvider, anchorProviderClient);
  assert.equal(collector.anchorRpc, anchorRpcClient);
  assert.notEqual(collector.anchorProvider, collector.provider);
});

test("enrichment queue deduplicates by normalized pool key and priority", () => {
  const queue = coalesceEnrichmentQueue([{ poolKey: POOL.toUpperCase().replace("0X", "0x"), priority: 10 }], [{ poolKey: POOL, priority: 90 }]);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].priority, 90);
  assert.equal(queue[0].poolKey, POOL);
});

test("bounded provider timeout/retry performs at most two attempts", async () => {
  let calls = 0;
  const client = new ProviderEnrichmentClient({ retries: 1, delayImpl: async () => {}, fetchImpl: async () => { calls += 1; return calls === 1 ? response(503, {}) : response(200, { pairs: [] }); } });
  await client.request("dexscreener", "https://api.dexscreener.com/test");
  assert.equal(calls, 2);
});

test("non-retryable provider failure is attempted once", async () => {
  let calls = 0;
  const client = new ProviderEnrichmentClient({ retries: 3, delayImpl: async () => {}, fetchImpl: async () => { calls += 1; return response(400, {}); } });
  await assert.rejects(client.request("dexscreener", "https://api.dexscreener.com/test"), (error) => error.retryable === false);
  assert.equal(calls, 1);
});

test("retry backoff is deterministic and bounded", () => {
  assert.equal(nextRetryAt(1, NOW), new Date(NOW.getTime() + 2_000).toISOString());
  assert.equal(nextRetryAt(99, NOW), new Date(NOW.getTime() + 5 * 60_000).toISOString());
});

test("V2 reserve reader is decimals-aware and preserves rational precision", async () => {
  const rpc = { call: async () => `0x${word(10n ** 18n)}${word(2n * 10n ** 6n)}${word(1n)}` };
  const state = await readSupportedPoolState(rpc, { ...poolRecord(), factoryId: "uniswap-v2" }, { [TOKEN]: { decimals: 18 }, [BASE_WETH]: { decimals: 6 } });
  assert.equal(state.status, "complete");
  assert.equal(state.priceToken1PerToken0, 2);
  assert.equal(typeof state.rawPriceRatio.numerator, "string");
});

test("V3 in-range liquidity is never labeled USD", async () => {
  const rpc = { batch: async () => [`0x${word(2n ** 96n)}${word(0n)}`, `0x${word(123456n)}`] };
  const state = await readSupportedPoolState(rpc, { ...poolRecord(), factoryId: "uniswap-v3" }, { [TOKEN]: { decimals: 18 }, [BASE_WETH]: { decimals: 18 } });
  assert.equal(state.priceToken1PerToken0, 1);
  assert.equal(state.inRangeLiquidityRaw, "123456");
  assert.equal(state.liquidityUsd, undefined);
});

test("invalid decimals reject on-chain spot without retry", async () => {
  const state = await readSupportedPoolState({}, { ...poolRecord(), factoryId: "uniswap-v2" }, { [TOKEN]: { decimals: 256 }, [BASE_WETH]: { decimals: 18 } });
  assert.equal(state.status, "rejected");
  assert.equal(state.reasonCode, "invalid_decimals");
  assert.equal(state.retryable, false);
});

test("outlier direct pool cannot capture canonical price", () => {
  const pools = [
    pricingPool({ poolKey: POOL, priceToken1PerToken0: 1, liquidityUsd: 100_000 }),
    pricingPool({ poolKey: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", priceToken1PerToken0: 1.02, liquidityUsd: 200_000 }),
    pricingPool({ poolKey: "0xcccccccccccccccccccccccccccccccccccccccc", priceToken1PerToken0: 100, liquidityUsd: 999_000_000 })
  ];
  const price = calculateCanonicalUsdcPrice(TOKEN, pools, NOW);
  assert.equal(price.tier, "A");
  assert.ok(price.value > 1 && price.value < 1.02);
  assert.ok(!price.sourcePoolKeys.includes("0xcccccccccccccccccccccccccccccccccccccccc"));
});

test("canonical rounding is deterministic while raw value remains stored", () => {
  const first = calculateCanonicalUsdcPrice(TOKEN, [pricingPool({ priceToken1PerToken0: 1 / 3 })], NOW);
  const second = calculateCanonicalUsdcPrice(TOKEN, [pricingPool({ priceToken1PerToken0: 1 / 3 })], NOW);
  assert.equal(first.rawValue, second.rawValue);
  assert.equal(first.value, second.value);
});

test("enrichment queue survives durable store restart", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "base-enrichment-restart-"));
  const first = new DurableDiscoveryStore(directory);
  try {
    await first.open();
    await first.transact("queue", (draft) => { draft.enrichmentQueue = [{ poolKey: POOL, poolAddress: POOL, attempts: 2, nextAttemptAt: NOW.toISOString() }]; });
    await first.close();
    const second = new DurableDiscoveryStore(directory);
    const state = await second.open();
    assert.equal(state.enrichmentQueue[0].attempts, 2);
    await second.close();
  } finally {
    await first.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("opportunity_priced semantic SSE delta is emitted once", async () => {
  const before = initialState(NOW);
  const after = structuredClone(before);
  before.opportunities = [opportunity("UNPRICED", false)];
  after.opportunities = [opportunity("B", true)];
  const relay = structuredClone(after);
  const fakeStore = { transact: async (_reason, mutator) => { await mutator(relay); return relay; } };
  await OnchainDiscoveryCollector.prototype.publishSemanticDeltas.call({ store: fakeStore }, before, after, []);
  await OnchainDiscoveryCollector.prototype.publishSemanticDeltas.call({ store: fakeStore }, after, after, []);
  assert.equal(relay.eventRing.filter((event) => event.type === "opportunity_priced").length, 1);
});

test("ranking source requires comparable snapshots and priced opportunities in source", async () => {
  const source = await readFile(path.resolve("src/lib/base-terminal/terminalMarket.ts"), "utf8");
  assert.match(source, /comparison\.status === "ready"/);
  assert.match(source, /canonicalPrice\.tier !== "UNPRICED"/);
});

test("pricing-path labels retain exact TR/EN parity", async () => {
  const source = await readFile(path.resolve("src/i18n/dictionaries.ts"), "utf8");
  for (const key of ["pricingPending", "anchor", "anchorSources", "observedAt", "pricingReason", "rawPair"]) assert.equal(source.match(new RegExp(`"terminalV3\\.${key}"`, "g"))?.length, 2);
});

function dexRow(overrides = {}) { return { chainId: "base", dexId: "uniswap", pairAddress: POOL, baseToken: { address: TOKEN, symbol: "TOKEN" }, quoteToken: { address: BASE_WETH, symbol: "WETH" }, priceNative: "0.5", priceUsd: "1000", liquidity: { usd: 10_000 }, volume: { h24: 2_000 }, txns: { h24: { buys: 4, sells: 6 } }, ...overrides }; }
function providerObservation(overrides = {}) { return { provider: "dexscreener", chainId: 8453, poolAddress: POOL, baseTokenAddress: TOKEN, quoteTokenAddress: BASE_WETH, priceNative: 0.5, priceUsd: 1000, liquidityUsd: 10_000, volumes: { h24: 2_000 }, transactions: { h24: { buys: 4, sells: 6 } }, observedAt: NOW.toISOString(), receivedAt: NOW.toISOString(), fieldProvenance: {}, ...overrides }; }
function poolRecord() { return { poolKey: POOL, poolAddress: POOL, token0: TOKEN, token1: BASE_WETH, status: "confirmed", verifiedSource: true }; }
function pricingPool(overrides = {}) { return { ...poolRecord(), token1: BASE_USDC, orphaned: false, observedAt: NOW.toISOString(), confirmedAt: NOW.toISOString(), blockNumber: 50_000_000, priceToken1PerToken0: 1, liquidityUsd: 100_000, providers: ["onchain"], ...overrides }; }
function anchorCandidate(overrides = {}) { return { poolAddress: POOL, token0: BASE_WETH, token1: BASE_USDC, registeredFactory: true, decimalsVerified: true, priceToken1PerToken0: 2_000, liquidityUsd: 100_000, observedAt: NOW.toISOString(), providers: ["dexscreener"], factoryId: "uniswap-v3", factoryAddress: FACTORY_REGISTRY.find((entry) => entry.id === "uniswap-v3").address, protocolVersion: "v3", ...overrides }; }
function response(status, payload) { return { ok: status >= 200 && status < 300, status, json: async () => payload }; }
function word(value) { return value.toString(16).padStart(64, "0"); }
function opportunity(tier, ranked) { return { id: `8453:token:${TOKEN}`, canonicalPrice: { tier, sourcePoolKeys: [], reasonCode: tier === "UNPRICED" ? "pending" : "weth_usdc_anchor", value: tier === "UNPRICED" ? undefined : 1 }, aggregate: { contributingPoolCount: 1 }, lifecycle: ranked ? "active" : "unpriced", ranked }; }
