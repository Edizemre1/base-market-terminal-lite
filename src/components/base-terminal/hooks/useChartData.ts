import { useCallback, useRef, useState } from "react";
import type { MarketTerminalSnapshot } from "@/data/providers";
import type { PairChartResult } from "@/data/providers/chart/types";
import { getChartCacheKey } from "@/lib/base-terminal/pairs";
import type { BasePair } from "@/types/baseTerminal";
import type { ChartRefreshStatus } from "@/components/base-terminal/types";

export function useChartData(snapshotRef: { current: MarketTerminalSnapshot }) {
  const [chartOverrides, setChartOverrides] = useState<Record<string, Partial<BasePair>>>({});
  const [chartRefreshStatus, setChartRefreshStatus] = useState<Record<string, ChartRefreshStatus>>({});
  const chartRefreshRequestIds = useRef<Record<string, number>>({});

  const refreshPairChart = useCallback(
    async (pair: BasePair) => {
      const chartKey = getChartCacheKey(pair);
      const requestId = (chartRefreshRequestIds.current[chartKey] ?? 0) + 1;
      chartRefreshRequestIds.current[chartKey] = requestId;
      setChartRefreshStatus((current) => ({ ...current, [chartKey]: "refreshing" }));

      try {
        const response = await fetch("/api/chart", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: pair.id,
            mode: snapshotRef.current.mode,
            dataSource: pair.dataSource,
            pairAddress: pair.pairAddress,
            chart: pair.chart,
            volume24h: pair.volume24h
          })
        });

        if (!response.ok) {
          throw new Error("Chart refresh failed");
        }

        const result = (await response.json()) as PairChartResult;
        const expectedReadOnlyOhlcv =
          snapshotRef.current.mode === "dexscreener" &&
          pair.dataSource === "dexscreener" &&
          Boolean(pair.pairAddress);

        if (chartRefreshRequestIds.current[chartKey] !== requestId) {
          return;
        }

        if (expectedReadOnlyOhlcv && result.source !== "geckoterminal") {
          setChartRefreshStatus((current) => ({ ...current, [chartKey]: "using-last" }));
          return;
        }

        setChartOverrides((current) => ({
          ...current,
          [chartKey]: {
            chart: result.candles.map((candle) => candle.close),
            chartCandles: result.candles,
            chartSource: result.source,
            chartLabel: result.label,
            chartUpdatedAt: result.updatedAt,
            chartUnavailableReason: result.unavailableReason
          }
        }));
        setChartRefreshStatus((current) => ({ ...current, [chartKey]: "updated" }));
      } catch {
        if (chartRefreshRequestIds.current[chartKey] === requestId) {
          setChartRefreshStatus((current) => ({ ...current, [chartKey]: "using-last" }));
        }
      }
    },
    [snapshotRef]
  );

  return {
    chartOverrides,
    chartRefreshStatus,
    refreshPairChart
  };
}
