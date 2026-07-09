import type { ReactNode } from "react";
import { Copy, LockKeyhole, RefreshCw, Settings, Star } from "lucide-react";
import type { MarketTerminalSnapshot } from "@/data/providers";
import { cx, formatCompactCurrency, formatPercent } from "@/lib/format";
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
  onRefreshChart: (pair: BasePair) => void;
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
    <section className="flex min-h-0 flex-col overflow-hidden border border-base-line bg-base-panel">
      <div className="flex min-h-10 shrink-0 items-center justify-between gap-3 border-b border-base-line bg-base-raised px-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-base-muted">
            Selected pair
          </p>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="truncate text-lg font-semibold text-base-text">{pair.pair}</h1>
            <Star size={14} className="shrink-0 text-base-mint" aria-hidden="true" />
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
            <Copy size={12} className="shrink-0 text-base-muted" aria-hidden="true" />
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
  onRefreshChart: (pair: BasePair) => void;
}) {
  const width = 720;
  const height = 250;
  const candles = getDisplayCandles(pair);
  const values = candles.flatMap((candle) => [
    candle.open,
    candle.high,
    candle.low,
    candle.close
  ]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || 1;
  const step = width / Math.max(candles.length - 1, 1);
  const path = candles
    .map((candle, index) => {
      const x = index * step;
      const y = getChartY(candle.close, min, spread, height);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const latest = candles[candles.length - 1];
  const chartLabel = pair.chartLabel ?? "Chart preview \u00b7 OHLCV unavailable";
  const statusMessage =
    refreshStatus === "refreshing"
      ? "Updating chart..."
      : refreshStatus === "using-last"
      ? "Using last available chart"
      : pair.chartUnavailableReason && pair.chartSource !== "geckoterminal"
        ? "Using synthetic fallback"
        : undefined;

  return (
    <div className="market-scanline flex min-h-[280px] flex-1 flex-col overflow-hidden border border-base-line bg-base-panel xl:min-h-0">
      <div className="flex shrink-0 items-center justify-between border-b border-base-line bg-base-raised px-2 py-1.5">
        <div className="min-w-0">
          <p className="font-mono text-[12px] font-semibold text-base-text">
            {pair.pair.replace(" / ", "/")} - {chartLabel}
          </p>
          <p className="font-mono text-[10px] text-base-mint">
            O {formatChartValue(latest.open)} H {formatChartValue(latest.high)} L{" "}
            {formatChartValue(latest.low)} C {formatChartValue(latest.close)}
          </p>
          <p className="font-mono text-[10px] text-base-muted">
            {pair.chartSource === "geckoterminal"
              ? "Read-only candles - Base"
              : `Synthetic path only - ${pair.dex} (Base)`}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[10px] text-base-muted">
            <span>Last updated {formatChartTimestamp(pair.chartUpdatedAt)}</span>
            {statusMessage ? <span className="text-base-amber">{statusMessage}</span> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => onRefreshChart(pair)}
            disabled={refreshStatus === "refreshing"}
            className="inline-flex h-6 items-center gap-1 border border-base-line bg-base-elevated px-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-base-muted hover:border-base-mint hover:text-base-mint disabled:cursor-not-allowed disabled:opacity-60"
            title="Refresh cached chart data"
          >
            <RefreshCw
              size={11}
              className={cx(refreshStatus === "refreshing" && "animate-spin")}
              aria-hidden="true"
            />
            {refreshStatus === "refreshing" ? "Refreshing" : "Refresh"}
          </button>
          <span className="border border-base-mint/40 bg-base-mint/10 px-1.5 py-0.5 font-mono text-[10px] text-base-mint">
            Volume {formatCompactCurrency(latest.volume || pair.volume24h)}
          </span>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-[235px] w-full max-w-full shrink-0 p-2 xl:h-auto xl:min-h-[190px] xl:flex-1"
        aria-hidden="true"
      >
        {Array.from({ length: 6 }).map((_, index) => (
          <line
            key={`h-${index}`}
            x1="0"
            x2={width}
            y1={(height / 5) * index}
            y2={(height / 5) * index}
            stroke="rgb(var(--color-line))"
            strokeOpacity="0.65"
            strokeWidth="1"
          />
        ))}
        {candles.map((candle, index) => {
          const x = index * step;
          const openY = getChartY(candle.open, min, spread, height);
          const closeY = getChartY(candle.close, min, spread, height);
          const highY = getChartY(candle.high, min, spread, height);
          const lowY = getChartY(candle.low, min, spread, height);
          const positive = candle.close >= candle.open;
          const bodyY = Math.min(openY, closeY);
          const bodyHeight = Math.max(2, Math.abs(openY - closeY));
          return (
            <g key={`c-${index}`}>
              <line
                x1={x}
                x2={x}
                y1={highY}
                y2={lowY}
                stroke={positive ? "rgb(var(--color-mint))" : "rgb(var(--color-rose))"}
                strokeWidth="1"
              />
              <rect
                x={x - 3}
                y={bodyY}
                width="6"
                height={bodyHeight}
                fill={positive ? "rgb(var(--color-mint))" : "rgb(var(--color-rose))"}
                opacity="0.88"
              />
              <rect
                x={x - 4}
                y={height - 20 - ((index % 4) + 1) * 4}
                width="8"
                height={((index % 4) + 1) * 4}
                fill={positive ? "rgb(var(--color-mint) / 0.22)" : "rgb(var(--color-rose) / 0.18)"}
              />
            </g>
          );
        })}
        <path d={path} fill="none" stroke="rgb(var(--color-mint))" strokeWidth="1.4" opacity="0.8" />
      </svg>
    </div>
  );
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
