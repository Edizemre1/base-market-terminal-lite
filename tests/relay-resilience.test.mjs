import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { getEventListeners } from "node:events";
import vm from "node:vm";
import ts from "typescript";
import { calculateCanonicalUsdcPrice } from "../collector/model.mjs";

const require = createRequire(import.meta.url);
function load(relativePath, mocks = {}) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS, esModuleInterop: true } });
  const exports = {};
  vm.runInNewContext(compiled.outputText, { exports, require: (name) => mocks[name] ?? require(name), process, globalThis: {}, URL, TextEncoder, Response, ReadableStream, setTimeout, clearTimeout, setInterval, clearInterval, console });
  return exports;
}
const discovery = load("../src/lib/base-terminal/onchainDiscovery.ts");
function state() {
  const now = new Date().toISOString();
  return { updatedAt: now, confirmedHead: 100, currentHead: 102, cursors: { one: { blockNumber: 100, updatedAt: now } }, health: { ready: true, storeIntegrity: "ok", lastHeadObservedAt: now }, eventRing: [{ id: "9", type: "pool_enriched", at: now, data: {} }, { id: "10", type: "pool_enriched", at: now, data: {} }] };
}

test("fresh snapshot writes cannot mask a stale external head or cursor lag", () => {
  const value = state();
  assert.equal(discovery.collectorFreshness(value).ready, true);
  value.health.lastHeadObservedAt = new Date(Date.now() - 120_000).toISOString();
  assert.equal(discovery.collectorFreshness(value).delayedReason, "head_observation_stale");
  value.health.lastHeadObservedAt = new Date().toISOString(); value.cursors.one.blockNumber = 10;
  assert.equal(discovery.collectorFreshness(value).lagBlocks, 90);
  assert.equal(discovery.collectorFreshness(value).ready, false);
});

test("live Pulse stays delayed while its configured collector is behind, then recovers", async () => {
  const previous = process.env.ONCHAIN_STORE_PATH;
  process.env.ONCHAIN_STORE_PATH = "/not-read-by-mocked-test";
  let ready = false;
  try {
    const route = load("../src/app/api/pulse/route.ts", {
      "next/server": { NextResponse: { json: (value) => Response.json(value) } },
      "@/data/providers": { resolveUrlMarketDataMode: () => "live", getMarketTerminalSnapshot: async () => ({ mode: "live", allPairs: [{}], universe: {}, recentSignals: [], freshness: "fresh" }) },
      "@/lib/base-terminal/onchainDiscovery": { getOnchainCollectorHealth: () => ({ ready, lagBlocks: ready ? 0 : 100, delayedReason: ready ? undefined : "confirmed_cursor_behind" }) }
    });
    const request = new Request("https://example.invalid/api/pulse?data=live");
    const delayed = await (await route.GET(request)).json();
    assert.equal(delayed.freshness, "delayed"); assert.equal(delayed.delayedReason, "confirmed_cursor_behind");
    ready = true;
    const recovered = await (await route.GET(request)).json();
    assert.equal(recovered.freshness, "fresh"); assert.equal(recovered.onchainCollector.ready, true);
  } finally { if (previous === undefined) delete process.env.ONCHAIN_STORE_PATH; else process.env.ONCHAIN_STORE_PATH = previous; }
});

test("relay baseline/checkpoint and expired reconnect do not replay historical transitions", () => {
  const relay = load("../src/lib/base-terminal/onchainRelay.ts", { "@/lib/base-terminal/onchainDiscovery": { readOnchainStoreSnapshot: () => ({ ok: true, state: state() }) } });
  assert.equal(relay.readRelayEventsAfter().events.length, 0);
  assert.equal(relay.readRelayEventsAfter().checkpoint, "10");
  assert.equal(relay.readRelayEventsAfter("9").events[0].id, "10");
  assert.equal(relay.readRelayEventsAfter("10").events.length, 0);
  assert.equal(relay.readRelayEventsAfter("3").resetRequired, true);
  assert.equal(relay.readRelayEventsAfter("3").events.length, 0);
  assert.equal(relay.readRelayEventsAfter("bad-id").resetRequired, true);
});

test("SSE cancellation closes timers, removes request listener and releases client once", async () => {
  const value = state(); let clients = 0;
  const route = load("../src/app/api/opportunity-stream/route.ts", {
    "@/lib/base-terminal/onchainDiscovery": discovery,
    "@/lib/base-terminal/onchainRelay": {
      getOnchainRelayClientCount: () => clients,
      registerOnchainRelayClient: () => { clients += 1; return () => { clients -= 1; }; },
      readRelayEventsAfter: () => ({ ok: true, state: value, events: [], checkpoint: "10", resetRequired: false })
    }
  });
  const controller = new AbortController();
  const request = new Request("https://example.invalid/api/opportunity-stream", { signal: controller.signal });
  const response = route.GET(request); const reader = response.body.getReader();
  assert.equal(response.status, 200); await reader.read();
  const message = new TextDecoder().decode((await reader.read()).value);
  assert(message.includes("collector_status"));
  await reader.cancel(); controller.abort();
  assert.equal(clients, 0); assert.equal(getEventListeners(request.signal, "abort").length, 0);
});

test("web canonical pricing uses exact state in direct and inverted display orientations", () => {
  const { calculateOpportunityUsdcPrice } = load("../src/lib/base-terminal/canonicalPricing.ts", { "../../../collector/model.mjs": { calculateCanonicalUsdcPrice } });
  const token = `0x${"1".repeat(40)}`, usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
  const now = new Date();
  const pair = { id: "one", pairAddress: `0x${"2".repeat(40)}`, baseTokenAddress: token, quoteTokenAddress: usdc, priceNative: "999", liquidityUsd: 10_000, dataProviders: ["onchain"], metadataVerificationState: "verified", onchainStateEvidence: { status: "complete", confidence: "exact_onchain_state", token0: token, token1: usdc, decimals0: 18, decimals1: 6, blockNumber: 100, blockHash: `0x${"a".repeat(64)}`, observedAt: now.toISOString(), observedPrice0In1: 2, observedPrice1In0: 0.5 } };
  assert.equal(calculateOpportunityUsdcPrice(token, [pair], now).value, 2);
  assert.equal(calculateOpportunityUsdcPrice(token, [{ ...pair, baseTokenAddress: usdc, quoteTokenAddress: token }], now).value, 2);
  assert.equal(calculateOpportunityUsdcPrice(token, [{ ...pair, onchainStateEvidence: undefined }], now).tier, "UNPRICED");
});
