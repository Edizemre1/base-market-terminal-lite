import { expect, test, type Page } from "@playwright/test";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const externalNavigationCalls = new WeakMap<Page, string[]>();

test.describe("wallet picker safety contract", () => {
  test("Keplr-only first load produces no request, popup, install URL or redirect", async ({ page }) => {
    await installNavigationInstrumentation(page);
    await installEip6963Providers(page, [{ key: "keplr", uuid: "keplr-uuid", name: "Keplr", rdns: "app.keplr", redirectOnRequest: true }]);
    await page.goto("/?data=mock");
    await page.waitForTimeout(650);

    await expect(page.getByTestId("wallet-picker")).toHaveCount(0);
    expect(await providerRequests(page, "keplr")).toEqual([]);
    expect(await openCalls(page)).toEqual([]);
    expect(navigationCalls(page)).toEqual([]);
    expect(new URL(page.url()).pathname).toBe("/");

    await page.getByTestId("connect-wallet-button").click();
    await expect(page.getByTestId("wallet-picker")).toBeVisible();
    await expect(page.getByTestId("wallet-provider-eip6963:keplr-uuid")).toContainText("Base compatibility not verified");
    expect(await providerRequests(page, "keplr")).toEqual([]);
    expect(await openCalls(page)).toEqual([]);
    expect(navigationCalls(page)).toEqual([]);
  });

  test("Keplr never wins discovery order over MetaMask, Coinbase and Rabby", async ({ page }) => {
    await installNavigationInstrumentation(page);
    await installEip6963Providers(page, [
      { key: "keplr", uuid: "keplr-uuid", name: "Keplr", rdns: "app.keplr", redirectOnRequest: true },
      { key: "metamask", uuid: "metamask-uuid", name: "MetaMask", rdns: "io.metamask" },
      { key: "coinbase", uuid: "coinbase-uuid", name: "Coinbase Wallet", rdns: "com.coinbase.wallet" },
      { key: "rabby", uuid: "rabby-uuid", name: "Rabby", rdns: "io.rabby" }
    ]);
    await page.goto("/?data=mock&view=wallet");

    for (const key of ["keplr", "metamask", "coinbase", "rabby"]) expect(await providerRequests(page, key)).toEqual([]);
    await page.getByTestId("wallet-panel-connect").click();
    await expect(page.getByText("Installed wallets")).toBeVisible();
    await page.getByTestId("wallet-provider-eip6963:metamask-uuid").click();
    await expect(page.getByTestId("wallet-address")).toHaveText("0x1111...1111");

    expect(await providerRequests(page, "metamask")).toContain("eth_requestAccounts");
    expect(await providerRequests(page, "keplr")).toEqual([]);
    expect(await providerRequests(page, "coinbase")).toEqual([]);
    expect(await providerRequests(page, "rabby")).toEqual([]);
    expect(await openCalls(page)).toEqual([]);
    expect(navigationCalls(page)).toEqual([]);
  });

  test("valid remembered provider restores with permissionless reads only", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("mergen-pulse:wallet-provider:v2", JSON.stringify({ id: "eip6963:metamask-uuid", name: "MetaMask", rdns: "io.metamask", compatibility: "verified" })));
    await installEip6963Providers(page, [{ key: "metamask", uuid: "metamask-uuid", name: "MetaMask", rdns: "io.metamask", initiallyConnected: true }]);
    await page.goto("/?data=mock&view=wallet");
    await expect(page.getByTestId("wallet-address")).toHaveText("0x1111...1111");
    const methods = await providerRequests(page, "metamask");
    expect(methods).toContain("eth_accounts");
    expect(methods).toContain("eth_chainId");
    expect(methods).not.toContain("eth_requestAccounts");
    expect(methods).not.toContain("wallet_switchEthereumChain");
  });

  test("missing and stale Keplr preferences migrate without provider calls", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("mergen-pulse:wallet-provider:v2", JSON.stringify({ id: "eip6963:keplr-old", name: "Keplr", rdns: "app.keplr", compatibility: "unverified" })));
    await installEip6963Providers(page, [{ key: "keplr", uuid: "keplr-new", name: "Keplr", rdns: "app.keplr", redirectOnRequest: true }]);
    await page.goto("/?data=mock");
    await page.waitForTimeout(650);
    expect(await page.evaluate(() => localStorage.getItem("mergen-pulse:wallet-provider:v2"))).toBeNull();
    expect(await providerRequests(page, "keplr")).toEqual([]);

    await page.evaluate(() => localStorage.setItem("mergen-pulse:wallet-provider:v2", JSON.stringify({ id: "eip6963:missing", name: "MetaMask", rdns: "io.metamask", compatibility: "verified" })));
    await page.reload();
    await page.waitForTimeout(650);
    expect(await page.evaluate(() => localStorage.getItem("mergen-pulse:wallet-provider:v2"))).toBeNull();
  });

  test("official install URL opens only after explicit expansion and click", async ({ page }) => {
    await installNavigationInstrumentation(page);
    await page.goto("/?data=mock");
    await page.getByTestId("connect-wallet-button").click();
    expect(await openCalls(page)).toEqual([]);
    await page.getByTestId("get-wallet-toggle").click();
    expect(await openCalls(page)).toEqual([]);
    await page.getByTestId("install-metamask").click();
    expect(await openCalls(page)).toEqual(["https://metamask.io/download"]);
  });

  test("wallet picker traps keyboard focus, closes with Escape and restores the opener", async ({ page }) => {
    await page.goto("/?data=mock");
    const opener = page.getByTestId("connect-wallet-button");
    await opener.focus();
    await opener.click();
    const dialog = page.getByTestId("wallet-picker");
    await expect(dialog).toBeVisible();

    await page.keyboard.press("Shift+Tab");
    expect(await page.evaluate(() => document.querySelector('[data-testid="wallet-picker"]')?.contains(document.activeElement))).toBeTruthy();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  });
});

test.describe("TR/EN and progressive disclosure", () => {
  test("English default and Turkish browser locale hydrate without errors", async ({ browser }) => {
    const errors: string[] = [];
    const englishContext = await browser.newContext({ locale: "en-US" });
    const englishPage = await englishContext.newPage();
    englishPage.on("console", (message) => { if (message.type() === "error" || /hydration/i.test(message.text())) errors.push(message.text()); });
    englishPage.on("pageerror", (error) => errors.push(error.message));
    await englishPage.goto("http://127.0.0.1:3000/?data=mock");
    await expect(englishPage.locator("html")).toHaveAttribute("lang", "en");
    await expect(englishPage.getByText("Now on Base")).toBeVisible();
    expect(errors).toEqual([]);
    await englishContext.close();

    const turkishContext = await browser.newContext({ locale: "tr-TR" });
    const turkishPage = await turkishContext.newPage();
    turkishPage.on("console", (message) => { if (message.type() === "error" || /hydration/i.test(message.text())) errors.push(message.text()); });
    turkishPage.on("pageerror", (error) => errors.push(error.message));
    await turkishPage.goto("http://127.0.0.1:3000/?data=mock");
    await expect(turkishPage.locator("html")).toHaveAttribute("lang", "tr");
    await expect(turkishPage.getByText("Şimdi Base'te")).toBeVisible();
    expect(errors).toEqual([]);
    await turkishContext.close();
  });

  test("saved Turkish preference wins after hydration and persists", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("mergen-pulse:locale:v1", "tr"));
    await page.goto("/?data=mock");
    await expect(page.locator("html")).toHaveAttribute("lang", "tr");
    await expect(page.getByText("Şimdi Base'te")).toBeVisible();
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "tr");
  });

  test("TR and EN switch instantly, persist and preserve pair route state", async ({ page, context }) => {
    await context.addCookies([{ name: "mergen_locale", value: "tr", domain: "127.0.0.1", path: "/" }]);
    await page.goto("/?data=mock");
    await expect(page.getByText("CANLI HAREKETLER", { exact: true })).toBeVisible();
    await page.getByTestId("discovery-row-blob-usdc").first().getByRole("button").first().click();
    await expect(page.getByTestId("pair-workspace")).toBeVisible();
    await expect(page).toHaveURL(/\?data=mock&view=pair&pair=blob-usdc$/);
    const pairUrl = page.url();

    await page.getByTestId("locale-switcher").getByRole("button", { name: "en" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByTestId("back-from-pair")).toContainText("Back to Pulse");
    expect(page.url()).toBe(pairUrl);

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByTestId("pair-workspace")).toBeVisible();
    const englishPairUrl = page.url();
    await page.getByTestId("locale-switcher").getByRole("button", { name: "tr" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "tr");
    await expect(page.getByTestId("back-from-pair")).toContainText("Pulse'a dön");
    expect(page.url()).toBe(englishPairUrl);
  });

  test("locale switch preserves connected wallet state", async ({ page }) => {
    await installEip6963Providers(page, [{ key: "metamask", uuid: "metamask-uuid", name: "MetaMask", rdns: "io.metamask" }]);
    await page.goto("/?data=mock&view=wallet");
    await page.getByTestId("wallet-panel-connect").click();
    await page.getByTestId("wallet-provider-eip6963:metamask-uuid").click();
    await expect(page.getByTestId("wallet-address")).toHaveText("0x1111...1111");
    await page.getByTestId("locale-switcher").getByRole("button", { name: "tr" }).click();
    await expect(page.getByTestId("wallet-address")).toHaveText("0x1111...1111");
    await expect(page.getByText("Cüzdan bağlantısı salt okunurdur")).toBeVisible();
  });

  test("Pulse first viewport excludes chart and permanent wallet rail", async ({ page }) => {
    await page.goto("/?data=mock");
    await expect(page.getByTestId("live-pulse-strip")).toBeVisible();
    await expect(page.getByTestId("opportunity-stream")).toBeVisible();
    await expect(page.getByTestId("market-discovery")).toBeVisible();
    await expect(page.getByTestId("chart-panel")).toHaveCount(0);
    await expect(page.getByTestId("swap-preview-panel")).toHaveCount(0);
    await expect(page.getByTestId("discovery-advanced-filters")).toHaveCount(0);
  });
});

async function installNavigationInstrumentation(page: Page) {
  const navigations: string[] = [];
  externalNavigationCalls.set(page, navigations);
  page.on("request", (request) => {
    if (!request.isNavigationRequest()) return;
    const url = new URL(request.url());
    if (url.hostname !== "127.0.0.1" && url.protocol !== "about:") navigations.push(request.url());
  });
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, "open", { configurable: true, value: (url?: string | URL) => { calls.push(String(url)); return null; } });
    (window as Window & { __walletOpenCalls?: string[] }).__walletOpenCalls = calls;
  });
}

function navigationCalls(page: Page) {
  return externalNavigationCalls.get(page) ?? [];
}

type ProviderFixture = { key: string; uuid: string; name: string; rdns: string; redirectOnRequest?: boolean; initiallyConnected?: boolean };

async function installEip6963Providers(page: Page, fixtures: ProviderFixture[]) {
  await page.addInitScript(({ providerFixtures, account }) => {
    const requests: Record<string, string[]> = Object.fromEntries(providerFixtures.map((fixture) => [fixture.key, []]));
    const providers = providerFixtures.map((fixture) => {
      const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
      let accounts = fixture.initiallyConnected ? [account] : [];
      const provider = {
        request: async ({ method }: { method: string }) => {
          requests[fixture.key].push(method);
          if (fixture.redirectOnRequest) window.open("https://www.keplr.app/get", "_blank");
          if (method === "eth_accounts") return accounts;
          if (method === "eth_requestAccounts") { accounts = [account]; for (const listener of listeners.get("accountsChanged") ?? []) listener(accounts); return accounts; }
          if (method === "eth_chainId") return "0x2105";
          if (method === "eth_getBalance") return "0xde0b6b3a7640000";
          if (method === "wallet_switchEthereumChain") return null;
          throw new Error(`Unexpected wallet method ${method}`);
        },
        on: (event: string, listener: (...args: unknown[]) => void) => { const set = listeners.get(event) ?? new Set(); set.add(listener); listeners.set(event, set); },
        removeListener: (event: string, listener: (...args: unknown[]) => void) => listeners.get(event)?.delete(listener)
      };
      return { info: { uuid: fixture.uuid, name: fixture.name, rdns: fixture.rdns }, provider };
    });
    window.addEventListener("eip6963:requestProvider", () => { for (const detail of providers) window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail })); });
    (window as Window & { __walletProviderRequests?: Record<string, string[]> }).__walletProviderRequests = requests;
  }, { providerFixtures: fixtures, account: ACCOUNT });
}

async function providerRequests(page: Page, key: string) {
  return page.evaluate((providerKey) => (window as Window & { __walletProviderRequests?: Record<string, string[]> }).__walletProviderRequests?.[providerKey] ?? [], key);
}

async function openCalls(page: Page) {
  return page.evaluate(() => (window as Window & { __walletOpenCalls?: string[] }).__walletOpenCalls ?? []);
}
