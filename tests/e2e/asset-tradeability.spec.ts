import { expect, test } from "@playwright/test";
import { getTokenAvatarPresentation } from "../../src/components/TokenIdentity";
import { getMarketTerminalSnapshot } from "../../src/data/providers";
import { assetIdentityForPair } from "../../src/components/base-terminal/AssetTradeabilityBadges";
import { deriveTradeabilityAssessment, resolveAssetIdentity, type TradeabilityStatus } from "../../src/lib/base-terminal/assetTradeability";
import { getNormalizedMarketModel } from "../../src/lib/base-terminal/marketModel";
import { en, tr } from "../../src/i18n/dictionaries";
import { getBaseScanAddressUrl, sanitizeTokenLogoUrl } from "../../src/lib/safeUrl";
import { QuoteProviderError, SequentialQuoteService } from "../../src/lib/trade/quoteProviders";
import { BASE_TRADE_CHAIN_ID, type QuoteFailureCode, type QuoteProviderAdapter, type QuoteRequest, type TradeCapabilities, type TransactionQuote } from "../../src/lib/trade/types";
import { createQuoteFingerprint } from "../../src/lib/trade/validation";
import type { BasePair } from "../../src/types/baseTerminal";

const wallet = "0x1111111111111111111111111111111111111111";
const otherWallet = "0x2222222222222222222222222222222222222222";

test.describe("asset identity", () => {
  test("binds identity to lowercase exact contracts rather than names or symbols", () => {
    const weth = resolveAssetIdentity({ chainId: 8453, tokenAddress: "0x4200000000000000000000000000000000000006" });
    const uppercaseAddress = resolveAssetIdentity({ chainId: "Base", tokenAddress: "0x833589FCD6EDB6E08F4C7C32D4F71B54BDA02913", displaySymbol: "USDC" });
    const sameSymbolDifferentContract = resolveAssetIdentity({ chainId: 8453, tokenAddress: "0x9999999999999999999999999999999999999999", displayName: "USD Coin", displaySymbol: "USDC" });
    const conflict = resolveAssetIdentity({ chainId: 8453, tokenAddress: "0x4200000000000000000000000000000000000006", displaySymbol: "APPLE" });
    expect(weth).toMatchObject({ status: "verified", canonicalSymbol: "WETH", tokenAddress: "0x4200000000000000000000000000000000000006" });
    expect(uppercaseAddress).toMatchObject({ status: "verified", canonicalSymbol: "USDC", tokenAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" });
    expect(sameSymbolDifferentContract.status).toBe("unverified");
    expect(conflict.status).toBe("conflicting");
  });

  test("keeps an Apple-like unverified token generic and suppresses its upstream logo", () => {
    const address = "0x9999999999999999999999999999999999999999";
    const identity = resolveAssetIdentity({ chainId: 8453, tokenAddress: address, displayName: "Apple Token", displaySymbol: "AAPL" });
    const presentation = getTokenAvatarPresentation({ symbol: "AAPL", name: "Apple Token", address, chainId: 8453 });
    expect(identity).toMatchObject({ status: "unverified", usesGenericAvatar: true, resemblesKnownBrand: true });
    expect(presentation.identity.status).toBe("unverified");
    expect(presentation.safeLogoUrl).toBeUndefined();
  });

  test("recognizes company-name and ticker aliases without granting identity", () => {
    for (const displaySymbol of ["AAPL", "TSLAc", "MSFT", "AMZN", "GOOGLc", "NVDAc", "NFLX"]) {
      const identity = resolveAssetIdentity({ chainId: 8453, tokenAddress: "0x9999999999999999999999999999999999999999", displaySymbol });
      expect(identity).toMatchObject({ status: "unverified", resemblesKnownBrand: true, usesGenericAvatar: true });
    }
  });

  test("sanitizes identity links and never treats missing as verified", () => {
    expect(getBaseScanAddressUrl("javascript:alert(1)")).toBeUndefined();
    expect(getBaseScanAddressUrl("0x9999999999999999999999999999999999999999")).toBe("https://basescan.org/address/0x9999999999999999999999999999999999999999");
    expect(sanitizeTokenLogoUrl("javascript:alert(1)")).toBeUndefined();
    expect(resolveAssetIdentity({ chainId: 8453 }).status).toBe("unavailable");
  });

  test("rebinds malformed opportunity labels to the exact token side", async () => {
    const pair = await pairAt(0);
    const officialPair = {
      ...pair,
      chainId: "base",
      baseToken: "WETH",
      baseTokenAddress: "0x4200000000000000000000000000000000000006",
      quoteToken: "USDC",
      quoteTokenAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      focusTokenAddress: "0x4200000000000000000000000000000000000006",
      focusTokenName: "WETH / USDC",
      focusTokenSymbol: "WETH/USDC"
    } satisfies BasePair;
    expect(assetIdentityForPair(officialPair)).toMatchObject({ status: "verified", displaySymbol: "WETH", canonicalSymbol: "WETH" });
    expect(assetIdentityForPair({ ...officialPair, focusTokenAddress: officialPair.quoteTokenAddress })).toMatchObject({ status: "verified", displaySymbol: "USDC", canonicalSymbol: "USDC" });
  });
});

test.describe("live tradeability", () => {
  test("separates market data and provider recognition from an executable quote", async () => {
    const pair = await pairAt(0);
    expect(assessment(pair, {}).status).toBe("market_data_only");
    expect(assessment(pair, { capabilities: enabledCapabilities(), walletAddress: wallet, walletChainId: 8453, amount: "1" }).status).toBe("quote_required");
  });

  test("accepts only a fresh exact quote and invalidates every bound context", async () => {
    const pair = await pairAt(0);
    const quote = quoteFor(pair);
    const exact = { capabilities: enabledCapabilities(), walletAddress: wallet, walletChainId: 8453, amount: "1", quote };
    expect(assessment(pair, exact).status).toBe("quote_available");
    expect(assessment(pair, { ...exact, amount: "2" }).status).toBe("quote_required");
    expect(assessment(pair, { ...exact, side: "sell" }).status).toBe("quote_required");
    expect(assessment(pair, { ...exact, slippageBps: 100 }).status).toBe("quote_required");
    expect(assessment(pair, { ...exact, walletAddress: otherWallet }).status).toBe("quote_required");
    const anotherPair = await pairAt(1);
    expect(assessment(anotherPair, exact).status).not.toBe("quote_available");
  });

  test("distinguishes exact no-route from timeout, rate limit, and unsupported token", async () => {
    const pair = await pairAt(0);
    const expected: Array<[QuoteFailureCode, TradeabilityStatus]> = [
      ["no-route", "no_route"],
      ["timeout", "provider_unavailable"],
      ["rate-limited", "provider_unavailable"],
      ["unsupported-token", "token_metadata_invalid"]
    ];
    for (const [code, status] of expected) {
      const result = assessment(pair, { capabilities: enabledCapabilities(), walletAddress: wallet, walletChainId: 8453, amount: "1", quoteFailureCode: code });
      expect(result.status).toBe(status);
      expect(result.reasonCode).toBe(code);
    }
  });

  test("models expiry, wallet, network, circuit, metadata, execution, review, and simulation states", async () => {
    const pair = await pairAt(0);
    const capabilities = enabledCapabilities();
    const quote = quoteFor(pair);
    expect(assessment(pair, { capabilities, amount: "1" }).status).toBe("wallet_required");
    expect(assessment(pair, { capabilities, walletAddress: wallet, walletChainId: 1, amount: "1" }).status).toBe("wrong_network");
    expect(assessment(pair, { capabilities: { ...capabilities, providers: [{ name: "LI.FI", status: "circuit-open" }] }, walletAddress: wallet, walletChainId: 8453, amount: "1" }).status).toBe("provider_unavailable");
    expect(assessment(pair, { capabilities: { ...capabilities, quoteRequestEnabled: false }, walletAddress: wallet, walletChainId: 8453, amount: "1" }).status).toBe("execution_disabled");
    expect(assessment({ ...pair, baseTokenAddress: "invalid" }, { capabilities, walletAddress: wallet, walletChainId: 8453, amount: "1" }).status).toBe("token_metadata_invalid");
    expect(assessment(pair, { capabilities, walletAddress: wallet, walletChainId: 8453, amount: "1", quote, now: Date.parse(quote.expiresAt) + 1 }).status).toBe("quote_expired");
    expect(assessment(pair, { capabilities, walletAddress: wallet, walletChainId: 8453, amount: "1", quote, reviewRequested: true }).status).toBe("review_ready");
    expect(assessment(pair, { capabilities, walletAddress: wallet, walletChainId: 8453, amount: "1", quote, reviewOpen: true }).status).toBe("simulation_required");
    expect(assessment(pair, { capabilities, walletAddress: wallet, walletChainId: 8453, amount: "1", quote, reviewOpen: true, approvalRequired: true }).status).toBe("approval_required");
    expect(assessment(pair, { capabilities, walletAddress: wallet, walletChainId: 8453, amount: "1", quote, reviewOpen: true, simulationPassed: true, transactionReady: true }).status).toBe("transaction_ready");
  });

  test("preserves typed provider failures without opening a circuit for no-route", async () => {
    let calls = 0;
    const adapter: QuoteProviderAdapter = { id: "LI.FI", enabled: () => true, quote: async () => { calls += 1; throw new QuoteProviderError("no-route", "exact no route"); } };
    const service = new SequentialQuoteService([adapter]);
    for (let index = 0; index < 3; index += 1) await expect(service.getQuote({ ...requestFor(await pairAt(0)), amount: String(index + 1), fromAmountRaw: String(index + 1) })).rejects.toMatchObject({ code: "no-route" });
    expect(calls).toBe(3);
    expect(service.getProviderStatus("LI.FI")).toBe("enabled");
  });

  test("has complete TR/EN parity for every identity and tradeability state", () => {
    const statuses: TradeabilityStatus[] = ["market_data_only", "quote_required", "quote_loading", "quote_available", "no_route", "quote_expired", "execution_disabled", "wrong_network", "wallet_required", "review_ready", "approval_required", "simulation_required", "transaction_ready", "provider_unavailable", "token_metadata_invalid"];
    for (const status of statuses) {
      const label = `tradeability.status.${status}` as keyof typeof en;
      const description = `tradeability.description.${status}` as keyof typeof en;
      expect(en[label]).toBeTruthy(); expect(tr[label]).toBeTruthy();
      expect(en[description]).toBeTruthy(); expect(tr[description]).toBeTruthy();
    }
    for (const status of ["verified", "unverified", "conflicting", "unavailable"] as const) {
      const key = `identity.status.${status}` as keyof typeof en;
      expect(en[key]).toBeTruthy(); expect(tr[key]).toBeTruthy();
    }
  });
});

async function pairAt(index: number) {
  return (await getMarketTerminalSnapshot("mock")).allPairs[index];
}

function assessment(pair: BasePair, input: Partial<Parameters<typeof deriveTradeabilityAssessment>[0]>) {
  return deriveTradeabilityAssessment({ pair, side: input.side ?? "buy", amount: input.amount ?? "", slippageBps: input.slippageBps ?? 50, ...input });
}

function enabledCapabilities(): TradeCapabilities {
  return { quoteRequestEnabled: true, transactionExecutionEnabled: true, approvalRequestEnabled: true, swapRequestEnabled: true, providers: [{ name: "LI.FI", status: "enabled" }] };
}

function requestFor(pair: BasePair): QuoteRequest {
  return { walletAddress: wallet, pairKey: getNormalizedMarketModel(pair).key, side: "buy", fromToken: { address: pair.quoteTokenAddress!, symbol: pair.quoteToken, decimals: 6 }, toToken: { address: pair.baseTokenAddress!, symbol: pair.baseToken, decimals: 18 }, amount: "1", fromAmountRaw: "1000000", slippageBps: 50, chainId: BASE_TRADE_CHAIN_ID };
}

function quoteFor(pair: BasePair): TransactionQuote {
  const request = requestFor(pair);
  const createdAt = new Date("2026-08-30T10:00:00.000Z").toISOString();
  const withoutFingerprint: Omit<TransactionQuote, "fingerprint"> = {
    kind: "transaction-quote", id: "quote_exact", provider: "LI.FI", route: "LI.FI exact route", walletAddress: wallet, pairKey: request.pairKey, side: "buy", chainId: BASE_TRADE_CHAIN_ID,
    fromToken: request.fromToken, toToken: request.toToken, amount: "1", fromAmountRaw: "1000000", expectedAmountRaw: "2000000000000000000", minimumAmountRaw: "1900000000000000000", slippageBps: 50,
    fees: [], createdAt, expiresAt: new Date("2099-08-30T10:00:45.000Z").toISOString(), transaction: { from: wallet, to: "0x3333333333333333333333333333333333333333", data: "0x12345678", value: "0x0", chainId: BASE_TRADE_CHAIN_ID }, simulation: "required"
  };
  return { ...withoutFingerprint, fingerprint: createQuoteFingerprint(withoutFingerprint) };
}
