import { NextResponse } from "next/server";
import { getPairChart } from "@/data/providers/chart";
import type { ChartPairInput, ChartTimeframe } from "@/data/providers/chart/types";
import { resolveMarketDataMode } from "@/data/providers";

type ChartRefreshBody = {
  id?: unknown;
  dataSource?: unknown;
  pairAddress?: unknown;
  chart?: unknown;
  volume24h?: unknown;
  mode?: unknown;
  timeframe?: unknown;
};

const chartTimeframes: ChartTimeframe[] = ["15m", "1h", "4h", "1d"];

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChartRefreshBody;
    const pair = normalizeChartPairInput(body);

    if (!pair) {
      return NextResponse.json({ error: "Invalid chart refresh request." }, { status: 400 });
    }

    const mode = resolveMarketDataMode(typeof body.mode === "string" ? body.mode : undefined);
    const result = await getPairChart(pair, mode);

    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Chart refresh failed." }, { status: 500 });
  }
}

function normalizeChartPairInput(body: ChartRefreshBody): ChartPairInput | undefined {
  if (typeof body.id !== "string" || body.id.length === 0) {
    return undefined;
  }

  return {
    id: body.id,
    dataSource: body.dataSource === "dexscreener" ? "dexscreener" : "mock",
    pairAddress: typeof body.pairAddress === "string" ? body.pairAddress : undefined,
    timeframe: normalizeChartTimeframe(body.timeframe),
    chart: Array.isArray(body.chart) ? body.chart.map(toNumber).filter((value) => value > 0) : [],
    volume24h: toNumber(body.volume24h)
  };
}

function normalizeChartTimeframe(value: unknown): ChartTimeframe {
  return typeof value === "string" && chartTimeframes.includes(value as ChartTimeframe)
    ? (value as ChartTimeframe)
    : "1h";
}

function toNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}
