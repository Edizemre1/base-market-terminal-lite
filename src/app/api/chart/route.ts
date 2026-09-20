import { NextResponse } from "next/server";
import { getPairChart } from "@/data/providers/chart";
import type { ChartPairInput, ChartTimeframe } from "@/data/providers/chart/types";
import { resolveMarketDataMode } from "@/data/providers";
import { parseStrictFiniteNumber } from "@/lib/marketMath";
import { readLimitedJsonBody } from "@/lib/http/requestBody";

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
const MAX_CHART_BODY_BYTES = 65_536;
const MAX_CHART_POINTS = 256;

export async function POST(request: Request) {
  try {
    const parsed = await readLimitedJsonBody(request, MAX_CHART_BODY_BYTES);
    if (!parsed.ok) {
      return NextResponse.json(
        { error: parsed.reason === "too-large" ? "Chart refresh request is too large." : "Invalid chart refresh request." },
        { status: parsed.reason === "too-large" ? 413 : 400 }
      );
    }
    if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
      return NextResponse.json({ error: "Invalid chart refresh request." }, { status: 400 });
    }
    const body = parsed.value as ChartRefreshBody;
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
  const id = readText(body.id, 128);
  if (!id || !isChartDataSource(body.dataSource)) return undefined;
  const pairAddress = body.pairAddress === undefined ? undefined : readEvmAddress(body.pairAddress);
  if (body.pairAddress !== undefined && !pairAddress) return undefined;

  return {
    id,
    dataSource: body.dataSource,
    pairAddress,
    timeframe: normalizeChartTimeframe(body.timeframe),
    chart: Array.isArray(body.chart) ? body.chart.slice(0, MAX_CHART_POINTS).map(toNumber).filter((value) => value > 0) : [],
    volume24h: toNumber(body.volume24h)
  };
}

function normalizeChartTimeframe(value: unknown): ChartTimeframe {
  return typeof value === "string" && chartTimeframes.includes(value as ChartTimeframe)
    ? (value as ChartTimeframe)
    : "1h";
}

function toNumber(value: unknown) {
  return parseStrictFiniteNumber(value) ?? 0;
}

function readText(value: unknown, maximumLength: number) {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return normalized && normalized.length <= maximumLength ? normalized : undefined;
}

function readEvmAddress(value: unknown) {
  return typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value) ? value.toLocaleLowerCase("en-US") : undefined;
}

function isChartDataSource(value: unknown): value is NonNullable<ChartPairInput["dataSource"]> {
  return value === "mock" || value === "dexscreener" || value === "geckoterminal" || value === "onchain";
}
