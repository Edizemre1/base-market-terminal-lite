import { NextResponse } from "next/server";
import { getQuoteService, getTradeCapabilities } from "@/lib/trade/quoteProviders";
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
  const normalizedInput = await attachVerifiedDecimals(input);
  const quoteRequest = validateQuoteRequest(normalizedInput);
  if (!quoteRequest) return NextResponse.json({ error: "Wallet, Base tokens, amount, or slippage is invalid.", code: "invalid-request" }, { status: 400 });

  try {
    const quote = await getQuoteService().getQuote(quoteRequest);
    return NextResponse.json({ quote, capabilities: getTradeCapabilities() }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "A fresh transaction quote is unavailable. Check the amount and try again.", code: "quote-unavailable" }, { status: 502 });
  }
}

async function attachVerifiedDecimals(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const record = input as Record<string, unknown>;
  const fromToken = record.fromToken && typeof record.fromToken === "object" && !Array.isArray(record.fromToken) ? record.fromToken as Record<string, unknown> : undefined;
  const toToken = record.toToken && typeof record.toToken === "object" && !Array.isArray(record.toToken) ? record.toToken as Record<string, unknown> : undefined;
  if (!fromToken || !toToken || !isEvmAddress(fromToken.address) || !isEvmAddress(toToken.address)) return input;
  try {
    const [fromDecimals, toDecimals] = await Promise.all([resolveBaseTokenDecimals(fromToken.address), resolveBaseTokenDecimals(toToken.address)]);
    return { ...record, fromToken: { ...fromToken, decimals: fromDecimals }, toToken: { ...toToken, decimals: toDecimals } };
  } catch {
    return input;
  }
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
