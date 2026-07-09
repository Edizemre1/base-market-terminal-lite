import { useMemo, useState, type ReactNode } from "react";
import { ExternalLink, LockKeyhole, RefreshCw, Settings } from "lucide-react";
import type { MarketTerminalSnapshot } from "@/data/providers";
import type { ChartTimeframe } from "@/data/providers/chart/types";
import { cx, formatCompactCurrency, formatPercent } from "@/lib/format";
import { PairAvatarStack } from "@/components/TokenIdentity";
import type { BasePair } from "@/types/baseTerminal";
import type { ChartRefreshStatus } from "@/components/base-terminal/types";

export function SelectedPairPanel({
  pair,
  marketDataMode,
  outsideCurrentFilter,
  chartRefreshStatus,
  onRefreshChart
}: {
  pair: BasePair;
  marketDataMode: MarketTerminalSnapshot["mode"];
  outsideCurrentFilter: boolean;
  chartRefreshStatus: ChartRefreshStatus;
  onRefreshChart: (pair: BasePair, timeframe?: ChartTimeframe) => void;
}) {
  const isDemoFallbackSelected =
    marketDataMode === "dexscreener" && pair.dataSource === "mock";
  const readOnlyDetail =
    marketDataMode === "dexscreener"
      ? isDemoFallbackSelected
        ? "Mock fallback"
        : "Read-only feed"
      : "+mock";

  return (
    <section
      className="flex min-h-0 flex-col overflow-hidden border border-base-line bg-base-panel"
      data-testid="selected-pair-panel"
    >
      <div className="flex min-h-10 shrink-0 items-center justify-between gap-3 border-b border-base-line bg-base-raised px-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <PairAvatarStack
            baseSymbol={pair.baseToken}
            quoteSymbol={pair.quoteToken}
            baseLogoUrl={pair.tokenLogoUrl}
            quoteLogoUrl={pair.quoteTokenLogoUrl}
            size="lg"
          />
          <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-base-muted">
            Selected market
          </p>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
            <h1
              className="truncate text-[17px] font-semibold leading-5 text-base-text"
              data-testid="selected-pair-title"
            >
              {pair.pair}
            </h1>
            <span className="border border-base-mint/35 bg-base-mint/10 px-1.5 py-0.5 font-mono text-[10px] uppercase text-base-mint">
              {pair.dexName ?? pair.dex}
            </span>
            <span className="border border-base-line bg-base-elevated px-1.5 py-0.5 font-mono text-[10px] uppercase text-base-muted">
              {pair.dataSource === "mock" ? "Demo data" : "Read-only data"}
            </span>
            <span className="max-w-[150px] truncate border border-base-line bg-base-elevated px-1.5 py-0.5 font-mono text-[10px] text-base-muted">
              {pair.address}
            </span>
            {isDemoFallbackSelected ? (
              <span className="border border-base-amber/45 bg-base-amber/10 px-1.5 py-0.5 font-mono text-[10px] text-base-amber">
                Demo fallback selected
              </span>
            ) : null}
            {pair.stale ? (
              <span className="border border-base-amber/45 bg-base-amber/10 px-1.5 py-0.5 font-mono text-[10px] text-base-amber">
                {pair.staleReason ?? "Stale selected pair"}
              </span>
            ) : null}
            {outsideCurrentFilter ? (
              <span className="border border-base-amber/45 bg-base-amber/10 px-1.5 py-0.5 font-mono text-[10px] text-base-amber">
                Outside current filter
              </span>
            ) : null}
            {pair.sourceUrl ? (
              <a
                href={pair.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="grid h-5 w-5 place-items-center border border-base-line bg-base-elevated text-base-muted hover:border-base-mint hover:text-base-mint"
                aria-label={`Open ${pair.pair} source`}
              >
                <ExternalLink size={11} aria-hidden="true" />
              </a>
            ) : null}
          </div>
          </div>
        </div>
        <div className="hidden shrink-0 items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-base-muted md:flex">
          {["5m", "15m", "1h", "4h", "1d"].map((period) => (
            <span
              key={period}
              className={cx(
                "border px-1.5 py-0.5",
                period === "1h"
                  ? "border-base-mint bg-base-mint/10 text-base-mint"
                  : "border-base-line bg-base-elevated"
              )}
            >
              {period}
            </span>
          ))}
          <span className="grid h-5 w-5 place-items-center border border-base-line bg-base-elevated">
            <Settings size={11} aria-hidden="true" />
          </span>
          <button
            type="button"
            onClick={() => onRefreshChart(pair)}
            className="inline-flex h-5 items-center gap-1 border border-base-line bg-base-elevated px-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-base-muted hover:border-base-mint hover:text-base-mint"
            title="Refresh cached chart data"
          >
            <RefreshCw size={10} aria-hidden="true" />
            Refresh
          </button>
        </div>
      </div>

      <div className="grid shrink-0 gap-1 border-b border-base-line p-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <Metric label={`Price (${pair.quoteToken})`} value={pair.price} detail={pair.priceUsd} />
        <Metric
          label="24h change"
          value={formatPercent(pair.change24h)}
          detail={`5m ${formatOptionalPercent(pair.priceChanges?.m5)} / 1h ${formatOptionalPercent(pair.priceChanges?.h1)}`}
          tone={pair.change24h >= 0 ? "mint" : "rose"}
        />
        <Metric
          label="24h volume"
          value={formatCompactCurrency(pair.volume24h)}
          detail={readOnlyDetail}
        />
        <Metric
          label="Liquidity"
          value={formatCompactCurrency(pair.liquidity)}
          detail={readOnlyDetail}
        />
        <Metric label="Age" value={pair.age} detail={formatPairCreatedAt(pair)} />
        <Metric label="Risk score" value={`${pair.riskScore} / 100`} detail={pair.riskLabel} tone="mint" />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
        <ChartPanel
          pair={pair}
          refreshStatus={chartRefreshStatus}
          onRefreshChart={onRefreshChart}
        />
        <div className="grid shrink-0 gap-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
          <MiniModule
            label="Buy / Sell Pressure"
            value={`${pair.pressure.buy}% / ${pair.pressure.sell}%`}
            detail={pair.pressure.buy >= pair.pressure.sell ? "Bullish" : "Defensive"}
            bar={pair.pressure.buy}
          />
          <MiniModule
            label="Holder Concentration"
            value={`Top 10: ${pair.holders.top10}`}
            detail="Healthy"
            bar={Number.parseFloat(pair.holders.top10)}
          />
          <MiniModule label="Pool Age" value={pair.poolAge} detail="Just launched" />
          <MiniModule
            label="Contract Flags"
            value={pair.flags[0] ?? "No flags"}
            detail={pair.flags[1] ?? "Demo check"}
          />
          <MiniModule
            label="Taxes"
            value={`Buy: ${pair.taxes.buy}`}
            detail={`Sell: ${pair.taxes.sell}`}
          />
          <MiniModule
            label="LP Lock"
            value={pair.lpLock.status}
            detail={pair.lpLock.provider}
            icon={<LockKeyhole size={12} aria-hidden="true" />}
          />
        </div>
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  detail,
  tone = "default"
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "mint" | "rose";
}) {
  return (
    <div className="border border-base-line bg-base-panel p-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-base-muted">
        {label}
      </p>
      <p
        className={cx(
          "mt-2 font-mono text-[15px] font-semibold leading-none",
          tone === "mint"
            ? "text-base-mint"
            : tone === "rose"
              ? "text-base-rose"
              : "text-base-text"
        )}
      >
        {value}
      </p>
      <p className="mt-1 font-mono text-[10px] text-base-muted">{detail}</p>
    </div>
  );
}

function ChartPanel({
  pair,
  refreshStatus,
  onRefreshChart
}: {
  pair: BasePair;
  refreshStatus: ChartRefreshStatus;
  onRefreshChart: (pair: BasePair, timeframe?: ChartTimeframe) => void;
}) {
  const [timeframe, setTimeframe] = useState<ChartTimeframe>("1h");
  const width = 820;
  const height = 270;
  const priceHeight = 198;
  const volumeTop = 214;
  const volumeHeight = 42;
  const plotLeft = 10;
  const plotRight = 66;
  const plotWidth = width - plotLeft - plotRight;
  const hasReadOnlyOhlcv =
    pair.chartSource === "geckoterminal" && (pair.chartCandles?.length ?? 0) > 0;
  const candles = useMemo(() => getDisplayCandles(pair), [pair]);
  const visibleCandles = useMemo(
    () => candles.slice(-getVisibleCandleCount(timeframe)),
    [candles, timeframe]
  );
  const values = visibleCandles.flatMap((candle) => [
    candle.open,
    candle.high,
    candle.low,
    candle.close
  ]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || 1;
  const step = plotWidth / Math.max(visibleCandles.length - 1, 1);
  const candleWidth = Math.max(3, Math.min(8, step * 0.56));
  const maxVolume = Math.max(...visibleCandles.map((candle) => candle.volume), 1);
  const closePath = visibleCandles
    .map((candle, index) => {
      const x = plotLeft + index * step;
      const y = getChartY(candle.close, min, spread, priceHeight);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const areaPath = `${closePath} L ${plotLeft + plotWidth} ${priceHeight} L ${plotLeft} ${priceHeight} Z`;
  const latest = candles[candles.length - 1];
  const previous = candles[candles.length - 2] ?? latest;
  const lastMove = latest.close - previous.close;
  const currentPriceY = getChartY(latest.close, min, spread, priceHeight);
  const axisTicks = [max, min + spread / 2, min];
  const chartLabel = hasReadOnlyOhlcv
    ? (pair.chartLabel ?? "OHLCV read-only \u00b7 cached chart")
    : pair.dataSource === "mock"
      ? "Mock preview data"
      : "OHLCV unavailable";
  const statusMessage =
    refreshStatus === "refreshing"
      ? "Updating chart..."
      : refreshStatus === "using-last"
      ? "Using last available chart"
      : !hasReadOnlyOhlcv
        ? "Demo chart preview - not real market data"
        : undefined;

  return (
    <div
      className="market-scanline flex min-h-[280px] flex-1 flex-col overflow-hidden border border-base-line bg-base-panel xl:min-h-0"
      data-testid="chart-panel"
    >
      <div className="relative z-20 shrink-0 border-b border-base-line bg-base-raised px-2 py-1.5 pr-[188px]">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-mono text-[12px] font-semibold text-base-text">
            <span>{pair.pair.replace(" / ", "/")}</span>
            <span className="border border-base-line bg-base-elevated px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-base-muted">
              {chartLabel}
            </span>
          </p>
          {hasReadOnlyOhlcv ? (
            <p className="mt-1 font-mono text-[10px] text-base-mint">
              O {formatChartValue(latest.open)} H {formatChartValue(latest.high)} L{" "}
              {formatChartValue(latest.low)} C {formatChartValue(latest.close)} V{" "}
              {formatCompactCurrency(latest.volume || pair.volume24h)}
            </p>
          ) : (
            <p className="mt-1 font-mono text-[10px] text-base-amber">
              Demo chart preview - not real market data
            </p>
          )}
          <p className="font-mono text-[10px] text-base-muted">
            {hasReadOnlyOhlcv
              ? "Cached OHLCV - read-only"
              : pair.chartUnavailableReason ?? "OHLCV unavailable for this selected pair"}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[10px] text-base-muted">
            <span>Last updated {formatChartTimestamp(pair.chartUpdatedAt)}</span>
            {statusMessage ? <span className="text-base-amber">{statusMessage}</span> : null}
          </div>
        </div>
        <div className="absolute right-2 top-1.5 z-30 flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          <div className="flex h-6 items-center border border-base-line bg-base-elevated">
            {(["15m", "1h", "4h", "1d"] as ChartTimeframe[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setTimeframe(option);
                  onRefreshChart(pair, option);
                }}
                className={cx(
                  "h-full border-r border-base-line px-1.5 font-mono text-[10px] uppercase last:border-r-0",
                  timeframe === option
                    ? "bg-base-mint/10 text-base-mint"
                    : "text-base-muted hover:text-base-text"
                )}
              >
                {option.toUpperCase()}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => onRefreshChart(pair, timeframe)}
            disabled={refreshStatus === "refreshing"}
            className="relative z-40 inline-flex h-6 items-center gap-1 border border-base-line bg-base-elevated px-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-base-muted hover:border-base-mint hover:text-base-mint disabled:cursor-not-allowed disabled:opacity-60"
            title="Refresh cached chart data"
          >
            <RefreshCw
              size={11}
              className={cx(refreshStatus === "refreshing" && "animate-spin")}
              aria-hidden="true"
            />
            {refreshStatus === "refreshing" ? "Refreshing" : "Refresh chart"}
          </button>
          <span
            className={cx(
              "border px-1.5 py-0.5 font-mono text-[10px]",
              hasReadOnlyOhlcv
                ? "border-base-mint/40 bg-base-mint/10 text-base-mint"
                : "border-base-amber/45 bg-base-amber/10 text-base-amber"
            )}
          >
            {hasReadOnlyOhlcv ? `Last ${formatChartValue(latest.close)}` : "Preview only"}
          </span>
        </div>
      </div>
      {hasReadOnlyOhlcv ? (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="pointer-events-none h-[250px] w-full max-w-full shrink-0 p-2 xl:h-auto xl:min-h-[205px] xl:flex-1"
          aria-hidden="true"
        >
        <defs>
          <linearGradient id={`chart-fill-${pair.id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--color-mint))" stopOpacity="0.18" />
            <stop offset="100%" stopColor="rgb(var(--color-mint))" stopOpacity="0" />
          </linearGradient>
        </defs>
        {Array.from({ length: 5 }).map((_, index) => (
          <line
            key={`h-${index}`}
            x1={plotLeft}
            x2={plotLeft + plotWidth}
            y1={(priceHeight / 4) * index}
            y2={(priceHeight / 4) * index}
            stroke="rgb(var(--color-line))"
            strokeOpacity={index === 0 || index === 4 ? "0.9" : "0.48"}
            strokeWidth="1"
          />
        ))}
        {Array.from({ length: 8 }).map((_, index) => (
          <line
            key={`v-${index}`}
            x1={plotLeft + (plotWidth / 7) * index}
            x2={plotLeft + (plotWidth / 7) * index}
            y1="0"
            y2={volumeTop + volumeHeight}
            stroke="rgb(var(--color-line))"
            strokeOpacity="0.24"
            strokeWidth="1"
          />
        ))}
        <line
          x1={plotLeft}
          x2={plotLeft + plotWidth}
          y1={volumeTop}
          y2={volumeTop}
          stroke="rgb(var(--color-line))"
          strokeOpacity="0.85"
        />
        {axisTicks.map((value, index) => (
          <text
            key={`axis-${index}`}
            x={width - 6}
            y={Math.max(10, Math.min(priceHeight - 2, getChartY(value, min, spread, priceHeight) + 3))}
            textAnchor="end"
            className="fill-base-muted font-mono text-[9px]"
          >
            {formatChartValue(value)}
          </text>
        ))}
        <path d={areaPath} fill={`url(#chart-fill-${pair.id})`} />
        <path d={closePath} fill="none" stroke="rgb(var(--color-mint))" strokeWidth="1" opacity="0.5" />
        {visibleCandles.map((candle, index) => {
          const x = plotLeft + index * step;
          const openY = getChartY(candle.open, min, spread, priceHeight);
          const closeY = getChartY(candle.close, min, spread, priceHeight);
          const highY = getChartY(candle.high, min, spread, priceHeight);
          const lowY = getChartY(candle.low, min, spread, priceHeight);
          const positive = candle.close >= candle.open;
          const bodyY = Math.min(openY, closeY);
          const bodyHeight = Math.max(2, Math.abs(openY - closeY));
          const volumeBarHeight = Math.max(1, (candle.volume / maxVolume) * volumeHeight);
          return (
            <g key={`c-${index}`}>
              <line
                x1={x}
                x2={x}
                y1={highY}
                y2={lowY}
                stroke={positive ? "rgb(var(--color-mint))" : "rgb(var(--color-rose))"}
                strokeOpacity="0.92"
                strokeWidth="1.1"
              />
              <rect
                x={x - candleWidth / 2}
                y={bodyY}
                width={candleWidth}
                height={bodyHeight}
                fill={positive ? "rgb(var(--color-mint))" : "rgb(var(--color-rose))"}
                opacity={positive ? "0.86" : "0.78"}
              />
              <rect
                x={x - candleWidth / 2}
                y={volumeTop + volumeHeight - volumeBarHeight}
                width={candleWidth}
                height={volumeBarHeight}
                fill={positive ? "rgb(var(--color-mint))" : "rgb(var(--color-rose))"}
                opacity={positive ? "0.28" : "0.2"}
              />
            </g>
          );
        })}
        <line
          x1={plotLeft}
          x2={plotLeft + plotWidth}
          y1={currentPriceY}
          y2={currentPriceY}
          stroke="rgb(var(--color-mint))"
          strokeDasharray="3 5"
          strokeOpacity="0.58"
        />
        <rect
          x={width - 62}
          y={Math.max(2, Math.min(priceHeight - 16, currentPriceY - 8))}
          width="58"
          height="16"
          fill="rgb(var(--color-mint))"
          opacity="0.14"
        />
        <text
          x={width - 6}
          y={Math.max(12, Math.min(priceHeight - 4, currentPriceY + 3))}
          textAnchor="end"
          className="fill-base-mint font-mono text-[10px] font-semibold"
        >
          {formatChartValue(latest.close)}
        </text>
        <text x="0" y={height - 2} className="fill-base-muted font-mono text-[10px]">
          {timeframe.toUpperCase()} cached OHLCV preview
        </text>
        <text
          x={width}
          y={height - 2}
          textAnchor="end"
          className={cx(
            "font-mono text-[10px]",
            lastMove >= 0 ? "fill-base-mint" : "fill-base-rose"
          )}
        >
          {lastMove >= 0 ? "+" : ""}
          {formatChartValue(lastMove)}
        </text>
        </svg>
      ) : (
        <ChartUnavailablePlaceholder
          pair={pair}
          statusMessage={statusMessage}
          timeframe={timeframe}
        />
      )}
    </div>
  );
}

function ChartUnavailablePlaceholder({
  pair,
  statusMessage,
  timeframe
}: {
  pair: BasePair;
  statusMessage?: string;
  timeframe: ChartTimeframe;
}) {
  const headline = "Demo chart preview";
  const reason =
    pair.chartUnavailableReason ??
    "Read-only OHLCV is not available for this selected pair yet.";

  return (
    <div className="relative flex h-[250px] w-full max-w-full shrink-0 overflow-hidden border-t border-base-line bg-base-elevated/40 p-2 xl:h-auto xl:min-h-[205px] xl:flex-1">
      <div
        className="pointer-events-none absolute inset-2 border border-dashed border-base-line bg-base-panel/45"
        aria-hidden="true"
      />
      <svg
        viewBox="0 0 820 270"
        className="pointer-events-none absolute inset-0 h-full w-full opacity-75"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={`demo-preview-${pair.id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--color-mint))" stopOpacity="0.13" />
            <stop offset="100%" stopColor="rgb(var(--color-mint))" stopOpacity="0" />
          </linearGradient>
        </defs>
        {Array.from({ length: 6 }).map((_, index) => (
          <line
            key={`placeholder-h-${index}`}
            x1="0"
            x2="820"
            y1={32 + index * 38}
            y2={32 + index * 38}
            stroke="rgb(var(--color-line))"
            strokeOpacity="0.62"
          />
        ))}
        <path
          d="M52 178 C126 151 167 163 225 134 S332 118 396 130 S520 153 594 112 S700 82 768 92 L768 214 L52 214 Z"
          fill={`url(#demo-preview-${pair.id})`}
        />
        <path
          d="M52 178 C126 151 167 163 225 134 S332 118 396 130 S520 153 594 112 S700 82 768 92"
          fill="none"
          stroke="rgb(var(--color-mint))"
          strokeDasharray="7 7"
          strokeOpacity="0.45"
          strokeWidth="1.6"
        />
        <text
          x="410"
          y="148"
          textAnchor="middle"
          className="fill-base-muted font-mono text-[26px] font-semibold uppercase opacity-20"
        >
          DEMO PREVIEW
        </text>
      </svg>
      <div className="relative z-10 m-auto max-w-[440px] border border-base-line bg-base-panel/95 px-4 py-3 text-center">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-base-muted">
          {headline}
        </p>
        <p className="mt-2 font-mono text-[13px] font-semibold text-base-text">
          Demo chart preview - not real market data
        </p>
        <p className="mt-2 text-[11px] leading-5 text-base-muted">{reason}</p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-base-muted">
          <span className="border border-base-line bg-base-elevated px-1.5 py-0.5">
            {timeframe.toUpperCase()} placeholder
          </span>
          {statusMessage ? (
            <span className="border border-base-line bg-base-elevated px-1.5 py-0.5 text-base-muted">
              {statusMessage}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function getVisibleCandleCount(timeframe: ChartTimeframe) {
  switch (timeframe) {
    case "15m":
      return 64;
    case "4h":
      return 72;
    case "1d":
      return 90;
    case "1h":
    default:
      return 80;
  }
}

function getDisplayCandles(pair: BasePair) {
  if (pair.chartCandles && pair.chartCandles.length > 0) {
    return pair.chartCandles;
  }

  const points = pair.chart.length > 0 ? pair.chart : [1];

  return points.map((close, index) => {
    const open = points[index - 1] ?? close;
    const wick = Math.max(Math.abs(close - open) * 0.45, Math.abs(close) * 0.006, 0.0001);

    return {
      timestamp: index,
      open,
      high: Math.max(open, close) + wick,
      low: Math.max(0, Math.min(open, close) - wick),
      close,
      volume: pair.volume24h / Math.max(points.length, 1)
    };
  });
}

function getChartY(value: number, min: number, spread: number, height: number) {
  return height - ((value - min) / spread) * height;
}

function formatChartValue(value: number) {
  if (value > 0 && value < 0.0001) {
    return value.toFixed(10);
  }

  if (value > 0 && value < 1) {
    return value.toFixed(6);
  }

  return value.toFixed(4);
}

function formatChartTimestamp(value: string | undefined) {
  if (!value) {
    return "cached";
  }

  const timestamp = new Date(value);

  if (Number.isNaN(timestamp.getTime())) {
    return "cached";
  }

  return timestamp.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function MiniModule({
  label,
  value,
  detail,
  bar,
  icon
}: {
  label: string;
  value: string;
  detail: string;
  bar?: number;
  icon?: ReactNode;
}) {
  const clamped = Math.max(0, Math.min(100, bar ?? 0));

  return (
    <div className="min-h-[78px] border border-base-line bg-base-panel p-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-base-muted">
          {label}
        </p>
        {icon ? <span className="text-base-mint">{icon}</span> : null}
      </div>
      <p className="mt-2 font-mono text-[13px] font-semibold text-base-text">{value}</p>
      {bar !== undefined ? (
        <div className="mt-2 h-1.5 bg-base-elevated">
          <div className="h-full bg-base-mint" style={{ width: `${clamped}%` }} />
        </div>
      ) : null}
      <p className="mt-1.5 text-[10px] text-base-muted">{detail}</p>
    </div>
  );
}

function formatOptionalPercent(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? formatPercent(value) : "N/A";
}

function formatPairCreatedAt(pair: BasePair) {
  if (!pair.pairCreatedAt) {
    return pair.age === "N/A" ? "Age unavailable" : "Public feed";
  }

  const timestamp = new Date(pair.pairCreatedAt);

  if (Number.isNaN(timestamp.getTime())) {
    return "Public feed";
  }

  return timestamp.toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric"
  });
}
