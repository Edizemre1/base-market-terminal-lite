import { expect, test, type Page } from "@playwright/test";
import type { QuoteRequest, TransactionQuote, TradeCapabilities } from "../../src/lib/trade/types";
import { BASE_TRADE_CHAIN_ID } from "../../src/lib/trade/types";
import { createQuoteFingerprint, parseHumanTokenAmount } from "../../src/lib/trade/validation";
import { installVerifiedWalletStub } from "./helpers/walletStub";

const targetAddress = "0x4444444444444444444444444444444444444444";
const approvalAddress = "0x5555555555555555555555555555555555555555";
const usdcAddress = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

type BrowserQuoteRequest = Omit<QuoteRequest, "fromAmountRaw" | "chainId" | "fromToken" | "toToken"> & {
  fromToken: Omit<QuoteRequest["fromToken"], "decimals">;
  toToken: Omit<QuoteRequest["toToken"], "decimals">;
};

test.describe("explicit wallet and transaction lifecycle", () => {
  test("makes no wallet RPC or popup request on initial load", async ({ page }) => {
    let quoteRequests = 0;
    await page.route("**/api/quote", (route) => { quoteRequests += 1; return route.fulfill({ status: 500, json: { code: "provider-unavailable" } }); });
    await installVerifiedWalletStub(page);
    await page.goto("/terminal?data=mock");
    expect(await walletMethods(page)).toEqual([]);
    expect(quoteRequests).toBe(0);
    await expect(page.getByTestId("wallet-picker")).toHaveCount(0);
  });

  test("treats a stored provider and legacy session flags as reconnect-only", async ({ page }) => {
    await installVerifiedWalletStub(page, { initialAccounts: ["0x1111111111111111111111111111111111111111"] });
    await page.addInitScript(() => {
      localStorage.setItem("mergen-pulse:wallet-provider:v2", JSON.stringify({ id: "legacy:injected", name: "MetaMask", compatibility: "verified" }));
      localStorage.setItem("mergen-pulse:wallet-address", "0x9999999999999999999999999999999999999999");
      localStorage.setItem("mergen-pulse:wallet-connected", "true");
      sessionStorage.setItem("base-terminal-lite:wallet-connected", "true");
    });
    await page.goto("/terminal?data=mock");

    await expect(page.getByTestId("connect-wallet-button")).toHaveAttribute("data-wallet-status", "reconnect_required");
    await expect(page.getByTestId("connect-wallet-button")).toContainText(/Reconnect|Yeniden bağlan/);
    await expect(page.getByTestId("connect-wallet-button")).not.toContainText("0x1111");
    expect(await walletMethods(page)).toEqual([]);
    expect(await page.evaluate(() => [localStorage.getItem("mergen-pulse:wallet-address"), localStorage.getItem("mergen-pulse:wallet-connected"), sessionStorage.getItem("base-terminal-lite:wallet-connected")])).toEqual([null, null, null]);

    await openWalletPicker(page);
    await page.getByTestId("wallet-reconnect-button").click();
    await expect(page.getByTestId("connect-wallet-button")).toContainText("0x1111...1111");
    await page.getByTestId("connect-wallet-button").click();
    await expect(page.getByTestId("wallet-details")).toContainText(/Previously authorized|Daha önce yetkilendirilmiş/);
    await expect(page.getByTestId("wallet-details")).toContainText("MetaMask");
    await expect(page.getByTestId("wallet-details")).toContainText("Base Mainnet · 8453");
    await expect(page.getByTestId("wallet-native-balance")).toHaveText("1 ETH");
    await expect(page.getByTestId("wallet-token-balance")).toHaveText("1 USDC");
    expect(await walletMethods(page)).not.toContain("eth_sendTransaction");
  });

  test("keeps locked and missing-balance states distinct without leaking an address", async ({ page }) => {
    await installVerifiedWalletStub(page, { requestAccountsEmpty: true });
    await page.goto("/terminal?data=mock");
    await openWalletPicker(page);
    await page.getByTestId("wallet-provider-legacy:injected").click();
    await expect(page.getByTestId("wallet-picker")).toHaveAttribute("data-wallet-status", "locked_or_no_accounts");
    await expect(page.getByTestId("connect-wallet-button")).not.toContainText("0x1111");
    expect(await walletMethods(page)).not.toContain("eth_getBalance");
    expect(await walletMethods(page)).not.toContain("eth_sendTransaction");
  });

  test("renders native zero separately from an unavailable balance", async ({ page }) => {
    await installVerifiedWalletStub(page, { balanceHex: "0x0" });
    await page.goto("/terminal?data=mock");
    await connectWalletOnly(page);
    await page.getByTestId("connect-wallet-button").click();
    await expect(page.getByTestId("wallet-native-balance")).toHaveText("0 ETH");

    await page.reload();
    await expect(page.getByTestId("connect-wallet-button")).toHaveAttribute("data-wallet-status", "reconnect_required");
    expect(await walletMethods(page)).toEqual([]);
  });

  test("clears account and balance on provider account loss and disconnect", async ({ page }) => {
    await installVerifiedWalletStub(page, { balanceError: true });
    await page.goto("/terminal?data=mock");
    await connectWalletOnly(page);
    await page.getByTestId("connect-wallet-button").click();
    await expect(page.getByTestId("wallet-native-balance")).toContainText(/Unavailable|Kullanılamıyor/);
    await page.getByRole("button", { name: /Close wallet picker|Cüzdan seçiciyi kapat/ }).click();

    await page.evaluate(() => (window as Window & { __walletHarness?: { setAccounts: (accounts: string[]) => void } }).__walletHarness?.setAccounts(["0x2222222222222222222222222222222222222222"]));
    await expect(page.getByTestId("connect-wallet-button")).toContainText("0x2222...2222");
    await page.evaluate(() => (window as Window & { __walletHarness?: { setAccounts: (accounts: string[]) => void } }).__walletHarness?.setAccounts([]));
    await expect(page.getByTestId("connect-wallet-button")).toHaveAttribute("data-wallet-status", "locked_or_no_accounts");
    await expect(page.getByTestId("connect-wallet-button")).not.toContainText("0x2222");
    expect(await walletMethods(page)).not.toContain("eth_sendTransaction");
  });

  test("keeps Trade asset-scoped without automatic wallet or quote calls", async ({ page }) => {
    let quoteRequests = 0;
    await page.route("**/api/quote", (route) => { quoteRequests += 1; return route.fulfill({ status: 500, json: { code: "provider-unavailable" } }); });
    await installVerifiedWalletStub(page);
    await page.goto("/terminal?data=mock");
    await expect(page.getByTestId("global-trade-button")).toHaveCount(0);
    await page.getByTestId("matrix-row-pepe-weth").getByRole("button", { name: /Inspect|incele/ }).click();
    await page.getByTestId("inspector-trade-cta").click();
    await expect(page.getByTestId("trade-dock")).toBeVisible();
    await expect(page.getByTestId("trade-spend-token")).toHaveValue("USDC");
    await expect(page.getByTestId("trade-dock")).toContainText("USDC → PEPE");
    expect(await walletMethods(page)).toEqual([]);
    expect(quoteRequests).toBe(0);
  });

  test("uses token-first market labels while preserving the raw pair in technical details", async ({ page }) => {
    await installVerifiedWalletStub(page);
    await page.goto("/terminal?data=mock");
    const row = page.getByTestId("matrix-row-pepe-weth");
    await expect(row.locator("strong").first()).toHaveText("PEPE");
    await expect(row.locator("strong").first()).not.toContainText("WETH");
    await row.getByRole("button", { name: /Inspect|incele/ }).click();
    const technical = page.getByTestId("inspector-technical-details");
    await expect(technical).not.toHaveAttribute("open", "");
    await technical.locator("summary").click();
    await expect(technical).toContainText("PEPE / WETH");
    await expect(page.getByTestId("inspector-trade-cta")).toBeVisible();
  });

  test("connects only after explicit provider selection", async ({ page }) => {
    await installVerifiedWalletStub(page);
    await page.goto("/terminal?data=mock&view=portfolio");
    await openWalletPicker(page);
    await expect(page.getByTestId("wallet-picker")).toBeVisible();
    expect(await walletMethods(page)).toEqual([]);
    await page.getByTestId("wallet-provider-legacy:injected").click();
    await expect(page.getByTestId("connect-wallet-button")).toContainText("0x1111...1111");
    expect(await walletMethods(page)).toContain("eth_requestAccounts");
    expect(await walletMethods(page)).not.toContain("eth_sendTransaction");
  });

  test("preserves a verified wallet only across client-side route changes", async ({ page }) => {
    await installVerifiedWalletStub(page);
    await page.goto("/terminal?data=mock");
    await connectWalletOnly(page);
    const methodsAfterConnect = await walletMethods(page);
    await page.getByRole("link", { name: /Markets|Piyasalar/, exact: true }).first().click();
    await expect(page.getByTestId("connect-wallet-button")).toContainText("0x1111...1111");
    expect((await walletMethods(page)).filter((method) => method === "eth_requestAccounts")).toHaveLength(methodsAfterConnect.filter((method) => method === "eth_requestAccounts").length);
  });

  test("switches to Base only after the manual action", async ({ page }, testInfo) => {
    await mockEnabledTradeServer(page);
    await installVerifiedWalletStub(page, { chainId: "0x1" });
    await page.goto("/terminal?data=mock");
    await openWalletPicker(page);
    await page.getByTestId("wallet-provider-legacy:injected").click();
    await expect(page.getByTestId("connect-wallet-button")).toContainText("0x1111...1111");
    await expect(page.getByTestId("wallet-picker")).toHaveCount(0);
    await openTradeDrawer(page);
    await expect(page.getByTestId("trade-dock")).toHaveAttribute("data-tradeability-status", "wrong_network");
    await page.screenshot({ path: testInfo.outputPath("trade-wrong-network-1440.png"), fullPage: false });
    expect(await walletMethods(page)).not.toContain("wallet_switchEthereumChain");
    expect(await walletMethods(page)).not.toContain("eth_getBalance");
    await page.getByRole("button", { name: /Switch to Base|Base ağına geç/ }).click();
    await expect(page.getByTestId("connect-wallet-button")).toContainText("0x1111...1111");
    expect(await walletMethods(page)).toContain("wallet_switchEthereumChain");
  });

  test("keeps exact no-route distinct from timeout and other provider outages", async ({ page }, testInfo) => {
    await installVerifiedWalletStub(page);
    await mockFailedTradeServer(page, "no-route");
    await page.goto("/terminal?data=mock");
    await connectWallet(page);
    await page.getByRole("button", { name: /Get fresh quote|Taze teklif al/ }).click();
    await expect(page.getByTestId("trade-dock")).toHaveAttribute("data-tradeability-status", "no_route");
    await expect(page.getByTestId("trade-dock")).toContainText(/No route was found|işlem rotası bulunamadı/);
    await page.screenshot({ path: testInfo.outputPath("trade-no-route-error-1440.png"), fullPage: false });

    await page.unroute("**/api/quote");
    await mockFailedTradeServer(page, "timeout");
    await page.getByRole("button", { name: /Get fresh quote|Taze teklif al/ }).click();
    await expect(page.getByTestId("trade-dock")).toHaveAttribute("data-tradeability-status", "provider_unavailable");
    await expect(page.getByTestId("trade-dock")).toContainText(/timed out|zaman aşımına/);
    await expect(page.getByTestId("trade-dock")).not.toContainText(/No route was found|işlem rotası bulunamadı/);
    await page.screenshot({ path: testInfo.outputPath("trade-provider-unavailable-1440.png"), fullPage: false });
  });

  test("expires a short-lived valid quote without sending a transaction", async ({ page }, testInfo) => {
    await installVerifiedWalletStub(page);
    await mockEnabledTradeServer(page, { expiryMs: 700 });
    await page.goto("/terminal?data=mock");
    await connectWallet(page);
    await page.getByRole("button", { name: /Get fresh quote|Taze teklif al/ }).click();
    await expect(page.getByTestId("trade-dock")).toHaveAttribute("data-tradeability-status", "quote_expired");
    await page.screenshot({ path: testInfo.outputPath("trade-quote-expired-1440.png"), fullPage: false });
    expect(await sentTransactions(page)).toHaveLength(0);
  });

  test("reports a rejected connection without exposing raw provider errors", async ({ page }) => {
    await installVerifiedWalletStub(page, { rejectConnection: true });
    await page.goto("/terminal?data=mock");
    await openWalletPicker(page);
    await page.getByTestId("wallet-provider-legacy:injected").click();
    await expect(page.getByTestId("wallet-picker-error")).toContainText(/cancelled|iptal edildi/);
    expect(await walletMethods(page)).not.toContain("eth_sendTransaction");
  });

  test("runs mocked quote, exact approval, refreshed review, simulation, and swap through two explicit sends", async ({ page }, testInfo) => {
    await installVerifiedWalletStub(page);
    await mockEnabledTradeServer(page, { delayMs: 450 });
    await page.goto("/terminal?data=mock");
    await openWalletPicker(page);
    await page.getByTestId("wallet-provider-legacy:injected").click();
    await openTradeDrawer(page);
    await expect(page.getByTestId("trade-spend-token")).toHaveValue("USDC");
    await page.getByTestId("trade-spend-token").selectOption("WETH");
    await expect(page.getByTestId("trade-spend-token")).toHaveValue("WETH");
    await page.getByTestId("trade-spend-token").selectOption("USDC");

    await page.getByRole("button", { name: /Get fresh quote|Taze teklif al/ }).click();
    await expect(page.getByTestId("trade-dock")).toHaveAttribute("data-tradeability-status", "quote_loading");
    await page.screenshot({ path: testInfo.outputPath("trade-quote-loading-1440.png"), fullPage: false });
    await expect(page.getByTestId("trade-dock")).toContainText("LI.FI");
    await expect(page.getByTestId("trade-dock")).toContainText(/Minimum receive|Minimum alım/);
    await page.screenshot({ path: testInfo.outputPath("trade-quote-available-1440.png"), fullPage: false });
    await page.getByRole("button", { name: /Review swap|Swap'ı gözden geçir/ }).click();
    await expect(page.getByTestId("trade-review-dialog")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(page.getByTestId("trade-review-dialog")).toContainText(/Exact approval required|Kesin miktar token izni/);
    await expect(page.getByRole("button", { name: /Approve exactly|token izni ver/ })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("trade-review-exact-approval-1440.png"), fullPage: true });

    await page.getByRole("button", { name: /Approve exactly|token izni ver/ }).evaluate((button) => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
    await expect(page.getByTestId("trade-review-dialog")).toHaveCount(0);
    await expect(page.getByTestId("trade-dock")).toContainText(/Approval confirmed|Token izni \(approval\) onaylandı/);
    let sent = await sentTransactions(page);
    expect(sent).toHaveLength(1);
    expect(String(sent[0]?.data)).toMatch(/^0x095ea7b3/);
    expect(String(sent[0]?.data).endsWith(BigInt("100000").toString(16).padStart(64, "0"))).toBeTruthy();

    await page.getByRole("button", { name: /Get fresh quote|Taze teklif al/ }).click();
    await page.getByRole("button", { name: /Review swap|Swap'ı gözden geçir/ }).click();
    await expect(page.getByTestId("trade-review-dialog")).toContainText(/Passed for current draft|Güncel taslak için geçti/);
    await page.getByRole("button", { name: /Confirm swap in wallet|Swap'ı cüzdanda onayla/ }).evaluate((button) => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
    await expect(page.getByTestId("trade-review-dialog")).toHaveCount(0);
    sent = await sentTransactions(page);
    expect(sent).toHaveLength(2);
    expect(String(sent[1]?.data)).toBe("0x12345678");
    await expect(page.getByTestId("trade-dock").getByRole("link")).toHaveAttribute("href", /basescan\.org\/tx\/0x/);
  });
});

async function mockEnabledTradeServer(page: Page, options: { expiryMs?: number; delayMs?: number } = {}) {
  const capabilities: TradeCapabilities = { quoteRequestEnabled: true, transactionExecutionEnabled: true, approvalRequestEnabled: true, swapRequestEnabled: true, providers: [{ name: "LI.FI", status: "enabled" }, { name: "OpenOcean", status: "disabled" }, { name: "Odos", status: "disabled" }] };
  await page.route("**/api/health", (route) => route.fulfill({ json: { ok: true, ...capabilities, quoteProviders: capabilities.providers } }));
  await page.route("**/api/quote", async (route) => {
    if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    const request = route.request().postDataJSON() as BrowserQuoteRequest;
    const fromToken = { ...request.fromToken, decimals: request.fromToken.address.toLowerCase() === usdcAddress ? 6 : 18 };
    const toToken = { ...request.toToken, decimals: request.toToken.address.toLowerCase() === usdcAddress ? 6 : 18 };
    const fromAmountRaw = parseHumanTokenAmount(request.amount, fromToken.decimals)!;
    const createdAt = new Date().toISOString();
    const withoutFingerprint: Omit<TransactionQuote, "fingerprint"> = {
      kind: "transaction-quote", id: `mock_quote_${Date.now()}`, provider: "LI.FI", route: "Mocked CI route", walletAddress: request.walletAddress, pairKey: request.pairKey, side: request.side, chainId: BASE_TRADE_CHAIN_ID,
      fromToken, toToken, amount: request.amount, fromAmountRaw, expectedAmountRaw: "200000000000000000000", minimumAmountRaw: "190000000000000000000", approvalAddress, slippageBps: request.slippageBps, priceImpactPercent: 0.12, gasEstimate: "0x186a0", networkFeeUsd: "0.03", fees: [{ name: "Protocol fee", amountUsd: "0.01" }], createdAt, expiresAt: new Date(Date.now() + (options.expiryMs ?? 45_000)).toISOString(), transaction: { from: request.walletAddress, to: targetAddress, data: "0x12345678", value: "0x0", chainId: BASE_TRADE_CHAIN_ID, gasLimit: "0x186a0" }, simulation: "required"
    };
    const quote = { ...withoutFingerprint, fingerprint: createQuoteFingerprint(withoutFingerprint) };
    return route.fulfill({ json: { quote, capabilities } });
  });
}

async function mockFailedTradeServer(page: Page, code: "no-route" | "timeout") {
  const capabilities: TradeCapabilities = { quoteRequestEnabled: true, transactionExecutionEnabled: true, approvalRequestEnabled: true, swapRequestEnabled: true, providers: [{ name: "LI.FI", status: "enabled" }] };
  await page.route("**/api/health", (route) => route.fulfill({ json: { ok: true, ...capabilities, quoteProviders: capabilities.providers } }));
  await page.route("**/api/quote", (route) => route.fulfill({ status: code === "timeout" ? 504 : 422, json: { code } }));
}

async function connectWallet(page: Page) {
  await connectWalletOnly(page);
  await openTradeDrawer(page);
}

async function connectWalletOnly(page: Page) {
  await openWalletPicker(page);
  await page.getByTestId("wallet-provider-legacy:injected").click();
  await expect(page.getByTestId("connect-wallet-button")).toContainText("0x1111...1111");
}

async function openTradeDrawer(page: Page) {
  await page.getByTestId("matrix-row-pepe-weth").getByRole("button", { name: /Inspect|incele/ }).click();
  await page.getByTestId("inspector-trade-cta").click();
  await expect(page.locator("[data-overlay-state]")).toHaveAttribute("data-overlay-state", "trade_drawer");
  await expect(page.getByTestId("trade-dock")).toBeVisible();
}

async function openWalletPicker(page: Page) {
  const trigger = page.getByTestId("connect-wallet-button");
  await expect(trigger).toHaveAttribute("data-wallet-ready", "true");
  await trigger.click();
}

async function walletMethods(page: Page) {
  return page.evaluate(() => ((window as Window & { __walletHarness?: { requests: Array<{ method: string }> } }).__walletHarness?.requests ?? []).map((request) => request.method));
}

async function sentTransactions(page: Page) {
  return page.evaluate(() => ((window as Window & { __walletHarness?: { requests: Array<{ method: string; params?: unknown }> } }).__walletHarness?.requests ?? []).filter((request) => request.method === "eth_sendTransaction").map((request) => Array.isArray(request.params) ? request.params[0] as { data?: string } : {}));
}
