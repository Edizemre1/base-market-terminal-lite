import { mockChartProvider } from "./mockChartProvider";
import type { ChartPairInput, PairChartCandle, PairChartProvider } from "./types";

const GECKOTERMINAL_API_BASE = "https://api.geckoterminal.com/api/v2";
const BASE_NETWORK = "base";
const TIMEFRAME = "hour";
const CANDLE_LIMIT = 96;
const REVALIDATE_SECONDS = 60;

type GeckoTerminalOhlcvResponse = {
  data?: {
    attributes?: {
      ohlcv_list?: unknown[];
    };
  };
};

export const geckoTerminalChartProvider: PairChartProvider = {
  name: "GeckoTerminal OHLCV read-only",
  readOnly: true,
  getPairChart: async (pair) => {
    const pairAddress = getValidPairAddress(pair);

    if (!pairAddress) {
      return fallback(pair, "Pair address is unavailable.");
    }

    try {
      const response = await fetch(
        `${GECKOTERMINAL_API_BASE}/networks/${BASE_NETWORK}/pools/${pairAddress}/ohlcv/${TIMEFRAME}?aggregate=1&limit=${CANDLE_LIMIT}&currency=usd&token=base`,
        {
          headers: { accept: "application/json" },
          next: { revalidate: REVALIDATE_SECONDS }
        } as RequestInit & { next: { revalidate: number } }
      );

      if (!response.ok) {
        return fallback(pair, `GeckoTerminal returned ${response.status}.`);
      }

      const payload = (await response.json()) as GeckoTerminalOhlcvResponse;
      const candles = normalizeOhlcvList(payload.data?.attributes?.ohlcv_list ?? []);

      if (candles.length === 0) {
        return fallback(pair, "GeckoTerminal returned no OHLCV candles.");
      }

      return {
        source: "geckoterminal",
        label: "OHLCV read-only",
        candles
      };
    } catch {
      return fallback(pair, "GeckoTerminal OHLCV request failed.");
    }
  }
};

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
