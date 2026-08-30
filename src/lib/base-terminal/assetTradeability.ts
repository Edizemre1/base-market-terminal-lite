import type { BasePair } from "@/types/baseTerminal";
import type { QuoteFailureCode, TransactionQuote, TradeCapabilities, TradeSide } from "@/lib/trade/types";
import { BASE_TRADE_CHAIN_ID } from "@/lib/trade/types";
import { getQuoteInvalidationReason, isEvmAddress, isQuoteFingerprintValid, validateTransactionQuote } from "@/lib/trade/validation";
import { getNormalizedMarketModel } from "./marketModel";

export type AssetIdentityStatus = "verified" | "unverified" | "conflicting" | "unavailable";

export type TradeabilityStatus =
  | "market_data_only"
  | "quote_required"
  | "quote_loading"
  | "quote_available"
  | "no_route"
  | "quote_expired"
  | "execution_disabled"
  | "wrong_network"
  | "wallet_required"
  | "review_ready"
  | "approval_required"
  | "simulation_required"
  | "transaction_ready"
  | "provider_unavailable"
  | "token_metadata_invalid";

export type AssetIdentityRegistryRecord = {
  chainId: typeof BASE_TRADE_CHAIN_ID;
  contractAddress: string;
  canonicalName: string;
  canonicalSymbol: string;
  verifiedIssuer: string;
  officialSourceUrl: string;
  officialLogoUrl?: string;
  verificationDate: string;
  version: string;
};

export type AssetIdentityAssessment = {
  status: AssetIdentityStatus;
  chainId: typeof BASE_TRADE_CHAIN_ID;
  tokenAddress?: string;
  displayName: string;
  displaySymbol: string;
  canonicalName?: string;
  canonicalSymbol?: string;
  verifiedIssuer?: string;
  officialSourceUrl?: string;
  officialLogoUrl?: string;
  reasonCode: "registry_exact_match" | "registry_symbol_conflict" | "address_not_in_registry" | "address_unavailable";
  source: string;
  observedAt: string;
  expiresAt: string;
  usesGenericAvatar: boolean;
  resemblesKnownBrand: boolean;
};

export type TradeabilityAssessment = {
  status: TradeabilityStatus;
  chainId: typeof BASE_TRADE_CHAIN_ID;
  tokenAddress?: string;
  fromTokenAddress?: string;
  toTokenAddress?: string;
  pairKey: string;
  side: TradeSide;
  amount: string;
  slippageBps: number;
  walletAddress?: string;
  reasonCode: string;
  source: string;
  observedAt: string;
  expiresAt: string;
  quoteId?: string;
  provider?: string;
};

export type TradeabilityInput = {
  pair: BasePair;
  side: TradeSide;
  amount: string;
  slippageBps: number;
  walletAddress?: string;
  walletChainId?: number;
  capabilities?: TradeCapabilities;
  quote?: TransactionQuote;
  quoteLoading?: boolean;
  quoteFailureCode?: QuoteFailureCode;
  reviewRequested?: boolean;
  reviewOpen?: boolean;
  approvalRequired?: boolean;
  simulationPassed?: boolean;
  transactionReady?: boolean;
  observedAt?: string;
  now?: number;
};

const STATIC_IDENTITY_TTL_MS = 365 * 24 * 60 * 60_000;
const UNVERIFIED_IDENTITY_TTL_MS = 15 * 60_000;
const MARKET_DATA_TTL_MS = 90_000;

export const ASSET_IDENTITY_REGISTRY: Readonly<Record<string, AssetIdentityRegistryRecord>> = Object.freeze({
  "8453:0x4200000000000000000000000000000000000006": Object.freeze({
    chainId: BASE_TRADE_CHAIN_ID,
    contractAddress: "0x4200000000000000000000000000000000000006",
    canonicalName: "Wrapped Ether",
    canonicalSymbol: "WETH",
    verifiedIssuer: "Base WETH9 predeploy",
    officialSourceUrl: "https://docs.base.org/base-chain/network-information/base-contracts",
    verificationDate: "2026-08-30",
    version: "2026-08-30.1"
  }),
  "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": Object.freeze({
    chainId: BASE_TRADE_CHAIN_ID,
    contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    canonicalName: "USD Coin",
    canonicalSymbol: "USDC",
    verifiedIssuer: "Circle",
    officialSourceUrl: "https://developers.circle.com/stablecoins/usdc-contract-addresses",
    verificationDate: "2026-08-30",
    version: "2026-08-30.1"
  })
});

const KNOWN_BRAND_TERMS = ["apple", "tesla", "microsoft", "amazon", "google", "nvidia", "meta", "netflix", "openai", "spacex"];

export function resolveAssetIdentity(input: {
  chainId?: string | number;
  tokenAddress?: string;
  displayName?: string;
  displaySymbol?: string;
  observedAt?: string;
}): AssetIdentityAssessment {
  const providedName = cleanLabel(input.displayName);
  const providedSymbol = cleanLabel(input.displaySymbol);
  const displayName = providedName || providedSymbol || "Unknown token";
  const displaySymbol = providedSymbol || "?";
  const observedMs = validTimestamp(input.observedAt) ?? 0;
  const observedAt = new Date(observedMs).toISOString();
  const chainId = normalizeBaseChainId(input.chainId);
  const address = isEvmAddress(input.tokenAddress) ? input.tokenAddress.toLowerCase() : undefined;
  const resemblesKnownBrand = resemblesBrand(displayName, displaySymbol);
  if (chainId !== BASE_TRADE_CHAIN_ID || !address) {
    return {
      status: "unavailable",
      chainId: BASE_TRADE_CHAIN_ID,
      tokenAddress: address,
      displayName,
      displaySymbol,
      reasonCode: "address_unavailable",
      source: "Exact Base contract registry",
      observedAt,
      expiresAt: new Date(observedMs + UNVERIFIED_IDENTITY_TTL_MS).toISOString(),
      usesGenericAvatar: true,
      resemblesKnownBrand
    };
  }
  const record = ASSET_IDENTITY_REGISTRY[`${chainId}:${address}`];
  if (!record) {
    return {
      status: "unverified",
      chainId,
      tokenAddress: address,
      displayName,
      displaySymbol,
      reasonCode: "address_not_in_registry",
      source: "Exact Base contract registry",
      observedAt,
      expiresAt: new Date(observedMs + UNVERIFIED_IDENTITY_TTL_MS).toISOString(),
      usesGenericAvatar: true,
      resemblesKnownBrand
    };
  }
  const symbolMatches = !providedSymbol || providedSymbol.toLocaleUpperCase("en-US") === record.canonicalSymbol.toLocaleUpperCase("en-US");
  return {
    status: symbolMatches ? "verified" : "conflicting",
    chainId,
    tokenAddress: address,
    displayName: providedName || record.canonicalName,
    displaySymbol: providedSymbol || record.canonicalSymbol,
    canonicalName: record.canonicalName,
    canonicalSymbol: record.canonicalSymbol,
    verifiedIssuer: record.verifiedIssuer,
    officialSourceUrl: record.officialSourceUrl,
    officialLogoUrl: symbolMatches ? record.officialLogoUrl : undefined,
    reasonCode: symbolMatches ? "registry_exact_match" : "registry_symbol_conflict",
    source: `${record.verifiedIssuer} · registry ${record.version}`,
    observedAt,
    expiresAt: new Date(observedMs + STATIC_IDENTITY_TTL_MS).toISOString(),
    usesGenericAvatar: !symbolMatches || !record.officialLogoUrl,
    resemblesKnownBrand
  };
}

export function deriveTradeabilityAssessment(input: TradeabilityInput): TradeabilityAssessment {
  const now = input.now ?? Date.now();
  const observedAt = validTimestamp(input.quote?.createdAt) ?? validTimestamp(input.observedAt) ?? validTimestamp(input.pair.sourceUpdatedAt) ?? now;
  const market = getNormalizedMarketModel(input.pair);
  const focusAddress = getFocusTokenAddress(input.pair);
  const tokenAddressesValid = normalizeBaseChainId(input.pair.chainId) === BASE_TRADE_CHAIN_ID && isEvmAddress(input.pair.baseTokenAddress) && isEvmAddress(input.pair.quoteTokenAddress);
  const common: Omit<TradeabilityAssessment, "status" | "reasonCode" | "source" | "expiresAt" | "quoteId" | "provider"> = {
    chainId: BASE_TRADE_CHAIN_ID,
    tokenAddress: isEvmAddress(focusAddress) ? focusAddress.toLowerCase() : undefined,
    fromTokenAddress: normalizedAddress(input.side === "buy" ? input.pair.quoteTokenAddress : input.pair.baseTokenAddress),
    toTokenAddress: normalizedAddress(input.side === "buy" ? input.pair.baseTokenAddress : input.pair.quoteTokenAddress),
    pairKey: market.key,
    side: input.side,
    amount: input.amount.trim(),
    slippageBps: input.slippageBps,
    walletAddress: normalizedAddress(input.walletAddress),
    observedAt: new Date(observedAt).toISOString()
  };
  const make = (status: TradeabilityStatus, reasonCode: string, source: string, expiresAt = observedAt + MARKET_DATA_TTL_MS, quote = input.quote): TradeabilityAssessment => ({
    ...common,
    status,
    reasonCode,
    source,
    expiresAt: new Date(expiresAt).toISOString(),
    quoteId: quote?.id,
    provider: quote?.provider
  });

  if (!tokenAddressesValid || !market.key) return make("token_metadata_invalid", "exact_token_metadata_invalid", "Canonical pair binding");
  if (!input.capabilities) return make("market_data_only", "market_data_without_execution_context", input.pair.dataProviders?.join(" + ") || input.pair.dataSource || "Market provider");
  if (!input.capabilities.quoteRequestEnabled) return make("execution_disabled", "quote_capability_disabled", "Mergen capability health");
  if (!input.walletAddress) return make("wallet_required", "wallet_not_connected", "Local wallet state");
  if (input.walletChainId !== BASE_TRADE_CHAIN_ID) return make("wrong_network", "wallet_not_on_base_8453", "Wallet chain state");
  if (!validAmount(input.amount)) return make("quote_required", "exact_amount_required", "Local quote context");
  const provider = input.capabilities.providers.find((candidate) => candidate.name === "LI.FI");
  if (provider?.status === "circuit-open") return make("provider_unavailable", "provider_circuit_open", "Mergen capability health");
  if (input.quoteLoading) return make("quote_loading", "exact_quote_request_in_flight", "LI.FI");
  if (input.quoteFailureCode) return make(statusForFailure(input.quoteFailureCode), input.quoteFailureCode, "LI.FI quote response");
  if (!input.quote) return make("quote_required", "fresh_executable_quote_required", "Local quote context");

  const quote = input.quote;
  const expiresMs = Date.parse(quote.expiresAt);
  if (!Number.isFinite(expiresMs) || expiresMs <= now) return make("quote_expired", "expired", quote.provider, Number.isFinite(expiresMs) ? expiresMs : now, quote);
  if (!validateTransactionQuote(quote, now) || !isQuoteFingerprintValid(quote)) return make("token_metadata_invalid", "invalid_quote_binding", quote.provider, expiresMs, quote);
  const invalidation = getQuoteInvalidationReason(quote, {
    walletAddress: input.walletAddress,
    pairKey: market.key,
    side: input.side,
    chainId: BASE_TRADE_CHAIN_ID,
    fromToken: { ...quote.fromToken, address: common.fromTokenAddress ?? "" },
    toToken: { ...quote.toToken, address: common.toTokenAddress ?? "" },
    amount: input.amount.trim(),
    slippageBps: input.slippageBps
  }, now);
  if (invalidation) return make(invalidation === "expired" ? "quote_expired" : "quote_required", `quote_invalidated_${invalidation}`, "Exact quote fingerprint", expiresMs, quote);
  if (input.approvalRequired) return make("approval_required", "exact_approval_required", quote.provider, expiresMs, quote);
  if (input.reviewRequested) return make("review_ready", "exact_quote_ready_for_review", quote.provider, expiresMs, quote);
  if (input.reviewOpen && !input.simulationPassed) return make("simulation_required", "wallet_simulation_required", quote.provider, expiresMs, quote);
  if (input.transactionReady) return make("transaction_ready", "fresh_quote_and_simulation_ready", quote.provider, expiresMs, quote);
  if (input.reviewOpen) return make("review_ready", "exact_quote_ready_for_review", quote.provider, expiresMs, quote);
  return make("quote_available", "fresh_executable_quote_available", quote.provider, expiresMs, quote);
}

export function marketDataOnlyAssessment(pair: BasePair, side: TradeSide = "buy"): TradeabilityAssessment {
  return deriveTradeabilityAssessment({ pair, side, amount: "", slippageBps: 50, observedAt: pair.sourceUpdatedAt, now: validTimestamp(pair.sourceUpdatedAt) ?? 0 });
}

export function getFocusTokenAddress(pair: BasePair) {
  return pair.focusTokenAddress ?? pair.baseTokenAddress;
}

export function getIdentityDisplay(pair: BasePair, preferred: { address?: string; name?: string; symbol?: string } = {}) {
  const address = preferred.address ?? getFocusTokenAddress(pair);
  const normalized = normalizedAddress(address);
  const baseAddress = normalizedAddress(pair.baseTokenAddress);
  const quoteAddress = normalizedAddress(pair.quoteTokenAddress);

  // Discovery labels describe an opportunity and can occasionally contain a
  // pair label. Bind the presented token label back to the exact contract side
  // before identity assessment so an official address is not misclassified.
  if (normalized && normalized === baseAddress) {
    return { address, name: preferred.name ?? pair.focusTokenName ?? pair.baseToken, symbol: pair.baseToken };
  }
  if (normalized && normalized === quoteAddress) {
    return { address, name: preferred.name ?? pair.focusTokenName ?? pair.quoteToken, symbol: pair.quoteToken };
  }
  return {
    address,
    name: preferred.name ?? pair.focusTokenName ?? pair.project ?? pair.baseToken,
    symbol: preferred.symbol ?? pair.focusTokenSymbol ?? pair.baseToken
  };
}

export function identityRegistryKey(chainId: number, address: string) {
  return `${chainId}:${address.toLowerCase()}`;
}

function statusForFailure(code: QuoteFailureCode): TradeabilityStatus {
  if (code === "no-route") return "no_route";
  if (code === "invalid-amount") return "quote_required";
  if (code === "expired") return "quote_expired";
  if (code === "capability-disabled") return "execution_disabled";
  if (code === "unsupported-token" || code === "token-metadata-invalid" || code === "invalid-request") return "token_metadata_invalid";
  return "provider_unavailable";
}

function normalizeBaseChainId(value: string | number | undefined) {
  if (value === BASE_TRADE_CHAIN_ID || value === String(BASE_TRADE_CHAIN_ID)) return BASE_TRADE_CHAIN_ID;
  if (typeof value === "string" && value.trim().toLocaleLowerCase("en-US") === "base") return BASE_TRADE_CHAIN_ID;
  return undefined;
}

function normalizedAddress(value: string | undefined) {
  return isEvmAddress(value) ? value.toLowerCase() : undefined;
}

function validTimestamp(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function validAmount(value: string) {
  const trimmed = value.trim();
  return /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed) && Number(trimmed) > 0;
}

function cleanLabel(value: string | undefined) {
  return value?.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 120) ?? "";
}

function resemblesBrand(name: string, symbol: string) {
  const haystack = `${name} ${symbol}`.toLocaleLowerCase("en-US");
  return KNOWN_BRAND_TERMS.some((term) => haystack.includes(term));
}
