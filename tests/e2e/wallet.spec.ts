import { expect, test, type Page } from "@playwright/test";
import type { TransactionQuote, TradeCapabilities } from "../../src/lib/trade/types";
import { BASE_TRADE_CHAIN_ID } from "../../src/lib/trade/types";
import { createQuoteFingerprint } from "../../src/lib/trade/validation";
import { installVerifiedWalletStub } from "./helpers/walletStub";

const account = "0x1111111111111111111111111111111111111111";
const pairAddress = mockAddress(1);
const baseAddress = mockAddress(101);
const quoteAddress = mockAddress(201);
const targetAddress = "0x4444444444444444444444444444444444444444";
const approvalAddress = "0x5555555555555555555555555555555555555555";

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

  test("switches to Base only after the manual action", async ({ page }) => {
    await mockEnabledTradeServer(page);
    await installVerifiedWalletStub(page, { chainId: "0x1" });
    await page.goto("/terminal?data=mock");
    await openWalletPicker(page);
    await page.getByTestId("wallet-provider-legacy:injected").click();
    await openTradeDrawer(page);
    await expect(page.getByTestId("trade-dock")).toHaveAttribute("data-tradeability-status", "wrong_network");
    expect(await walletMethods(page)).not.toContain("wallet_switchEthereumChain");
    await page.getByRole("button", { name: /Switch to Base|Base ağına geç/ }).click();
    await expect(page.getByTestId("connect-wallet-button")).toContainText("0x1111...1111");
    expect(await walletMethods(page)).toContain("wallet_switchEthereumChain");
  });

  test("keeps exact no-route distinct from timeout and other provider outages", async ({ page }) => {
    await installVerifiedWalletStub(page);
    await mockFailedTradeServer(page, "no-route");
    await page.goto("/terminal?data=mock");
    await connectWallet(page);
    await page.getByRole("button", { name: /Get fresh quote|Güncel teklif al/ }).click();
    await expect(page.getByTestId("trade-dock")).toHaveAttribute("data-tradeability-status", "no_route");
    await expect(page.getByTestId("trade-dock")).toContainText(/No route was found|route bulunamadı/);

    await page.unroute("**/api/quote");
    await mockFailedTradeServer(page, "timeout");
    await page.getByRole("button", { name: /Get fresh quote|Güncel teklif al/ }).click();
    await expect(page.getByTestId("trade-dock")).toHaveAttribute("data-tradeability-status", "provider_unavailable");
    await expect(page.getByTestId("trade-dock")).toContainText(/timed out|zaman aşımına/);
    await expect(page.getByTestId("trade-dock")).not.toContainText(/No route was found|route bulunamadı/);
  });

  test("expires and invalidates a quote on pair or wallet context changes", async ({ page }) => {
    await installVerifiedWalletStub(page);
    await mockEnabledTradeServer(page, { expiryMs: 700 });
    await page.goto("/terminal?data=mock");
    await connectWallet(page);
    await page.getByRole("button", { name: /Get fresh quote|Güncel teklif al/ }).click();
    await expect(page.getByTestId("trade-dock")).toHaveAttribute("data-tradeability-status", "quote_available");
    await expect(page.getByTestId("trade-dock")).toHaveAttribute("data-tradeability-status", "quote_expired", { timeout: 3_000 });

    await page.unroute("**/api/quote");
    await mockEnabledTradeServer(page);
    await page.getByRole("button", { name: /Get fresh quote|Güncel teklif al/ }).click();
    await expect(page.getByTestId("trade-dock")).toHaveAttribute("data-tradeability-status", "quote_available");
    await page.keyboard.press("Escape");
    await page.getByTestId("matrix-row-blob-usdc").getByRole("button").first().click();
    await page.getByTestId("context-inspector").getByRole("button", { name: /Buy|Al/, exact: true }).click();
    await expect(page.getByTestId("trade-dock")).toHaveAttribute("data-tradeability-status", "quote_required");

    await page.evaluate(() => (window as Window & { __walletHarness?: { disconnect: () => void } }).__walletHarness?.disconnect());
    await expect(page.getByTestId("trade-dock")).toHaveAttribute("data-tradeability-status", "wallet_required");
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
    await mockEnabledTradeServer(page);
    await page.goto("/terminal?data=mock");
    await openWalletPicker(page);
    await page.getByTestId("wallet-provider-legacy:injected").click();
    await openTradeDrawer(page);

    await page.getByRole("button", { name: /Get fresh quote|Güncel teklif al/ }).click();
    await expect(page.getByTestId("trade-dock")).toContainText("LI.FI");
    await expect(page.getByTestId("trade-dock")).toContainText(/Minimum receive|Minimum alım/);
    await page.getByRole("button", { name: /Review swap|Swap'ı gözden geçir/ }).click();
    await expect(page.getByTestId("trade-review-dialog")).toBeVisible();
    await expect(page.getByTestId("trade-review-dialog")).toContainText(/Exact approval required|Kesin miktar approval gerekli/);
    await page.screenshot({ path: testInfo.outputPath("trade-review-exact-approval-1440.png"), fullPage: true });

    await page.getByRole("button", { name: /Approve exactly|Tam .* onayla/ }).evaluate((button) => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
    await expect(page.getByTestId("trade-review-dialog")).toHaveCount(0);
    await expect(page.getByTestId("trade-dock")).toContainText(/Approval confirmed|Approval onaylandı/);
    let sent = await sentTransactions(page);
    expect(sent).toHaveLength(1);
    expect(String(sent[0]?.data)).toMatch(/^0x095ea7b3/);
    expect(String(sent[0]?.data).endsWith(BigInt("100000000000000000").toString(16).padStart(64, "0"))).toBeTruthy();

    await page.getByRole("button", { name: /Get fresh quote|Güncel teklif al/ }).click();
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

async function mockEnabledTradeServer(page: Page, options: { expiryMs?: number } = {}) {
  const capabilities: TradeCapabilities = { quoteRequestEnabled: true, transactionExecutionEnabled: true, approvalRequestEnabled: true, swapRequestEnabled: true, providers: [{ name: "LI.FI", status: "enabled" }, { name: "OpenOcean", status: "disabled" }, { name: "Odos", status: "disabled" }] };
  await page.route("**/api/health", (route) => route.fulfill({ json: { ok: true, ...capabilities, quoteProviders: capabilities.providers } }));
  await page.route("**/api/quote", (route) => {
    const createdAt = new Date().toISOString();
    const withoutFingerprint: Omit<TransactionQuote, "fingerprint"> = {
      kind: "transaction-quote", id: `mock_quote_${Date.now()}`, provider: "LI.FI", route: "Mocked CI route", walletAddress: account, pairKey: `base:pool:${pairAddress}`, side: "buy", chainId: BASE_TRADE_CHAIN_ID,
      fromToken: { address: quoteAddress, symbol: "WETH", decimals: 18 }, toToken: { address: baseAddress, symbol: "PEPE", decimals: 18 }, amount: "0.10", fromAmountRaw: "100000000000000000", expectedAmountRaw: "200000000000000000000", minimumAmountRaw: "190000000000000000000", approvalAddress, slippageBps: 50, priceImpactPercent: 0.12, gasEstimate: "0x186a0", networkFeeUsd: "0.03", fees: [{ name: "Protocol fee", amountUsd: "0.01" }], createdAt, expiresAt: new Date(Date.now() + (options.expiryMs ?? 45_000)).toISOString(), transaction: { from: account, to: targetAddress, data: "0x12345678", value: "0x0", chainId: BASE_TRADE_CHAIN_ID, gasLimit: "0x186a0" }, simulation: "required"
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
  await openWalletPicker(page);
  await page.getByTestId("wallet-provider-legacy:injected").click();
  await openTradeDrawer(page);
}

async function openTradeDrawer(page: Page) {
  await page.getByTestId("matrix-row-pepe-weth").getByRole("button", { name: /Inspect|incele/ }).click();
  await page.getByTestId("context-inspector").getByRole("button", { name: /Buy|Al/, exact: true }).click();
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

function mockAddress(value: number) { return `0x${value.toString(16).padStart(40, "0")}`; }
