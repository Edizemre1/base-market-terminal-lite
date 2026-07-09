import { expect, test, type Page } from "@playwright/test";

test.describe("Base Terminal Lite smoke coverage", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expectTerminalShell(page);
  });

  test("loads the default mock terminal and keeps swap read-only", async ({ page }) => {
    await expect(page.getByTestId("terminal-topbar")).toContainText("Mergen.finance");
    await expect(page.getByTestId("feed-new")).toContainText("New Pairs");
    await expect(page.getByTestId("selected-pair-panel")).toContainText("Selected market");
    await expect(page.getByTestId("swap-preview-panel")).toContainText("Execution preview");
    await expect(page.getByTestId("review-swap-button")).toBeDisabled();
    await expect(page.getByText(/no transaction will be sent/i)).toBeVisible();
    await expect(page.getByText(/connect wallet/i)).toHaveCount(0);
  });

  test("loads read-only market data mode without crashing", async ({ page }) => {
    await page.goto("/?data=dexscreener");
    await expect(page.getByTestId("terminal-topbar")).toContainText("Mergen.finance");
    await expect(page.getByRole("button", { name: /read-only data/i })).toBeVisible();
    await expect(page.getByTestId("feed-inflow")).toBeVisible();
    await expect(page.getByTestId("selected-pair-panel")).toBeVisible();
    await expect(page.getByTestId("swap-preview-panel")).toBeVisible();
    await expect(page.getByTestId("review-swap-button")).toBeDisabled();
  });

  test("clicking a pair updates selected pair and restores through the URL", async ({ page }) => {
    await page.getByTestId("pair-row-new-blob-usdc").getByRole("button").first().click();

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

    await page.getByTestId("pin-pair-new-blob-usdc").click();
    await expect(page.getByTestId("pinned-pair-blob-usdc")).toContainText("BLOB / USDC");

    await page.reload();
    await expectTerminalShell(page);
    await expect(page.getByTestId("pinned-pair-blob-usdc")).toContainText("BLOB / USDC");

    await page
      .getByTestId("pinned-pair-blob-usdc")
      .getByRole("button", { name: "Unpin BLOB / USDC" })
      .click();
    await expect(page.getByTestId("pinned-pair-blob-usdc")).toHaveCount(0);
    await expect(page.getByTestId("pinned-pairs-panel")).toContainText("No pinned pairs");
  });

  test("radar presets and sorting keep the terminal stable", async ({ page }) => {
    const initialPair = await page.getByTestId("selected-pair-title").innerText();

    await page.getByTestId("radar-preset-liquid").click();
    await expect(page.getByTestId("radar-filters")).toBeVisible();
    await expect(page.getByTestId("selected-pair-title")).toHaveText(initialPair);

    await page.getByTestId("radar-select-sort").selectOption("volume-desc");
    await expect(page.getByTestId("feed-inflow")).toBeVisible();
    await expect(page.getByTestId("selected-pair-panel")).toBeVisible();
    await expect(page.getByTestId("swap-preview-panel")).toBeVisible();
  });

  test("provider health and chart refresh keep last good terminal data visible", async ({ page }) => {
    await expect(page.getByTestId("provider-health-status")).toBeVisible();

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
      readOnly: true
    });
    expect(JSON.stringify(health).toLowerCase()).not.toContain("secret");
    expect(JSON.stringify(health).toLowerCase()).not.toContain("api_key");

    await page.goto("/status");
    await expect(page.getByRole("heading", { name: "Public demo status" })).toBeVisible();
    await expect(page.getByText("No transaction execution")).toBeVisible();
    await expect(page.getByText("No API keys or secrets are exposed")).toBeVisible();
    await expect(page.getByText("CI smoke tests")).toBeVisible();
  });
});

async function expectTerminalShell(page: Page) {
  await expect(page.getByTestId("terminal-topbar")).toBeVisible();
  await expect(page.getByTestId("radar-filters")).toBeVisible();
  await expect(page.getByTestId("feed-new")).toBeVisible();
  await expect(page.getByTestId("selected-pair-panel")).toBeVisible();
  await expect(page.getByTestId("swap-preview-panel")).toBeVisible();
}

async function waitForWatchlistStorage(page: Page) {
  await page.waitForFunction(() =>
    window.localStorage.getItem("base-terminal-lite:pinned-pairs") !== null
  );
}
