import { parseStrictFiniteNumber } from "@/lib/marketMath";
import {
  BASE_TRADE_CHAIN_ID,
  NATIVE_TOKEN_ADDRESS,
  type TransactionQuote,
  type QuoteInvalidationInput,
  type QuoteRequest,
  type TradeToken,
  type TransactionDraft
} from "./types";

const ZERO = BigInt(0);
const TEN = BigInt(10);
const MAX_UINT256 = (BigInt(1) << BigInt(256)) - BigInt(1);
const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/i;
const HEX_PATTERN = /^0x(?:[0-9a-f]{2})*$/i;
const RAW_AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,77})$/;

export function isEvmAddress(value: unknown): value is string {
  return typeof value === "string" && ADDRESS_PATTERN.test(value);
}

export function parseHumanTokenAmount(value: string, decimals: number) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return undefined;
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized)) return undefined;
  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > decimals) return undefined;
  const raw = BigInt(whole) * TEN ** BigInt(decimals) + BigInt((fraction || "0").padEnd(decimals, "0"));
  return raw > ZERO && raw <= MAX_UINT256 ? raw.toString() : undefined;
}

export function formatRawTokenAmount(value: string, decimals: number, maximumFractionDigits = 8) {
  if (!isRawAmount(value) || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return undefined;
  const raw = BigInt(value);
  const scale = TEN ** BigInt(decimals);
  const whole = raw / scale;
  if (decimals === 0) return whole.toString();
  const fraction = (raw % scale).toString().padStart(decimals, "0").slice(0, maximumFractionDigits).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function validateQuoteRequest(value: unknown): QuoteRequest | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const walletAddress = readAddress(input.walletAddress);
  const fromToken = readTradeToken(input.fromToken);
  const toToken = readTradeToken(input.toToken);
  const pairKey = readBoundedText(input.pairKey, 320);
  const side = input.side === "buy" || input.side === "sell" ? input.side : undefined;
  const amount = typeof input.amount === "string" ? input.amount.trim() : undefined;
  const slippageBps = parseStrictFiniteNumber(input.slippageBps);
  if (!walletAddress || !fromToken || !toToken || fromToken.address === toToken.address || !pairKey || !side || !amount) return undefined;
  if (!Number.isInteger(slippageBps) || slippageBps! < 1 || slippageBps! > 500) return undefined;
  const fromAmountRaw = parseHumanTokenAmount(amount, fromToken.decimals);
  if (!fromAmountRaw) return undefined;
  return {
    walletAddress,
    pairKey,
    side,
    fromToken,
    toToken,
    amount,
    fromAmountRaw,
    slippageBps: slippageBps!,
    chainId: BASE_TRADE_CHAIN_ID
  };
}

export function validateTransactionQuote(quote: TransactionQuote, now = Date.now()) {
  if (quote.kind !== "transaction-quote" || quote.chainId !== BASE_TRADE_CHAIN_ID) return false;
  if (!isEvmAddress(quote.walletAddress) || !validateTradeToken(quote.fromToken) || !validateTradeToken(quote.toToken)) return false;
  if (!isRawAmount(quote.fromAmountRaw) || BigInt(quote.fromAmountRaw) <= ZERO) return false;
  if (!isRawAmount(quote.expectedAmountRaw) || !isRawAmount(quote.minimumAmountRaw)) return false;
  if (BigInt(quote.minimumAmountRaw) <= ZERO || BigInt(quote.minimumAmountRaw) > BigInt(quote.expectedAmountRaw)) return false;
  if (quote.approvalAddress && !isEvmAddress(quote.approvalAddress)) return false;
  if (!validateTransactionDraft(quote.transaction, quote.walletAddress)) return false;
  const createdAt = Date.parse(quote.createdAt);
  const expiresAt = Date.parse(quote.expiresAt);
  return Number.isFinite(createdAt) && Number.isFinite(expiresAt) && expiresAt > createdAt && expiresAt > now;
}

export function validateTransactionDraft(draft: TransactionDraft, walletAddress?: string) {
  if (draft.chainId !== BASE_TRADE_CHAIN_ID || !isEvmAddress(draft.from) || !isEvmAddress(draft.to)) return false;
  if (walletAddress && draft.from.toLowerCase() !== walletAddress.toLowerCase()) return false;
  if (!HEX_PATTERN.test(draft.data) || draft.data.length < 10 || draft.data.length > 200_002) return false;
  if (!isHexQuantity(draft.value)) return false;
  return draft.gasLimit === undefined || isHexQuantity(draft.gasLimit);
}

export function getQuoteInvalidationReason(quote: TransactionQuote | undefined, current: QuoteInvalidationInput, now = Date.now()) {
  if (!quote) return "missing" as const;
  if (Date.parse(quote.expiresAt) <= now) return "expired" as const;
  if (quote.walletAddress.toLowerCase() !== current.walletAddress.toLowerCase()) return "wallet" as const;
  if (quote.chainId !== current.chainId) return "chain" as const;
  if (quote.pairKey !== current.pairKey || quote.side !== current.side) return "pair" as const;
  if (!sameToken(quote.fromToken, current.fromToken) || !sameToken(quote.toToken, current.toToken)) return "token" as const;
  if (quote.amount !== current.amount) return "amount" as const;
  if (quote.slippageBps !== current.slippageBps) return "slippage" as const;
  return undefined;
}

export function buildExactApprovalData(spender: string, amountRaw: string) {
  if (!isEvmAddress(spender) || !isRawAmount(amountRaw)) return undefined;
  const amount = BigInt(amountRaw);
  if (amount <= ZERO || amount > MAX_UINT256) return undefined;
  return `0x095ea7b3${spender.slice(2).toLowerCase().padStart(64, "0")}${amount.toString(16).padStart(64, "0")}`;
}

export function buildAllowanceData(owner: string, spender: string) {
  if (!isEvmAddress(owner) || !isEvmAddress(spender)) return undefined;
  return `0xdd62ed3e${owner.slice(2).toLowerCase().padStart(64, "0")}${spender.slice(2).toLowerCase().padStart(64, "0")}`;
}

export function buildBalanceOfData(owner: string) {
  if (!isEvmAddress(owner)) return undefined;
  return `0x70a08231${owner.slice(2).toLowerCase().padStart(64, "0")}`;
}

export function quoteFingerprintPayload(quote: Omit<TransactionQuote, "fingerprint">) {
  return stableSerialize({
    provider: quote.provider,
    route: quote.route,
    walletAddress: quote.walletAddress.toLowerCase(),
    pairKey: quote.pairKey,
    side: quote.side,
    chainId: quote.chainId,
    fromToken: normalizeToken(quote.fromToken),
    toToken: normalizeToken(quote.toToken),
    amount: quote.amount,
    fromAmountRaw: quote.fromAmountRaw,
    expectedAmountRaw: quote.expectedAmountRaw,
    minimumAmountRaw: quote.minimumAmountRaw,
    approvalAddress: quote.approvalAddress?.toLowerCase(),
    slippageBps: quote.slippageBps,
    target: quote.transaction.to.toLowerCase(),
    data: quote.transaction.data.toLowerCase(),
    value: quote.transaction.value.toLowerCase(),
    expiresAt: quote.expiresAt
  });
}

export function createQuoteFingerprint(quote: Omit<TransactionQuote, "fingerprint">) {
  const text = quoteFingerprintPayload(quote);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `qf_${(hash >>> 0).toString(16).padStart(8, "0")}_${text.length.toString(36)}`;
}

export function isQuoteFingerprintValid(quote: TransactionQuote) {
  const withoutFingerprint = Object.fromEntries(Object.entries(quote).filter(([key]) => key !== "fingerprint")) as Omit<TransactionQuote, "fingerprint">;
  return createQuoteFingerprint(withoutFingerprint) === quote.fingerprint;
}

export function normalizeHexQuantity(value: unknown) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return `0x${value.toString(16)}`;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (/^0x[0-9a-f]+$/i.test(normalized)) return `0x${BigInt(normalized).toString(16)}`;
  if (/^(?:0|[1-9]\d*)$/.test(normalized)) return `0x${BigInt(normalized).toString(16)}`;
  return undefined;
}

function readTradeToken(value: unknown): TradeToken | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const token = value as Record<string, unknown>;
  const address = readAddress(token.address);
  const symbol = readBoundedText(token.symbol, 24);
  const decimals = parseStrictFiniteNumber(token.decimals);
  if (!address || !symbol || !Number.isInteger(decimals) || decimals! < 0 || decimals! > 36) return undefined;
  return { address, symbol, decimals: decimals! };
}

function validateTradeToken(token: TradeToken) {
  return isEvmAddress(token.address) && typeof token.symbol === "string" && token.symbol.length > 0 && token.symbol.length <= 24 && Number.isInteger(token.decimals) && token.decimals >= 0 && token.decimals <= 36;
}

function sameToken(left: TradeToken, right: TradeToken) {
  return left.address.toLowerCase() === right.address.toLowerCase() && left.symbol === right.symbol && left.decimals === right.decimals;
}

function normalizeToken(token: TradeToken) {
  return { ...token, address: token.address.toLowerCase() };
}

function readAddress(value: unknown) {
  return isEvmAddress(value) ? value.toLowerCase() : undefined;
}

function readBoundedText(value: unknown, maximumLength: number) {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return normalized && normalized.length <= maximumLength ? normalized : undefined;
}

function isRawAmount(value: unknown): value is string {
  return typeof value === "string" && RAW_AMOUNT_PATTERN.test(value) && BigInt(value) <= MAX_UINT256;
}

function isHexQuantity(value: unknown): value is string {
  return typeof value === "string" && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value);
}

function stableSerialize(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(object[key])}`).join(",")}}`;
}

export function isNativeToken(token: TradeToken) {
  return token.address.toLowerCase() === NATIVE_TOKEN_ADDRESS;
}
