import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { presentMarketSignals } from "../../src/components/base-terminal/MarketSignalBadges";
import { shouldPresentAssetBadges } from "../../src/components/base-terminal/AssetTradeabilityBadges";
import type { MarketSignalBadge } from "../../src/lib/base-terminal/marketSignals";

test.describe("information architecture and overlay hierarchy", () => {
  test("keeps the canonical overlay enum explicit", () => {
    const source = readFileSync(path.resolve(process.cwd(), "src/components/OverlayManager.tsx"), "utf8");
    for (const state of ["none", "signal_details", "filters", "columns", "market_inspector", "market_board", "pool_drawer", "trade_drawer", "mergen_profile", "wallet_picker", "transaction_review"]) {
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

  test("replaces primary overlays while restoring only nested decision sheets", async ({ page }) => {
    await page.goto("/terminal?data=mock");
    await expect(page.locator("[data-overlay-state]")).toHaveAttribute("data-overlay-state", "none");
    await expect(page.getByTestId("trade-dock")).toHaveCount(0);

    const inspect = page.getByTestId("matrix-row-pepe-weth").getByRole("button", { name: /Inspect|incele/ });
    await inspect.focus();
    await inspect.click();
    await expect(page.locator("[data-overlay-state]")).toHaveAttribute("data-overlay-state", "market_inspector");
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(page).toHaveURL(/pair=0x[0-9a-f]{40}/);

    await page.getByTestId("context-inspector").getByRole("tab", { name: /Pools|Havuzlar/ }).click();
    await page.getByTestId("context-inspector").getByRole("button", { name: /execution pool|işlem havuzu/i }).click();
    await expect(page.locator("[data-overlay-state]")).toHaveAttribute("data-overlay-state", "pool_drawer");
    await expect(page.getByTestId("context-inspector")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-overlay-state]")).toHaveAttribute("data-overlay-state", "none");
    await inspect.click();
    await expect(page.locator("[data-overlay-state]")).toHaveAttribute("data-overlay-state", "market_inspector");
    await page.getByTestId("context-inspector").getByRole("tab", { name: /Overview|Genel Bakış/ }).click();

    await page.getByTestId("inspector-trade-cta").click();
    await expect(page.locator("[data-overlay-state]")).toHaveAttribute("data-overlay-state", "trade_drawer");
    await expect(page.getByRole("dialog")).toHaveCount(1);

    const walletTrigger = page.getByTestId("trade-dock").getByRole("button", { name: /Connect Wallet|Cüzdan bağla/ });
    await walletTrigger.click();
    await expect(page.locator("[data-overlay-state]")).toHaveAttribute("data-overlay-state", "wallet_picker");
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-overlay-state]")).toHaveAttribute("data-overlay-state", "none");
    await expect(page.getByTestId("trade-dock")).toHaveCount(0);
    await expect(inspect).toBeFocused();
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

  for (const viewport of [{ name: "desktop-1280", width: 1280, height: 800 }, { name: "mobile-390", width: 390, height: 844 }]) {
    test(`keeps cached internal routes inside the performance SLO at ${viewport.name}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const terminalRequests: string[] = [];
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (url.pathname === "/terminal" && request.resourceType() !== "document") terminalRequests.push(request.url());
      });
      await page.goto("/terminal?data=mock");
      await expect(page.getByTestId(viewport.width < 768 ? "open-market-board" : "market-matrix")).toBeVisible();
      await expect(page.getByTestId("connect-wallet-button")).toHaveAttribute("data-wallet-ready", "true");
      const samples: RoutePerformanceSample[] = [];
      const routeCycle = ["markets", "terminal", "watchlist", "terminal", "portfolio", "terminal", "alerts", "terminal"];
      for (let pass = 0; pass < 11; pass += 1) {
        for (const target of routeCycle) samples.push(await measureClientRoute(page, target));
      }
      for (let pass = 0; pass < 11; pass += 1) {
        samples.push(await measureInspectorRoute(page));
        samples.push(await measureWorkspaceRoute(page));
        samples.push(await measureHistoryRoute(page, "back", "market_inspector"));
        samples.push(await measureHistoryRoute(page, "forward", "workspace"));
        await measureHistoryRoute(page, "back", "market_inspector");
        await measureClientRoute(page, "terminal");
      }
      const meaningfulP95 = percentile(samples.map((sample) => sample.contentMs), 0.95);
      const commitP95 = percentile(samples.map((sample) => sample.commitMs), 0.95);
      const interactiveP95 = percentile(samples.map((sample) => sample.interactiveMs), 0.95);
      const byTarget = Object.fromEntries([...new Set(samples.map((sample) => sample.target))].map((target) => {
        const targetSamples = samples.filter((sample) => sample.target === target);
        const warmTargetSamples = targetSamples.slice(1);
        return [target, {
          commitP95: percentile(warmTargetSamples.map((sample) => sample.commitMs), 0.95),
          meaningfulP95: percentile(warmTargetSamples.map((sample) => sample.contentMs), 0.95),
          interactiveP95: percentile(warmTargetSamples.map((sample) => sample.interactiveMs), 0.95),
          coldMeaningful: targetSamples[0]?.contentMs ?? 0,
          warmSampleCount: warmTargetSamples.length
        }];
      }));
      const longTasks = await page.evaluate(() => performance.getEntriesByType("longtask").map((entry) => entry.duration));
      const performancePath = testInfo.outputPath(`route-performance-${viewport.name}.json`);
      writeFileSync(performancePath, JSON.stringify({ viewport, samples, byTarget, commitP95, meaningfulP95, interactiveP95, terminalRequests, longTasks }, null, 2));
      await testInfo.attach(`route-performance-${viewport.name}.json`, { path: performancePath, contentType: "application/json" });
      expect(terminalRequests, "client route switches must not request a new terminal RSC payload").toEqual([]);
      expect(commitP95).toBeLessThanOrEqual(300);
      expect(meaningfulP95).toBeLessThanOrEqual(600);
      expect(interactiveP95).toBeLessThanOrEqual(600);
      for (const [target, timing] of Object.entries(byTarget)) {
        expect(timing.warmSampleCount, `${target} warm sample count`).toBeGreaterThanOrEqual(10);
        expect(timing.commitP95).toBeLessThanOrEqual(300);
        expect(timing.meaningfulP95).toBeLessThanOrEqual(600);
        expect(timing.interactiveP95).toBeLessThanOrEqual(600);
        expect(timing.coldMeaningful).toBeLessThanOrEqual(1_500);
      }
    });
  }
});

async function measureClientRoute(page: import("@playwright/test").Page, target: string) {
  return page.evaluate(async (nextView) => {
    const finish = (routeTarget: string, start: number, urlMs: number, commitMs: number, contentMs: number) => {
      const resources = performance.getEntriesByType("resource").filter((entry) => entry.startTime >= start) as PerformanceResourceTiming[];
      return { target: routeTarget, urlMs, commitMs, contentMs, interactiveMs: performance.now() - start, requestCount: resources.length, transferBytes: resources.reduce((total, resource) => total + resource.transferSize, 0), ttfbMs: resources.reduce((highest, resource) => Math.max(highest, resource.responseStart - resource.requestStart), 0) };
    };
    const links = [...document.querySelectorAll<HTMLAnchorElement>('a[data-client-route="terminal"]')];
    const link = links.find((candidate) => nextView === "terminal" ? !new URL(candidate.href).searchParams.has("view") : new URL(candidate.href).searchParams.get("view") === nextView);
    if (!link) throw new Error(`Missing terminal link for ${nextView}`);
    const start = performance.now();
    link.click();
    const urlMs = performance.now() - start;
    const waitForCommit = async () => {
      while (document.querySelector<HTMLElement>("[data-testid='pulse-terminal']")?.dataset.terminalView !== nextView) {
        if (performance.now() - start > 2_000) throw new Error(`Route commit exceeded 2s for ${nextView}`);
        await new Promise(requestAnimationFrame);
      }
    };
    await waitForCommit();
    const commitMs = performance.now() - start;
    const mobile = innerWidth < 768;
    const meaningfulSelector = nextView === "portfolio" ? "[data-testid='portfolio-workspace']" : nextView === "alerts" ? "[data-testid='alerts-workspace']" : mobile ? "[data-testid='open-market-board']" : "[data-testid='market-matrix']";
    while (!document.querySelector(meaningfulSelector)) await new Promise(requestAnimationFrame);
    const contentMs = performance.now() - start;
    await new Promise(requestAnimationFrame);
    return finish(nextView, start, urlMs, commitMs, contentMs);
  }, target);
}

async function measureInspectorRoute(page: import("@playwright/test").Page) {
  return page.evaluate(async () => {
    const nextFrame = async (start: number, label: string) => { if (performance.now() - start > 2_000) throw new Error(`${label} exceeded 2s`); await new Promise(requestAnimationFrame); };
    const finish = (routeTarget: string, start: number, urlMs: number, commitMs: number, contentMs: number) => {
      const resources = performance.getEntriesByType("resource").filter((entry) => entry.startTime >= start) as PerformanceResourceTiming[];
      return { target: routeTarget, urlMs, commitMs, contentMs, interactiveMs: performance.now() - start, requestCount: resources.length, transferBytes: resources.reduce((total, resource) => total + resource.transferSize, 0), ttfbMs: resources.reduce((highest, resource) => Math.max(highest, resource.responseStart - resource.requestStart), 0) };
    };
    const findVisibleInspectorTrigger = () => [...document.querySelectorAll<HTMLButtonElement>("[data-testid='open-market-inspector']")]
      .find((candidate) => candidate.offsetParent !== null);
    let button = findVisibleInspectorTrigger();
    if (!button) {
      const boardTrigger = document.querySelector<HTMLButtonElement>("[data-testid='open-market-board']");
      if (boardTrigger?.offsetParent !== null) {
        const openStart = performance.now();
        boardTrigger.click();
        while (document.querySelector<HTMLElement>("[data-overlay-state]")?.dataset.overlayState !== "market_board") await nextFrame(openStart, "Market board open");
        button = findVisibleInspectorTrigger();
      }
    }
    if (!button) throw new Error("Missing visible market row Inspector trigger");
    const start = performance.now();
    button.click();
    while (!new URL(location.href).searchParams.has("pair")) await nextFrame(start, "Inspector URL");
    const urlMs = performance.now() - start;
    while (document.querySelector<HTMLElement>("[data-overlay-state]")?.dataset.overlayState !== "market_inspector") await nextFrame(start, "Inspector commit");
    const commitMs = performance.now() - start;
    while (!document.querySelector("[data-testid='context-inspector']")) await nextFrame(start, "Inspector content");
    const contentMs = performance.now() - start;
    await new Promise(requestAnimationFrame);
    return finish("inspector", start, urlMs, commitMs, contentMs);
  });
}

async function measureWorkspaceRoute(page: import("@playwright/test").Page) {
  return page.evaluate(async () => {
    const nextFrame = async (start: number, label: string) => { if (performance.now() - start > 2_000) throw new Error(`${label} exceeded 2s`); await new Promise(requestAnimationFrame); };
    const finish = (routeTarget: string, start: number, urlMs: number, commitMs: number, contentMs: number) => {
      const resources = performance.getEntriesByType("resource").filter((entry) => entry.startTime >= start) as PerformanceResourceTiming[];
      return { target: routeTarget, urlMs, commitMs, contentMs, interactiveMs: performance.now() - start, requestCount: resources.length, transferBytes: resources.reduce((total, resource) => total + resource.transferSize, 0), ttfbMs: resources.reduce((highest, resource) => Math.max(highest, resource.responseStart - resource.requestStart), 0) };
    };
    const button = document.querySelector<HTMLButtonElement>("[data-testid='open-pair-workspace']");
    if (!button) throw new Error("Missing pair workspace trigger");
    const start = performance.now();
    button.click();
    while (new URL(location.href).searchParams.get("view") !== "workspace") await nextFrame(start, "Workspace URL");
    const urlMs = performance.now() - start;
    while (document.querySelector<HTMLElement>("[data-testid='pulse-terminal']")?.dataset.terminalView !== "workspace") await nextFrame(start, "Workspace commit");
    const commitMs = performance.now() - start;
    while (!document.querySelector("[data-testid='pair-workspace']")) await nextFrame(start, "Workspace content");
    const contentMs = performance.now() - start;
    await new Promise(requestAnimationFrame);
    return finish("workspace", start, urlMs, commitMs, contentMs);
  });
}

async function measureHistoryRoute(page: import("@playwright/test").Page, direction: "back" | "forward", target: "market_inspector" | "workspace") {
  return page.evaluate(async ({ historyDirection, routeTarget }) => {
    const nextFrame = async (start: number, label: string) => { if (performance.now() - start > 2_000) throw new Error(`${label} exceeded 2s`); await new Promise(requestAnimationFrame); };
    const finish = (sampleTarget: string, start: number, urlMs: number, commitMs: number, contentMs: number) => {
      const resources = performance.getEntriesByType("resource").filter((entry) => entry.startTime >= start) as PerformanceResourceTiming[];
      return { target: sampleTarget, urlMs, commitMs, contentMs, interactiveMs: performance.now() - start, requestCount: resources.length, transferBytes: resources.reduce((total, resource) => total + resource.transferSize, 0), ttfbMs: resources.reduce((highest, resource) => Math.max(highest, resource.responseStart - resource.requestStart), 0) };
    };
    const start = performance.now();
    if (historyDirection === "back") history.back();
    else history.forward();
    if (routeTarget === "workspace") {
      while (new URL(location.href).searchParams.get("view") !== "workspace") await nextFrame(start, "Forward URL");
    } else {
      while (new URL(location.href).searchParams.get("view") === "workspace") await nextFrame(start, "Back URL");
    }
    const urlMs = performance.now() - start;
    const expectedView = routeTarget === "workspace" ? "workspace" : "terminal";
    while (document.querySelector<HTMLElement>("[data-testid='pulse-terminal']")?.dataset.terminalView !== expectedView) await nextFrame(start, "History commit");
    const commitMs = performance.now() - start;
    const selector = routeTarget === "workspace" ? "[data-testid='pair-workspace']" : "[data-testid='context-inspector']";
    while (!document.querySelector(selector)) await nextFrame(start, "History content");
    const contentMs = performance.now() - start;
    await new Promise(requestAnimationFrame);
    return finish(`history-${historyDirection}`, start, urlMs, commitMs, contentMs);
  }, { historyDirection: direction, routeTarget: target });
}

type RoutePerformanceSample = {
  target: string;
  urlMs: number;
  commitMs: number;
  contentMs: number;
  interactiveMs: number;
  requestCount: number;
  transferBytes: number;
  ttfbMs: number;
};

function percentile(values: number[], fraction: number) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)] ?? 0;
}

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
