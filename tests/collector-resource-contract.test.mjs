import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FACTORY_REGISTRY } from "../collector/factory-registry.mjs";
import { appendRelayEvent } from "../collector/model.mjs";
import { JsonRpcClient, verifyPoolBindings } from "../collector/rpc.mjs";
import { nextScanDelayMs, OnchainDiscoveryCollector, resolveCollectorConfig } from "../collector/service.mjs";
import { DurableDiscoveryStore, initialState } from "../collector/store.mjs";

const NOW = new Date("2026-09-02T20:00:00.000Z");
const TOKEN0 = "0x1111111111111111111111111111111111111111";
const TOKEN1 = "0x2222222222222222222222222222222222222222";

test("normal collector cadence is measured start-to-start", () => {
  const config = resolveCollectorConfig({ BASE_RPC_HTTP_URL: "https://mainnet.base.org" });
  assert.equal(config.pollIntervalMs, 10_000);
  assert.equal(config.metadataBatchSize, 1);
  assert.equal(config.onchainStateBatchSize, 1);
  assert.equal(config.onchainLocalClassificationBatchSize, 128);
  assert.equal(config.onchainStateIntervalMs, 30_000);
  assert.equal(config.onchainStateCycleTimeoutMs, 45_000);
  assert.equal(config.enrichmentIntervalMs, 30_000);
  assert.equal(config.discoveryBatchPaceMs, 3_000);

  const bounded = resolveCollectorConfig({
    BASE_RPC_HTTP_URL: "https://mainnet.base.org",
    ONCHAIN_STATE_INTERVAL_MS: "120000",
    ONCHAIN_ENRICHMENT_INTERVAL_MS: "120000",
    ONCHAIN_DISCOVERY_BATCH_PACE_MS: "4000"
  });
  assert.equal(bounded.onchainStateIntervalMs, 120_000);
  assert.equal(bounded.enrichmentIntervalMs, 120_000);
  assert.equal(bounded.discoveryBatchPaceMs, 4_000);
  assert.equal(nextScanDelayMs(config.pollIntervalMs, 2_500), 7_500);
  assert.equal(nextScanDelayMs(config.pollIntervalMs, 12_000), 3_000);
});

test("discovery verification has an isolated bounded RPC client", () => {
  const discoveryRpcClient = { kind: "isolated-discovery-client" };
  const config = {
    ...resolveCollectorConfig({ BASE_RPC_HTTP_URL: "https://mainnet.base.org" }),
    discoveryRpcClient
  };

  const collector = new OnchainDiscoveryCollector(config);

  assert.equal(collector.discoveryRpc, discoveryRpcClient);
  assert.notEqual(collector.discoveryRpc, collector.rpc);

  const defaultCollector = new OnchainDiscoveryCollector(resolveCollectorConfig({ BASE_RPC_HTTP_URL: "https://mainnet.base.org" }));
  assert.equal(defaultCollector.discoveryRpc.retries, 3);
  assert.equal(defaultCollector.discoveryRpc.timeoutMs, 8_000);
  assert.equal(defaultCollector.discoveryRpc.batchPaceMs, 3_000);
});

test("public RPC pacing measures the interval between batch starts", async () => {
  let nowMs = NOW.getTime();
  const delays = [];
  const rpc = new JsonRpcClient("https://mainnet.base.org", {
    batchPaceMs: 3_000,
    now: () => new Date(nowMs),
    delayImpl: async (waitMs) => { delays.push(waitMs); nowMs += waitMs; }
  });

  await rpc.paceBatch();
  nowMs += 1_000;
  await rpc.paceBatch();
  nowMs += 4_000;
  await rpc.paceBatch();

  assert.deepEqual(delays, [2_000]);
});

test("pool binding verification paces each public RPC batch", async () => {
  let requests = 0;
  let pacing = 0;
  const rpc = {
    async paceBatch() { pacing += 1; },
    async batchOutcomes(calls) {
      requests += 1;
      return calls.map(() => ({ ok: true, value: "0x01" }));
    }
  };
  const pools = Array.from({ length: 5 }, (_, index) => ({
    factoryAddress: `0x${String(index + 1).padStart(40, "0")}`,
    blockNumber: 50_000_000
  }));

  const results = await verifyPoolBindings(rpc, pools);

  assert.equal(requests, 3);
  assert.equal(pacing, 3);
  assert.ok(results.every((result) => result.ok && result.kind === "manager_pool_id"));
});

test("manager PoolId events reuse one factory bytecode proof across live scans", async () => {
  let requests = 0;
  let calls = 0;
  let pacing = 0;
  const factoryAddress = `0x${"f".repeat(40)}`;
  const rpc = {
    async paceBatch() { pacing += 1; },
    async batchOutcomes(batch) {
      requests += 1;
      calls += batch.length;
      return batch.map(() => ({ ok: true, value: "0x01" }));
    }
  };
  const pools = Array.from({ length: 6 }, (_, index) => ({
    poolKey: `manager-pool-${index}`,
    factoryAddress,
    blockNumber: 50_000_000 + index
  }));
  const managerCodeEvidence = new Map();

  const first = await verifyPoolBindings(rpc, pools, { managerCodeEvidence });
  const second = await verifyPoolBindings(rpc, pools, { managerCodeEvidence });

  assert.equal(requests, 1);
  assert.equal(calls, 1);
  assert.equal(pacing, 1);
  assert.equal(first.length, pools.length);
  assert.equal(second.length, pools.length);
  assert.ok([...first, ...second].every((result) => result.ok && result.kind === "manager_pool_id"));
});

test("retryable getter failures retain verified factory-event and bytecode evidence", async () => {
  const rpc = {
    async batchOutcomes(calls) {
      return calls.map((call) => call.method === "eth_getCode"
        ? { ok: true, value: "0x01" }
        : { ok: false, reasonCode: "rpc_error_-32016", retryable: true });
    }
  };
  const pool = {
    poolAddress: `0x${"a".repeat(40)}`,
    factoryAddress: `0x${"f".repeat(40)}`,
    token0: TOKEN0,
    token1: TOKEN1,
    blockNumber: 50_000_000
  };

  const [result] = await verifyPoolBindings(rpc, [pool]);

  assert.equal(result.ok, true);
  assert.equal(result.kind, "factory_event_and_code");
});

test("pool binding verification fails fast and defers the remaining batch backlog", async () => {
  let requests = 0;
  const signal = AbortSignal.timeout(1_000);
  const rpc = {
    async batchOutcomes(_calls, options) {
      requests += 1;
      assert.equal(options.signal, signal);
      return [{ ok: false, reasonCode: "rpc_timeout", retryable: true }];
    }
  };
  const pools = Array.from({ length: 5 }, (_, index) => ({
    poolAddress: `0x${String(index + 1).padStart(40, "0")}`,
    factoryAddress: `0x${"f".repeat(40)}`,
    blockNumber: 50_000_000
  }));

  const results = await verifyPoolBindings(rpc, pools, { signal });

  assert.equal(requests, 1);
  assert.equal(results.length, pools.length);
  assert.ok(results.every((result) => !result.ok && result.retryable && result.reason === "rpc_timeout"));
});

test("scan failure exposes the latest independently observed head and real lag", async () => {
  let state = initialState(NOW);
  for (const cursor of Object.values(state.cursors)) cursor.blockNumber = 500;
  const store = {
    transact: async (_reason, mutator) => {
      const draft = structuredClone(state);
      const result = await mutator(draft);
      state = result && typeof result === "object" ? result : draft;
      return structuredClone(state);
    }
  };
  const subject = {
    store,
    config: {},
    lastObservedHead: 1_002,
    lastObservedConfirmedHead: 1_000
  };

  await OnchainDiscoveryCollector.prototype.recordFailure.call(subject, new Error("factory_binding_verification_unavailable"));

  assert.equal(state.currentHead, 1_002);
  assert.equal(state.confirmedHead, 1_000);
  assert.equal(state.health.confirmedCursor, 500);
  assert.equal(state.health.lagBlocks, 500);
  assert.equal(state.health.lagSeconds, 1_000);
  assert.equal(state.health.ready, false);
  assert.equal(state.health.backfillState, "retrying");
  assert.equal(state.health.lastFailure, "factory_binding_verification_unavailable");
});

test("derived semantic events are finalized in the originating durable commit", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "base-resource-contract-"));
  const store = new DurableDiscoveryStore(directory);
  try {
    await store.open();
    const state = await store.transact(
      "single-derived-commit",
      (draft) => { draft.health.lastOnchainStateCycle = "2026-09-02T20:00:00.000Z"; },
      (draft) => { appendRelayEvent(draft, "pool_onchain_state_observed", { poolKey: "fixture" }, "2026-09-02T20:00:00.000Z"); }
    );
    const wal = (await readFile(path.join(directory, "wal.ndjson"), "utf8")).trim().split(/\r?\n/).map(JSON.parse);
    assert.deepEqual(wal.map((row) => row.type), ["prepare", "commit"]);
    assert.equal(state.eventRing.at(-1).type, "pool_onchain_state_observed");
    assert.equal(store.integrityCheck().ok, true);
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("an unqueued pool is seeded and classified in one durable state transaction", async () => {
  let state = initialState(NOW);
  state.health.backfillState = "caught_up";
  state.confirmedHead = 50_000_000;
  const registry = FACTORY_REGISTRY.find((entry) => entry.id === "uniswap-v4");
  state.pools.fixture = {
    poolKey: "fixture",
    token0: TOKEN0,
    token1: TOKEN1,
    factoryId: registry.id,
    factoryAddress: registry.address,
    status: "confirmed",
    orphaned: false,
    replay: false
  };
  let transactions = 0;
  const store = {
    read: () => structuredClone(state),
    transact: async (_reason, mutator, afterDerive) => {
      transactions += 1;
      const draft = structuredClone(state);
      const result = await mutator(draft);
      state = result && typeof result === "object" ? result : draft;
      await afterDerive?.(state);
      return structuredClone(state);
    }
  };
  const subject = {
    store,
    stateRpc: { circuitSnapshot: () => ({ state: "closed" }) },
    config: { onchainStateBatchSize: 4 }
  };

  await OnchainDiscoveryCollector.prototype.runOnchainStateCycle.call(subject, NOW);

  assert.equal(transactions, 1);
  assert.equal(state.pools.fixture.onchainState.status, "unsupported");
  assert.equal(state.eventRing.filter((event) => event.type === "pool_onchain_state_observed").length, 1);
});

test("metadata-pending supported pools classify locally without spending RPC", async () => {
  let state = initialState(NOW);
  state.health.backfillState = "caught_up";
  state.confirmedHead = 50_000_000;
  const registry = FACTORY_REGISTRY.find((entry) => entry.id === "uniswap-v2");
  for (let index = 0; index < 3; index += 1) {
    const poolKey = `pending-${index}`;
    state.pools[poolKey] = {
      poolKey,
      poolAddress: `0x${String(index + 10).padStart(40, "0")}`,
      token0: TOKEN0,
      token1: TOKEN1,
      factoryId: registry.id,
      factoryAddress: registry.address,
      status: "confirmed",
      orphaned: false,
      replay: false
    };
  }
  let rpcRequests = 0;
  const store = {
    read: () => structuredClone(state),
    transact: async (_reason, mutator, afterDerive) => {
      const draft = structuredClone(state);
      const result = await mutator(draft);
      state = result && typeof result === "object" ? result : draft;
      await afterDerive?.(state);
      return structuredClone(state);
    }
  };
  const subject = {
    store,
    stateRpc: {
      async blockNumber() { rpcRequests += 1; throw new Error("unexpected RPC"); },
      circuitSnapshot: () => ({ state: "closed" })
    },
    config: { onchainStateBatchSize: 1, onchainLocalClassificationBatchSize: 128 }
  };

  await OnchainDiscoveryCollector.prototype.runOnchainStateCycle.call(subject, NOW);

  assert.equal(rpcRequests, 0);
  assert.deepEqual(Object.values(state.pools).map((pool) => pool.onchainState?.reasonCode), ["token_metadata_pending", "token_metadata_pending", "token_metadata_pending"]);
});
