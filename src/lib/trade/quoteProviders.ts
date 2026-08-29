import { parseStrictFiniteNumber } from "@/lib/marketMath";
import { readArray, readRecord, readString } from "@/data/providers/responseValidation";
import type { TransactionQuote, QuoteProviderAdapter, QuoteRequest, TradeCapabilities, TradeFee } from "./types";
import { createQuoteFingerprint, isEvmAddress, normalizeHexQuantity, validateTransactionQuote } from "./validation";

const QUOTE_TIMEOUT_MS = 8_000;
const QUOTE_CACHE_MS = 5_000;
const QUOTE_SAFETY_TTL_MS = 45_000;
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_OPEN_MS = 30_000;
const MAX_CACHE_ENTRIES = 100;
let quoteSequence = 0;

type CircuitState = { failures: number; openUntil: number };
type QuoteCacheEntry = { quote: TransactionQuote; cachedUntil: number };

export class SequentialQuoteService {
  private readonly inFlight = new Map<string, Promise<TransactionQuote>>();
  private readonly cache = new Map<string, QuoteCacheEntry>();
  private readonly circuits = new Map<QuoteProviderAdapter["id"], CircuitState>();

  constructor(private readonly adapters: QuoteProviderAdapter[]) {}

  async getQuote(request: QuoteRequest) {
    const key = getRequestKey(request);
    const now = Date.now();
    this.prune(now);
    const cached = this.cache.get(key);
    if (cached && cached.cachedUntil > now && Date.parse(cached.quote.expiresAt) > now) return cached.quote;
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const operation = this.loadSequentially(request).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, operation);
    return operation;
  }

  getProviderStatus(id: QuoteProviderAdapter["id"]) {
    const adapter = this.adapters.find((candidate) => candidate.id === id);
    if (!adapter?.enabled()) return "disabled" as const;
    return (this.circuits.get(id)?.openUntil ?? 0) > Date.now() ? "circuit-open" as const : "enabled" as const;
  }

  private async loadSequentially(request: QuoteRequest) {
    let lastError: unknown;
    for (const adapter of this.adapters) {
      if (!adapter.enabled() || this.isCircuitOpen(adapter.id)) continue;
      try {
        const candidate = await withTimeout((signal) => adapter.quote(request, signal), QUOTE_TIMEOUT_MS);
        const createdAt = new Date().toISOString();
        const withoutFingerprint: Omit<TransactionQuote, "fingerprint"> = {
          ...candidate,
          id: `quote_${Date.now().toString(36)}_${(quoteSequence = (quoteSequence + 1) % 1_000_000).toString(36)}`,
          createdAt,
          expiresAt: new Date(Date.now() + QUOTE_SAFETY_TTL_MS).toISOString()
        };
        const quote: TransactionQuote = { ...withoutFingerprint, fingerprint: createQuoteFingerprint(withoutFingerprint) };
        if (!validateTransactionQuote(quote)) throw new Error("Provider returned an invalid transaction quote");
        this.circuits.set(adapter.id, { failures: 0, openUntil: 0 });
        this.cache.set(getRequestKey(request), { quote, cachedUntil: Date.now() + QUOTE_CACHE_MS });
        return quote;
      } catch (error) {
        lastError = error;
        const current = this.circuits.get(adapter.id) ?? { failures: 0, openUntil: 0 };
        const failures = current.failures + 1;
        this.circuits.set(adapter.id, {
          failures,
          openUntil: failures >= CIRCUIT_FAILURE_THRESHOLD ? Date.now() + CIRCUIT_OPEN_MS : 0
        });
      }
    }
    throw lastError instanceof Error ? lastError : new Error("No transaction quote provider is currently available");
  }

  private isCircuitOpen(id: QuoteProviderAdapter["id"]) {
    return (this.circuits.get(id)?.openUntil ?? 0) > Date.now();
  }

  private prune(now: number) {
    for (const [key, entry] of this.cache) if (entry.cachedUntil <= now || Date.parse(entry.quote.expiresAt) <= now) this.cache.delete(key);
    while (this.cache.size > MAX_CACHE_ENTRIES) this.cache.delete(this.cache.keys().next().value!);
    for (const [id, state] of this.circuits) if (state.openUntil > 0 && state.openUntil <= now) this.circuits.set(id, { failures: 0, openUntil: 0 });
  }
}

export const lifiQuoteAdapter: QuoteProviderAdapter = {
  id: "LI.FI",
  enabled: () => isQuoteRequestEnabled(),
  quote: async (request, signal) => {
    const url = new URL("https://li.quest/v1/quote");
    url.searchParams.set("fromChain", String(request.chainId));
    url.searchParams.set("toChain", String(request.chainId));
    url.searchParams.set("fromToken", request.fromToken.address);
    url.searchParams.set("toToken", request.toToken.address);
    url.searchParams.set("fromAmount", request.fromAmountRaw);
    url.searchParams.set("fromAddress", request.walletAddress);
    url.searchParams.set("slippage", String(request.slippageBps / 10_000));
    const headers: Record<string, string> = { accept: "application/json" };
    const apiKey = process.env.LIFI_API_KEY?.trim();
    if (apiKey) headers["x-lifi-api-key"] = apiKey;
    const response = await fetch(url, { headers, signal, cache: "no-store" });
    if (!response.ok) throw new Error(`Quote provider rejected the request (${response.status})`);
    return parseLifiQuote(await response.json(), request);
  }
};

const quoteService = new SequentialQuoteService([lifiQuoteAdapter]);

export function getQuoteService() {
  return quoteService;
}

export function getTradeCapabilities(): TradeCapabilities {
  const quoteRequestEnabled = isQuoteRequestEnabled();
  const transactionExecutionEnabled = quoteRequestEnabled && process.env.MERGEN_SWAP_EXECUTION_ENABLED === "true";
  return {
    quoteRequestEnabled,
    transactionExecutionEnabled,
    approvalRequestEnabled: transactionExecutionEnabled,
    swapRequestEnabled: transactionExecutionEnabled,
    providers: [
      { name: "LI.FI", status: quoteService.getProviderStatus("LI.FI") },
      { name: "OpenOcean", status: "disabled" },
      { name: "Odos", status: "disabled" }
    ]
  };
}

export function isQuoteRequestEnabled() {
  return process.env.MERGEN_QUOTE_ENABLED === "true";
}

export function parseLifiQuote(payload: unknown, request: QuoteRequest): Omit<TransactionQuote, "id" | "fingerprint" | "createdAt" | "expiresAt"> {
  const root = readRecord(payload);
  const estimate = readRecord(root?.estimate);
  const transaction = readRecord(root?.transactionRequest);
  const expectedAmountRaw = readRawAmount(estimate?.toAmount);
  const minimumAmountRaw = readRawAmount(estimate?.toAmountMin);
  const target = readAddress(transaction?.to);
  const data = readHexData(transaction?.data);
  const value = normalizeHexQuantity(transaction?.value ?? "0x0");
  const transactionFrom = readAddress(transaction?.from) ?? request.walletAddress;
  const transactionChain = parseStrictFiniteNumber(transaction?.chainId);
  if (!root || !estimate || !transaction || !expectedAmountRaw || !minimumAmountRaw || !target || !data || !value) throw new Error("Quote provider response is incomplete");
  if (transactionChain !== undefined && transactionChain !== request.chainId) throw new Error("Quote provider returned the wrong chain");
  if (transactionFrom.toLowerCase() !== request.walletAddress.toLowerCase()) throw new Error("Quote provider returned the wrong wallet");

  const gasCosts = readArray(estimate.gasCosts).map(readRecord).filter(Boolean);
  const feeCosts = readArray(estimate.feeCosts).map(readRecord).filter(Boolean);
  const networkFeeUsdNumber = gasCosts.reduce((sum, fee) => sum + (parseStrictFiniteNumber(fee?.amountUSD) ?? 0), 0);
  const tool = readSafeLabel(root.tool, 64) ?? readSafeLabel(estimate.tool, 64) ?? "LI.FI route";
  const approvalAddress = readAddress(estimate.approvalAddress);
  const priceImpact = parseStrictFiniteNumber(estimate.priceImpact);
  const gasLimit = normalizeHexQuantity(transaction.gasLimit);

  return {
    kind: "transaction-quote",
    provider: "LI.FI",
    route: tool,
    walletAddress: request.walletAddress,
    pairKey: request.pairKey,
    side: request.side,
    chainId: request.chainId,
    fromToken: request.fromToken,
    toToken: request.toToken,
    amount: request.amount,
    fromAmountRaw: request.fromAmountRaw,
    expectedAmountRaw,
    minimumAmountRaw,
    approvalAddress: approvalAddress && approvalAddress !== "0x0000000000000000000000000000000000000000" ? approvalAddress : undefined,
    slippageBps: request.slippageBps,
    priceImpactPercent: priceImpact,
    gasEstimate: gasLimit,
    networkFeeUsd: networkFeeUsdNumber > 0 ? networkFeeUsdNumber.toFixed(4) : undefined,
    fees: feeCosts.map(toFee).filter((fee): fee is TradeFee => Boolean(fee)),
    transaction: { from: transactionFrom, to: target, data, value, chainId: request.chainId, gasLimit },
    simulation: "required"
  };
}

function toFee(value: Record<string, unknown> | undefined): TradeFee | undefined {
  if (!value) return undefined;
  const name = readSafeLabel(value.name, 80) ?? readSafeLabel(value.description, 80) ?? "Provider fee";
  const token = readRecord(value.token);
  return {
    name,
    amountRaw: readRawAmount(value.amount),
    amountUsd: readDecimalText(value.amountUSD),
    tokenSymbol: readSafeLabel(token?.symbol, 24)
  };
}

function getRequestKey(request: QuoteRequest) {
  return [request.walletAddress, request.pairKey, request.side, request.fromToken.address, request.toToken.address, request.fromAmountRaw, request.slippageBps]
    .join(":")
    .toLowerCase();
}

function readAddress(value: unknown) {
  const text = readString(value);
  return isEvmAddress(text) ? text.toLowerCase() : undefined;
}

function readRawAmount(value: unknown) {
  const text = readString(value);
  return text && /^(?:0|[1-9]\d{0,77})$/.test(text) ? text : undefined;
}

function readDecimalText(value: unknown) {
  const parsed = parseStrictFiniteNumber(value);
  return parsed !== undefined && parsed >= 0 ? String(parsed) : undefined;
}

function readHexData(value: unknown) {
  const text = readString(value);
  return text && /^0x(?:[0-9a-f]{2})+$/i.test(text) && text.length <= 200_002 ? text : undefined;
}

function readSafeLabel(value: unknown, maximum: number) {
  const text = readString(value)?.replace(/[\u0000-\u001f\u007f]/g, " ");
  return text ? text.slice(0, maximum) : undefined;
}

async function withTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}
