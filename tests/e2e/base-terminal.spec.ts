import { expect, test, type Page } from "@playwright/test";
import { buildDiscoveryUniverse } from "../../src/lib/base-terminal/opportunityModel";
import type { MarketTerminalSnapshot } from "../../src/data/providers";

test.describe("living Base terminal", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/terminal?data=mock");
    await expectTerminalShell(page);
  });

  test("opens on the canonical terminal with tape, pulse, six-lane wall, board and explicit overlays", async ({ page }) => {
    await expect(page).toHaveURL(/\/terminal\?data=mock$/);
    await expect(page.getByTestId("live-market-tape")).toBeVisible();
    await expect(page.getByTestId("live-pulse-rail")).toBeVisible();
    await expect(page.getByTestId("live-market-wall")).toBeVisible();
    await expect(page.locator('[data-testid^="live-wall-lane-"]')).toHaveCount(6);
    await expect(page.getByTestId("market-matrix")).toBeVisible();
    await expect(page.getByTestId("market-result-count")).toContainText("24");
    await expect(page.getByTestId("context-inspector")).toHaveCount(0);
    await expect(page.getByTestId("trade-dock")).toHaveCount(0);
    await page.getByTestId("matrix-row-blob-usdc").getByRole("button", { name: /Inspect|incele/ }).click();
    await expect(page.getByTestId("context-inspector")).toBeVisible();
    await expect(page.locator("[data-overlay-state]")).toHaveAttribute("data-overlay-state", "market_inspector");
    await page.getByTestId("context-inspector").getByRole("button", { name: /Buy|Al/, exact: true }).click();
    await expect(page.getByTestId("trade-dock")).toBeVisible();
    await expect(page.getByTestId("context-inspector")).toHaveCount(0);
  });

  test("renders address-unique token discovery by default and preserves exact pools on demand", async ({ page }) => {
    const tapeIds = await page.getByTestId("live-market-tape").locator("[data-opportunity-id]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-opportunity-id")));
    expect(new Set(tapeIds).size).toBe(tapeIds.length);

    const wallRows = page.getByTestId("live-wall-lanes").locator("[data-opportunity-id]");
    const wallIds = await wallRows.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-opportunity-id")));
    expect(new Set(wallIds).size).toBe(wallIds.length);
    await expect(page.getByTestId("live-market-wall")).toHaveAttribute("data-cross-lane-duplicates", "0");

    const tokenRows = page.getByTestId("market-matrix").locator('table tbody [data-focus-token-address]:not([data-focus-token-address=""])');
    const tokenAddresses = await tokenRows.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-focus-token-address")));
    expect(new Set(tokenAddresses).size).toBe(tokenAddresses.length);
    await page.getByTestId("open-market-columns").click();
    await page.getByTestId("market-columns-sheet").getByText(/Pools|Havuzlar/, { exact: true }).click();
    await page.getByTestId("market-columns-sheet").getByRole("button", { name: /Apply updates|Güncellemeleri uygula/ }).click();
    await expect(page.getByRole("columnheader", { name: /Pools|Havuzlar/ })).toBeVisible();
    await page.getByTestId("matrix-row-pepe-weth").getByRole("button", { name: /Inspect|incele/ }).click();
    await page.getByTestId("context-inspector").getByRole("tab", { name: /Pools|Havuzlar/ }).click();
    await page.getByTestId("context-inspector").getByRole("button", { name: /Exact execution pool set|Kesin işlem havuzu seti/ }).click();
    await expect(page.getByTestId("pool-drawer")).toBeVisible();
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
    await expect(page.getByTestId("context-inspector")).toBeVisible();
    await expect(page.getByTestId("trade-dock")).toHaveCount(0);
  });

  test("global search resolves token, pool, and address context", async ({ page }) => {
    const search = page.getByRole("combobox", { name: /Search token|Token, piyasa çifti/ });
    await expect(search).toHaveAttribute("data-search-ready", "true");
    await search.fill("blob");
    await expect(page.getByTestId("search-result-blob-usdc")).toContainText("BLOB / USDC");
    await page.getByTestId("search-result-blob-usdc").click();
    await expect(page.getByTestId("selected-pair-title")).toHaveText("BLOB / USDC");
  });

  test("applies filters, shows active chips, updates result count, and resets", async ({ page }) => {
    await page.getByRole("link", { name: /Markets|Piyasalar/, exact: true }).first().click();
    await expect(page).toHaveURL(/view=markets/);
    await page.getByTestId("open-market-filters").click();
    await page.getByTestId("market-filters-sheet").getByLabel(/Search token|Token, piyasa çifti/).fill("BLOB");
    await expect(page.getByTestId("market-result-count")).toContainText("24");
    await page.getByTestId("market-filters-sheet").getByRole("button", { name: /Apply updates|Güncellemeleri uygula/ }).click();
    await expect(page.getByTestId("active-filter-chips")).toContainText(/Search: BLOB|Arama: BLOB/);
    await expect(page.getByTestId("market-result-count")).toContainText("1");
    await page.getByRole("button", { name: /Clear filters|Filtreleri temizle/ }).click();
    await expect(page.getByTestId("market-result-count")).toContainText("24");
    await page.getByTestId("open-market-filters").click();
    await page.getByTestId("market-filters-sheet").getByLabel(/Minimum liquidity|Minimum likidite/).fill("999999999");
    await page.getByTestId("market-filters-sheet").getByRole("button", { name: /Cancel|İptal/ }).last().click();
    await expect(page.getByTestId("market-result-count")).toContainText("24");
  });

  test("persists no more than four pinned markets and renders the shared multichart", async ({ page }) => {
    for (const id of ["blob-usdc", "toshi-weth", "degen-weth", "mochi-usdc"]) {
      await page.getByTestId(`matrix-row-${id}`).getByRole("button", { name: new RegExp(/Pin|izle/) }).click();
    }
    await page.getByRole("link", { name: /Watchlist|İzleme/, exact: true }).first().click();
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
    await expect(page.getByTestId("market-feed-delayed")).toBeVisible();
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
    await expect(page.getByTestId("live-pulse-rail")).toContainText("New pool");
    await page.getByTestId("locale-switcher").getByRole("button", { name: "tr", exact: true }).click();
    await expect(page.getByTestId("live-pulse-rail")).toContainText("Yeni havuz");
    await expect(page.getByTestId("live-pulse-rail")).toContainText("görüntü");
    await expect(page.getByTestId("live-pulse-rail")).toContainText("güncel");
    await expect(row).toHaveAttribute("data-pool-count", "2");
    await expect(row).toHaveCount(1);
    expect(await page.evaluate(() => (window as Window & { __ingestionNoReload?: string }).__ingestionNoReload)).toBe("present");
    await row.getByTestId("market-signal-group").getByRole("button").click();
    const multiPoolDetail = page.locator('[data-signal-detail="multi_pool"]');
    await expect(multiPoolDetail).toBeVisible();
    await multiPoolDetail.getByRole("button", { name: /Open pool details|havuz ayrıntılarını aç/i }).click();
    await expect(page.getByTestId("pool-drawer")).toBeVisible();
  });

  test("keeps canonical bounded signal semantics across scanner, board, watchlist and inspector", async ({ page }) => {
    const groups = page.getByTestId("market-signal-group");
    const visibleCounts = await groups.evaluateAll((nodes) => nodes.map((node) => node.querySelectorAll(":scope > button [data-signal-type]").length));
    expect(Math.max(0, ...visibleCounts)).toBeLessThanOrEqual(3);

    const matrix = page.getByTestId("matrix-row-pepe-weth").getByTestId("market-signal-group");
    await expect(matrix.locator('[data-signal-type="security_unknown"]')).toHaveCount(0);
    await expect(matrix.locator('[data-signal-type="delayed"]')).toHaveCount(0);
    await page.getByTestId("matrix-row-pepe-weth").getByRole("button", { name: /Inspect|incele/ }).click();
    await page.getByTestId("context-inspector").getByRole("tab", { name: /Signals|Sinyaller/ }).click();
    const inspectorSignals = page.getByTestId("context-inspector").getByTestId("market-signal-group");
    await expect(inspectorSignals.locator('[data-signal-type="security_unknown"]')).toHaveCount(1);
    await expect(inspectorSignals.locator('[data-signal-type="delayed"]')).toHaveCount(1);

    await page.getByTestId("matrix-row-pepe-weth").getByRole("button", { name: /Pin|izle/ }).click();
    await page.getByRole("link", { name: /Watchlist|İzleme/, exact: true }).first().click();
    await expect(page).toHaveURL(/view=watchlist/);
    const watchlist = page.getByTestId("pinned-multichart").getByTestId("market-signal-group");
    await expect(watchlist.locator('[data-signal-type="security_unknown"]')).toHaveCount(0);

    await page.getByRole("link", { name: /Terminal/, exact: true }).first().click();
    await expect(page.getByTestId("live-market-wall").locator('[data-signal-type="security_unknown"]')).toHaveCount(0);
  });

  test("renders an Apple-like token as unverified data-only with a generic avatar", async ({ page, request }) => {
    const initial = await (await request.get("/api/market-snapshot?data=mock")).json() as MarketTerminalSnapshot;
    const target = initial.allPairs.find((pair) => pair.id === "blob-usdc")!;
    const opportunityId = target.opportunityId!;
    const generatedAt = new Date(Date.now() + 60_000).toISOString();
    const next: MarketTerminalSnapshot = {
      ...initial,
      version: "apple-like-identity-fixture-v1",
      generatedAt,
      receivedAt: generatedAt,
      sourceUpdatedAt: generatedAt,
      allPairs: initial.allPairs.map((pair) => pair.id === target.id ? { ...pair, baseToken: "AAPL", project: "Apple Token", tokenLogoUrl: "https://assets.coingecko.com/apple-official.png", sourceUpdatedAt: generatedAt } : pair),
      opportunities: initial.opportunities.map((opportunity) => opportunity.id === opportunityId ? { ...opportunity, focusTokenSymbol: "AAPL", focusTokenName: "Apple Token", focusTokenLogoUrl: "https://assets.coingecko.com/apple-official.png" } : opportunity)
    };
    await page.route("**/api/market-snapshot?data=mock", (route) => route.fulfill({ json: next }));
    await page.getByTestId("refresh-terminal").click();
    const row = page.getByTestId("matrix-row-blob-usdc");
    await expect(row).toContainText("AAPL");
    const avatar = row.locator('[data-identity-status="unverified"]').first();
    await expect(avatar).toHaveAttribute("data-avatar-kind", "generic");
    await expect(avatar.locator("img")).toHaveCount(0);
    const badges = row.getByTestId("asset-tradeability-group");
    await expect(badges).toHaveAttribute("data-identity-status", "unverified");
    await expect(badges).toHaveAttribute("data-tradeability-status", "market_data_only");
    await badges.click();
    await expect(page.getByTestId("asset-tradeability-popover")).toContainText(/does not prove|kanıtlamaz/i);
  });

  test("opens signal evidence by keyboard and tap, closes with Escape, and honors reduced motion", async ({ page, request }) => {
    const initial = await (await request.get("/api/market-snapshot?data=mock")).json() as MarketTerminalSnapshot;
    const target = initial.opportunities.find((opportunity) => opportunity.primaryMarketId === initial.defaultPairId)!;
    const next = buildSignalSnapshot(initial, target.id, new Date(Date.parse(initial.receivedAt) + 1_000).toISOString(), 3);
    await page.route("**/api/market-snapshot?data=mock", (route) => route.fulfill({ json: next }));
    await page.getByTestId("refresh-terminal").click();
    await page.getByTestId("pending-market-updates").click();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const desktopButton = page.getByTestId("matrix-row-pepe-weth").getByTestId("market-signal-group").getByRole("button");
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
    const mobileButton = page.getByTestId("market-card-pepe-weth").getByTestId("market-signal-group").getByRole("button");
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
    const marketsLink = page.getByRole("link", { name: /Markets|Piyasalar/, exact: true }).first();
    await marketsLink.click();
    await expect(marketsLink).toHaveAttribute("aria-current", "page");
    await page.getByTestId("open-market-filters").click();
    await page.getByTestId("market-filters-sheet").locator('[data-signal-filter="security_unknown"]').click();
    await page.getByTestId("market-filters-sheet").getByRole("button", { name: /Apply updates|Güncellemeleri uygula/ }).click();
    await expect(page.getByTestId("market-result-count")).toContainText("24");
    await expect(page.getByTestId("active-filter-chips")).toContainText(/Security not assessed|Güvenlik değerlendirilmedi/);
    await page.getByTestId("open-market-filters").click();
    await page.getByTestId("market-filters-sheet").locator('[data-signal-filter="risk_flagged"]').click();
    await page.getByTestId("market-filters-sheet").getByRole("button", { name: /Apply updates|Güncellemeleri uygula/ }).click();
    await expect(page.getByTestId("market-result-count")).toContainText("0");
    await expect(page.getByText(/No qualified markets match|Uygun piyasa bulunamadı/)).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("market-result-count")).toContainText("0");

    await page.getByRole("button", { name: "en", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.getByTestId("open-market-filters").click();
    await expect(page.getByTestId("market-filters-sheet")).toContainText("Filter by verified signals");
    await page.getByRole("button", { name: /Reset all filters/ }).click();
    await page.getByTestId("market-filters-sheet").getByRole("button", { name: /Apply updates/ }).click();
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

    const selectedSignals = page.getByTestId("matrix-row-pepe-weth").getByTestId("market-signal-group");
    await page.getByTestId("refresh-terminal").click();
    await page.getByTestId("pending-market-updates").click();
    await selectedSignals.getByRole("button").click();
    await expect(page.locator('[data-signal-detail="gaining_fast"]')).toBeVisible();
    await expect(page.locator('[data-signal-detail="gaining_fast"]')).toContainText(/confirming|doğrulanıyor/i);
    await page.keyboard.press("Escape");

    await page.getByTestId("refresh-terminal").click();
    await page.getByTestId("pending-market-updates").click();
    await selectedSignals.getByRole("button").click();
    await expect(page.locator('[data-signal-detail="gaining_fast"]')).toContainText(/cooldown|bekleme/i);
    await page.keyboard.press("Escape");

    await page.getByTestId("refresh-terminal").click();
    await expect(selectedSignals.locator('[data-signal-type="gaining_fast"]')).toHaveCount(0);
  });

  test("freezes wall ordering during focus and applies the latest bounded update after a quiet period", async ({ page, request }) => {
    const initial = await (await request.get("/api/market-snapshot?data=mock")).json() as MarketTerminalSnapshot;
    const target = initial.opportunities.find((item) => item.primaryMarketId === initial.defaultPairId)!;
    const next = buildWallChangeSnapshot(initial, target.id);
    const gainers = page.getByTestId("live-wall-lane-gainers").locator("[data-opportunity-id]");
    const before = await gainers.first().getAttribute("data-opportunity-id");
    await page.getByTestId("live-market-wall").hover();
    await page.waitForTimeout(100);
    await page.route("**/api/market-snapshot?data=mock", (route) => route.fulfill({ json: next }));
    await page.getByTestId("refresh-terminal").evaluate((button: HTMLButtonElement) => button.click());
    await expect(page.getByTestId("pending-market-updates")).toBeVisible();
    await expect(gainers.first()).toHaveAttribute("data-opportunity-id", before!);
    await page.waitForTimeout(2_500);
    await expect(page.getByTestId("pending-market-updates")).toBeVisible();
    await expect(gainers.first()).toHaveAttribute("data-opportunity-id", before!);

    await page.getByTestId("refresh-terminal").hover();
    await page.getByTestId("refresh-terminal").focus();
    await expect(page.getByTestId("pending-market-updates")).toHaveCount(0, { timeout: 5_000 });
    await expect(page.getByTestId("live-wall-lane-gainers").locator(`[data-opportunity-id="${target.id}"]`)).toBeVisible();
  });

  test("is usable without horizontal page overflow at required breakpoints", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    for (const viewport of [{ width: 2048, height: 1024 }, { width: 1728, height: 1080 }, { width: 1440, height: 900 }, { width: 1280, height: 800 }, { width: 1024, height: 768 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.goto("/terminal?data=mock");
      await expectTerminalShell(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
      if (viewport.width === 1024) {
        const walletLabelFits = await page.getByTestId("connect-wallet-button").locator("span").evaluate((label) => label.scrollWidth <= label.clientWidth);
        expect(walletLabelFits).toBeTruthy();
      }
      if (viewport.width === 2048) {
        const laneBounds = await page.locator('[data-testid^="live-wall-lane-"]').evaluateAll((lanes) => lanes.map((lane) => lane.getBoundingClientRect()));
        expect(laneBounds).toHaveLength(6);
        expect(laneBounds.every((bounds) => bounds.left >= 0 && bounds.right <= viewport.width)).toBeTruthy();
      }
      if (viewport.width === 1440) {
        const visibleBadgeCounts = await page.getByTestId("market-board-table").locator("tbody tr").evaluateAll((rows) => rows.map((row) => row.querySelectorAll("[data-signal-type], [data-testid='asset-identity-badge'], [data-testid='tradeability-badge']").length));
        expect(Math.max(...visibleBadgeCounts)).toBeLessThanOrEqual(3);
      }
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
    await page.getByTestId("market-card-pepe-weth").getByRole("button", { name: /Inspect|incele/ }).click();
    await page.getByTestId("context-inspector").getByRole("button", { name: /Buy|Al/, exact: true }).click();
    await expect(page.getByRole("dialog", { name: /Trade Dock|İşlem Alanı/ })).toBeVisible();
    await expect(page.getByTestId("trade-dock")).toContainText("PEPE / WETH");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: /Trade Dock|İşlem Alanı/ })).toHaveCount(0);
  });

  test("captures required terminal visual evidence", async ({ page, request }, testInfo) => {
    test.setTimeout(180_000);
    for (const locale of ["en", "tr"] as const) {
      await page.context().addCookies([{ name: "mergen_locale", value: locale, domain: "127.0.0.1", path: "/" }]);
      for (const viewport of [{ width: 2048, height: 1024, name: "desktop-2048" }, { width: 1728, height: 1080, name: "desktop-1728" }, { width: 1440, height: 900, name: "desktop-1440" }, { width: 1280, height: 800, name: "desktop-1280" }, { width: 1024, height: 768, name: "tablet-1024" }, { width: 768, height: 1024, name: "tablet-768" }, { width: 390, height: 844, name: "mobile-390" }]) {
        await page.setViewportSize(viewport);
        await page.goto("/terminal?data=mock");
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await page.screenshot({ path: testInfo.outputPath(`terminal-${locale}-${viewport.name}.png`), fullPage: true });
        if (viewport.width === 390) {
          await page.getByTestId("market-card-pepe-weth").getByRole("button", { name: /Inspect|incele/ }).click();
          await expect(page.getByTestId("context-inspector")).toBeVisible();
          await page.screenshot({ path: testInfo.outputPath(`market-sheet-${locale}-mobile-390.png`), fullPage: false });
          await page.getByTestId("context-inspector").getByRole("button", { name: /Buy|Al/, exact: true }).click();
          await expect(page.locator("[data-overlay-state]")).toHaveAttribute("data-overlay-state", "trade_drawer");
          await expect(page.getByRole("dialog", { name: /Trade Dock|İşlem Alanı/ })).toBeVisible();
          await page.screenshot({ path: testInfo.outputPath(`trade-sheet-${locale}-mobile-390.png`), fullPage: false });
        }
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/terminal?data=mock");
      const visualInitial = await (await request.get("/api/market-snapshot?data=mock")).json() as MarketTerminalSnapshot;
      await page.screenshot({ path: testInfo.outputPath(`market-board-compact-${locale}-1440.png`), fullPage: true });
      await page.getByTestId("market-density-comfortable").click();
      await expect(page.getByTestId("market-density-comfortable")).toHaveAttribute("aria-pressed", "true");
      await page.screenshot({ path: testInfo.outputPath(`market-board-comfortable-${locale}-1440.png`), fullPage: true });
      await page.getByTestId("market-density-compact").click();
      const visualWall = buildVisualWallSnapshot(visualInitial);
      await page.route("**/api/market-snapshot?data=mock", (route) => route.fulfill({ json: visualWall }));
      await page.getByTestId("refresh-terminal").click();
      await expect(page.locator('[data-cell-updated="true"]').first()).toBeVisible({ timeout: 800 });
      await page.screenshot({ path: testInfo.outputPath(`market-cell-update-tint-${locale}-1440.png`), fullPage: true });
      await expect(page.getByTestId("live-wall-lane-new")).toHaveAttribute("data-lane-count", "4");
      await expect(page.getByTestId("live-wall-lane-losers")).toHaveAttribute("data-lane-count", "4");
      await page.screenshot({ path: testInfo.outputPath(`lane-gainers-${locale}-1440.png`), fullPage: false });
      await page.screenshot({ path: testInfo.outputPath(`lane-losers-${locale}-1440.png`), fullPage: false });
      await expect(page.getByTestId("live-wall-lane-volume")).toHaveAttribute("data-lane-fallback", "true");
      await page.screenshot({ path: testInfo.outputPath(`lane-volume-fallback-${locale}-1440.png`), fullPage: false });
      const signalTrigger = page.getByTestId("market-matrix").getByTestId("market-signal-group").getByRole("button").first();
      await signalTrigger.click();
      await expect(page.getByTestId("market-signal-popover")).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`signal-popover-${locale}-1440.png`), fullPage: false });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.screenshot({ path: testInfo.outputPath(`reduced-motion-signal-${locale}-1440.png`), fullPage: false });
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.keyboard.press("Escape");

      await page.unroute("**/api/market-snapshot?data=mock");
      const removed = buildLiquidityRemovedSnapshot(visualInitial);
      await page.route("**/api/market-snapshot?data=mock", (route) => route.fulfill({ json: removed }));
      await page.getByTestId("refresh-terminal").click();
      await expect(page.getByTestId("pending-market-updates")).toBeVisible();
      await page.getByTestId("pending-market-updates").click();
      await page.getByTestId("live-wall-lane-liquidity").getByRole("button", { name: /Removed|Çıktı/ }).click();
      await expect(page.getByTestId("live-wall-lane-liquidity")).toHaveAttribute("data-lane-count", "1");
      await page.screenshot({ path: testInfo.outputPath(`lane-liquidity-removed-${locale}-1440.png`), fullPage: false });
      await page.unroute("**/api/market-snapshot?data=mock");

      await page.goto("/terminal?data=mock");
      const delayedAt = new Date(Date.parse(visualInitial.generatedAt) + 180_000).toISOString();
      const delayedWall: MarketTerminalSnapshot = {
        ...visualInitial,
        version: `visual-delayed-${locale}`,
        generatedAt: delayedAt,
        receivedAt: delayedAt,
        sourceUpdatedAt: delayedAt,
        freshness: "delayed",
        allPairs: visualInitial.allPairs.map((pair) => ({ ...pair, stale: true, sourceUpdatedAt: delayedAt }))
      };
      await page.route("**/api/market-snapshot?data=mock", (route) => route.fulfill({ json: delayedWall }));
      await page.getByTestId("refresh-terminal").click();
      const delayedPending = page.getByTestId("pending-market-updates");
      if (await delayedPending.isVisible()) await delayedPending.click();
      await expect(page.getByTestId("live-wall-lane-gainers")).toHaveAttribute("data-lane-count", "0");
      await expect(page.getByTestId("live-wall-lane-gainers")).toHaveAttribute("data-lane-freshness", "delayed");
      await page.screenshot({ path: testInfo.outputPath(`lane-empty-delayed-${locale}-1440.png`), fullPage: true });
      await page.unroute("**/api/market-snapshot?data=mock");

      await page.goto("/terminal?data=mock&pair=blob-usdc");
      await expect(page.getByTestId("context-inspector")).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`inspector-${locale}-1440.png`), fullPage: false });
      await page.getByTestId("context-inspector").getByRole("button", { name: /Buy|Al/, exact: true }).click();
      await expect(page.locator("[data-overlay-state]")).toHaveAttribute("data-overlay-state", "trade_drawer");
      await expect(page.getByRole("dialog", { name: /Trade Dock|İşlem Alanı/ })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`trade-drawer-${locale}-1440.png`), fullPage: false });
      await page.keyboard.press("Escape");
      await page.goto("/terminal?data=mock&view=workspace&pair=blob-usdc");
      await page.screenshot({ path: testInfo.outputPath(`pair-workspace-${locale}-1440.png`), fullPage: true });
      await page.evaluate(() => localStorage.removeItem("base-terminal-lite:pinned-pairs"));
      await page.goto("/terminal?data=mock");
      for (const id of ["blob-usdc", "toshi-weth", "degen-weth", "mochi-usdc"]) {
        await page.getByTestId(`matrix-row-${id}`).getByRole("button", { name: /Pin|izle/ }).click();
      }
      await page.getByRole("link", { name: /Watchlist|İzleme/, exact: true }).first().click();
      await expect(page.getByTestId("pinned-multichart")).toContainText("4/4");
      await page.screenshot({ path: testInfo.outputPath(`multichart-${locale}-1440.png`), fullPage: true });
      await page.getByTestId("connect-wallet-button").click();
      await page.screenshot({ path: testInfo.outputPath(`wallet-picker-${locale}-1440.png`), fullPage: false });
      await page.keyboard.press("Escape");
      await page.goto("/status?data=mock");
      await page.screenshot({ path: testInfo.outputPath(`secondary-status-${locale}-1440.png`), fullPage: true });
      await page.goto("/calm-market-intelligence-missing");
      await page.screenshot({ path: testInfo.outputPath(`state-404-${locale}-1440.png`), fullPage: true });
    }
  });
});

async function expectTerminalShell(page: Page) {
  await expect(page.getByTestId("terminal-topbar")).toBeVisible();
  await expect(page.getByTestId("pulse-terminal")).toBeVisible();
  await expect(page.getByTestId("live-market-tape")).toBeVisible();
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

function buildWallChangeSnapshot(snapshot: MarketTerminalSnapshot, opportunityId: string): MarketTerminalSnapshot {
  const opportunity = snapshot.opportunities.find((item) => item.id === opportunityId)!;
  const baseTime = Number.isFinite(Date.parse(snapshot.generatedAt)) ? Date.parse(snapshot.generatedAt) : Date.now();
  const generatedAt = new Date(baseTime + 1_000).toISOString();
  return {
    ...snapshot,
    version: `wall-focus-${generatedAt}`,
    generatedAt,
    receivedAt: generatedAt,
    sourceUpdatedAt: generatedAt,
    allPairs: snapshot.allPairs.map((pair) => pair.id === opportunity.primaryMarketId ? {
      ...pair,
      stale: false,
      sourceUpdatedAt: generatedAt,
      priceUsdValue: (pair.priceUsdValue ?? 1) * 1.01,
      priceChanges: { ...pair.priceChanges, h1: 999 }
    } : pair)
  };
}

function buildLiquidityRemovedSnapshot(snapshot: MarketTerminalSnapshot): MarketTerminalSnapshot {
  const target = snapshot.opportunities.find((item) => item.quality === "active" && (item.aggregate.liquidityUsd ?? 0) >= 20_000)!;
  const previousLiquidity = target.aggregate.liquidityUsd!;
  const currentLiquidity = previousLiquidity - 5_000;
  const baseTime = Number.isFinite(Date.parse(snapshot.generatedAt)) ? Date.parse(snapshot.generatedAt) : Date.now();
  const previousGeneratedAt = new Date(baseTime).toISOString();
  const generatedAt = new Date(baseTime + 60_000).toISOString();
  const emptyTransactions = { m5: { buys: 0, sells: 0 }, h1: { buys: 0, sells: 0 }, h6: { buys: 0, sells: 0 }, h24: { buys: 0, sells: 0 } };
  const emptyVolumes = { m5: 0, h1: 0, h6: 0, h24: 0 };
  return {
    ...snapshot,
    version: `liquidity-removed-${generatedAt}`,
    generatedAt,
    receivedAt: generatedAt,
    sourceUpdatedAt: generatedAt,
    freshness: "fresh",
    comparison: {
      status: "ready",
      previousGeneratedAt,
      opportunityVolume1h: {},
      opportunityMetrics: {
        [target.id]: { liquidityUsd: previousLiquidity, volumes: emptyVolumes, transactions: emptyTransactions }
      }
    },
    allPairs: snapshot.allPairs.map((pair) => pair.id === target.primaryMarketId ? {
      ...pair,
      stale: false,
      sourceUpdatedAt: generatedAt,
      liquidityUsd: currentLiquidity,
      liquidity: currentLiquidity,
      pairCreatedAt: new Date(baseTime - 8 * 24 * 60 * 60 * 1_000).toISOString(),
      pairCreatedAtMs: baseTime - 8 * 24 * 60 * 60 * 1_000,
      priceChanges: { m5: 0, h1: 0, h6: 0, h24: 0 },
      volumes: emptyVolumes,
      transactions: emptyTransactions
    } : pair),
    opportunities: snapshot.opportunities.map((item) => item.id === target.id ? {
      ...item,
      newestPoolCreatedAt: new Date(baseTime - 8 * 24 * 60 * 60 * 1_000).toISOString(),
      aggregate: { ...item.aggregate, liquidityUsd: currentLiquidity, volumes: emptyVolumes, transactions: emptyTransactions },
      freshness: { newestSourceAt: generatedAt, oldestSourceAt: generatedAt, stalePoolCount: 0 }
    } : item)
  };
}

function buildVisualWallSnapshot(snapshot: MarketTerminalSnapshot): MarketTerminalSnapshot {
  const targets = snapshot.opportunities.filter((item) => item.quality === "active" && (item.aggregate.liquidityUsd ?? 0) >= 10_000);
  const recentIds = new Set(targets.slice(0, 4).map((item) => item.id));
  const loserIds = new Set(targets.slice(4, 8).map((item) => item.id));
  const targetByPrimary = new Map(targets.map((item) => [item.primaryMarketId, item.id]));
  const zeroVolumes = { m5: 0, h1: 0, h6: 0, h24: 0 };
  const zeroTransactions = { m5: { buys: 0, sells: 0 }, h1: { buys: 0, sells: 0 }, h6: { buys: 0, sells: 0 }, h24: { buys: 0, sells: 0 } };
  const baseTime = Number.isFinite(Date.parse(snapshot.generatedAt)) ? Date.parse(snapshot.generatedAt) : Date.now();
  const generatedAt = new Date(baseTime + 1_000).toISOString();
  const recentAt = new Date(baseTime - 60 * 60 * 1_000).toISOString();
  return {
    ...snapshot,
    version: `visual-wall-${generatedAt}`,
    generatedAt,
    receivedAt: generatedAt,
    sourceUpdatedAt: generatedAt,
    allPairs: snapshot.allPairs.map((pair) => {
      const opportunityId = targetByPrimary.get(pair.id);
      if (!opportunityId) return pair;
      return {
        ...pair,
        stale: false,
        sourceUpdatedAt: generatedAt,
        pairCreatedAt: recentIds.has(opportunityId) ? recentAt : pair.pairCreatedAt,
        pairCreatedAtMs: recentIds.has(opportunityId) ? Date.parse(recentAt) : pair.pairCreatedAtMs,
        priceChanges: loserIds.has(opportunityId) ? { ...pair.priceChanges, h1: -10 - targets.findIndex((item) => item.id === opportunityId) } : pair.priceChanges
      };
    }),
    opportunities: snapshot.opportunities.map((item) => {
      if (recentIds.has(item.id)) return {
        ...item,
        newestPoolCreatedAt: recentAt,
        aggregate: { ...item.aggregate, liquidityUsd: 500, volumes: zeroVolumes, transactions: zeroTransactions },
        freshness: { newestSourceAt: generatedAt, oldestSourceAt: generatedAt, stalePoolCount: 0 }
      };
      if (loserIds.has(item.id)) return {
        ...item,
        aggregate: { ...item.aggregate, volumes: zeroVolumes, transactions: zeroTransactions },
        freshness: { newestSourceAt: generatedAt, oldestSourceAt: generatedAt, stalePoolCount: 0 }
      };
      return item;
    })
  };
}
