import { expect, test, type Page } from "@playwright/test";
import { buildDiscoveryUniverse } from "../../src/lib/base-terminal/opportunityModel";
import type { MarketTerminalSnapshot } from "../../src/data/providers";

test.describe("living Base terminal", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/terminal?data=mock");
    await expectTerminalShell(page);
  });

  test("opens on the canonical terminal with tape, four lanes, matrix, inspector and trade dock", async ({ page }) => {
    await expect(page).toHaveURL(/\/terminal\?data=mock$/);
    await expect(page.getByTestId("live-market-tape")).toBeVisible();
    await expect(page.locator('[data-testid^="opportunity-lane-"]')).toHaveCount(4);
    await expect(page.getByTestId("market-matrix")).toBeVisible();
    await expect(page.getByTestId("market-result-count")).toContainText("24");
    await expect(page.getByTestId("selected-pair-panel")).toBeVisible();
    await expect(page.getByTestId("trade-dock")).toBeVisible();
    await expect(page.getByTestId("trade-dock")).toContainText(/Indicative context|Gösterge bağlamı/);
    const selectedBox = await page.getByTestId("selected-pair-panel").boundingBox();
    const dockBox = await page.getByTestId("trade-dock").boundingBox();
    expect(selectedBox?.y).toBeLessThan(900);
    expect(dockBox?.y).toBeLessThan(900);
  });

  test("renders address-unique token discovery by default and preserves exact pools on demand", async ({ page }) => {
    const tapeIds = await page.getByTestId("live-market-tape").locator("[data-opportunity-id]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-opportunity-id")));
    expect(new Set(tapeIds).size).toBe(tapeIds.length);

    const laneRows = page.getByTestId("opportunity-lanes").locator("[data-opportunity-id]");
    const laneIds = await laneRows.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-opportunity-id")));
    expect(new Set(laneIds).size).toBe(laneIds.length);
    const newAges = await page.getByTestId("opportunity-lane-new").locator("[data-pool-age-minutes]").evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute("data-pool-age-minutes"))));
    expect(newAges.every((age) => Number.isFinite(age) && age >= 0 && age <= 7 * 24 * 60)).toBeTruthy();

    const tokenRows = page.getByTestId("market-matrix").locator('table tbody [data-focus-token-address]:not([data-focus-token-address=""])');
    const tokenAddresses = await tokenRows.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-focus-token-address")));
    expect(new Set(tokenAddresses).size).toBe(tokenAddresses.length);
    await page.getByRole("button", { name: /Pools|Havuzlar/, exact: true }).click();
    await expect(page.getByRole("button", { name: /Pools|Havuzlar/, exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("market-result-count")).toContainText("24");
    await expect(page.getByRole("columnheader", { name: /Pool address|Havuz adresi/ })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /Quote token|Karşı token/ })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /Orientation|Yön/ })).toBeVisible();
  });

  test("redirects legacy root parameters to canonical terminal and keeps deep-linked selection", async ({ page }) => {
    await page.goto("/?data=mock&pair=blob-usdc");
    await expect(page).toHaveURL(/\/terminal\?data=mock&pair=blob-usdc/);
    await expect(page.getByTestId("selected-pair-title")).toHaveText("BLOB / USDC");
    await page.reload();
    await expect(page.getByTestId("selected-pair-title")).toHaveText("BLOB / USDC");
  });

  test("selects a market inline without leaving the current workspace", async ({ page }) => {
    await page.getByTestId("matrix-row-blob-usdc").getByRole("button").first().click();
    await expect(page.getByTestId("selected-pair-title")).toHaveText("BLOB / USDC");
    await expect(page).toHaveURL(/pair=0x[0-9a-f]{40}/);
    await expect(page.getByTestId("terminal-workspace")).toBeVisible();
    await expect(page.getByTestId("trade-dock")).toContainText("BLOB / USDC");
  });

  test("global search resolves token, pool, and address context", async ({ page }) => {
    await page.getByRole("combobox", { name: /Search token|Token, pair/ }).fill("toshi");
    await expect(page.getByTestId("search-result-toshi-weth")).toContainText("TOSHI / WETH");
    await page.getByTestId("search-result-toshi-weth").click();
    await expect(page.getByTestId("selected-pair-title")).toHaveText("TOSHI / WETH");
  });

  test("applies filters, shows active chips, updates result count, and resets", async ({ page }) => {
    await page.getByRole("link", { name: /Markets|Piyasalar/, exact: true }).first().click();
    await expect(page).toHaveURL(/view=markets/);
    await page.getByPlaceholder(/Search token|Token \/ pair/).last().fill("BLOB");
    await expect(page.getByTestId("active-filter-chips")).toContainText(/Search: BLOB|Arama: BLOB/);
    await expect(page.getByTestId("market-result-count")).toContainText("1");
    await page.getByRole("button", { name: /Reset all filters|Tüm filtreleri sıfırla/ }).click();
    await expect(page.getByTestId("market-result-count")).toContainText("24");
    await page.getByRole("combobox", { name: /DEX filter|DEX filtresi/ }).selectOption({ index: 1 });
    await expect(page.getByTestId("active-filter-chips")).toContainText("DEX:");
    await page.getByRole("combobox", { name: /Opportunity category|Fırsat kategorisi/ }).selectOption("new");
    await expect(page.getByTestId("active-filter-chips")).toContainText(/Category:|Kategori:/);
    await page.getByRole("button", { name: /Reset all filters|Tüm filtreleri sıfırla/ }).click();
    await expect(page.getByTestId("active-filter-chips")).toHaveCount(0);
  });

  test("persists no more than four pinned markets and renders the shared multichart", async ({ page }) => {
    for (const id of ["blob-usdc", "toshi-weth", "degen-weth", "mochi-usdc"]) {
      await page.getByTestId(`matrix-row-${id}`).getByRole("button", { name: new RegExp(/Pin|izle/) }).click();
    }
    await expect(page.getByTestId("pinned-multichart")).toContainText("4/4");
    await page.reload();
    await expect(page.getByTestId("pinned-multichart")).toContainText("4/4");
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("base-terminal-lite:pinned-pairs") || "[]"));
    expect(stored).toHaveLength(4);
  });

  test("keeps alerts local and requests browser permission only after an explicit action", async ({ page }) => {
    await page.addInitScript(() => {
      (window as Window & { __permissionRequests?: number }).__permissionRequests = 0;
      if (typeof Notification !== "undefined") Object.defineProperty(Notification, "requestPermission", { configurable: true, value: () => { (window as Window & { __permissionRequests?: number }).__permissionRequests = 1; return Promise.resolve("denied"); } });
    });
    await page.goto("/terminal?data=mock&view=alerts");
    expect(await page.evaluate(() => (window as Window & { __permissionRequests?: number }).__permissionRequests)).toBe(0);
    await page.locator("#alert-center-panel input").fill("1");
    await page.getByRole("button", { name: /Add|Ekle/, exact: true }).click();
    await expect(page.getByTestId("alert-rule")).toHaveCount(1);
    await page.getByRole("button", { name: /Enable browser notifications|Tarayıcı bildirimlerini aç/ }).click();
    expect(await page.evaluate(() => (window as Window & { __permissionRequests?: number }).__permissionRequests)).toBe(1);
  });

  test("reports safe capabilities without secrets", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.ok()).toBeTruthy();
    const health = await response.json();
    expect(health).toMatchObject({ ok: true, walletTargetChainId: 8453, quoteRequestEnabled: false, transactionExecutionEnabled: false });
    expect(JSON.stringify(health).toLowerCase()).not.toContain("api_key");
    expect(JSON.stringify(health).toLowerCase()).not.toContain("lifi_api_key");
  });

  test("keeps the last good board visible and captures a delayed-source state", async ({ page }, testInfo) => {
    await page.route("**/api/market-snapshot?data=mock", (route) => route.abort("failed"));
    await page.getByTestId("refresh-terminal").click();
    await expect(page.getByText(/Delayed data|Veri gecikmeli/)).toBeVisible();
    await expect(page.getByTestId("market-result-count")).toContainText("24");
    await page.screenshot({ path: testInfo.outputPath("terminal-delayed-source-1440.png"), fullPage: true });
  });

  test("ingests a new pool for an existing token on refresh without reloading or duplicating its token row", async ({ page, request }) => {
    const initial = await (await request.get("/api/market-snapshot?data=mock")).json() as MarketTerminalSnapshot;
    const target = initial.allPairs.find((pair) => pair.opportunityId && pair.poolCount === 1)!;
    const newPoolAddress = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
    const now = new Date().toISOString();
    const newPool = { ...target, id: newPoolAddress, pairAddress: newPoolAddress, pairCreatedAt: now, pairCreatedAtMs: Date.parse(now), age: "0m", ageMinutes: 0, firstSeenAt: now, sourceUpdatedAt: now, opportunityId: undefined, poolCount: undefined, isPrimaryMarket: false };
    const discovery = buildDiscoveryUniverse([...initial.allPairs, newPool], initial.opportunities, new Date(now));
    const next: MarketTerminalSnapshot = {
      ...initial,
      version: "mock-ingestion-fixture-v2",
      allPairs: discovery.pairs,
      poolMarkets: discovery.poolMarkets,
      opportunities: discovery.opportunities,
      universe: discovery.universe,
      newPairs: [newPool],
      recentSignals: [{ key: `new_pool:base:pool:${newPoolAddress}`, type: "new_pool", pairId: newPoolAddress, pair: newPool.pair, headline: "New Base pool", detail: `${newPool.pair} entered the verified Base pool reservoir.`, createdAt: now, source: "deterministic fixture", sourceUpdatedAt: now, timeframe: "snapshot", direction: "neutral" }]
    };
    const opportunityId = target.opportunityId!;
    const row = page.getByTestId("market-matrix").locator(`table tbody [data-opportunity-id="${opportunityId}"]`);
    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute("data-pool-count", "1");
    await page.evaluate(() => { (window as Window & { __ingestionNoReload?: string }).__ingestionNoReload = "present"; });
    await page.route("**/api/market-snapshot?data=mock", (route) => route.fulfill({ json: next }));
    await page.getByTestId("refresh-terminal").click();
    await expect(row).toHaveAttribute("data-pool-count", "2");
    await expect(row).toHaveCount(1);
    expect(await page.evaluate(() => (window as Window & { __ingestionNoReload?: string }).__ingestionNoReload)).toBe("present");
    await expect(page.getByTestId("live-pulse-strip")).toContainText(/New pool|Yeni havuz/);
    await row.getByTestId("market-signal-group").getByRole("button").click();
    const multiPoolDetail = page.locator('[data-signal-detail="multi_pool"]');
    await expect(multiPoolDetail).toBeVisible();
    await multiPoolDetail.getByRole("button", { name: /Open pool details|havuz ayrıntılarını aç/i }).click();
    await expect(page.getByTestId("pool-drawer")).toBeVisible();
  });

  test("keeps canonical bounded signal semantics across tape, lanes, matrix, watchlist and pair workspace", async ({ page }) => {
    const groups = page.getByTestId("market-signal-group");
    expect(await groups.count()).toBeGreaterThan(0);
    const visibleCounts = await groups.evaluateAll((nodes) => nodes.map((node) => node.querySelectorAll(":scope > button [data-signal-type]").length));
    expect(Math.max(...visibleCounts)).toBeLessThanOrEqual(3);

    const selected = page.getByTestId("selected-pair-panel").getByTestId("market-signal-group");
    const matrix = page.getByTestId("matrix-row-pepe-weth").getByTestId("market-signal-group");
    for (const surface of [selected, matrix]) {
      await expect(surface.locator('[data-signal-type="security_unknown"]')).toHaveCount(1);
      await expect(surface.locator('[data-signal-type="delayed"]')).toHaveCount(1);
    }

    await page.getByTestId("matrix-row-pepe-weth").getByRole("button", { name: /Pin|izle/ }).click();
    const watchlist = page.getByTestId("pinned-multichart").getByTestId("market-signal-group");
    await expect(watchlist.locator('[data-signal-type="security_unknown"]')).toHaveCount(1);
    await page.getByRole("link", { name: /Watchlist|İzleme/, exact: true }).first().click();
    await expect(page).toHaveURL(/view=watchlist/);
    await expect(page.getByTestId("pinned-multichart").getByTestId("market-signal-group")).toBeVisible();

    await page.getByRole("link", { name: /Terminal/, exact: true }).first().click();
    await expect(page.getByTestId("opportunity-lanes").getByTestId("market-signal-group").first()).toBeVisible();
    await expect(page.getByText(/Public data signals|Açık veri sinyalleri/)).toBeVisible();
  });

  test("opens signal evidence by keyboard and tap, closes with Escape, and honors reduced motion", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const desktopButton = page.getByTestId("selected-pair-panel").getByTestId("market-signal-group").getByRole("button");
    await desktopButton.focus();
    const desktopPopover = page.getByTestId("market-signal-popover");
    await expect(desktopPopover).toBeVisible();
    await expect(desktopPopover).toContainText(/Source|Kaynak/);
    await expect(desktopPopover).toContainText(/Observed|Gözlem/);
    await expect(desktopPopover).toContainText(/Expires|Bitiş/);
    const entering = page.locator('[data-signal-state="entering"]').first();
    await expect(entering).toHaveCSS("animation-name", "none");
    await page.keyboard.press("Escape");
    await expect(desktopPopover).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/terminal?data=mock");
    const mobileButton = page.getByTestId("live-market-tape").getByTestId("market-signal-group").first().getByRole("button");
    await mobileButton.click();
    const mobilePopover = page.getByTestId("market-signal-popover");
    await expect(mobilePopover).toBeVisible();
    const bounds = await mobilePopover.boundingBox();
    expect(bounds?.x).toBeGreaterThanOrEqual(0);
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(390);
    await page.keyboard.press("Escape");
    await expect(mobilePopover).toHaveCount(0);
  });

  test("filters by signal with a translated empty state and persists the safe preference", async ({ page }) => {
    await page.getByRole("link", { name: /Markets|Piyasalar/, exact: true }).first().click();
    await page.getByTestId("market-signal-legend").locator("summary").click();
    await page.locator('[data-signal-filter="security_unknown"]').click();
    await expect(page.getByTestId("market-result-count")).toContainText("24");
    await expect(page.getByTestId("active-filter-chips")).toContainText(/Security not assessed|Güvenlik değerlendirilmedi/);
    await page.locator('[data-signal-filter="risk_flagged"]').click();
    await expect(page.getByTestId("market-result-count")).toContainText("0");
    await expect(page.getByText(/No qualified markets match|Uygun piyasa bulunamadı/)).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("market-result-count")).toContainText("0");

    await page.getByRole("button", { name: "en", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByTestId("market-signal-legend")).toContainText("Signals");
    await page.getByRole("button", { name: /Reset all filters/ }).click();
    await expect(page.getByTestId("market-result-count")).toContainText("24");
  });

  test("updates live badge entry, cooldown exit and TTL removal from ordered snapshots", async ({ page, request }) => {
    const initial = await (await request.get("/api/market-snapshot?data=mock")).json() as MarketTerminalSnapshot;
    const target = initial.opportunities.find((opportunity) => opportunity.primaryMarketId === initial.defaultPairId)!;
    const baseTime = Date.parse(initial.receivedAt);
    const snapshots = [
      buildSignalSnapshot(initial, target.id, new Date(baseTime + 1_000).toISOString(), 3),
      buildSignalSnapshot(initial, target.id, new Date(baseTime + 45_000).toISOString(), 2.3),
      buildSignalSnapshot(initial, target.id, new Date(baseTime + 90_000).toISOString(), 2.3)
    ];
    let refreshIndex = 0;
    await page.route("**/api/market-snapshot?data=mock", (route) => route.fulfill({ json: snapshots[Math.min(refreshIndex++, snapshots.length - 1)] }));

    const selectedSignals = page.getByTestId("selected-pair-panel").getByTestId("market-signal-group");
    await page.getByTestId("refresh-terminal").click();
    await page.getByTestId("pending-market-updates").getByRole("button").click();
    await selectedSignals.getByRole("button").click();
    await expect(page.locator('[data-signal-detail="gaining_fast"]')).toBeVisible();
    await expect(page.locator('[data-signal-detail="gaining_fast"]')).toContainText(/confirming|doğrulanıyor/i);
    await page.keyboard.press("Escape");

    await page.getByTestId("refresh-terminal").click();
    await page.getByTestId("pending-market-updates").getByRole("button").click();
    await selectedSignals.getByRole("button").click();
    await expect(page.locator('[data-signal-detail="gaining_fast"]')).toContainText(/cooldown|bekleme/i);
    await page.keyboard.press("Escape");

    await page.getByTestId("refresh-terminal").click();
    await selectedSignals.getByRole("button").click();
    await expect(page.locator('[data-signal-detail="gaining_fast"]')).toHaveCount(0);
  });

  test("is usable without horizontal page overflow at required breakpoints", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }, { width: 1024, height: 768 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.goto("/terminal?data=mock");
      await expectTerminalShell(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
      if (viewport.width === 390) {
        await expect(page.getByRole("navigation", { name: /Mobile terminal|Mobil terminal/ })).toBeVisible();
        await expect(page.getByRole("link", { name: /Wallet|Cüzdan/, exact: true })).toBeVisible();
      }
    }
    expect(consoleErrors).toEqual([]);
  });

  test("opens the selected market trade dock as a keyboard-closeable mobile sheet", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/terminal?data=mock");
    await page.getByRole("button", { name: /Open trade dock|İşlem alanını aç/ }).click();
    await expect(page.getByRole("dialog", { name: /Trade Dock|İşlem Alanı/ })).toBeVisible();
    await expect(page.getByTestId("trade-dock")).toContainText("PEPE / WETH");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: /Trade Dock|İşlem Alanı/ })).toHaveCount(0);
  });

  test("captures required terminal visual evidence", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    for (const locale of ["en", "tr"] as const) {
      await page.context().addCookies([{ name: "mergen_locale", value: locale, domain: "127.0.0.1", path: "/" }]);
      for (const viewport of [{ width: 1440, height: 900, name: "desktop-1440" }, { width: 1280, height: 800, name: "desktop-1280" }, { width: 1024, height: 768, name: "tablet-1024" }, { width: 768, height: 1024, name: "tablet-768" }, { width: 390, height: 844, name: "mobile-390" }]) {
        await page.setViewportSize(viewport);
        await page.goto("/terminal?data=mock");
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await page.screenshot({ path: testInfo.outputPath(`terminal-${locale}-${viewport.name}.png`), fullPage: true });
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/terminal?data=mock&pair=blob-usdc");
      await page.screenshot({ path: testInfo.outputPath(`pair-workspace-${locale}-1440.png`), fullPage: true });
      await page.evaluate(() => localStorage.removeItem("base-terminal-lite:pinned-pairs"));
      await page.reload();
      for (const id of ["blob-usdc", "toshi-weth", "degen-weth", "mochi-usdc"]) {
        await page.getByTestId(`matrix-row-${id}`).getByRole("button", { name: /Pin|izle/ }).click();
      }
      await expect(page.getByTestId("pinned-multichart")).toContainText("4/4");
      await page.screenshot({ path: testInfo.outputPath(`multichart-${locale}-1440.png`), fullPage: true });
      await page.getByTestId("connect-wallet-button").click();
      await page.screenshot({ path: testInfo.outputPath(`wallet-picker-${locale}-1440.png`), fullPage: true });
      await page.keyboard.press("Escape");
    }
  });
});

async function expectTerminalShell(page: Page) {
  await expect(page.getByTestId("terminal-topbar")).toBeVisible();
  await expect(page.getByTestId("pulse-terminal")).toBeVisible();
  await expect(page.getByTestId("live-pulse-strip")).toBeVisible();
}

function buildSignalSnapshot(snapshot: MarketTerminalSnapshot, opportunityId: string, generatedAt: string, change5m: number): MarketTerminalSnapshot {
  const opportunity = snapshot.opportunities.find((item) => item.id === opportunityId)!;
  return {
    ...snapshot,
    version: `signal-browser-${generatedAt}`,
    generatedAt,
    receivedAt: generatedAt,
    sourceUpdatedAt: generatedAt,
    freshness: "fresh",
    fallbackReason: undefined,
    allPairs: snapshot.allPairs.map((pair) => pair.id === opportunity.primaryMarketId ? {
      ...pair,
      stale: false,
      sourceUpdatedAt: generatedAt,
      priceUsdValue: (pair.priceUsdValue ?? 1) * (1 + change5m / 1_000),
      priceChanges: { ...pair.priceChanges, m5: change5m }
    } : pair),
    opportunities: snapshot.opportunities.map((item) => item.id === opportunityId ? {
      ...item,
      quality: "active",
      aggregate: {
        ...item.aggregate,
        liquidityUsd: 40_000,
        volumes: { ...item.aggregate.volumes, m5: 6_000 }
      },
      freshness: { newestSourceAt: generatedAt, oldestSourceAt: generatedAt, stalePoolCount: 0 }
    } : item)
  };
}
