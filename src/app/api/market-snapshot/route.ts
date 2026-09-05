import { NextResponse } from "next/server";
import { getMarketTerminalSnapshot, resolveUrlMarketDataMode } from "@/data/providers";

export const dynamic = "force-dynamic";

const MARKET_SNAPSHOT_HEADERS = {
  "Cache-Control": "public, max-age=15, s-maxage=60, stale-while-revalidate=120",
  "X-Content-Type-Options": "nosniff",
  "X-Base-Terminal-Read-Only": "true"
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = resolveUrlMarketDataMode(searchParams.get("data"));
    const snapshot = await getMarketTerminalSnapshot(mode, { force: searchParams.get("onchain") === "1" });
    const etag = `W/${JSON.stringify([
      snapshot.version,
      snapshot.freshness,
      snapshot.sourceHealth?.marketProvider,
      snapshot.sourceHealth?.collector,
      snapshot.sourceHealth?.reason
    ].join("|"))}`;
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers: { ...MARKET_SNAPSHOT_HEADERS, ETag: etag } });
    }

    return NextResponse.json(snapshot, {
      headers: { ...MARKET_SNAPSHOT_HEADERS, ETag: etag }
    });
  } catch {
    return NextResponse.json(
      { error: "Market snapshot refresh failed." },
      {
        status: 500,
        headers: MARKET_SNAPSHOT_HEADERS
      }
    );
  }
}
