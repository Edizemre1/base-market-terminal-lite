import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FACTORY_REGISTRY } from "../collector/factory-registry.mjs";
import { appendRelayEvent } from "../collector/model.mjs";
import { verifyPoolBindings } from "../collector/rpc.mjs";
import { OnchainDiscoveryCollector, resolveCollectorConfig } from "../collector/service.mjs";
import { DurableDiscoveryStore, initialState } from "../collector/store.mjs";

const NOW = new Date("2026-09-02T20:00:00.000Z");
const TOKEN0 = "0x1111111111111111111111111111111111111111";
const TOKEN1 = "0x2222222222222222222222222222222222222222";

test("normal collector cadence leaves an idle window after durable work", () => {
  const config = resolveCollectorConfig({ BASE_RPC_HTTP_URL: "https://mainnet.base.org" });
  assert.equal(config.pollIntervalMs, 10_000);
  assert.equal(config.onchainStateIntervalMs, 30_000);
  assert.equal(config.enrichmentIntervalMs, 30_000);

  const bounded = resolveCollectorConfig({
    BASE_RPC_HTTP_URL: "https://mainnet.base.org",
    ONCHAIN_STATE_INTERVAL_MS: "120000",
    ONCHAIN_ENRICHMENT_INTERVAL_MS: "120000"
  });
  assert.equal(bounded.onchainStateIntervalMs, 120_000);
  assert.equal(bounded.enrichmentIntervalMs, 120_000);
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
