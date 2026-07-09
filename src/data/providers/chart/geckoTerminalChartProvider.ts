import { mockChartProvider } from "./mockChartProvider";
import type {
  ChartPairInput,
  ChartTimeframe,
  PairChartCandle,
  PairChartProvider
} from "./types";
import {
  fetchJsonWithTimeout,
  readArray,
  readRecord
} from "../responseValidation";

const GECKOTERMINAL_API_BASE = "https://api.geckoterminal.com/api/v2";
const BASE_NETWORK = "base";
const CANDLE_LIMIT = 96;
const REVALIDATE_SECONDS = 60;
const REQUEST_TIMEOUT_MS = 8_000;

export const geckoTerminalChartProvider: PairChartProvider = {
  name: "GeckoTerminal OHLCV read-only",
  readOnly: true,
  getPairChart: async (pair) => {
    const pairAddress = getValidPairAddress(pair);

    if (!pairAddress) {
      return fallback(pair, "Pair address is unavailable.");
    }

    try {
      const timeframe = getTimeframeConfig(pair.timeframe);
      const payload = await fetchJsonWithTimeout(
        `${GECKOTERMINAL_API_BASE}/networks/${BASE_NETWORK}/pools/${pairAddress}/ohlcv/${timeframe.path}?aggregate=${timeframe.aggregate}&limit=${CANDLE_LIMIT}&currency=usd&token=base`,
        {
          headers: { accept: "application/json" },
          next: { revalidate: REVALIDATE_SECONDS }
        },
        REQUEST_TIMEOUT_MS
      );

      if (!payload) {
        return fallback(pair, "GeckoTerminal OHLCV request failed.");
      }

      const candles = parseGeckoTerminalOhlcvResponse(payload);

      if (candles.length === 0) {
        return fallback(pair, "GeckoTerminal returned no OHLCV candles.");
      }

      return {
        source: "geckoterminal",
        label: "OHLCV read-only \u00b7 cached chart",
        updatedAt: new Date().toISOString(),
        candles
      };
    } catch {
      return fallback(pair, "GeckoTerminal OHLCV request failed.");
    }
  }
};

function getTimeframeConfig(timeframe: ChartTimeframe | undefined) {
  switch (timeframe) {
    case "15m":
      return { path: "minute", aggregate: 15 };
    case "4h":
      return { path: "hour", aggregate: 4 };
    case "1d":
      return { path: "day", aggregate: 1 };
    case "1h":
    default:
      return { path: "hour", aggregate: 1 };
  }
}

export function parseGeckoTerminalOhlcvResponse(payload: unknown): PairChartCandle[] {
  const response = readRecord(payload);
  const data = readRecord(response?.data);
  const attributes = readRecord(data?.attributes);
  return normalizeOhlcvList(readArray(attributes?.ohlcv_list));
}

async function fallback(pair: ChartPairInput, unavailableReason: string) {
  const result = await mockChartProvider.getPairChart(pair);

  return {
    ...result,
    unavailableReason
  };
}

function normalizeOhlcvList(ohlcvList: unknown[]): PairChartCandle[] {
  return ohlcvList
    .map(normalizeOhlcvRow)
    .filter((candle): candle is PairChartCandle => Boolean(candle))
    .sort((left, right) => left.timestamp - right.timestamp);
}

function normalizeOhlcvRow(row: unknown): PairChartCandle | undefined {
  if (!Array.isArray(row) || row.length < 6) {
    return undefined;
  }

  const [timestamp, open, high, low, close, volume] = row.map(toNumber);

  if (
    timestamp <= 0 ||
    open <= 0 ||
    high <= 0 ||
    low <= 0 ||
    close <= 0 ||
    high < low
  ) {
    return undefined;
  }

  return {
    timestamp,
    open,
    high,
    low,
    close,
    volume: Math.max(0, volume)
  };
}

function getValidPairAddress(pair: ChartPairInput) {
  const address = pair.pairAddress ?? pair.id;

  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return undefined;
  }

  return address.toLowerCase();
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
