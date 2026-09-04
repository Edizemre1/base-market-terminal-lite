import { useMemo, useState } from "react";
import { ExternalLink, Maximize2, Minimize2, RefreshCw } from "lucide-react";
import type { MarketTerminalSnapshot } from "@/data/providers";
import type { ChartTimeframe } from "@/data/providers/chart/types";
import { cx } from "@/lib/format";
import { PairAvatarStack } from "@/components/TokenIdentity";
import type { BasePair } from "@/types/baseTerminal";
import type { ChartRefreshStatus } from "@/components/base-terminal/types";
import { useI18n } from "@/i18n/I18nProvider";
import { localizeAgeLabel } from "@/i18n/dictionaries";
import { getChange24h, getLiquidityUsd, getVolume24h } from "@/lib/base-terminal/discovery";
import { getMarketInvariantAttributes } from "@/lib/base-terminal/marketModel";
import { MarketSignalBadges } from "@/components/base-terminal/MarketSignalBadges";
import { AssetTradeabilityBadges } from "@/components/base-terminal/AssetTradeabilityBadges";

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
  const { t, locale, formatCompactCurrency: localCurrency, formatPercent: localPercent } = useI18n();
  const isDemoFallbackSelected =
    marketDataMode === "dexscreener" && pair.dataSource === "mock";
  const readOnlyDetail =
    marketDataMode === "dexscreener"
      ? isDemoFallbackSelected
        ? t("header.demoFallback")
        : t("workspace.readOnlyData")
      : t("market.sampleDataset");
  const change24h = getChange24h(pair);
  const volume24h = getVolume24h(pair);
  const liquidityUsd = getLiquidityUsd(pair);

  return (
    <section
      {...getMarketInvariantAttributes(pair)}
      id="selected-market"
      className="pulse-surface flex min-h-0 flex-col overflow-hidden rounded-panel"
      data-testid="selected-pair-panel"
    >
      <div className="flex min-h-10 shrink-0 items-center justify-between gap-3 border-b border-border-subtle bg-surface-raised px-3">
        <div className="flex min-w-0 items-center gap-2">
          <PairAvatarStack
            baseSymbol={pair.baseToken}
            quoteSymbol={pair.quoteToken}
            baseLogoUrl={pair.tokenLogoUrl}
            quoteLogoUrl={pair.quoteTokenLogoUrl}
            baseAddress={pair.baseTokenAddress}
            quoteAddress={pair.quoteTokenAddress}
            baseName={pair.project}
            chainId={pair.chainId}
            observedAt={pair.sourceUpdatedAt}
            size="md"
          />
          <div className="min-w-0">
            <p className="text-meta font-semibold uppercase tracking-eyebrow text-content-secondary">
              {t("workspace.selected")}
            </p>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
              <h2
                className="truncate text-title-sm font-semibold leading-5 text-content-primary"
                data-testid="selected-pair-title"
              >
                {pair.pair}
              </h2>
              <MarketSignalBadges pair={pair} />
              <AssetTradeabilityBadges pair={pair} compact={false} />
              <span className="border border-border-subtle bg-surface-panel px-2 py-1 font-mono text-meta uppercase tracking-eyebrow text-content-secondary">
                {pair.dexName ?? pair.dex}
              </span>
              <span className="border border-border-subtle bg-surface-panel px-2 py-1 font-mono text-meta uppercase tracking-eyebrow text-content-secondary">
                {pair.dataSource === "mock" ? t("market.demoData") : t("workspace.readOnlyData")}
              </span>
              <span className="max-w-[128px] truncate border border-border-subtle bg-surface-panel px-2 py-1 font-mono text-meta text-content-secondary">
                {pair.address}
              </span>
              {isDemoFallbackSelected ? (
                <span className="border border-freshness-delayed/45 bg-freshness-delayed/10 px-2 py-1 font-mono text-meta text-freshness-delayed">
                  {t("workspace.demoFallback")}
                </span>
              ) : null}
              {pair.stale ? (
                <span className="border border-freshness-delayed/45 bg-freshness-delayed/10 px-2 py-1 font-mono text-meta text-freshness-delayed">
                  {pair.staleReason ?? t("workspace.stalePair")}
                </span>
              ) : null}
              {pair.sourceUrl ? (
                <a
                  href={pair.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="grid h-5 w-5 place-items-center border border-border-subtle bg-surface-interactive text-content-secondary hover:border-border-strong hover:text-content-primary"
                  aria-label={t("workspace.openSource", { pair: pair.pair })}
                >
                  <ExternalLink size={11} aria-hidden="true" />
                </a>
              ) : null}
            </div>
          </div>
        </div>
        <div className="hidden shrink-0 items-center gap-1 text-meta font-semibold uppercase tracking-eyebrow text-content-secondary md:flex">
          <button
            type="button"
            onClick={() => onRefreshChart(pair)}
            className="inline-flex h-control-s items-center gap-1 rounded-control border border-border-subtle bg-surface-interactive px-2 font-mono text-meta text-content-secondary hover:border-border-strong hover:text-content-primary focus-visible:ring-2 focus-visible:ring-focus"
            title={t("workspace.refreshChart")}
          >
            <RefreshCw size={10} aria-hidden="true" />
            {t("common.refresh")}
          </button>
        </div>
      </div>

      <div className="grid shrink-0 gap-1 border-b border-border-subtle p-2 sm:grid-cols-2 lg:grid-cols-6">
        <Metric label={t("workspace.price", { quote: pair.quoteToken })} value={pair.price} detail={pair.priceUsd} />
        <Metric
          label={t("workspace.change24h")}
          value={typeof change24h === "number" ? localPercent(change24h) : t("common.noData")}
          detail={`5m ${typeof pair.priceChanges?.m5 === "number" ? localPercent(pair.priceChanges.m5) : t("common.noData")} / 1h ${typeof pair.priceChanges?.h1 === "number" ? localPercent(pair.priceChanges.h1) : t("common.noData")}`}
          tone={typeof change24h !== "number" || change24h === 0 ? "default" : change24h > 0 ? "positive" : "negative"}
        />
        <Metric
          label={t("workspace.volume24h")}
          value={typeof volume24h === "number" ? localCurrency(volume24h) : t("common.noData")}
          detail={readOnlyDetail}
        />
        <Metric
          label={t("workspace.liquidity")}
          value={typeof liquidityUsd === "number" ? localCurrency(liquidityUsd) : t("common.noData")}
          detail={readOnlyDetail}
        />
        <Metric label={t("workspace.age")} value={localizeAgeLabel(pair.age, locale)} detail={formatPairCreatedAt(pair, locale, t)} />
        <Metric
          label={t("workspace.dataStatus")}
          value={pair.dataSource === "mock" ? t("market.demoData") : pair.stale ? t("market.staleData") : t("workspace.publicFeed")}
          detail={pair.dataSource === "mock" ? t("workspace.explicitSample") : t("workspace.noSafetyScore")}
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
  tone?: "default" | "positive" | "negative";
}) {
  return (
    <div className="border border-border-subtle bg-surface-panel p-2">
      <p className="text-meta font-semibold uppercase tracking-eyebrow text-content-secondary">
        {label}
      </p>
      <p
        className={cx(
          "mt-2 font-mono text-title-sm font-semibold leading-none",
          tone === "positive"
            ? "text-market-positive"
            : tone === "negative"
              ? "text-market-negative"
              : "text-content-primary"
        )}
      >
        {value}
      </p>
      <p className="mt-1 font-mono text-meta text-content-secondary">{detail}</p>
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
  const { t, locale, formatCompactCurrency: localCurrency } = useI18n();
  const [timeframe, setTimeframe] = useState<ChartTimeframe>("1h");
  const [expanded, setExpanded] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number>();
  const [livePaused, setLivePaused] = useState(false);
  const [frozenCandles, setFrozenCandles] = useState<BasePair["chartCandles"]>();
  const width = 820;
  const height = 270;
  const priceHeight = 198;
  const volumeTop = 214;
  const volumeHeight = 42;
  const plotLeft = 10;
  const plotRight = 66;
  const plotWidth = width - plotLeft - plotRight;
  const sourceCandles = useMemo(() => getDisplayCandles(pair), [pair]);
  const candles = livePaused && frozenCandles ? frozenCandles : sourceCandles;
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
    ? (pair.chartLabel ?? t("chart.readOnly"))
    : pair.dataSource === "mock"
      ? t("chart.sampleDisabled")
      : t("chart.unavailable");
  const statusMessage =
    refreshStatus === "refreshing"
      ? t("chart.updating")
      : refreshStatus === "using-last"
      ? hasReadOnlyOhlcv
        ? t("chart.lastAvailable")
        : t("chart.requestFailed")
      : pair.stale
        ? t("chart.stalePair")
      : !hasReadOnlyOhlcv
        ? t("chart.noSynthetic")
        : undefined;

  return (
    <div
      className={cx(
        "market-scanline flex flex-col overflow-hidden rounded-panel border border-border-subtle/60 bg-surface-panel",
        expanded
          ? "fixed inset-3 z-layer-modal h-auto bg-surface-panel shadow-overlay sm:inset-6"
          : "h-[320px] sm:h-[340px] lg:h-[360px] 2xl:h-[380px]"
      )}
      data-testid="chart-panel"
    >
      <div className="relative z-layer-shell shrink-0 border-b border-border-subtle bg-surface-raised px-2 py-2 md:pr-chart-toolbar">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-mono text-label font-semibold text-content-primary">
            <span>{pair.pair.replace(" / ", "/")}</span>
            <span className="border border-border-subtle bg-surface-interactive px-2 py-1 text-meta uppercase tracking-eyebrow text-content-secondary">
              {chartLabel}
            </span>
          </p>
          {hasReadOnlyOhlcv && latest ? (
            <p className="mt-1 font-mono text-meta text-content-primary">
              O {formatChartValue(latest.open)} H {formatChartValue(latest.high)} L{" "}
              {formatChartValue(latest.low)} C {formatChartValue(latest.close)} V{" "}
              {localCurrency(latest.volume)}
            </p>
          ) : (
            <p className="mt-1 font-mono text-meta text-freshness-delayed">
              {t("chart.unavailableNoSynthetic")}
            </p>
          )}
          <p className="font-mono text-meta text-content-secondary">
            {hasReadOnlyOhlcv
              ? t("chart.cachedReadOnly")
              : pair.dataSource === "mock" ? t("chart.notConnected") : t("chart.unavailablePair")}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-meta text-content-secondary">
            <span>{t("chart.lastUpdated", { time: formatChartTimestamp(pair.chartUpdatedAt, locale) })}</span>
            {statusMessage ? <span className="text-freshness-delayed">{statusMessage}</span> : null}
          </div>
        </div>
        <div className="mt-2 flex shrink-0 flex-wrap items-center gap-2 md:absolute md:right-2 md:top-2 md:z-layer-popover md:mt-0 md:justify-end">
          <div className="flex h-control-s items-center rounded-control border border-border-subtle bg-surface-interactive">
            {(["15m", "1h", "4h", "1d"] as ChartTimeframe[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setTimeframe(option);
                  onRefreshChart(pair, option);
                }}
                className={cx(
                  "h-full border-r border-border-subtle px-2 font-mono text-meta uppercase outline-none last:border-r-0 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus",
                  timeframe === option
                    ? "bg-surface-selected text-content-primary"
                    : "text-content-secondary hover:text-content-primary"
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
            className="relative z-layer-popover inline-flex h-control-s items-center gap-1 rounded-control border border-border-subtle bg-surface-interactive px-2 font-mono text-meta text-content-secondary hover:border-border-strong hover:text-content-primary focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-60"
            title={t("workspace.refreshChart")}
          >
            <RefreshCw
              size={11}
              className={cx(refreshStatus === "refreshing" && "animate-spin")}
              aria-hidden="true"
            />
            {refreshStatus === "refreshing" ? t("chart.refreshing") : t("chart.refresh")}
          </button>
          {livePaused ? (
            <button
              type="button"
              onClick={() => {
                setLivePaused(false);
                setFrozenCandles(undefined);
              }}
              data-testid="resume-live-chart"
              className="relative z-layer-popover h-control-s rounded-control bg-operation-ready px-2 font-mono text-meta font-bold text-content-primary"
            >
              {t("chart.resume")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="relative z-layer-popover grid h-control-s w-control-s place-items-center rounded-control border border-border-subtle bg-surface-interactive text-content-secondary outline-none hover:border-border-strong hover:text-content-primary focus-visible:ring-2 focus-visible:ring-focus"
            aria-label={expanded ? t("chart.collapse") : t("chart.expand")}
          >
            {expanded ? <Minimize2 size={12} aria-hidden="true" /> : <Maximize2 size={12} aria-hidden="true" />}
          </button>
          <span
            className={cx(
              "border px-2 py-1 font-mono text-meta",
              hasReadOnlyOhlcv
                ? "border-freshness-live/35 bg-freshness-live/10 text-freshness-live"
                : "border-freshness-delayed/45 bg-freshness-delayed/10 text-freshness-delayed"
            )}
          >
            {hasReadOnlyOhlcv && latest ? t("chart.last", { value: formatChartValue(latest.close) }) : t("chart.noData")}
          </span>
        </div>
      </div>
      {hasReadOnlyOhlcv && latest ? (
        <div className="relative min-h-0 flex-1">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-full min-h-0 w-full max-w-full touch-none p-2"
          role="img"
          aria-label={t("chart.aria", { pair: pair.pair, timeframe })}
          onPointerEnter={() => {
            if (!livePaused) {
              setFrozenCandles(sourceCandles);
              setLivePaused(true);
            }
          }}
          onPointerMove={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const chartX = ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * width;
            const nextIndex = Math.round((chartX - plotLeft) / Math.max(step, 1));
            setHoveredIndex(Math.max(0, Math.min(visibleCandles.length - 1, nextIndex)));
          }}
          onPointerLeave={() => setHoveredIndex(undefined)}
        >
        <title>{t("chart.svgTitle", { pair: pair.pair })}</title>
        <defs>
          <linearGradient id={`chart-fill-${pair.id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--network-base))" stopOpacity="0.18" />
            <stop offset="100%" stopColor="rgb(var(--network-base))" stopOpacity="0" />
          </linearGradient>
        </defs>
        {Array.from({ length: 5 }).map((_, index) => (
          <line
            key={`h-${index}`}
            x1={plotLeft}
            x2={plotLeft + plotWidth}
            y1={(priceHeight / 4) * index}
            y2={(priceHeight / 4) * index}
            stroke="rgb(var(--border-subtle))"
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
            stroke="rgb(var(--border-subtle))"
            strokeOpacity="0.24"
            strokeWidth="1"
          />
        ))}
        <line
          x1={plotLeft}
          x2={plotLeft + plotWidth}
          y1={volumeTop}
          y2={volumeTop}
          stroke="rgb(var(--border-subtle))"
          strokeOpacity="0.85"
        />
        {axisTicks.map((value, index) => (
          <text
            key={`axis-${index}`}
            x={width - 6}
            y={Math.max(10, Math.min(priceHeight - 2, getChartY(value, min, spread, priceHeight) + 3))}
            textAnchor="end"
            className="fill-content-secondary font-mono text-meta"
          >
            {formatChartValue(value)}
          </text>
        ))}
        <path d={areaPath} fill={`url(#chart-fill-${pair.id})`} />
        <path d={closePath} fill="none" stroke="rgb(var(--network-base))" strokeWidth="1" opacity="0.72" />
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
                stroke={positive ? "rgb(var(--market-positive))" : "rgb(var(--market-negative))"}
                strokeOpacity="0.92"
                strokeWidth="1.1"
              />
              <rect
                x={x - candleWidth / 2}
                y={bodyY}
                width={candleWidth}
                height={bodyHeight}
                fill={positive ? "rgb(var(--market-positive))" : "rgb(var(--market-negative))"}
                opacity={positive ? "0.86" : "0.78"}
              />
              <rect
                x={x - candleWidth / 2}
                y={volumeTop + volumeHeight - volumeBarHeight}
                width={candleWidth}
                height={volumeBarHeight}
                fill={positive ? "rgb(var(--market-positive))" : "rgb(var(--market-negative))"}
                opacity={positive ? "0.28" : "0.2"}
              />
            </g>
          );
        })}
        {timeTickIndexes.map((index) => {
          const candle = visibleCandles[index];
          return candle ? (
            <text key={`time-${index}`} x={plotLeft + index * step} y={height - 3} textAnchor={index === 0 ? "start" : index === visibleCandles.length - 1 ? "end" : "middle"} className="fill-content-secondary font-mono text-meta">
              {formatCandleTime(candle.timestamp, locale)}
            </text>
          ) : null;
        })}
        {hoveredCandle && hoveredIndex !== undefined ? (
          <line x1={plotLeft + hoveredIndex * step} x2={plotLeft + hoveredIndex * step} y1="0" y2={volumeTop + volumeHeight} stroke="rgb(var(--content-primary))" strokeDasharray="2 4" strokeOpacity="0.4" />
        ) : null}
        <line
          x1={plotLeft}
          x2={plotLeft + plotWidth}
          y1={currentPriceY}
          y2={currentPriceY}
          stroke="rgb(var(--network-base))"
          strokeDasharray="3 5"
          strokeOpacity="0.58"
        />
        <rect
          x={width - 62}
          y={Math.max(2, Math.min(priceHeight - 16, currentPriceY - 8))}
          width="58"
          height="16"
          fill="rgb(var(--network-base))"
          opacity="0.14"
        />
        <text
          x={width - 6}
          y={Math.max(12, Math.min(priceHeight - 4, currentPriceY + 3))}
          textAnchor="end"
          className="fill-brand-accent font-mono text-meta font-semibold"
        >
          {formatChartValue(latest.close)}
        </text>
        </svg>
        {hoveredCandle ? (
          <div className="pointer-events-none absolute left-3 top-3 rounded-control border border-border-subtle bg-surface-panel/95 px-3 py-2 font-mono text-meta text-content-primary shadow-raised">
            <p className="text-content-secondary">{formatCandleTimestamp(hoveredCandle.timestamp, locale)}</p>
            <p className="mt-1">O {formatChartValue(hoveredCandle.open)} · H {formatChartValue(hoveredCandle.high)} · L {formatChartValue(hoveredCandle.low)} · C {formatChartValue(hoveredCandle.close)}</p>
            <p className="mt-1 text-content-secondary">{t("chart.volume")} {localCurrency(hoveredCandle.volume)}</p>
          </div>
        ) : null}
        <span className={cx("pointer-events-none absolute bottom-2 right-3 font-mono text-meta", lastMove >= 0 ? "text-market-positive" : "text-market-negative")}>{lastMove >= 0 ? "+" : ""}{formatChartValue(lastMove)}</span>
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
  const { t } = useI18n();
  const headline =
    pair.chartSource === "geckoterminal" && (pair.chartCandles?.length ?? 0) < 2
      ? t("chart.insufficient")
      : t("chart.unavailableTitle");
  const reason =
    pair.chartSource === "geckoterminal" && (pair.chartCandles?.length ?? 0) < 2
      ? t("chart.insufficientBody")
      : pair.dataSource === "mock"
        ? t("chart.notConnected")
        : t("chart.unavailableBody");

  return (
    <div className="relative flex min-h-0 w-full max-w-full flex-1 overflow-hidden border-t border-border-subtle bg-surface-interactive/40 p-2">
      <div
        className="pointer-events-none absolute inset-2 border border-dashed border-border-subtle bg-surface-panel/45"
        aria-hidden="true"
      />
      <div className="relative z-layer-sticky m-auto max-w-[440px] border border-border-subtle bg-surface-panel/95 px-4 py-3 text-center">
        <p className="font-mono text-meta font-semibold uppercase tracking-eyebrow text-content-secondary">
          {headline}
        </p>
        <p className="mt-2 font-mono text-data font-semibold text-content-primary">
          {t("chart.noSyntheticTitle")}
        </p>
        <p className="mt-2 text-meta leading-5 text-content-secondary">{reason}</p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2 font-mono text-meta uppercase tracking-eyebrow text-content-secondary">
          <span className="border border-border-subtle bg-surface-interactive px-2 py-1">
            {t("chart.requested", { timeframe: timeframe.toUpperCase() })}
          </span>
          {statusMessage ? (
            <span className="border border-border-subtle bg-surface-interactive px-2 py-1 text-content-secondary">
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

function formatChartTimestamp(value: string | undefined, locale: "tr" | "en" = "en") {
  if (!value) {
    return locale === "tr" ? "önbellekte" : "cached";
  }

  const timestamp = new Date(value);

  if (Number.isNaN(timestamp.getTime())) {
    return locale === "tr" ? "önbellekte" : "cached";
  }

  return timestamp.toLocaleTimeString(locale === "tr" ? "tr-TR" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC"
  });
}

function formatCandleTime(timestamp: number, locale: "tr" | "en" = "en") {
  const value = new Date(timestamp * 1000);
  return Number.isNaN(value.getTime())
    ? "N/A"
    : value.toLocaleTimeString(locale === "tr" ? "tr-TR" : "en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
}

function formatCandleTimestamp(timestamp: number, locale: "tr" | "en" = "en") {
  const value = new Date(timestamp * 1000);
  return Number.isNaN(value.getTime())
    ? (locale === "tr" ? "Zaman damgası yok" : "Timestamp unavailable")
    : value.toLocaleString(locale === "tr" ? "tr-TR" : "en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }) + " UTC";
}

function formatPairCreatedAt(pair: BasePair, locale: "tr" | "en" = "en", t?: ReturnType<typeof useI18n>["t"]) {
  if (!pair.pairCreatedAt) {
    return pair.age === "N/A" ? (t?.("workspace.ageUnavailable") ?? "Age unavailable") : (t?.("workspace.publicFeed") ?? "Public feed");
  }

  const timestamp = new Date(pair.pairCreatedAt);

  if (Number.isNaN(timestamp.getTime())) {
    return t?.("workspace.publicFeed") ?? "Public feed";
  }

  return timestamp.toLocaleDateString(locale === "tr" ? "tr-TR" : "en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    timeZone: "UTC"
  });
}
