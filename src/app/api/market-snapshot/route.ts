import { NextResponse } from "next/server";
import { getMarketTerminalSnapshot, resolveUrlMarketDataMode } from "@/data/providers";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = resolveUrlMarketDataMode(searchParams.get("data"));
    const snapshot = await getMarketTerminalSnapshot(mode);

    return NextResponse.json(snapshot);
  } catch {
    return NextResponse.json(
      { error: "Market snapshot refresh failed." },
      { status: 500 }
    );
  }
}
