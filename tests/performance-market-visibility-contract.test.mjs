import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

async function source(file) {
  return readFile(path.resolve(file), "utf8");
}

test("terminal route state commits through shared client history without router refresh", async () => {
  const [shell, terminal, navigation] = await Promise.all([
    source("src/components/AppShell.tsx"),
    source("src/components/BaseTerminal.tsx"),
    source("src/lib/base-terminal/terminalNavigation.ts")
  ]);
  assert.match(shell, /commitTerminalNavigation/);
  assert.match(terminal, /data-terminal-view=\{view\}/);
  assert.match(terminal, /typeof window === "undefined"[\s\S]*?readTerminalLocation\(\)/);
  assert.match(terminal, /useSyncExternalStore\(subscribeToView, readView, readServerView\)/);
  assert.match(navigation, /history\[mode === "replace" \? "replaceState" : "pushState"\]/);
  assert.doesNotMatch(terminal, /router\.(push|replace)\(/);
});

test("last-good store reads are cached by exact file identity and shared by pricing", async () => {
  const [store, provider] = await Promise.all([
    source("src/lib/base-terminal/onchainDiscovery.ts"),
    source("src/data/providers/index.ts")
  ]);
  assert.match(store, /onchainStoreCache\.size === stat\.size && onchainStoreCache\.mtimeMs === stat\.mtimeMs/);
  assert.match(store, /onchainStoreReadMetrics\.cacheHits \+= 1/);
  assert.match(provider, /mergeOnchainPoolsIntoPairs\(hydratedPairs, storeResult\)/);
  assert.match(provider, /getOnchainPricingStatus\(storeResult\)/);
  assert.match(provider, /preferLastGood[\s\S]*?buildOnchainLastGoodSnapshot/);
  assert.match(provider, /compactMarketTerminalSnapshot[\s\S]*?qualityBand === "REJECTED"/);
});

test("market visibility stays separate from trade eligibility and old filters migrate", async () => {
  const [surface, wall, filters] = await Promise.all([
    source("src/components/base-terminal/TerminalMarketSurface.tsx"),
    source("src/lib/base-terminal/liveMarketWall.ts"),
    source("src/lib/base-terminal/terminalMarket.ts")
  ]);
  assert.match(surface, /market-board:v6/);
  assert.match(filters, /qualityView: "all"/);
  assert.match(wall, /pair\.priceChanges\?\.h24/);
  assert.match(wall, /liquidity_leader/);
  assert.match(surface, /tradeAllowed = opportunity\?\.rankingEligibility === true/);
});

test("live values update independently while queueing only locks placement", async () => {
  const [terminal, updates, client] = await Promise.all([
    source("src/components/BaseTerminal.tsx"),
    source("src/lib/base-terminal/liveUpdates.ts"),
    source("src/lib/base-terminal/terminalSnapshotClient.ts")
  ]);
  assert.match(terminal, /setSnapshotData\(liveSnapshot\)[\s\S]*?shouldQueueMarketUpdate/);
  assert.match(updates, /changedPairCount > 0 && interactionLocked/);
  assert.match(client, /inFlightSnapshots\.get\(url\)/);
  assert.match(client, /withSubscriberAbort/);
});

test("fresh validated provider prices reach the UI without weakening pending semantics", async () => {
  const [priceDisplay, surface, inspector] = await Promise.all([
    source("src/lib/base-terminal/marketPriceDisplay.ts"),
    source("src/components/base-terminal/TerminalMarketSurface.tsx"),
    source("src/components/base-terminal/ContextInspector.tsx")
  ]);
  assert.match(priceDisplay, /LIVE_PROVIDER_IDS\.has\(provider\)/);
  assert.match(priceDisplay, /pair\.stale !== true/);
  assert.match(priceDisplay, /isFreshTimestamp\(pair\.sourceUpdatedAt, nowMs\)/);
  assert.match(priceDisplay, /baseAddress === focusAddress/);
  assert.match(priceDisplay, /opportunity\.primaryMarketId === pair\.id/);
  assert.match(priceDisplay, /readPositive\(pair\.priceUsdValue\)/);
  assert.match(priceDisplay, /observed\.freshness === "fresh"/);
  assert.match(surface, /resolveOpportunityMarketPrice\(opportunity, oriented\)/);
  assert.match(surface, /if \(!price\) return t\("terminalV3\.pricingPending"\)/);
  assert.match(inspector, /resolveOpportunityMarketPrice\(opportunity, pair\)/);
});
