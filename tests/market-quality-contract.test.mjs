import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { BASE_USDC } from "../collector/factory-registry.mjs";
import { buildCanonicalOpportunities } from "../collector/model.mjs";
import {
  MARKET_QUALITY_THRESHOLDS,
  buildObservedPriceUsd,
  categoryEligibility,
  classifyLiquidityState,
  evaluateOpportunityQuality
} from "../collector/market-quality.mjs";
import { ProviderEnrichmentClient, EXACT_LOOKUP_NEGATIVE_TTL_MS, PROVIDER_MINIMUM_INTERVAL_MS, joinExactProviderPools } from "../collector/provider-enrichment.mjs";
import { OnchainDiscoveryCollector } from "../collector/service.mjs";
import { initialState } from "../collector/store.mjs";

const NOW = new Date("2026-09-01T12:00:00.000Z");
const TOKEN = "0x1111111111111111111111111111111111111111";
const POOL = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

test("quality thresholds are centralized, USD-denominated and ordered", () => {
  assert.equal(MARKET_QUALITY_THRESHOLDS.canonicalPriceMinimumLiquidityUsd, 1_000);
  assert.ok(MARKET_QUALITY_THRESHOLDS.rankingMinimumLiquidityUsd > MARKET_QUALITY_THRESHOLDS.canonicalPriceMinimumLiquidityUsd);
  assert.ok(MARKET_QUALITY_THRESHOLDS.gainersLosersMinimumLiquidityUsd >= MARKET_QUALITY_THRESHOLDS.rankingMinimumLiquidityUsd);
});

test("missing liquidity remains liquidity_unknown", () => assert.equal(classifyLiquidityState([undefined, Number.NaN]), "liquidity_unknown"));
test("exact zero liquidity remains zero_liquidity", () => assert.equal(classifyLiquidityState([0]), "zero_liquidity"));
test("positive sub-threshold liquidity is thin_liquidity", () => assert.equal(classifyLiquidityState([0.01, 999.99]), "thin_liquidity"));
test("canonical threshold boundary is usable_liquidity", () => assert.equal(classifyLiquidityState([1_000]), "usable_liquidity"));

test("exact matched provider price becomes a fresh observed price", () => {
  const observed = buildObservedPriceUsd(TOKEN, [collectorPool({ liquidityUsd: 500 })], NOW);
  assert.equal(observed.value, 0.00421);
  assert.equal(observed.provider, "dexscreener");
  assert.equal(observed.poolAddress, POOL);
});

test("inverted exact provider orientation derives quote token USD", () => {
  const observed = buildObservedPriceUsd(BASE_USDC, [collectorPool({ liquidityUsd: 500 })], NOW);
  assert.equal(observed.value, 1);
});

test("expired provider price is not promoted to observedPriceUsd", () => {
  const old = new Date(NOW.getTime() - MARKET_QUALITY_THRESHOLDS.observedPriceMaximumAgeMs - 1).toISOString();
  assert.equal(buildObservedPriceUsd(TOKEN, [collectorPool({ observedAt: old })], NOW), undefined);
});

test("aged exact provider price remains explicitly delayed before bounded expiry", () => {
  const delayed = new Date(NOW.getTime() - MARKET_QUALITY_THRESHOLDS.observedPriceFreshMaximumAgeMs - 1).toISOString();
  const observed = buildObservedPriceUsd(TOKEN, [collectorPool({ observedAt: delayed })], NOW);
  assert.equal(observed.freshness, "delayed");
  assert.equal(observed.executable, false);
});

test("observed provider price is explicitly never executable", () => {
  assert.equal(buildObservedPriceUsd(TOKEN, [collectorPool()], NOW).executable, false);
});

test("provider price plus thin liquidity produces EMERGING", () => {
  const opportunity = tokenOpportunity(500);
  assert.equal(opportunity.qualityBand, "EMERGING");
  assert.equal(opportunity.observedPriceUsd.value, 0.00421);
});

test("thin observed token is neither canonical nor ranked", () => {
  const opportunity = tokenOpportunity(500);
  assert.equal(opportunity.canonicalPrice.tier, "UNPRICED");
  assert.equal(opportunity.rankingEligibility, false);
  assert.equal(opportunity.ranked, false);
});

test("confirmed pool without provider price remains DETECTED", () => {
  const pool = collectorPool({ liquidityUsd: undefined, providerMatched: false, priceToken1PerToken0: undefined });
  const opportunity = buildCanonicalOpportunities([pool], {}, [], NOW).find((item) => item.tokenAddress === TOKEN);
  assert.equal(opportunity.qualityBand, "DETECTED");
  assert.equal(opportunity.observedPriceUsd, undefined);
});

test("identity conflict is REJECTED even if a price field exists", () => {
  const quality = evaluateOpportunityQuality({ canonicalPrice: { tier: "A", value: 1, reasonCode: "token_identity_conflict" }, liquidityState: "usable_liquidity", providerState: "conflicting", ranked: true });
  assert.equal(quality.band, "REJECTED");
});

test("high-quality emerging begins at its exact boundary", () => {
  const input = { canonicalPrice: { tier: "A", value: 1 }, observedPriceUsd: undefined, liquidityState: "usable_liquidity", ranked: false };
  assert.equal(evaluateOpportunityQuality({ ...input, bestLiquidityUsd: MARKET_QUALITY_THRESHOLDS.qualityViewEmergingMinimumLiquidityUsd - 0.01 }).highQualityEmerging, false);
  assert.equal(evaluateOpportunityQuality({ ...input, bestLiquidityUsd: MARKET_QUALITY_THRESHOLDS.qualityViewEmergingMinimumLiquidityUsd }).highQualityEmerging, true);
});

test("New on Base accepts honest EMERGING", () => {
  const eligibility = categoryEligibility({ band: "EMERGING", canonicalPrice: { tier: "UNPRICED" }, bestLiquidityUsd: 500, newlyCreated: true });
  assert.equal(eligibility.new, true);
  assert.equal(eligibility.gainersLosers, false);
});

test("gainers and losers require comparable canonical snapshots", () => {
  const base = { band: "RANKED", canonicalPrice: { tier: "A", value: 1 }, bestLiquidityUsd: 100_000 };
  assert.equal(categoryEligibility({ ...base, comparableSnapshots: false }).gainersLosers, false);
  assert.equal(categoryEligibility({ ...base, comparableSnapshots: true }).gainersLosers, true);
});

test("volume eligibility requires a real positive volume window", () => {
  const base = { band: "RANKED", canonicalPrice: { tier: "A", value: 1 }, bestLiquidityUsd: 50_000 };
  assert.equal(categoryEligibility({ ...base, volumes: {} }).volume, false);
  assert.equal(categoryEligibility({ ...base, volumes: { h1: 1 } }).volume, true);
});

test("liquidity eligibility honors the category-specific boundary", () => {
  const base = { band: "RANKED", canonicalPrice: { tier: "A", value: 1 } };
  assert.equal(categoryEligibility({ ...base, bestLiquidityUsd: MARKET_QUALITY_THRESHOLDS.liquidityLaneMinimumLiquidityUsd - 0.01 }).liquidity, false);
  assert.equal(categoryEligibility({ ...base, bestLiquidityUsd: MARKET_QUALITY_THRESHOLDS.liquidityLaneMinimumLiquidityUsd }).liquidity, true);
});

test("most-traded eligibility requires real transaction counts", () => {
  const base = { band: "RANKED", canonicalPrice: { tier: "A", value: 1 }, bestLiquidityUsd: 50_000 };
  assert.equal(categoryEligibility({ ...base, transactions: {} }).mostTraded, false);
  assert.equal(categoryEligibility({ ...base, transactions: { h1: { buys: 1, sells: 0 } } }).mostTraded, true);
});

test("ranking liquidity threshold has an exact boundary", () => {
  assert.equal(tokenOpportunity(MARKET_QUALITY_THRESHOLDS.rankingMinimumLiquidityUsd - 0.01).qualityBand, "EMERGING");
  assert.equal(tokenOpportunity(MARKET_QUALITY_THRESHOLDS.rankingMinimumLiquidityUsd).qualityBand, "RANKED");
});

test("exact pool lookup uses only the requested address endpoints", async () => {
  const urls = [];
  const client = exactClient(async (url) => {
    urls.push(url);
    if (url.includes("dexscreener")) return response(200, { pairs: [dexRow()] });
    if (url.endsWith("/info")) return response(200, { data: [{ id: `base_${TOKEN}`, attributes: { address: TOKEN, name: "Token", symbol: "TOKEN" } }, { id: `base_${BASE_USDC}`, attributes: { address: BASE_USDC, name: "USD Coin", symbol: "USDC" } }] });
    return response(200, geckoPayload());
  });
  const result = await client.lookupPool(POOL);
  assert.equal(result.lookupState, "found");
  assert.equal(result.observations.length, 2);
  assert.ok(urls.every((url) => url.includes(POOL)));
  assert.ok(urls.some((url) => url.endsWith(`/networks/base/pools/${POOL}/info`)));
});

test("exact provider rate gates leave shared-IP headroom", () => {
  assert.ok(PROVIDER_MINIMUM_INTERVAL_MS.dexscreener >= 200);
  assert.ok(PROVIDER_MINIMUM_INTERVAL_MS.geckoterminal >= 6_000);
  assert.ok(60_000 / PROVIDER_MINIMUM_INTERVAL_MS.geckoterminal <= 10);
});

test("a 429 opens the provider circuit immediately and honors Retry-After without retrying", async () => {
  let calls = 0;
  const client = new ProviderEnrichmentClient({
    fetchImpl: async () => {
      calls += 1;
      return { ok: false, status: 429, headers: { get: (name) => name === "retry-after" ? "120" : null } };
    },
    retries: 1,
    now: () => NOW,
    delayImpl: async () => {}
  });
  client.providerMinimumIntervalMs.geckoterminal = 0;
  await assert.rejects(client.request("geckoterminal", "https://api.geckoterminal.com/test"), (error) => error?.reasonCode === "provider_http_429");
  assert.equal(calls, 1);
  assert.equal(client.circuitSnapshot().geckoterminal.state, "open");
  assert.equal(client.circuitSnapshot().geckoterminal.openUntil, "2026-09-01T12:02:00.000Z");
});

test("exact lookup 404 is negative-cached until TTL expires", async () => {
  let nowMs = NOW.getTime();
  let calls = 0;
  const client = exactClient(async () => { calls += 1; return response(404, {}); }, () => new Date(nowMs));
  assert.equal((await client.lookupPool(POOL)).lookupState, "not_found");
  assert.equal((await client.lookupPool(POOL)).cacheHit, true);
  assert.equal(calls, 2);
  nowMs += EXACT_LOOKUP_NEGATIVE_TTL_MS + 1;
  await client.lookupPool(POOL);
  assert.equal(calls, 4);
});

test("a partial transient provider outage is retried instead of negative-cached", async () => {
  const client = exactClient(async (url) => {
    if (url.includes("dexscreener")) return response(200, { pairs: [] });
    if (url.endsWith("/info")) return response(404, {});
    return response(503, {});
  });
  await assert.rejects(client.lookupPool(POOL), (error) => error?.reasonCode === "all_providers_transient_failure" && error.retryable === true);
});

test("concurrent exact lookups coalesce to one provider request set", async () => {
  let calls = 0;
  const client = exactClient(async () => { calls += 1; await Promise.resolve(); return response(404, {}); });
  await Promise.all([client.lookupPool(POOL), client.lookupPool(POOL), client.lookupPool(POOL)]);
  assert.equal(calls, 2);
});

test("same symbol cannot bind a different exact pool address", () => {
  const observation = providerObservation({ poolAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" });
  assert.equal(joinExactProviderPools(collectorPool(), [observation]).status, "unmatched");
});

test("two exact providers remain one pool without double-counting", () => {
  const joined = joinExactProviderPools(collectorPool(), [providerObservation({ provider: "dexscreener", liquidityUsd: 10_000 }), providerObservation({ provider: "geckoterminal", liquidityUsd: 12_000 })], { now: NOW });
  assert.equal(joined.providerSnapshots.length, 2);
  assert.equal(joined.liquidityUsd, 12_000);
});

test("band transition emits one semantic event and no repeat", async () => {
  const before = initialState(NOW);
  const after = structuredClone(before);
  before.opportunities = [semanticOpportunity("DETECTED")];
  after.opportunities = [semanticOpportunity("EMERGING")];
  const relay = structuredClone(after);
  const fakeStore = { transact: async (_reason, mutator) => { await mutator(relay); return relay; } };
  const subject = { store: fakeStore };
  await OnchainDiscoveryCollector.prototype.publishSemanticDeltas.call(subject, before, after, []);
  await OnchainDiscoveryCollector.prototype.publishSemanticDeltas.call(subject, after, after, []);
  assert.equal(relay.eventRing.filter((event) => event.type === "opportunity_band_changed").length, 1);
});

test("Quality is the default and explicitly excludes DETECTED flood", async () => {
  const source = await readFile(path.resolve("src/components/base-terminal/TerminalMarketSurface.tsx"), "utf8");
  assert.match(source, /qualityView === "quality"[^\n]+RANKED[^\n]+highQualityEmerging/);
  assert.match(source, /qualityView === "detected"[^\n]+DETECTED/);
});

test("live wall compares canonical snapshot prices and excludes observed-only prices", async () => {
  const source = await readFile(path.resolve("src/lib/base-terminal/liveMarketWall.ts"), "utf8");
  assert.match(source, /previousMetrics\[opportunity\.id\]\?\.canonicalPriceUsd/);
  assert.match(source, /opportunity\.qualityBand === "RANKED"/);
  assert.doesNotMatch(source, /observedPriceUsd.*gainer/i);
});

test("live wall event times are hydration-stable across server and browser time zones", async () => {
  const source = await readFile(path.resolve("src/components/base-terminal/LiveMarketWall.tsx"), "utf8");
  assert.match(source, /function formatObservedTime[\s\S]*?toLocaleTimeString[\s\S]*?timeZone: "UTC"/);
});

test("relative event times share the serialized server clock during hydration", async () => {
  const layout = await readFile(path.resolve("src/app/layout.tsx"), "utf8");
  const provider = await readFile(path.resolve("src/i18n/I18nProvider.tsx"), "utf8");
  assert.match(layout, /initialNow=\{initialNow\}/);
  assert.match(provider, /useState\(initialNow\)/);
  assert.match(provider, /formatRelative\(date, locale, relativeNow\)/);
  assert.doesNotMatch(provider, /function formatRelative[\s\S]*?Date\.now\(\) - new Date/);
});

test("compact market numbers normalize optional ICU trailing zeroes during hydration", async () => {
  const formatter = await readFile(path.resolve("src/lib/format.ts"), "utf8");
  const provider = await readFile(path.resolve("src/i18n/I18nProvider.tsx"), "utf8");
  const badges = await readFile(path.resolve("src/components/base-terminal/MarketSignalBadges.tsx"), "utf8");
  assert.match(formatter, /function normalizeCompactNumberText[\s\S]*?replace\(\/\(\[\.,\]\)0\(\?=\\D\*\$\)\/u/);
  assert.match(provider, /formatCompactCurrency:[^\n]+normalizeCompactNumberText/);
  assert.match(badges, /unit === "usd"[^\n]+normalizeCompactNumberText/);
});

test("explicit mock mode cannot merge the persisted on-chain reservoir", async () => {
  const source = await readFile(path.resolve("src/data/providers/index.ts"), "utf8");
  assert.match(source, /provider\.mode === "dexscreener"[\s\S]*?mergeOnchainPoolsIntoPairs\(hydratedPairs\)[\s\S]*?: hydratedPairs/);
});

test("stale live snapshots serve immediately while provider refresh continues", async () => {
  const source = await readFile(path.resolve("src/data/providers/index.ts"), "utf8");
  assert.match(source, /entry\.inFlight[\s\S]*?entry\.snapshot[\s\S]*?markSnapshotDelayed/);
  assert.match(source, /snapshotCache\.set\(mode, \{ \.\.\.entry, inFlight \}\);[\s\S]*?if \(!options\.force && entry\.snapshot\)[\s\S]*?return markSnapshotDelayed/);
});

test("quality labels retain exact TR and EN parity", async () => {
  const source = await readFile(path.resolve("src/i18n/dictionaries.ts"), "utf8");
  for (const key of ["qualityView", "thinMarket", "qualityBand", "observedPrice", "liquidityState", "rankingEligibility", "providerDiscoveryState", "exactProvenance", "lane.detected"]) {
    assert.equal(source.match(new RegExp(`"terminalV3\\.${key.replace(".", "\\.")}"`, "g"))?.length, 2, key);
  }
});

function tokenOpportunity(liquidityUsd) {
  return buildCanonicalOpportunities([collectorPool({ liquidityUsd })], { [TOKEN]: { symbol: "TOKEN", name: "Token", decimals: 18, status: "complete", verificationState: "verified" } }, [], NOW).find((item) => item.tokenAddress === TOKEN);
}

function collectorPool({ liquidityUsd = 500, observedAt = NOW.toISOString(), providerMatched = true, priceToken1PerToken0 = 0.00421 } = {}) {
  return {
    poolKey: POOL,
    poolAddress: POOL,
    token0: TOKEN,
    token1: BASE_USDC,
    status: "confirmed",
    orphaned: false,
    verifiedSource: true,
    observedAt,
    confirmedAt: observedAt,
    firstSeenAt: observedAt,
    blockTimestamp: observedAt,
    blockNumber: 50_000_000,
    priceToken1PerToken0,
    liquidityUsd,
    providers: providerMatched ? ["dexscreener"] : ["onchain"],
    providerEnrichment: providerMatched ? { status: "matched", selectedProvider: "dexscreener", observedAt } : undefined,
    providerSnapshots: providerMatched ? [providerObservation({ liquidityUsd, observedAt, receivedAt: observedAt })] : []
  };
}

function providerObservation(overrides = {}) {
  return { provider: "dexscreener", chainId: 8453, poolAddress: POOL, baseTokenAddress: TOKEN, quoteTokenAddress: BASE_USDC, priceNative: 0.00421, priceUsd: 0.00421, liquidityUsd: 500, volumes: { h1: 10, h24: 100 }, transactions: { h1: { buys: 1, sells: 1 } }, observedAt: NOW.toISOString(), receivedAt: NOW.toISOString(), fieldProvenance: {}, ...overrides };
}

function exactClient(fetchImpl, now = () => NOW) {
  const client = new ProviderEnrichmentClient({ fetchImpl, retries: 0, now, delayImpl: async () => {} });
  client.providerMinimumIntervalMs = { dexscreener: 0, geckoterminal: 0 };
  return client;
}

function dexRow() { return { chainId: "base", dexId: "uniswap", pairAddress: POOL, baseToken: { address: TOKEN }, quoteToken: { address: BASE_USDC }, priceNative: "0.00421", priceUsd: "0.00421", liquidity: { usd: 500 } }; }
function geckoPayload() { return { data: { id: `base_${POOL}`, attributes: { address: POOL, base_token_price_quote_token: "0.00421", base_token_price_usd: "0.00421", reserve_in_usd: "500" }, relationships: { base_token: { data: { id: `base_${TOKEN}` } }, quote_token: { data: { id: `base_${BASE_USDC}` } }, dex: { data: { id: "uniswap" } } } }, included: [{ id: `base_${TOKEN}`, attributes: { address: TOKEN } }, { id: `base_${BASE_USDC}`, attributes: { address: BASE_USDC } }] }; }
function response(status, payload) { return { ok: status >= 200 && status < 300, status, json: async () => payload }; }
function semanticOpportunity(qualityBand) { return { id: `8453:token:${TOKEN}`, qualityBand, ranked: qualityBand === "RANKED", canonicalPrice: { tier: "UNPRICED", reasonCode: "thin_liquidity" }, observedPriceUsd: qualityBand === "EMERGING" ? { value: 1, provider: "dexscreener", poolAddress: POOL } : undefined, liquidityState: qualityBand === "EMERGING" ? "thin_liquidity" : "liquidity_unknown", aggregate: { contributingPoolCount: 1 }, lifecycle: qualityBand.toLowerCase() }; }
