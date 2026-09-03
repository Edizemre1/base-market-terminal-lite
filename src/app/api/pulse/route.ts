import { NextResponse } from "next/server";
import { getMarketTerminalSnapshot, resolveUrlMarketDataMode } from "@/data/providers";
import type { PulseEventType } from "@/lib/base-terminal/pulse";
import { getOnchainCollectorHealth } from "@/lib/base-terminal/onchainDiscovery";

export const dynamic = "force-dynamic";

const SUPPORTED_VERIFIED_EVENTS: PulseEventType[] = [
  "new_pool",
  "new_opportunity",
  "primary_market_changed",
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
    const collector = snapshot.mode === "live" && process.env.ONCHAIN_STORE_PATH?.trim() ? getOnchainCollectorHealth(0) : undefined;
    const collectorDelayed = collector?.ready === false;

    return NextResponse.json({
      ok: snapshot.allPairs.length > 0,
      readOnly: true,
      mode: snapshot.mode,
      source: snapshot.providerName,
      generatedAt: snapshot.generatedAt,
      sourceUpdatedAt: snapshot.sourceUpdatedAt,
      freshness: collectorDelayed ? "delayed" : snapshot.freshness,
      delayedReason: collectorDelayed ? ("delayedReason" in collector ? collector.delayedReason : "collector_store_unavailable") : undefined,
      onchainCollector: collector ? { ready: collector.ready, lagBlocks: "lagBlocks" in collector ? collector.lagBlocks : undefined, lastCursorProgressAt: "lastCursorProgressAt" in collector ? collector.lastCursorProgressAt : undefined } : undefined,
      qualifiedPairCount: snapshot.allPairs.length,
      rawPoolCount: snapshot.universe.rawPoolCount,
      uniqueTokenCount: snapshot.universe.uniqueTokenCount,
      activeOpportunityCount: snapshot.universe.activeOpportunityCount,
      historyStatus: snapshot.historyStatus,
      recentEventCount: snapshot.recentSignals.length,
      signalMode: "bounded-server-snapshot-history",
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
