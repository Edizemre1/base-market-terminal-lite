import { NextResponse } from "next/server";
import { getMarketTerminalSnapshot, resolveUrlMarketDataMode } from "@/data/providers";
import type { PulseEventType } from "@/lib/base-terminal/pulse";

export const dynamic = "force-dynamic";

const SUPPORTED_VERIFIED_EVENTS: PulseEventType[] = [
  "new_pool",
  "entered_trending",
  "entered_top_gainers",
  "price_move",
  "volume_burst",
  "liquidity_change",
  "watchlist_move",
  "data_recovered",
  "data_delayed"
];

const PULSE_HEADERS = {
  "Cache-Control": "public, max-age=10, s-maxage=12, stale-while-revalidate=60",
  "X-Content-Type-Options": "nosniff",
  "X-Mergen-Pulse-Read-Only": "true"
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const snapshot = await getMarketTerminalSnapshot(resolveUrlMarketDataMode(searchParams.get("data")));

    return NextResponse.json({
      ok: snapshot.allPairs.length > 0,
      readOnly: true,
      mode: snapshot.mode,
      source: snapshot.providerName,
      generatedAt: snapshot.generatedAt,
      sourceUpdatedAt: snapshot.sourceUpdatedAt,
      freshness: snapshot.freshness,
      qualifiedPairCount: snapshot.allPairs.length,
      signalMode: "verified-client-snapshot-diff",
      supportedEvents: SUPPORTED_VERIFIED_EVENTS,
      fabricatedEvents: false
    }, { headers: PULSE_HEADERS });
  } catch {
    return NextResponse.json({
      ok: false,
      readOnly: true,
      freshness: "delayed",
      error: "Live Pulse source is temporarily unavailable."
    }, { status: 503, headers: PULSE_HEADERS });
  }
}
