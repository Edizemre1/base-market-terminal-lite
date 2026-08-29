import { useMemo, useState } from "react";
import { ExternalLink, Maximize2, Minimize2, RefreshCw } from "lucide-react";
import type { MarketTerminalSnapshot } from "@/data/providers";
import type { ChartTimeframe } from "@/data/providers/chart/types";
import { cx, formatCompactCurrency, formatPercent } from "@/lib/format";
import { PairAvatarStack } from "@/components/TokenIdentity";
import type { BasePair } from "@/types/baseTerminal";
import type { ChartRefreshStatus } from "@/components/base-terminal/types";

export function SelectedPairPanel({
  pair,
  marketDataMode,
  chartRefreshStatus,
  onRefreshChart
}: {
  pair: BasePair;
  marketDataMode: MarketTerminalSnapshot["mode"];
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
      : "Labeled sample";

  return (
    <section
      id="selected-market"
      className="flex min-h-0 flex-col overflow-hidden rounded-sm border border-base-line bg-base-panel shadow-panel"
      data-testid="selected-pair-panel"
    >
      <div className="flex min-h-10 shrink-0 items-center justify-between gap-3 border-b border-base-line bg-base-raised px-3">
        <div className="flex min-w-0 items-center gap-2">
          <PairAvatarStack
            baseSymbol={pair.baseToken}
            quoteSymbol={pair.quoteToken}
            baseLogoUrl={pair.tokenLogoUrl}
            quoteLogoUrl={pair.quoteTokenLogoUrl}
            size="md"
          />
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-base-muted">
              Selected market
            </p>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
              <h1
                className="truncate text-[15px] font-semibold leading-5 text-base-text"
                data-testid="selected-pair-title"
              >
                {pair.pair}
              </h1>
              <span className="border border-base-line bg-base-panel px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-base-muted">
                {pair.dexName ?? pair.dex}
              </span>
              <span className="border border-base-line bg-base-panel px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-base-muted">
                {pair.dataSource === "mock" ? "Demo data" : "Read-only data"}
              </span>
              <span className="max-w-[128px] truncate border border-base-line bg-base-panel px-1.5 py-0.5 font-mono text-[9px] text-base-muted">
                {pair.address}
              </span>
              {isDemoFallbackSelected ? (
                <span className="border border-base-amber/45 bg-base-amber/10 px-1.5 py-0.5 font-mono text-[9px] text-base-amber">
                  Demo fallback selected
                </span>
              ) : null}
              {pair.stale ? (
                <span className="border border-base-amber/45 bg-base-amber/10 px-1.5 py-0.5 font-mono text-[9px] text-base-amber">
                  {pair.staleReason ?? "Stale selected pair"}
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

      <div className="grid shrink-0 gap-1 border-b border-base-line p-2 sm:grid-cols-2 lg:grid-cols-6">
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
        <Metric
          label="Data status"
          value={pair.dataSource === "mock" ? "Demo" : pair.stale ? "Stale" : "Public feed"}
          detail={pair.dataSource === "mock" ? "Explicit sample mode" : "No safety score inferred"}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col p-2">
        <ChartPanel
          pair={pair}
          refreshStatus={chartRefreshStatus}
          onRefreshChart={onRefreshChart}
        />
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
  const [expanded, setExpanded] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number>();
  const width = 820;
  const height = 270;
  const priceHeight = 198;
  const volumeTop = 214;
  const volumeHeight = 42;
  const plotLeft = 10;
  const plotRight = 66;
  const plotWidth = width - plotLeft - plotRight;
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
  const hasReadOnlyOhlcv = pair.chartSource === "geckoterminal" && candles.length >= 2;
  const rawMin = values.length > 0 ? Math.min(...values) : 0;
  const rawMax = values.length > 0 ? Math.max(...values) : 1;
  const pricePadding = Math.max((rawMax - rawMin) * 0.06, Math.abs(rawMax) * 0.002);
  const min = Math.max(0, rawMin - pricePadding);
  const max = rawMax + pricePadding;
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
  const latest = visibleCandles[visibleCandles.length - 1];
  const previous = visibleCandles[visibleCandles.length - 2] ?? latest;
  const lastMove = latest && previous ? latest.close - previous.close : 0;
  const currentPriceY = latest ? getChartY(latest.close, min, spread, priceHeight) : 0;
  const axisTicks = [max, min + spread / 2, min].filter(
    (value) => Math.abs(getChartY(value, min, spread, priceHeight) - currentPriceY) > 18
  );
  const timeTickIndexes = [...new Set([0, Math.floor((visibleCandles.length - 1) / 3), Math.floor(((visibleCandles.length - 1) * 2) / 3), visibleCandles.length - 1])].filter((index) => index >= 0);
  const hoveredCandle = hoveredIndex === undefined ? undefined : visibleCandles[hoveredIndex];
  const chartLabel = hasReadOnlyOhlcv
    ? (pair.chartLabel ?? "OHLCV read-only \u00b7 cached chart")
    : pair.dataSource === "mock"
      ? "Sample data — chart disabled"
      : "OHLCV unavailable";
  const statusMessage =
    refreshStatus === "refreshing"
      ? "Updating chart..."
      : refreshStatus === "using-last"
      ? hasReadOnlyOhlcv
        ? "Using last available chart"
        : "Chart request failed; no verified candles received"
      : pair.stale
        ? "Selected pair market data is stale"
      : !hasReadOnlyOhlcv
        ? "No synthetic chart rendered"
        : undefined;

  return (
    <div
      className={cx(
        "market-scanline flex flex-col overflow-hidden rounded-sm border border-base-line bg-base-panel",
        expanded
          ? "fixed inset-3 z-[80] h-auto bg-base-panel shadow-2xl sm:inset-6"
          : "h-[320px] sm:h-[340px] lg:h-[360px] 2xl:h-[380px]"
      )}
      data-testid="chart-panel"
    >
      <div className="relative z-20 shrink-0 border-b border-base-line bg-base-raised px-2 py-1.5 md:pr-[188px]">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-mono text-[12px] font-semibold text-base-text">
            <span>{pair.pair.replace(" / ", "/")}</span>
            <span className="border border-base-line bg-base-elevated px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-base-muted">
              {chartLabel}
            </span>
          </p>
          {hasReadOnlyOhlcv && latest ? (
            <p className="mt-1 font-mono text-[10px] text-base-mint">
              O {formatChartValue(latest.open)} H {formatChartValue(latest.high)} L{" "}
              {formatChartValue(latest.low)} C {formatChartValue(latest.close)} V{" "}
              {formatCompactCurrency(latest.volume || pair.volume24h)}
            </p>
          ) : (
            <p className="mt-1 font-mono text-[10px] text-base-amber">
              Chart unavailable — no synthetic market path is shown
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
        <div className="mt-2 flex shrink-0 flex-wrap items-center gap-1.5 md:absolute md:right-2 md:top-1.5 md:z-30 md:mt-0 md:justify-end">
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
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="relative z-40 grid h-6 w-6 place-items-center rounded-sm border border-base-line bg-base-elevated text-base-muted outline-none hover:border-base-mint hover:text-base-mint focus-visible:ring-2 focus-visible:ring-base-mint/40"
            aria-label={expanded ? "Collapse chart" : "Expand chart"}
          >
            {expanded ? <Minimize2 size={12} aria-hidden="true" /> : <Maximize2 size={12} aria-hidden="true" />}
          </button>
          <span
            className={cx(
              "border px-1.5 py-0.5 font-mono text-[10px]",
              hasReadOnlyOhlcv
                ? "border-base-mint/40 bg-base-mint/10 text-base-mint"
                : "border-base-amber/45 bg-base-amber/10 text-base-amber"
            )}
          >
            {hasReadOnlyOhlcv && latest ? `Last ${formatChartValue(latest.close)}` : "No chart data"}
          </span>
        </div>
      </div>
      {hasReadOnlyOhlcv && latest ? (
        <div className="relative min-h-0 flex-1">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-full min-h-0 w-full max-w-full touch-none p-2"
          role="img"
          aria-label={`${pair.pair} ${timeframe} candlestick and volume chart`}
          onPointerMove={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const chartX = ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * width;
            const nextIndex = Math.round((chartX - plotLeft) / Math.max(step, 1));
            setHoveredIndex(Math.max(0, Math.min(visibleCandles.length - 1, nextIndex)));
          }}
          onPointerLeave={() => setHoveredIndex(undefined)}
        >
        <title>{pair.pair} cached read-only OHLCV</title>
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
        {timeTickIndexes.map((index) => {
          const candle = visibleCandles[index];
          return candle ? (
            <text key={`time-${index}`} x={plotLeft + index * step} y={height - 3} textAnchor={index === 0 ? "start" : index === visibleCandles.length - 1 ? "end" : "middle"} className="fill-base-muted font-mono text-[9px]">
              {formatCandleTime(candle.timestamp)}
            </text>
          ) : null;
        })}
        {hoveredCandle && hoveredIndex !== undefined ? (
          <line x1={plotLeft + hoveredIndex * step} x2={plotLeft + hoveredIndex * step} y1="0" y2={volumeTop + volumeHeight} stroke="rgb(var(--color-text))" strokeDasharray="2 4" strokeOpacity="0.4" />
        ) : null}
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
        </svg>
        {hoveredCandle ? (
          <div className="pointer-events-none absolute left-3 top-3 rounded-sm border border-base-line bg-base-panel/95 px-2.5 py-2 font-mono text-[10px] text-base-text shadow-panel">
            <p className="text-base-muted">{formatCandleTimestamp(hoveredCandle.timestamp)}</p>
            <p className="mt-1">O {formatChartValue(hoveredCandle.open)} · H {formatChartValue(hoveredCandle.high)} · L {formatChartValue(hoveredCandle.low)} · C {formatChartValue(hoveredCandle.close)}</p>
            <p className="mt-1 text-base-muted">Volume {formatCompactCurrency(hoveredCandle.volume)}</p>
          </div>
        ) : null}
        <span className={cx("pointer-events-none absolute bottom-2 right-3 font-mono text-[10px]", lastMove >= 0 ? "text-base-mint" : "text-base-rose")}>{lastMove >= 0 ? "+" : ""}{formatChartValue(lastMove)}</span>
        </div>
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
  const headline =
    pair.chartSource === "geckoterminal" && (pair.chartCandles?.length ?? 0) < 2
      ? "Insufficient chart data"
      : "Chart unavailable";
  const reason =
    headline === "Insufficient chart data"
      ? "The provider returned too few verified candles for a readable chart."
      : pair.chartUnavailableReason ??
        "Read-only OHLCV is not available for this selected pair yet.";

  return (
    <div className="relative flex min-h-0 w-full max-w-full flex-1 overflow-hidden border-t border-base-line bg-base-elevated/40 p-2">
      <div
        className="pointer-events-none absolute inset-2 border border-dashed border-base-line bg-base-panel/45"
        aria-hidden="true"
      />
      <div className="relative z-10 m-auto max-w-[440px] border border-base-line bg-base-panel/95 px-4 py-3 text-center">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-base-muted">
          {headline}
        </p>
        <p className="mt-2 font-mono text-[13px] font-semibold text-base-text">
          No synthetic market chart is rendered
        </p>
        <p className="mt-2 text-[11px] leading-5 text-base-muted">{reason}</p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-base-muted">
          <span className="border border-base-line bg-base-elevated px-1.5 py-0.5">
            {timeframe.toUpperCase()} requested interval
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
  return pair.chartCandles ?? [];
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
    hour12: false,
    timeZone: "UTC"
  });
}

function formatCandleTime(timestamp: number) {
  const value = new Date(timestamp * 1000);
  return Number.isNaN(value.getTime())
    ? "N/A"
    : value.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
}

function formatCandleTimestamp(timestamp: number) {
  const value = new Date(timestamp * 1000);
  return Number.isNaN(value.getTime())
    ? "Timestamp unavailable"
    : value.toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }) + " UTC";
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
    year: "numeric",
    timeZone: "UTC"
  });
}
