import { expect, test, type Locator, type Page } from "@playwright/test";
import { translate, type TranslationKey } from "@/i18n/dictionaries";
import { APP_NAME } from "@/lib/appInfo";

const ACCOUNT = "0x1111111111111111111111111111111111111111";

test.describe("route, language, responsive and accessibility inventory", () => {
  test("keeps one route heading, matching titles and active navigation in TR and EN", async ({ page, context }) => {
    test.setTimeout(120_000);
    const terminalRoutes: Array<{ route: string; titleKey: TranslationKey; pair?: string }> = [
      { route: "/?data=mock", titleKey: "route.pulseTitle" },
      { route: "/?data=mock&view=markets", titleKey: "route.marketsTitle" },
      { route: "/?data=mock&view=watchlist", titleKey: "route.watchlistTitle" },
      { route: "/?data=mock&view=alerts", titleKey: "route.alertsTitle" },
      { route: "/?data=mock&view=wallet", titleKey: "route.walletTitle" },
      { route: "/?data=mock&view=pair&pair=blob-usdc", titleKey: "route.pairTitle", pair: "BLOB / USDC" }
    ];
    for (const locale of ["en", "tr"] as const) {
      await context.addCookies([{ name: "mergen_locale", value: locale, domain: "127.0.0.1", path: "/" }]);
      for (const { route, titleKey, pair } of terminalRoutes) {
        await page.goto(route);
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expect(page.locator("h1")).toHaveCount(1);
        await expect(page.locator("nav:visible [aria-current=page]")).toHaveCount(1);
        await expect(page).toHaveTitle(`${translate(locale, titleKey, { pair: pair ?? "" })} | ${APP_NAME}`);
        expect(await page.locator("body").innerText()).not.toMatch(/\b(?:nav|route|common|alerts)\.[a-z]/);
      }
      const secondaryRoutes = [
        { route: "/status?data=mock", title: translate(locale, "status.h1") },
        { route: "/docs", title: translate(locale, "docs.h1") },
        { route: "/does-not-exist", title: translate(locale, "notFound.title") }
      ];
      for (const { route, title } of secondaryRoutes) {
        await page.goto(route);
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expect(page.locator("h1")).toHaveCount(1);
        await expect(page.locator("nav:visible [aria-current=page]")).toHaveCount(0);
        await expect(page).toHaveTitle(`${title} | ${APP_NAME}`);
      }
    }
  });

  test("passes the full viewport matrix in both languages", async ({ page, context }) => {
    test.setTimeout(180_000);
    const viewports = [
      { width: 1920, height: 1080 },
      { width: 1440, height: 900 },
      { width: 1280, height: 800 },
      { width: 1024, height: 768 },
      { width: 768, height: 1024 },
      { width: 430, height: 932 },
      { width: 390, height: 844 },
      { width: 360, height: 800 }
    ];
    const routes = ["/?data=mock", "/?data=mock&view=markets", "/?data=mock&view=pair&pair=blob-usdc", "/?data=mock&view=wallet"];
    for (const locale of ["en", "tr"] as const) {
      await context.addCookies([{ name: "mergen_locale", value: locale, domain: "127.0.0.1", path: "/" }]);
      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        for (const route of routes) {
          await page.goto(route);
          await expect(page.locator("h1")).toHaveCount(1);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
          const visibleNavLinks = page.locator("nav:visible a");
          const count = await visibleNavLinks.count();
          for (let index = 0; index < count; index += 1) {
            const box = await visibleNavLinks.nth(index).boundingBox();
            expect(box?.height).toBeGreaterThanOrEqual(44);
            expect(box?.x).toBeGreaterThanOrEqual(0);
            expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport.width + 1);
          }
        }
      }
    }
  });

  test("supports skip navigation, keyboard tabs and controlled long-copy expansion", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/?data=mock&view=pair&pair=blob-usdc");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to terminal content" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#terminal-main")).toBeFocused();
    const overview = page.getByRole("tab", { name: "Overview" });
    await overview.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Data" })).toBeFocused();
    await expect(page.getByRole("tab", { name: "Data" })).toHaveAttribute("aria-selected", "true");
    await page.evaluate(() => {
      for (const element of document.querySelectorAll<HTMLElement>("nav span, h1, button")) {
        if (element.childElementCount === 0 && element.textContent?.trim()) element.textContent = `${element.textContent} ${element.textContent.slice(0, Math.ceil(element.textContent.length * 0.4))}`;
      }
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  });

  test("exposes identical normalized economics on board, pair, alerts and Action Dock", async ({ page }) => {
    await page.goto("/?data=mock&view=markets");
    const board = await readInvariantAttributes(page.getByTestId("discovery-row-blob-usdc").first());
    await page.getByTestId("discovery-row-blob-usdc").getByRole("button").first().click();
    const pair = await readInvariantAttributes(page.getByTestId("selected-pair-panel"));
    const actionDock = await readInvariantAttributes(page.getByTestId("swap-preview-panel"));
    expect(pair).toEqual(board);
    expect(actionDock).toEqual(board);
    await page.locator('nav:visible a[href="/?view=alerts"]').click();
    await expect(page.getByTestId("alert-center")).toBeVisible();
    expect(await readInvariantAttributes(page.getByTestId("alert-center"))).toEqual(board);
  });
});

test.describe("recovery and long-cycle stability", () => {
  test("survives restricted and corrupted local storage", async ({ page }) => {
    await page.addInitScript(() => {
      const originalGet = Storage.prototype.getItem;
      Storage.prototype.getItem = function (key: string) {
        if (key.includes("recent-pairs")) return "{broken-json";
        return originalGet.call(this, key);
      };
      Storage.prototype.setItem = function () { throw new DOMException("Quota exceeded", "QuotaExceededError"); };
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/?data=mock&view=markets");
    await expect(page.getByTestId("market-discovery")).toBeVisible();
    await page.getByTestId("discovery-row-blob-usdc").getByRole("button").first().click();
    await expect(page.getByTestId("pair-workspace")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("bounds DOM, wallet listeners and requests through required interaction cycles", async ({ page }) => {
    test.setTimeout(360_000);
    await installCycleWallet(page);
    const consoleProblems: string[] = [];
    const pageErrors: string[] = [];
    const requests: string[] = [];
    page.on("console", (message) => { if (message.type() === "error" || /hydration|unhandled|cannot update/i.test(message.text())) consoleProblems.push(message.text()); });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("request", (request) => { if (/\/api\/(?:chart|market-snapshot)/.test(request.url())) requests.push(request.url()); });
    await page.goto("/?data=mock");
    const initialNodes = await page.locator("*").count();

    for (let index = 0; index < 100; index += 1) {
      const pairId = index % 2 === 0 ? "blob-usdc" : "aero-usdc";
      await page.getByTestId(`discovery-row-${pairId}`).getByRole("button").first().click();
      await expect(page.getByTestId("pair-workspace")).toBeVisible();
      await page.getByTestId("back-from-pair").click();
      await expect(page.getByTestId("market-discovery")).toBeVisible();
    }

    for (let index = 0; index < 25; index += 1) {
      await page.locator('nav:visible a[href="/?view=markets"]').click();
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Markets");
      await page.locator('nav:visible a[href="/"]').click();
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Pulse");
    }

    for (let index = 0; index < 20; index += 1) {
      const locale = index % 2 === 0 ? "tr" : "en";
      await page.getByTestId("locale-switcher").getByRole("button", { name: locale }).click();
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
    }

    await page.goto("/?data=mock&view=wallet");
    for (let index = 0; index < 20; index += 1) {
      await page.getByTestId("wallet-panel-connect").click();
      await page.getByTestId("wallet-provider-legacy:injected").click();
      await expect(page.getByTestId("wallet-address")).toBeVisible();
      await page.getByRole("button", { name: "Disconnect wallet from this interface" }).click();
      await expect(page.getByTestId("wallet-address")).toHaveCount(0);
    }

    await page.evaluate(() => {
      let visibility: DocumentVisibilityState = "hidden";
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
      for (let index = 0; index < 20; index += 1) {
        visibility = index % 2 === 0 ? "hidden" : "visible";
        document.dispatchEvent(new Event("visibilitychange"));
      }
    });
    await page.waitForTimeout(100);
    const finalNodes = await page.locator("*").count();
    const walletMetrics = await page.evaluate(() => {
      const metrics = (window as Window & { __qualityWallet?: { requests: string[]; listenerSizes: () => number[] } }).__qualityWallet;
      return metrics ? { requests: metrics.requests, listenerSizes: metrics.listenerSizes() } : undefined;
    });
    expect(finalNodes).toBeLessThan(initialNodes + 300);
    expect(walletMetrics?.requests.filter((method) => method === "eth_requestAccounts")).toHaveLength(20);
    expect(walletMetrics?.listenerSizes).toEqual([1, 1, 1, 1]);
    expect(requests.filter((url) => url.includes("market-snapshot"))).toHaveLength(0);
    expect(consoleProblems).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});

async function installCycleWallet(page: Page) {
  await page.addInitScript(({ account }) => {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    const requests: string[] = [];
    let accounts: string[] = [];
    const provider = {
      isMetaMask: true,
      request: async ({ method }: { method: string }) => {
        requests.push(method);
        if (method === "eth_accounts") return accounts;
        if (method === "eth_requestAccounts") { accounts = [account]; return accounts; }
        if (method === "eth_chainId") return "0x2105";
        if (method === "eth_getBalance") return "0x0";
        throw new Error(`Unexpected wallet method ${method}`);
      },
      on: (event: string, listener: (...args: unknown[]) => void) => {
        const current = listeners.get(event) ?? new Set();
        current.add(listener);
        listeners.set(event, current);
      },
      removeListener: (event: string, listener: (...args: unknown[]) => void) => listeners.get(event)?.delete(listener)
    };
    (window as Window & { ethereum?: typeof provider; __qualityWallet?: { requests: string[]; listenerSizes: () => number[] } }).ethereum = provider;
    (window as Window & { __qualityWallet?: { requests: string[]; listenerSizes: () => number[] } }).__qualityWallet = {
      requests,
      listenerSizes: () => ["accountsChanged", "chainChanged", "connect", "disconnect"].map((event) => listeners.get(event)?.size ?? 0)
    };
  }, { account: ACCOUNT });
}

async function readInvariantAttributes(locator: Locator) {
  return locator.evaluate((element) => Object.fromEntries([
    "data-market-key",
    "data-market-direction",
    "data-price-usd",
    "data-change-24h",
    "data-volume-24h-usd",
    "data-liquidity-usd"
  ].map((name) => [name, element.getAttribute(name)])));
}
