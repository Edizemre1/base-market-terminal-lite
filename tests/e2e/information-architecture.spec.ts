import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { presentMarketSignals } from "../../src/components/base-terminal/MarketSignalBadges";
import { shouldPresentAssetBadges } from "../../src/components/base-terminal/AssetTradeabilityBadges";
import type { MarketSignalBadge } from "../../src/lib/base-terminal/marketSignals";

test.describe("information architecture and overlay hierarchy", () => {
  test("keeps the canonical overlay enum explicit", () => {
    const source = readFileSync(path.resolve(process.cwd(), "src/components/OverlayManager.tsx"), "utf8");
    for (const state of ["none", "signal_details", "filters", "columns", "market_inspector", "pool_drawer", "trade_drawer", "wallet_picker", "transaction_review"]) {
      expect(source).toContain(`\"${state}\"`);
    }
  });

  test("suppresses neutral row repetition but keeps critical and inspector detail", () => {
    expect(shouldPresentAssetBadges({ status: "unverified", resemblesKnownBrand: false }, { status: "market_data_only" }, "rowCritical")).toBeFalsy();
    expect(shouldPresentAssetBadges({ status: "conflicting", resemblesKnownBrand: false }, { status: "market_data_only" }, "rowCritical")).toBeTruthy();
    expect(shouldPresentAssetBadges({ status: "unverified", resemblesKnownBrand: false }, { status: "no_route" }, "rowCritical")).toBeTruthy();
    expect(shouldPresentAssetBadges({ status: "unverified", resemblesKnownBrand: false }, { status: "market_data_only" }, "inspectorDetails")).toBeTruthy();

    const neutral = badge("security_unknown");
    const primary = badge("moving_now");
    expect(presentMarketSignals([neutral, primary], "rowPrimary").map((item) => item.type)).toEqual(["moving_now"]);
    expect(presentMarketSignals([neutral, primary], "inspectorDetails")).toHaveLength(2);
  });

  test("opens one explicit main layer, restores suspended trade, and preserves route history", async ({ page }) => {
    await page.goto("/terminal?data=mock");
    await expect(page.locator("[data-overlay-state]")).toHaveAttribute("data-overlay-state", "none");
    await expect(page.getByTestId("trade-dock")).toHaveCount(0);

    const inspect = page.getByTestId("matrix-row-pepe-weth").getByRole("button", { name: /Inspect|incele/ });
    await inspect.focus();
    await inspect.click();
    await expect(page.locator("[data-overlay-state]")).toHaveAttribute("data-overlay-state", "market_inspector");
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(page).toHaveURL(/pair=0x[0-9a-f]{40}/);

    await page.getByTestId("context-inspector").getByRole("button", { name: /Buy|Al/, exact: true }).click();
    await expect(page.locator("[data-overlay-state]")).toHaveAttribute("data-overlay-state", "trade_drawer");
    await expect(page.getByRole("dialog")).toHaveCount(1);

    const walletTrigger = page.getByTestId("trade-dock").getByRole("button", { name: /Connect Wallet|Cüzdan bağla/ });
    await walletTrigger.click();
    await expect(page.locator("[data-overlay-state]")).toHaveAttribute("data-overlay-state", "wallet_picker");
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-overlay-state]")).toHaveAttribute("data-overlay-state", "trade_drawer");
    await expect(walletTrigger).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-overlay-state]")).toHaveAttribute("data-overlay-state", "none");
    await expect(page.getByTestId("trade-dock")).toHaveCount(0);
  });

  test("keeps the pair workspace route-backed across browser back and forward", async ({ page }) => {
    await page.goto("/terminal?data=mock");
    await page.getByTestId("matrix-row-pepe-weth").getByRole("button", { name: /Inspect|incele/ }).click();
    await expect(page.getByTestId("context-inspector")).toBeVisible();
    await expect(page).toHaveURL(/pair=/);
    await page.getByTestId("context-inspector").getByRole("button", { name: /Market workspace|Piyasa çalışma alanı/i }).click();
    await expect(page).toHaveURL(/view=workspace/);
    await expect(page.getByTestId("pair-workspace")).toBeVisible();
    await expect(page.locator("[data-overlay-state]")).toHaveAttribute("data-overlay-state", "none");

    await page.goBack();
    await expect(page).not.toHaveURL(/view=workspace/);
    await expect(page.getByTestId("context-inspector")).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(/view=workspace/);
    await expect(page.getByTestId("pair-workspace")).toBeVisible();
    await expect(page.getByTestId("context-inspector")).toHaveCount(0);
  });
});

function badge(type: MarketSignalBadge["type"]): MarketSignalBadge {
  return {
    id: type,
    type,
    scope: "opportunity",
    subjectId: "subject",
    labelKey: `marketSignal.${type}`,
    shortLabelKey: `marketSignal.${type}.short`,
    iconKey: "activity",
    tone: "neutral",
    priority: 1,
    reasonCode: type,
    source: "test",
    observedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-01T00:01:00.000Z",
    state: "active"
  } as MarketSignalBadge;
}
