import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { getEventListeners } from "node:events";
import { BASE_USDC, BASE_WETH, FACTORY_REGISTRY } from "../collector/factory-registry.mjs";
import { initialState, DurableDiscoveryStore } from "../collector/store.mjs";
import { OnchainDiscoveryCollector, seedMetadataQueue, verifyFactoryEvents } from "../collector/service.mjs";
import { seedBackfillQueue, recordBackfillOutcome, backfillPriority, BACKFILL_QUEUE_LIMIT, selectBackfillRpcBatch } from "../collector/pool-backfill.mjs";
import { acceptOnchainStateUpdate } from "../collector/onchain-state.mjs";
import { buildCanonicalOpportunities, calculateCanonicalUsdcPrice, decodeFactoryLog, eventsAfterId } from "../collector/model.mjs";

const NOW = new Date("2026-09-03T20:00:00Z");
const TOKEN = `0x${"1".repeat(40)}`, OTHER = `0x${"2".repeat(40)}`, HASH = `0x${"a".repeat(64)}`;
const registry = FACTORY_REGISTRY.find((row) => row.id === "uniswap-v2");
test("one rebuild validates each pool proof once and reuses its source-correct graph", () => {
  let proofReads = 0;
  const rows = Array.from({ length: 64 }, (_, index) => {
    const token = `0x${(index + 1).toString(16).padStart(40, "0")}`;
    return pool(`pool-${index}`, { token0: token, token1: BASE_USDC, liquidityUsd: 10_000, observedAt: NOW.toISOString(), priceToken1PerToken0: index + 1,
      onchainState: { get status() { proofReads++; return "complete"; }, confidence: "exact_onchain_state", token0: token, token1: BASE_USDC, decimals0: 18, decimals1: 6, blockNumber: 100, blockHash: HASH, observedAt: NOW.toISOString(), observedPrice0In1: index + 1 } });
  });
  const result = buildCanonicalOpportunities(rows, {}, [], NOW);
  assert.equal(result.length, 64);
  assert.equal(proofReads, 64, "proof validation must be linear, not repeated once per token");
  for (const opportunity of result) {
    const row = rows.find((item) => item.token0 === opportunity.tokenAddress);
    assert.deepEqual(opportunity.canonicalPrice, calculateCanonicalUsdcPrice(row.token0, rows, NOW));
  }
  const stale = buildCanonicalOpportunities(rows, {}, result, new Date(NOW.getTime() + 10 * 60_000));
  assert(stale.every((row) => row.canonicalPrice.tier === "UNPRICED"), "context cannot survive a later freshness boundary");
});
function pool(key, extra = {}) { return { poolKey: key, poolAddress: `0x${"3".repeat(40)}`, token0: TOKEN, token1: OTHER, status: "confirmed", verifiedSource: true, factoryId: registry.id, factoryAddress: registry.address, firstSeenAt: "2026-09-01T00:00:00Z", ...extra }; }
function memoryStore(state) {
  return {
    read: () => structuredClone(state),
    transact: async (_, mutator, after) => { const draft = structuredClone(state); const result = await mutator(draft); state = result ?? draft; await after?.(state); return structuredClone(state); }
  };
}

test("backfill priority follows exact anchor, matched, quote, new, evidence, retry, supported", () => {
  const rows = [pool("anchor", { token0: BASE_WETH, token1: BASE_USDC }), pool("matched", { providerEnrichment: { status: "matched" } }), pool("quote", { token1: BASE_USDC }), pool("new", { firstSeenAt: NOW.toISOString() }), pool("evidence", { volume24hUsd: 1 }), pool("retry", { onchainState: { status: "retryable" } }), pool("other")];
  assert.deepEqual(rows.map((row) => backfillPriority(row, NOW)), [0, 1, 2, 3, 4, 5, 6]);
});

test("metadata prerequisites preserve waiting jobs and attempts under bounded queue pressure", () => {
  const state = initialState(NOW);
  state.tokenMetadata[BASE_WETH] = { decimals: 18, verificationState: "verified" };
  state.pools.supported = pool("supported", { token0: TOKEN, token1: BASE_WETH });
  for (let i = 0; i < 300; i++) {
    const token = `0x${(i + 10).toString(16).padStart(40, "f")}`;
    state.pools[token] = pool(token, { token0: token, token1: BASE_WETH, factoryId: "uniswap-v4", poolAddress: undefined });
  }
  state.metadataQueue = [{ tokenAddress: TOKEN, poolKey: TOKEN, attempts: 4, createdAt: "2026-09-03T19:00:00Z", nextAttemptAt: NOW.toISOString() }];
  seedMetadataQueue(state, NOW);
  assert.equal(state.metadataQueue.length, 256);
  assert.equal(state.metadataQueue[0].tokenAddress, TOKEN);
  assert.equal(state.metadataQueue[0].attempts, 4);
  for (let pass = 0; pass < 3; pass++) seedMetadataQueue(state, NOW);
  assert.equal(state.metadataQueue[0].tokenAddress, TOKEN);
  state.metadataQueue = [];
  const restarted = structuredClone(state); seedMetadataQueue(restarted, NOW);
  assert.equal(restarted.metadataQueue[0].attempts, 4);
  assert.equal(restarted.metadataQueue[0].createdAt, "2026-09-03T19:00:00Z");
  const oldUnsupported = Object.values(restarted.pools).find((row) => !row.poolAddress).token0;
  restarted.tokenMetadata[oldUnsupported].metadataBackfill.nextAttemptAt = "2026-09-03T19:30:00Z";
  seedMetadataQueue(restarted, NOW);
  assert.equal(restarted.metadataQueue[0].tokenAddress, oldUnsupported, "aging still provides fairness to lower priorities");
});

test("queue is bounded and aging eventually outranks recurring high-priority work", () => {
  const state = initialState(NOW);
  state.pools = Object.fromEntries(Array.from({ length: 600 }, (_, index) => [`matched-${index}`, pool(`matched-${index}`, { providerEnrichment: { status: "matched" } })]));
  state.pools.old = pool("old", { backfill: { attempts: 2, createdAt: "2026-09-03T19:40:00Z", nextAttemptAt: "2026-09-03T19:40:00Z" } });
  seedBackfillQueue(state, NOW);
  assert.equal(state.onchainQueue.length, BACKFILL_QUEUE_LIMIT);
  assert.equal(state.onchainQueue[0].poolKey, "old");
  assert.equal(new Set(state.onchainQueue.map((job) => job.poolKey)).size, state.onchainQueue.length);
});

test("overdue legacy refreshes cannot starve newly unlocked unproved pools", () => {
  const pools = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`proved-${index}`, pool(`proved-${index}`, { backfill: { lastSuccessfulHash: HASH } })]));
  pools.unproved = pool("unproved");
  const queue = Object.keys(pools).map((poolKey) => ({ poolKey }));
  for (const attempts of [0, 1, 2]) assert.equal(selectBackfillRpcBatch(queue, pools, 1, attempts)[0].poolKey, "proved-0");
  assert.equal(selectBackfillRpcBatch(queue, pools, 1, 3)[0].poolKey, "unproved");
  const batch = selectBackfillRpcBatch(queue, pools, 4, 0);
  assert.equal(batch.length, 4); assert.equal(new Set(batch.map((row) => row.poolKey)).size, 4);
  assert.equal(batch[3].poolKey, "unproved");
  assert.equal(selectBackfillRpcBatch(queue, structuredClone(pools), 1, 7)[0].poolKey, "unproved", "restart cadence uses the persisted attempt count");
});

test("persistent attempts/cooldown survive dequeue and actual durable restart", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "base-backfill-resilience-"));
  let store = new DurableDiscoveryStore(directory);
  try {
    await store.open();
    await store.transact("seed", (draft) => { draft.pools.one = pool("one"); seedBackfillQueue(draft, NOW); });
    await store.transact("retry", (draft) => {
      recordBackfillOutcome(draft.pools.one, { status: "retryable", reasonCode: "rpc_error_-32016", endpointLabel: "primary" }, NOW, { usedRpc: true });
      draft.onchainQueue = []; seedBackfillQueue(draft, NOW);
    });
    assert.equal(store.read().onchainQueue.length, 0);
    await store.close(); store = new DurableDiscoveryStore(directory); await store.open();
    const after = await store.transact("resume", (draft) => { seedBackfillQueue(draft, new Date(NOW.getTime() + 31_000)); });
    assert.equal(after.onchainQueue[0].attempts, 1);
    assert.equal(after.onchainQueue[0].lastErrorClass, "rpc_error_-32016");
    assert.equal(after.onchainQueue[0].lastEndpointLabel, "primary");
    assert.equal(after.onchainQueue[0].createdAt, NOW.toISOString());
    assert.equal(store.integrityCheck().ok, true);
  } finally { await store.close(); await rm(directory, { recursive: true, force: true }); }
});

test("dead/dust/unsupported pools have long cooldown and never convert RPC failure into rejection", () => {
  for (const status of ["rejected", "unsupported", "retryable"]) {
    const row = pool(status);
    recordBackfillOutcome(row, { status, reasonCode: status === "rejected" ? "zero_liquidity" : "rpc_error_-32016" }, NOW, { usedRpc: status !== "unsupported" });
    if (status !== "retryable") assert(row.backfill.cooldownMs >= 3_600_000);
    assert.equal(row.backfill.lastStatus, status);
  }
});

test("failed pool refresh preserves last-good block/hash and does not renew freshness", async () => {
  const state = initialState(NOW);
  state.pools.one = pool("one", { onchainState: { status: "complete", blockNumber: 90, blockHash: HASH, observedAt: NOW.toISOString(), decimals0: 18, decimals1: 6, observedPrice0In1: 2 } });
  state.tokenMetadata = { [TOKEN]: { decimals: 18 }, [OTHER]: { decimals: 6 } };
  const collector = new OnchainDiscoveryCollector({ httpUrl: "https://example.invalid", storeDirectory: ".data/test", stateRpcClient: { blockNumber: async () => { throw Object.assign(new Error("rpc_error_-32016"), { reasonCode: "rpc_error_-32016", endpointLabel: "primary" }); }, circuitSnapshot: () => ({}) }, onchainStateBatchSize: 1 });
  collector.store = memoryStore(state);
  await collector.runOnchainStateCycle(new Date(NOW.getTime() + 61_000));
  const row = collector.store.read().pools.one;
  assert.equal(row.onchainState.status, "complete"); assert.equal(row.onchainState.blockNumber, 90);
  assert.equal(row.onchainState.observedAt, NOW.toISOString()); assert.equal(row.onchainState.blockHash, HASH);
  assert.equal(row.backfill.lastStatus, "retryable"); assert.equal(row.backfill.attempts, 1);
});

test("cursor commits independently while anchor is stuck; loop timeout cleans parent listeners", async () => {
  const state = initialState(NOW);
  for (const row of Object.values(state.cursors)) row.blockNumber = 50;
  const collector = new OnchainDiscoveryCollector({ httpUrl: "https://example.invalid", storeDirectory: ".data/test", rpcClient: { blockNumber: async () => 100, getLogs: async () => [], getBlock: async (number) => ({ number: `0x${number.toString(16)}`, hash: HASH, timestamp: "0x64" }) } });
  collector.store = memoryStore(state); collector.running = true;
  const controller = new AbortController();
  const anchor = collector.runLoop("anchor", 1, 5, () => new Promise(() => {}), controller.signal);
  await collector.reconcileHead();
  await collector.scanOnce();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(collector.store.read().cursors[registry.id].blockNumber, 98);
  assert.equal(collector.loopHealth.anchor.lastError.reasonCode, "anchor_cycle_deadline_exceeded");
  collector.running = false; controller.abort(); await anchor;
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("known overlap reuses immutable binding but always verifies canonical block hash", async () => {
  const event = { ...pool("known"), blockNumber: 100, blockHash: HASH, idempotencyKey: "8453:tx:1", verifiedBinding: "pool_contract" };
  const calls = [];
  let blockHash = HASH;
  const rpc = { batchOutcomes: async (batch) => {
    calls.push(...batch);
    if (batch.some((call) => call.method !== "eth_getBlockByNumber")) throw new Error("fresh_binding_required");
    return batch.map((call) => ({ ok: true, method: call.method, value: { hash: blockHash, timestamp: "0x64" } }));
  } };
  const result = await verifyFactoryEvents(rpc, [event], 2, { knownEvents: { [event.idempotencyKey]: event } });
  assert.equal(result.length, 1); assert.equal(calls.length, 1); assert.equal(calls[0].method, "eth_getBlockByNumber");
  blockHash = `0x${"b".repeat(64)}`;
  await assert.rejects(verifyFactoryEvents(rpc, [event], 2, { knownEvents: { [event.idempotencyKey]: event } }), /rpc_block_hash_conflict/);
  await assert.rejects(verifyFactoryEvents(rpc, [{ ...event, token0: OTHER }], 2, { knownEvents: { [event.idempotencyKey]: event } }), /fresh_binding_required/);
});

test("dense already-proved overlap cannot shrink a no-new-work scan to one block", async () => {
  const word = (address) => `0x${address.slice(2).padStart(64, "0")}`;
  const logs = Array.from({ length: 20 }, (_, index) => ({ address: registry.address, topics: [registry.eventTopic, word(TOKEN), word(OTHER)], data: `${word(`0x${(index + 100).toString(16).padStart(40, "0")}`)}${"0".repeat(63)}1`, blockNumber: "0x64", blockHash: HASH, transactionHash: `0x${"b".repeat(64)}`, logIndex: `0x${index.toString(16)}` }));
  const state = initialState(NOW);
  for (const cursor of Object.values(state.cursors)) cursor.blockNumber = 100;
  for (const log of logs) { const event = decodeFactoryLog(log); state.events[event.idempotencyKey] = { ...event, status: "confirmed", verifiedBinding: "pool_contract" }; }
  let logRequests = 0;
  const collector = new OnchainDiscoveryCollector({ httpUrl: "https://example.invalid", storeDirectory: ".data/test",
    rpcClient: { blockNumber: async () => 1_000, getLogs: async () => { logRequests++; return logs; }, getBlock: async (number) => ({ number: `0x${number.toString(16)}`, hash: HASH, timestamp: "0x64" }) },
    discoveryRpcClient: { batchOutcomes: async (calls) => calls.map((call) => ({ ok: true, method: call.method, value: { hash: HASH, timestamp: "0x64" } })) }
  });
  collector.store = memoryStore(state);
  await collector.scanOnce();
  assert.equal(logRequests, 1); assert.equal(collector.store.read().cursors[registry.id].blockNumber, 350);
});

test("an anchor cooldown tick cannot fabricate recovery or renew its last success", async () => {
  const collector = new OnchainDiscoveryCollector({ httpUrl: "https://example.invalid", storeDirectory: ".data/test" });
  collector.store = memoryStore(initialState(NOW)); collector.running = true;
  collector.loopHealth = { anchor: { lastSuccessAt: NOW.toISOString(), lastError: { reasonCode: "rpc_error_-32016", observedAt: NOW.toISOString() } } };
  await collector.runLoop("anchor", 1, 100, async () => { collector.running = false; return { loopSkipped: true }; });
  assert.equal(collector.loopHealth.anchor.phase, "retrying");
  assert.equal(collector.loopHealth.anchor.lastSuccessAt, NOW.toISOString());
  assert.equal(collector.loopHealth.anchor.lastError.recoveredAt, undefined);
});

test("anchor refresh cannot overwrite concurrently verified token metadata", async () => {
  const state = initialState(NOW);
  state.tokenMetadata = { [TOKEN]: { verificationState: "pending" }, [BASE_WETH]: { decimals: 18, verificationState: "verified" }, [BASE_USDC]: { decimals: 6, verificationState: "verified" } };
  const collector = new OnchainDiscoveryCollector({ httpUrl: "https://example.invalid", storeDirectory: ".data/test",
    anchorProviderClient: { lookupWethPools: async () => {
      await collector.store.transact("metadata-other-loop", (draft) => { draft.tokenMetadata[TOKEN] = { decimals: 9, verificationState: "verified", metadataBackfill: { attempts: 5 } }; });
      return [];
    } }, anchorRpcClient: { blockNumber: async () => 102, getBlock: async () => ({ number: "0x64", hash: HASH, timestamp: `0x${Math.floor(Date.now() / 1_000).toString(16)}` }) }
  });
  collector.store = memoryStore(state);
  await collector.refreshAnchorIfDue();
  assert.equal(collector.store.read().tokenMetadata[TOKEN].verificationState, "verified");
  assert.equal(collector.store.read().tokenMetadata[TOKEN].decimals, 9);
  assert.equal(collector.store.read().tokenMetadata[TOKEN].metadataBackfill.attempts, 5);
});

test("late metadata completion after cancellation cannot commit", async () => {
  const state = initialState(NOW);
  state.metadataQueue = [{ tokenAddress: TOKEN, blockNumber: 100 }];
  const controller = new AbortController();
  const collector = new OnchainDiscoveryCollector({ httpUrl: "https://example.invalid", storeDirectory: ".data/test", metadataBatchSize: 1, rpcClient: { getCode: async () => { controller.abort(new Error("cancelled")); return "0x01"; }, batchOutcomes: async () => [] } });
  collector.store = memoryStore(state);
  await assert.rejects(collector.drainMetadata(controller.signal), /cancelled/);
  assert.equal(collector.store.read().tokenMetadata[TOKEN], undefined);
});

test("duplicate/out-of-order/hash-conflicting state cannot replace durable proof", () => {
  const old = { status: "complete", blockNumber: 100, blockHash: HASH };
  assert.equal(acceptOnchainStateUpdate(old, { ...old, blockNumber: 99 }).accepted, false);
  assert.equal(acceptOnchainStateUpdate(old, { ...old, blockHash: `0x${"b".repeat(64)}` }).accepted, false);
  assert.equal(acceptOnchainStateUpdate(old, old).accepted, false);
});

test("relay first snapshot has no historical transition and reconnect sees only greater IDs", () => {
  const ring = [{ id: "9" }, { id: "10" }, { id: "11" }];
  assert.deepEqual(eventsAfterId(ring), []);
  assert.deepEqual(eventsAfterId(ring, "10"), [{ id: "11" }]);
  assert.deepEqual(eventsAfterId(ring, "11"), []);
});

test("provider-only price is not canonical; fresh exact proof is required and remains authoritative", () => {
  const row = pool("one", { token1: BASE_USDC, liquidityUsd: 10_000, priceToken1PerToken0: 999, observedAt: NOW.toISOString() });
  assert.equal(calculateCanonicalUsdcPrice(TOKEN, [row], NOW).tier, "UNPRICED");
  row.onchainState = { status: "complete", confidence: "exact_onchain_state", token0: TOKEN, token1: BASE_USDC, decimals0: 18, decimals1: 6, observedAt: NOW.toISOString(), blockNumber: 100, blockHash: HASH, observedPrice0In1: 2 };
  const price = calculateCanonicalUsdcPrice(TOKEN, [row], NOW);
  assert.equal(price.value, 2); assert.equal(price.sourceBlocks[0].blockHash, HASH);
  row.onchainState.observedAt = new Date(NOW.getTime() - 180_000).toISOString();
  assert.equal(calculateCanonicalUsdcPrice(TOKEN, [row], NOW).tier, "UNPRICED");
});
