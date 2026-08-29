import { expect, test, type Page } from "@playwright/test";

test.describe("Base Terminal Lite smoke coverage", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?data=mock");
    await expectTerminalShell(page);
  });

  test("loads the explicitly selected sample terminal and keeps swap read-only", async ({ page }) => {
    await expect(page.getByTestId("terminal-topbar")).toContainText("Mergen.finance");
    await expect(page.getByTestId("market-discovery")).toContainText("Market Discovery");
    await expect(page.getByTestId("market-discovery")).toContainText("Volume Leaders");
    await expect(page.getByTestId("selected-pair-panel")).toContainText("Selected market");
    await expect(page.getByTestId("swap-preview-panel")).toContainText("Wallet & quote");
    await expect(page.getByTestId("swap-preview-panel")).toContainText("Indicative quote unavailable");
    await expect(page.getByTestId("swap-preview-panel")).not.toContainText("$0.84");
    await expect(page.getByTestId("swap-preview-panel")).not.toContainText("-0.24%");
    await expect(page.getByTestId("review-swap-button")).toBeDisabled();
    await expect(page.getByText(/approval, swap and transaction creation remain disabled/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /connect wallet/i }).first()).toBeVisible();
    await expect(page.getByTestId("terminal-topbar")).not.toContainText("0xDemo");
  });

  test("loads the default read-only market data mode without sample substitution", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    await page.goto("/");
    await expect(page.getByTestId("terminal-topbar")).toContainText("Mergen.finance");
    await expect(page.getByRole("button", { name: "Read-only", exact: true })).toBeVisible();
    await expect(page.locator("body")).toContainText(
      /Selected market|Live market data is temporarily unavailable/
    );
    await expect(page.locator("body")).not.toContainText("Demo fallback selected");
    expect(consoleErrors).toEqual([]);
  });

  test("clicking a pair updates selected pair and restores through the URL", async ({ page }) => {
    await page.getByTestId("discovery-row-blob-usdc").getByRole("button").first().click();

    await expect(page.getByTestId("selected-pair-title")).toHaveText("BLOB / USDC");
    await expect(page).toHaveURL(/pair=blob-usdc/);

    await page.reload();
    await expectTerminalShell(page);
    await expect(page.getByTestId("selected-pair-title")).toHaveText("BLOB / USDC");
  });

  test("search can select a loaded pair", async ({ page }) => {
    await page.getByLabel("Search token, pair, or contract").fill("toshi");
    await expect(page.getByTestId("search-result-toshi-weth")).toContainText("TOSHI / WETH");

    await page.getByTestId("search-result-toshi-weth").click();

    await expect(page.getByTestId("selected-pair-title")).toHaveText("TOSHI / WETH");
    await expect(page).toHaveURL(/pair=toshi-weth/);
  });

  test("watchlist pins persist in localStorage and can be removed", async ({ page }) => {
    await waitForWatchlistStorage(page);

    await page.locator('[data-testid="pin-discovery-blob-usdc"]:visible').click();
    await page.getByTestId("discovery-category-watchlist").click();
    await expect(page.locator('[data-testid="discovery-row-blob-usdc"]:visible')).toContainText("BLOB / USDC");

    await page.reload();
    await expectTerminalShell(page);
    await page.getByTestId("discovery-category-watchlist").click();
    await expect(page.locator('[data-testid="discovery-row-blob-usdc"]:visible')).toContainText("BLOB / USDC");

    await page.locator('[data-testid="pin-discovery-blob-usdc"]:visible').click();
    await expect(page.getByTestId("discovery-row-blob-usdc")).toHaveCount(0);
  });

  test("discovery categories, advanced filters and selected-pair recovery stay coherent", async ({ page }) => {
    const initialPair = await page.getByTestId("selected-pair-title").innerText();

    await page.getByTestId("discovery-category-liquidity").click();
    await page.getByRole("button", { name: /^filters$/i }).click();
    await expect(page.getByTestId("discovery-advanced-filters")).toBeVisible();
    await page.getByLabel("Minimum liquidity ($)").fill("999999999");
    await expect(page.getByTestId("discovery-result-count")).toContainText("0 results");
    await expect(page.getByText(/is hidden by this category or the current filters/i)).toBeVisible();
    await page.getByRole("button", { name: "Show selected" }).click();
    await expect(page.locator(`[data-testid="discovery-row-${await selectedPairIdFromUrl(page)}"]:visible`)).toBeVisible();
    await expect(page.getByTestId("selected-pair-title")).toHaveText(initialPair);

    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page.getByTestId("market-discovery")).toBeVisible();
    await expect(page.getByTestId("selected-pair-panel")).toBeVisible();
    await expect(page.getByTestId("swap-preview-panel")).toBeVisible();
  });

  test("recent markets persist locally", async ({ page }) => {
    await page.getByTestId("discovery-row-blob-usdc").getByRole("button").first().click();
    await page.reload();
    await expectTerminalShell(page);
    await page.getByTestId("discovery-category-recent").click();
    await expect(page.locator('[data-testid="discovery-row-blob-usdc"]:visible')).toBeVisible();
  });

  test("provider health and chart refresh keep last good terminal data visible", async ({ page }) => {
    await expect(page.getByTestId("market-discovery")).toContainText("Sample dataset");

    await page.getByRole("button", { name: /^refresh$/i }).click();

    await expect(page.getByTestId("chart-panel")).toBeVisible();
    await expect(page.getByTestId("selected-pair-panel")).toBeVisible();
    await expect(page.getByTestId("swap-preview-panel")).toBeVisible();
    await expect(page.getByTestId("review-swap-button")).toBeDisabled();
  });

  test("status and health surfaces expose safe read-only metadata", async ({ page, request }) => {
    const response = await request.get("/api/health");
    expect(response.ok()).toBeTruthy();
    const health = await response.json();

    expect(health).toMatchObject({
      ok: true,
      app: "Mergen.finance",
      version: "0.1.0",
      readOnly: true,
      publicReadOnlyReady: true,
      walletConnectionEnabled: true,
      walletTargetChainId: 8453,
      approvalRequestEnabled: false,
      swapRequestEnabled: false,
      transactionExecutionEnabled: false
    });
    expect(JSON.stringify(health).toLowerCase()).not.toContain("secret");
    expect(JSON.stringify(health).toLowerCase()).not.toContain("api_key");

    await page.goto("/status");
    await expect(page.getByRole("heading", { name: "Public terminal status" })).toBeVisible();
    await expect(page.getByText("No transaction execution")).toBeVisible();
    await expect(page.getByText("No API keys or secrets are exposed")).toBeVisible();
    await expect(page.getByText("CI smoke tests")).toBeVisible();
  });

  test("keeps the primary terminal usable across desktop, tablet, and mobile", async ({ page }) => {
    const viewports = [
      { width: 1440, height: 900, minChart: 340, maxChart: 400 },
      { width: 1280, height: 800, minChart: 300, maxChart: 360 },
      { width: 1024, height: 768, minChart: 300, maxChart: 360 },
      { width: 768, height: 1024, minChart: 300, maxChart: 360 },
      { width: 390, height: 844, minChart: 260, maxChart: 320 }
    ];

    const consoleProblems: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" || /hydration|\b418\b/i.test(message.text())) {
        consoleProblems.push(message.text());
      }
    });

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto("/?data=mock");
      await expect(page.getByTestId("terminal-topbar")).toBeVisible();
      await expect(page.getByLabel("Search token, pair, or contract")).toBeVisible();
      await expect(page.getByTestId("selected-pair-panel")).toBeVisible();
      await expect(page.getByTestId("swap-preview-panel")).toBeVisible();
      const chartBox = await page.getByTestId("chart-panel").boundingBox();
      expect(chartBox?.height).toBeGreaterThanOrEqual(viewport.minChart);
      expect(chartBox?.height).toBeLessThanOrEqual(viewport.maxChart);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBeTruthy();
    }

    expect(consoleProblems).toEqual([]);
  });

  test("serves core routes and brand assets without console or server errors", async ({ page, request }) => {
    const consoleErrors: string[] = [];
    const serverErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("response", (response) => {
      if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`);
    });

    for (const route of ["/?data=mock", "/dashboard?data=mock", "/swap?data=mock", "/status?data=mock"]) {
      await page.goto(route);
      await expect(page.getByTestId("terminal-topbar")).toBeVisible();
    }

    const logo = await request.get("/brand/mergen-mark.svg");
    const favicon = await request.get("/favicon.ico");
    expect(logo.ok()).toBeTruthy();
    expect(favicon.status()).toBe(200);
    expect(consoleErrors).toEqual([]);
    expect(serverErrors).toEqual([]);
  });
});

async function expectTerminalShell(page: Page) {
  await expect(page.getByTestId("terminal-topbar")).toBeVisible();
  await expect(page.getByTestId("market-discovery")).toBeVisible();
  await expect(page.getByTestId("selected-pair-panel")).toBeVisible();
  await expect(page.getByTestId("swap-preview-panel")).toBeVisible();
}

async function selectedPairIdFromUrl(page: Page) {
  const pair = new URL(page.url()).searchParams.get("pair");
  return pair ?? "pepe-weth";
}

async function waitForWatchlistStorage(page: Page) {
  await page.waitForFunction(() =>
    window.localStorage.getItem("base-terminal-lite:pinned-pairs") !== null
  );
}
