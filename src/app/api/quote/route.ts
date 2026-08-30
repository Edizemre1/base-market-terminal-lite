import { NextResponse } from "next/server";
import { getQuoteService, getTradeCapabilities, QuoteProviderError } from "@/lib/trade/quoteProviders";
import { validateQuoteRequest } from "@/lib/trade/validation";
import { isEvmAddress } from "@/lib/trade/validation";
import { resolveBaseTokenDecimals } from "@/lib/trade/tokenMetadata";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const rateWindows = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 15;
const RATE_WINDOW_MS = 60_000;
const MAX_RATE_KEYS = 500;

export async function POST(request: Request) {
  const capabilities = getTradeCapabilities();
  if (!capabilities.quoteRequestEnabled) {
    return NextResponse.json({ error: "Quote requests are disabled in this environment.", code: "capability-disabled" }, { status: 503 });
  }

  const key = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!takeRateLimit(key)) return NextResponse.json({ error: "Too many quote requests. Wait a moment and retry.", code: "rate-limited" }, { status: 429 });

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "Quote request body is invalid.", code: "invalid-request" }, { status: 400 });
  }
  const normalized = await attachVerifiedDecimals(input);
  if (normalized.error) return NextResponse.json({ error: "Exact Base token metadata could not be verified.", code: normalized.error }, { status: 422 });
  const quoteRequest = validateQuoteRequest(normalized.input);
  if (!quoteRequest) return NextResponse.json({ error: "Wallet, Base tokens, amount, or slippage is invalid.", code: "invalid-request" }, { status: 400 });

  try {
    const quote = await getQuoteService().getQuote(quoteRequest);
    return NextResponse.json({ quote, capabilities: getTradeCapabilities() }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const code = error instanceof QuoteProviderError ? error.code : "provider-unavailable";
    const status = code === "invalid-amount" ? 400 : code === "unsupported-token" || code === "no-route" ? 422 : code === "rate-limited" ? 429 : code === "timeout" ? 504 : 502;
    return NextResponse.json({ error: quoteFailureMessage(code), code }, { status });
  }
}

async function attachVerifiedDecimals(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { input };
  const record = input as Record<string, unknown>;
  const fromToken = record.fromToken && typeof record.fromToken === "object" && !Array.isArray(record.fromToken) ? record.fromToken as Record<string, unknown> : undefined;
  const toToken = record.toToken && typeof record.toToken === "object" && !Array.isArray(record.toToken) ? record.toToken as Record<string, unknown> : undefined;
  if (!fromToken || !toToken || !isEvmAddress(fromToken.address) || !isEvmAddress(toToken.address)) return { input };
  try {
    const [fromDecimals, toDecimals] = await Promise.all([resolveBaseTokenDecimals(fromToken.address), resolveBaseTokenDecimals(toToken.address)]);
    return { input: { ...record, fromToken: { ...fromToken, decimals: fromDecimals }, toToken: { ...toToken, decimals: toDecimals } } };
  } catch {
    return { input, error: "token-metadata-invalid" as const };
  }
}

function quoteFailureMessage(code: string) {
  if (code === "no-route") return "No route was found for this exact amount and direction.";
  if (code === "unsupported-token") return "The quote provider does not support one of these exact token contracts.";
  if (code === "invalid-amount") return "The quote provider rejected this exact amount.";
  if (code === "rate-limited") return "The quote provider rate limit was reached. Wait and retry.";
  if (code === "timeout") return "The quote provider timed out. This does not mean no route exists.";
  if (code === "invalid-provider-response") return "The quote provider returned an invalid response.";
  return "The quote provider is temporarily unavailable. This does not prove the token is untradeable.";
}

function takeRateLimit(key: string) {
  const now = Date.now();
  for (const [candidate, entry] of rateWindows) if (entry.resetAt <= now) rateWindows.delete(candidate);
  while (rateWindows.size >= MAX_RATE_KEYS && !rateWindows.has(key)) rateWindows.delete(rateWindows.keys().next().value!);
  const current = rateWindows.get(key);
  if (!current || current.resetAt <= now) {
    rateWindows.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (current.count >= RATE_LIMIT) return false;
  current.count += 1;
  return true;
}
