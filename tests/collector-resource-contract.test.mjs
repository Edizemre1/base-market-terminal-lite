import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FACTORY_REGISTRY } from "../collector/factory-registry.mjs";
import { appendRelayEvent } from "../collector/model.mjs";
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
