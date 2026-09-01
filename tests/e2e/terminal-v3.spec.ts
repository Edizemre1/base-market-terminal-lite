import { expect, test } from "@playwright/test";
import { getMarketTerminalSnapshot } from "../../src/data/providers";
import { pairsRepresentSamePair } from "../../src/lib/base-terminal/pairs";
import { buildOpportunityLanes, countReorderedMarkets, filterAndSortMarkets, limitPinnedMarketKeys } from "../../src/lib/base-terminal/terminalMarket";
import { SequentialQuoteService, parseLifiQuote } from "../../src/lib/trade/quoteProviders";
import type { TransactionQuote, QuoteProviderAdapter, QuoteRequest } from "../../src/lib/trade/types";
import { BASE_TRADE_CHAIN_ID } from "../../src/lib/trade/types";
import { buildExactApprovalData, createQuoteFingerprint, getQuoteInvalidationReason, isQuoteFingerprintValid, parseHumanTokenAmount, validateTransactionQuote } from "../../src/lib/trade/validation";

const walletAddress = "0x1111111111111111111111111111111111111111";
const fromAddress = "0x2222222222222222222222222222222222222222";
const toAddress = "0x3333333333333333333333333333333333333333";
const targetAddress = "0x4444444444444444444444444444444444444444";
const spenderAddress = "0x5555555555555555555555555555555555555555";

test.describe("terminal v3 market contracts", () => {
  test("builds four deterministic lanes and never invents a first-visit surge", async () => {
    const snapshot = await getMarketTerminalSnapshot("mock");
    const first = buildOpportunityLanes(snapshot.allPairs);
    const second = buildOpportunityLanes([...snapshot.allPairs].reverse());
    expect(first.map((lane) => lane.id)).toEqual(["new", "moving", "volume", "liquidity"]);
    expect(first.find((lane) => lane.id === "volume")?.fallback).toBeTruthy();
    expect(first.map((lane) => lane.pairs.map((pair) => pair.id))).toEqual(second.map((lane) => lane.pairs.map((pair) => pair.id)));
  });

  test("filters missing fields instead of treating them as zero and applies a canonical tie break", async () => {
    const snapshot = await getMarketTerminalSnapshot("mock");
    const pair = snapshot.allPairs[0];
    const missing = { ...pair, id: "missing", pairAddress: "0x9999999999999999999999999999999999999999", liquidityUsd: undefined, liquidity: Number.NaN };
    const rows = filterAndSortMarkets([missing, ...snapshot.allPairs], { query: "", minimumLiquidity: 1, change: "all", qualityView: "quality", sortBy: "liquidity", sortDirection: "desc" });
    expect(rows.some((row) => row.id === "missing")).toBeFalsy();
    const deterministic = filterAndSortMarkets([...snapshot.allPairs].reverse(), { query: "", change: "all", qualityView: "quality", sortBy: "volume24h", sortDirection: "desc" });
    expect(deterministic.map((row) => row.id)).toEqual(filterAndSortMarkets(snapshot.allPairs, { query: "", change: "all", qualityView: "quality", sortBy: "volume24h", sortDirection: "desc" }).map((row) => row.id));
  });

  test("caps pinned charts at four and counts queued reorder positions", async () => {
    expect(limitPinnedMarketKeys(["a", "b", "c", "d"], "e")).toEqual(["b", "c", "d", "e"]);
    expect(limitPinnedMarketKeys(["a", "b"], "a")).toEqual(["b"]);
    const snapshot = await getMarketTerminalSnapshot("mock");
    expect(countReorderedMarkets(snapshot.allPairs.slice(0, 3), [snapshot.allPairs[1], snapshot.allPairs[0], snapshot.allPairs[2]])).toBe(2);
  });

  test("keeps same-symbol pools separate when canonical addresses are available", async () => {
    const snapshot = await getMarketTerminalSnapshot("mock");
    const pool = snapshot.allPairs[0];
    const anotherPool = { ...pool, id: "another-pool", pairAddress: "0x9999999999999999999999999999999999999999" };
    expect(pairsRepresentSamePair(pool, anotherPool)).toBeFalsy();
    expect(pairsRepresentSamePair(pool, { ...pool })).toBeTruthy();
  });
});

test.describe("terminal v3 quote and transaction contracts", () => {
  test("parses exact token amounts without float math and rejects excess precision", () => {
    expect(parseHumanTokenAmount("1.000001", 6)).toBe("1000001");
    expect(parseHumanTokenAmount("0.0000001", 6)).toBeUndefined();
    expect(parseHumanTokenAmount("1e3", 18)).toBeUndefined();
    expect(parseHumanTokenAmount("0", 18)).toBeUndefined();
  });

  test("encodes only the exact approval amount and never uint256 max", () => {
    const data = buildExactApprovalData(spenderAddress, "1234567");
    expect(data).toHaveLength(138);
    expect(data?.startsWith("0x095ea7b3")).toBeTruthy();
    expect(data?.endsWith(BigInt(1234567).toString(16).padStart(64, "0"))).toBeTruthy();
    expect(data).not.toContain("f".repeat(64));
  });

  test("invalidates every bound review field and detects a tampered draft", () => {
    const quote = buildQuote();
    const current = { walletAddress, pairKey: quote.pairKey, side: quote.side, chainId: BASE_TRADE_CHAIN_ID, fromToken: quote.fromToken, toToken: quote.toToken, amount: quote.amount, slippageBps: quote.slippageBps } as const;
    expect(getQuoteInvalidationReason(quote, current)).toBeUndefined();
    expect(getQuoteInvalidationReason(quote, { ...current, amount: "2" })).toBe("amount");
    expect(getQuoteInvalidationReason(quote, { ...current, walletAddress: targetAddress })).toBe("wallet");
    expect(getQuoteInvalidationReason(quote, current, Date.parse(quote.expiresAt) + 1)).toBe("expired");
    expect(isQuoteFingerprintValid({ ...quote, transaction: { ...quote.transaction, value: "0x1" } })).toBeFalsy();
  });

  test("rejects an executable claim without complete validated calldata", () => {
    const quote = buildQuote();
    expect(validateTransactionQuote(quote)).toBeTruthy();
    expect(validateTransactionQuote({ ...quote, transaction: { ...quote.transaction, data: "0x" } })).toBeFalsy();
    expect(() => parseLifiQuote({ estimate: { toAmount: "2", toAmountMin: "1" }, transactionRequest: { to: targetAddress, value: "0x0" } }, buildRequest())).toThrow();
  });

  test("fails over sequentially, coalesces duplicates, and opens a bounded circuit", async () => {
    let primaryCalls = 0;
    let fallbackCalls = 0;
    const primary = adapter("LI.FI", async () => { primaryCalls += 1; throw new Error("unavailable"); });
    const fallback = adapter("OpenOcean", async (request) => { fallbackCalls += 1; await Promise.resolve(); return candidate(request, "OpenOcean"); });
    const service = new SequentialQuoteService([primary, fallback]);
    const firstRequest = buildRequest();
    const [first, duplicate] = await Promise.all([service.getQuote(firstRequest), service.getQuote(firstRequest)]);
    expect(first.id).toBe(duplicate.id);
    expect(primaryCalls).toBe(1);
    expect(fallbackCalls).toBe(1);
    await service.getQuote({ ...firstRequest, fromAmountRaw: "2000000", amount: "2" });
    await service.getQuote({ ...firstRequest, fromAmountRaw: "3000000", amount: "3" });
    await service.getQuote({ ...firstRequest, fromAmountRaw: "4000000", amount: "4" });
    expect(primaryCalls).toBe(3);
    expect(service.getProviderStatus("LI.FI")).toBe("circuit-open");
    expect(fallbackCalls).toBe(4);
  });
});

function buildRequest(): QuoteRequest {
  return { walletAddress, pairKey: `base:${fromAddress}:${toAddress}:pool`, side: "buy", fromToken: { address: fromAddress, symbol: "USDC", decimals: 6 }, toToken: { address: toAddress, symbol: "TOKEN", decimals: 18 }, amount: "1", fromAmountRaw: "1000000", slippageBps: 50, chainId: BASE_TRADE_CHAIN_ID };
}

function buildQuote() {
  const createdAt = new Date(Date.now() - 1000).toISOString();
  const withoutFingerprint: Omit<TransactionQuote, "fingerprint"> = { ...candidate(buildRequest(), "LI.FI"), id: "quote_test", createdAt, expiresAt: new Date(Date.now() + 30_000).toISOString() };
  return { ...withoutFingerprint, fingerprint: createQuoteFingerprint(withoutFingerprint) };
}

function candidate(request: QuoteRequest, provider: "LI.FI" | "OpenOcean"): Omit<TransactionQuote, "id" | "fingerprint" | "createdAt" | "expiresAt"> {
  return { kind: "transaction-quote", provider, route: `${provider} route`, walletAddress: request.walletAddress, pairKey: request.pairKey, side: request.side, chainId: BASE_TRADE_CHAIN_ID, fromToken: request.fromToken, toToken: request.toToken, amount: request.amount, fromAmountRaw: request.fromAmountRaw, expectedAmountRaw: "2000000000000000000", minimumAmountRaw: "1900000000000000000", approvalAddress: spenderAddress, slippageBps: request.slippageBps, fees: [], transaction: { from: request.walletAddress, to: targetAddress, data: "0x12345678", value: "0x0", chainId: BASE_TRADE_CHAIN_ID }, simulation: "required" };
}

function adapter(id: QuoteProviderAdapter["id"], quote: QuoteProviderAdapter["quote"]): QuoteProviderAdapter { return { id, enabled: () => true, quote }; }
