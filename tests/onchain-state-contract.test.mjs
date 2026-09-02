import test from "node:test";
import assert from "node:assert/strict";
import { BASE_USDC, FACTORY_REGISTRY } from "../collector/factory-registry.mjs";
import { buildCanonicalOpportunities } from "../collector/model.mjs";
import {
  acceptOnchainStateUpdate,
  classifyOnchainLiquidity,
  exactPriceRatio,
  onchainStateFreshness,
  readPoolOnchainState,
  reconcileOnchainProviderValues,
  resolveOnchainPoolEvidence
} from "../collector/onchain-state.mjs";
import { enrichTokenMetadata, JsonRpcClient } from "../collector/rpc.mjs";
import { OnchainDiscoveryCollector, verifyFactoryEvents } from "../collector/service.mjs";
import { initialState } from "../collector/store.mjs";

const NOW = new Date("2026-09-02T12:00:00.000Z");
const TOKEN = "0x1111111111111111111111111111111111111111";
const POOL = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HASH = `0x${"a".repeat(64)}`;

test("V2 reserve ratio is exact across 6/8/18/255 decimals and reciprocal", () => {
  for (const decimals of [6, 8, 18, 255]) {
    const ratio = exactPriceRatio(2n * 10n ** BigInt(decimals), 10n ** BigInt(decimals), decimals, decimals);
    assert.equal(ratio.ok, true);
    assert.equal(ratio.observedPrice0In1, 2);
    assert.equal(ratio.observedPrice1In0, 0.5);
    assert.equal(ratio.observedPrice0In1 * ratio.observedPrice1In0, 1);
  }
});

test("BigInt price math remains finite without Number coercion overflow", () => {
  const ratio = exactPriceRatio(10n ** 250n, 5n * 10n ** 249n, 18, 18);
  assert.equal(ratio.ok, true);
  assert.equal(ratio.observedPrice0In1, 2);
  assert.match(ratio.rawPriceRatio.numerator, /^\d+$/);
});

test("reserve adapter verifies identity and emits direct/inverted state", async () => {
  const pool = poolRecord("uniswap-v2");
  const state = await readPoolOnchainState(fakeRpc({ pool, reserve0: 1_000n * 10n ** 18n, reserve1: 2_000n * 10n ** 6n }), pool, metadata(), block());
  assert.equal(state.status, "complete");
  assert.equal(state.observedPrice0In1, 2);
  assert.equal(state.observedPrice1In0, 0.5);
  assert.equal(state.reserveEvidence.reserve0Raw, (1_000n * 10n ** 18n).toString());
});

test("V3 sqrtPriceX96 yields reciprocal-safe spot and never treats raw liquidity as USD", async () => {
  const pool = poolRecord("uniswap-v3");
  const state = await readPoolOnchainState(fakeRpc({ pool, sqrtPriceX96: 2n ** 96n, liquidity: 123_456n }), pool, { [TOKEN]: verified(18), [BASE_USDC]: verified(18) }, block());
  assert.equal(state.status, "complete");
  assert.equal(state.observedPrice0In1, 1);
  assert.equal(state.observedPrice1In0, 1);
  assert.equal(state.inRangeLiquidityRaw, "123456");
  assert.equal(state.rawLiquiditySemantics, "in_range_not_usd");
  assert.equal(state.liquidityUsd, undefined);
});

test("zero reserves and missing or invalid decimals are reason-coded", async () => {
  const pool = poolRecord("uniswap-v2");
  const zero = await readPoolOnchainState(fakeRpc({ pool, reserve0: 0n, reserve1: 1n }), pool, metadata(), block());
  assert.equal(zero.reasonCode, "zero_liquidity");
  const missing = await readPoolOnchainState(fakeRpc({ pool }), pool, { [TOKEN]: verified(18) }, block());
  assert.equal(missing.reasonCode, "token_metadata_pending");
  const invalid = await readPoolOnchainState(fakeRpc({ pool }), pool, { [TOKEN]: verified(256), [BASE_USDC]: verified(6) }, block());
  assert.equal(invalid.reasonCode, "invalid_decimals");
  assert.equal(invalid.retryable, false);
});

test("revert, timeout, empty and malformed RPC outcomes remain isolated reason codes", async () => {
  const pool = poolRecord("uniswap-v2");
  for (const reasonCode of ["rpc_execution_reverted", "rpc_timeout", "rpc_empty_response", "rpc_malformed_response"]) {
    const rpc = fakeRpc({ pool, failureSelector: "0x0902f1ac", failureReason: reasonCode });
    const state = await readPoolOnchainState(rpc, pool, metadata(), block());
    assert.equal(state.reasonCode, reasonCode);
    assert.equal(state.status, "retryable");
  }
});

test("metadata failures distinguish revert, timeout, empty, malformed ABI and proxy mismatch", async () => {
  const cases = [
    ["rpc_execution_reverted", "decimals_call_reverted"],
    ["rpc_timeout", "decimals_timeout"],
    ["rpc_empty_response", "decimals_empty_response"],
    ["rpc_proxy_mismatch", "proxy_mismatch"]
  ];
  for (const [rpcReason, expected] of cases) {
    const metadata = await enrichTokenMetadata({ getCode: async () => "0x01", batchOutcomes: async () => [{ ok: true, value: "0x" }, { ok: true, value: "0x" }, { ok: false, reasonCode: rpcReason, retryable: true }] }, TOKEN, 50_000_000, NOW);
    assert.equal(metadata.failureReason, expected);
  }
  const malformed = await enrichTokenMetadata({ getCode: async () => "0x01", batchOutcomes: async () => [{ ok: true, value: "0x" }, { ok: true, value: "0x" }, { ok: true, value: "0xdeadbeef" }] }, TOKEN, 50_000_000, NOW);
  assert.equal(malformed.failureReason, "decimals_malformed_abi");
});

test("Aerodrome stable pools reject a simple reserve-ratio spot", async () => {
  const pool = poolRecord("aerodrome-classic");
  const state = await readPoolOnchainState(fakeRpc({ pool, stable: true }), pool, metadata(), block());
  assert.equal(state.status, "unsupported");
  assert.equal(state.reasonCode, "unsupported_stable_price_method");
  assert.equal(state.observedPrice0In1, undefined);
});

test("provider/on-chain agreement and conflict are explicit", () => {
  assert.equal(reconcileOnchainProviderValues(2.01, 2, 0.15, "price").status, "agreement");
  const conflict = reconcileOnchainProviderValues(3, 2, 0.15, "price");
  assert.equal(conflict.status, "conflict");
  assert.equal(conflict.reasonCode, "price_conflict");
});

test("fresh, stale and future state have distinct freshness", () => {
  assert.equal(onchainStateFreshness({ observedAt: NOW.toISOString() }, NOW), "fresh");
  assert.equal(onchainStateFreshness({ observedAt: new Date(NOW.getTime() - 120_001).toISOString() }, NOW), "stale");
  assert.equal(onchainStateFreshness({ observedAt: new Date(NOW.getTime() + 5_001).toISOString() }, NOW), "future");
});

test("duplicate, out-of-order and same-height reorg state are rejected deterministically", () => {
  const previous = { blockNumber: 10, blockHash: HASH, status: "complete", rawPriceRatio: { numerator: "2", denominator: "1" } };
  assert.equal(acceptOnchainStateUpdate(previous, { ...previous }).reasonCode, "duplicate_state_snapshot");
  assert.equal(acceptOnchainStateUpdate(previous, { ...previous, blockNumber: 9 }).reasonCode, "out_of_order_state");
  assert.equal(acceptOnchainStateUpdate(previous, { ...previous, blockHash: `0x${"b".repeat(64)}` }).reasonCode, "state_block_hash_conflict");
  assert.equal(acceptOnchainStateUpdate(previous, { ...previous, blockNumber: 11 }).accepted, true);
});

test("on-chain USDC pool resolves observed price, honest USD liquidity and RANKED transition", () => {
  const state = fixtureState();
  resolveOnchainPoolEvidence(state, NOW);
  const pool = state.pools[POOL];
  assert.equal(pool.priceReconciliation.status, "onchain_only");
  assert.equal(pool.onchainLiquidityUsd, 4_000);
  assert.equal(pool.liquidityResolutionState, "usable_liquidity");
  const opportunity = buildCanonicalOpportunities(Object.values(state.pools), state.tokenMetadata, [], NOW).find((item) => item.tokenAddress === TOKEN);
  assert.equal(opportunity.observedPriceUsd.provider, "onchain");
  assert.equal(opportunity.canonicalPrice.tier, "A");
  assert.equal(opportunity.qualityBand, "EMERGING");
  state.pools[POOL].onchainState.liquidityAmountsRaw = { amount0Raw: (10_000n * 10n ** 18n).toString(), amount1Raw: (20_000n * 10n ** 6n).toString() };
  resolveOnchainPoolEvidence(state, NOW);
  const ranked = buildCanonicalOpportunities(Object.values(state.pools), state.tokenMetadata, [opportunity], NOW).find((item) => item.tokenAddress === TOKEN);
  assert.equal(ranked.qualityBand, "RANKED");
});

test("price conflict and stale evidence deterministically downgrade quality", () => {
  const conflictState = fixtureState();
  conflictState.pools[POOL].providerPriceToken1PerToken0 = 4;
  resolveOnchainPoolEvidence(conflictState, NOW);
  assert.equal(conflictState.pools[POOL].priceToken1PerToken0, undefined);
  const conflict = buildCanonicalOpportunities(Object.values(conflictState.pools), conflictState.tokenMetadata, [], NOW).find((item) => item.tokenAddress === TOKEN);
  assert.equal(conflict.qualityBand, "REJECTED");
  assert.equal(conflict.exclusionReason, "price_conflict");

  const staleState = fixtureState();
  staleState.pools[POOL].onchainState.observedAt = new Date(NOW.getTime() - 120_001).toISOString();
  resolveOnchainPoolEvidence(staleState, NOW);
  assert.equal(staleState.pools[POOL].liquidityResolutionState, "stale_liquidity");
});

test("liquidity classifier preserves unknown, zero, thin and usable", () => {
  assert.equal(classifyOnchainLiquidity(undefined), "liquidity_unknown");
  assert.equal(classifyOnchainLiquidity(0), "zero_liquidity");
  assert.equal(classifyOnchainLiquidity(999), "thin_liquidity");
  assert.equal(classifyOnchainLiquidity(1_000), "usable_liquidity");
});

test("RPC circuit opens on bounded timeout and recovers after cooldown", async () => {
  let nowMs = NOW.getTime();
  let fail = true;
  const client = new JsonRpcClient("https://rpc.invalid", {
    retries: 0,
    circuitFailureThreshold: 1,
    circuitCooldownMs: 1_000,
    now: () => new Date(nowMs),
    delayImpl: async () => {},
    fetchImpl: async (_url, request) => {
      if (fail) { const error = new Error("timeout"); error.name = "TimeoutError"; throw error; }
      const [{ id }] = JSON.parse(request.body);
      return { ok: true, json: async () => [{ jsonrpc: "2.0", id, result: "0x1" }] };
    }
  });
  assert.equal((await client.batchOutcomes([{ method: "eth_blockNumber", params: [] }]))[0].reasonCode, "rpc_timeout");
  assert.equal((await client.batchOutcomes([{ method: "eth_blockNumber", params: [] }]))[0].reasonCode, "rpc_circuit_open");
  nowMs += 1_001;
  fail = false;
  assert.equal((await client.batchOutcomes([{ method: "eth_blockNumber", params: [] }]))[0].ok, true);
  assert.equal(client.circuitSnapshot().state, "closed");
});

test("new semantic SSE transitions emit once and Last-Event-ID identity stays stable", async () => {
  const before = initialState(NOW);
  before.pools[POOL] = poolRecord("uniswap-v2");
  before.opportunities = [{ id: `8453:token:${TOKEN}`, qualityBand: "DETECTED", ranked: false, canonicalPrice: { tier: "UNPRICED", reasonCode: "no_bounded_usdc_path", sourcePoolKeys: [] }, liquidityState: "liquidity_unknown", aggregate: {}, lifecycle: "detected" }];
  const after = structuredClone(before);
  after.pools[POOL].onchainState = fixtureState().pools[POOL].onchainState;
  after.pools[POOL].priceReconciliation = { status: "onchain_only", onchain: 2 };
  after.opportunities = [{ id: `8453:token:${TOKEN}`, qualityBand: "EMERGING", ranked: false, canonicalPrice: { tier: "A", value: 2, reasonCode: "direct_usdc_pool", sourcePoolKeys: [POOL] }, observedPriceUsd: { value: 2, provider: "onchain", poolAddress: POOL, reasonCode: "exact_onchain_observed_price" }, liquidityState: "usable_liquidity", bestLiquidityUsd: 4_000, aggregate: {}, lifecycle: "emerging" }];
  const relay = structuredClone(after);
  const subject = { store: { transact: async (_reason, mutator) => { await mutator(relay); return relay; } } };
  await OnchainDiscoveryCollector.prototype.publishSemanticDeltas.call(subject, before, after, [POOL]);
  await OnchainDiscoveryCollector.prototype.publishSemanticDeltas.call(subject, after, after, [POOL]);
  for (const type of ["pool_onchain_state_observed", "opportunity_observed_price", "opportunity_canonical_price", "opportunity_liquidity_resolved", "opportunity_band_changed"]) assert.equal(relay.eventRing.filter((event) => event.type === type).length, 1, type);
  const ids = relay.eventRing.map((event) => Number(event.id));
  assert.deepEqual(ids, [...ids].sort((left, right) => left - right));
});

test("factory event verification is bounded and reuses block evidence", async () => {
  let active = 0;
  let maximumActive = 0;
  let blockCalls = 0;
  const rpc = {
    async getCode() {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return "0x01";
    },
    async batch() {
      throw new Error("getter surface unavailable");
    },
    async getBlock() {
      blockCalls += 1;
      return { timestamp: "0x64" };
    }
  };
  const factoryAddress = FACTORY_REGISTRY.find((entry) => entry.id === "uniswap-v2").address;
  const events = Array.from({ length: 9 }, (_, index) => ({
    poolKey: `pool-${index}`,
    poolAddress: `0x${String(index + 1).padStart(40, "0")}`,
    factoryAddress,
    token0: TOKEN,
    token1: BASE_USDC,
    blockNumber: 123
  }));

  const verified = await verifyFactoryEvents(rpc, events, 4);

  assert.equal(verified.length, events.length);
  assert.equal(blockCalls, 1);
  assert.ok(maximumActive > 1);
  assert.ok(maximumActive <= 4);
  assert.ok(verified.every((event) => event.blockTimestamp === "1970-01-01T00:01:40.000Z"));
});

test("one bounded scan pass commits all fetched windows atomically", async () => {
  const state = initialState(NOW);
  for (const cursor of Object.values(state.cursors)) cursor.blockNumber = 500;
  let transactions = 0;
  const ranges = [];
  const store = {
    read: () => structuredClone(state),
    transact: async (_reason, mutator) => {
      transactions += 1;
      const next = await mutator(structuredClone(state));
      Object.assign(state, next);
      return structuredClone(state);
    }
  };
  const subject = {
    rpc: {
      blockNumber: async () => 1_000,
      getLogs: async ({ fromBlock, toBlock }) => {
        ranges.push([fromBlock, toBlock]);
        return [];
      }
    },
    store,
    config: { maximumChunksPerPass: 3 },
    drainMetadata: async () => {},
    websocket: undefined
  };

  await OnchainDiscoveryCollector.prototype.scanOnce.call(subject);

  assert.deepEqual(ranges, [[485, 750], [735, 998]]);
  assert.equal(transactions, 1);
  assert.ok(Object.values(state.cursors).every((cursor) => cursor.blockNumber === 998));
  assert.equal(state.health.backfillState, "caught_up");
});

test("factory identity and block evidence use bounded RPC batches", async () => {
  const factoryAddress = FACTORY_REGISTRY.find((entry) => entry.id === "uniswap-v2").address;
  const events = Array.from({ length: 20 }, (_, index) => ({
    poolKey: `batched-pool-${index}`,
    poolAddress: `0x${String(index + 101).padStart(40, "0")}`,
    factoryAddress,
    token0: TOKEN,
    token1: BASE_USDC,
    blockNumber: 200 + index
  }));
  const requestSizes = [];
  const rpc = {
    async batchOutcomes(calls) {
      requestSizes.push(calls.length);
      return calls.map((call) => {
        if (call.method === "eth_getCode") return { ok: true, value: "0x01" };
        if (call.method === "eth_getBlockByNumber") return { ok: true, value: { timestamp: "0x64" } };
        const selector = call.params[0].data;
        const value = selector === "0x0dfe1681" ? addressWord(TOKEN)
          : selector === "0xd21220a7" ? addressWord(BASE_USDC)
            : addressWord(factoryAddress);
        return { ok: true, value: `0x${value}` };
      });
    }
  };

  const verified = await verifyFactoryEvents(rpc, events);

  assert.equal(verified.length, events.length);
  assert.deepEqual(requestSizes, [16, 16, 16, 16, 16, 8, 8, 4]);
  assert.ok(requestSizes.every((size) => size <= 16));
});

function poolRecord(factoryId) {
  const registry = FACTORY_REGISTRY.find((entry) => entry.id === factoryId);
  return { poolKey: POOL, poolAddress: POOL, token0: TOKEN, token1: BASE_USDC, factoryId, factoryAddress: registry.address, status: "confirmed", verifiedSource: true, orphaned: false, observedAt: NOW.toISOString(), confirmedAt: NOW.toISOString(), blockNumber: 50_000_000, providers: ["onchain"] };
}

function metadata() { return { [TOKEN]: verified(18), [BASE_USDC]: verified(6) }; }
function verified(decimals) { return { decimals, verificationState: decimals <= 255 ? "verified" : "quarantined", status: "complete" }; }
function block() { return { number: 50_000_000, hash: HASH, observedAt: NOW.toISOString() }; }
function word(value) { return BigInt(value).toString(16).padStart(64, "0"); }
function addressWord(value) { return value.slice(2).padStart(64, "0"); }

function fakeRpc({ pool, reserve0 = 1_000n * 10n ** 18n, reserve1 = 2_000n * 10n ** 6n, sqrtPriceX96 = 2n ** 96n, liquidity = 1_000n, stable = false, failureSelector, failureReason } = {}) {
  return {
    batchOutcomes: async (calls) => calls.map((call) => {
      const selector = call.params[0].data.slice(0, 10);
      if (selector === failureSelector) return { ok: false, reasonCode: failureReason, retryable: true };
      const value = selector === "0x0dfe1681" ? `0x${addressWord(pool.token0)}`
        : selector === "0xd21220a7" ? `0x${addressWord(pool.token1)}`
          : selector === "0xc45a0155" ? `0x${addressWord(pool.factoryAddress)}`
            : selector === "0x0902f1ac" ? `0x${word(reserve0)}${word(reserve1)}${word(1)}`
              : selector === "0x3850c7bd" ? `0x${word(sqrtPriceX96)}${word(0)}`
                : selector === "0x1a686502" ? `0x${word(liquidity)}`
                  : selector === "0x22be3de1" ? `0x${word(stable ? 1 : 0)}`
                    : selector === "0x70a08231" ? `0x${word(call.params[0].to === pool.token0 ? reserve0 : reserve1)}`
                      : "0x";
      return { ok: true, value };
    })
  };
}

function fixtureState() {
  const pool = poolRecord("uniswap-v2");
  pool.onchainState = {
    status: "complete", adapterFamily: "reserve_pool_state", protocolFamily: "uniswap_v2_compatible", reasonCode: "v2_reserve_spot",
    observedAt: NOW.toISOString(), blockNumber: 50_000_000, blockHash: HASH, decimals0: 18, decimals1: 6,
    observedPrice0In1: 2, observedPrice1In0: 0.5,
    liquidityAmountsRaw: { amount0Raw: (1_000n * 10n ** 18n).toString(), amount1Raw: (2_000n * 10n ** 6n).toString(), sourceMethod: "getReserves" }
  };
  return { pools: { [POOL]: pool }, tokenMetadata: { [TOKEN]: { ...verified(18), name: "Token", symbol: "TOK" }, [BASE_USDC]: { ...verified(6), name: "USD Coin", symbol: "USDC" } }, priceAnchors: {} };
}
