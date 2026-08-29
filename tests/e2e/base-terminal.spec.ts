import { expect, test, type Page } from "@playwright/test";

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
    await page.getByLabel(/Search token|Token, pair/).fill("toshi");
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
