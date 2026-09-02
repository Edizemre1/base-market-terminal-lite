import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { appendRelayEvent } from "../collector/model.mjs";
import { resolveCollectorConfig } from "../collector/service.mjs";
import { DurableDiscoveryStore } from "../collector/store.mjs";

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
