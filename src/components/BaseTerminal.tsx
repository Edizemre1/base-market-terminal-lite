"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Copy, LockKeyhole, RefreshCw, Settings, ShieldCheck, Star } from "lucide-react";
import type { MarketTerminalSnapshot } from "@/data/providers";
import type { PairChartResult } from "@/data/providers/chart/types";
import { cx, formatCompactCurrency, formatNumber, formatPercent } from "@/lib/format";
import type { BasePair } from "@/types/baseTerminal";

type FeedKind = "new" | "inflow" | "momentum";
type DetailTab = "overview" | "risk" | "liquidity" | "activity";
type ChartRefreshStatus = "idle" | "refreshing" | "updated" | "using-last";

const tabs: Array<{ id: DetailTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "risk", label: "Risk" },
  { id: "liquidity", label: "Liquidity" },
  { id: "activity", label: "Activity" }
];

export function BaseTerminal({ data }: { data: MarketTerminalSnapshot }) {
  const [selectedPairId, setSelectedPairId] = useState(data.defaultPairId);
  const [activeTab, setActiveTab] = useState<DetailTab>("risk");
  const [amount, setAmount] = useState("0.10");
  const [chartOverrides, setChartOverrides] = useState<Record<string, Partial<BasePair>>>({});
  const [chartRefreshStatus, setChartRefreshStatus] = useState<Record<string, ChartRefreshStatus>>({});

  useEffect(() => {
    setSelectedPairId(data.defaultPairId);
  }, [data.defaultPairId]);

  const selectedPair =
    data.allPairs.find((pair) => pair.id === selectedPairId) ?? data.allPairs[0];
  const selectedPairWithChart = useMemo(
    () =>
      selectedPair
        ? {
            ...selectedPair,
            ...chartOverrides[selectedPair.id]
          }
        : undefined,
    [chartOverrides, selectedPair]
  );
  const amountNumber = Number.parseFloat(amount);
  const cleanAmount = Number.isFinite(amountNumber) && amountNumber > 0 ? amountNumber : 0;
  const estimatedOutput = useMemo(() => {
    if (!selectedPairWithChart) {
      return 0;
    }

    const base = selectedPairWithChart.liquidity / Math.max(selectedPairWithChart.riskScore, 1);
    return cleanAmount * base * selectedPairWithChart.volumeMultiple;
  }, [cleanAmount, selectedPairWithChart]);

  async function handleRefreshChart(pair: BasePair) {
    setChartRefreshStatus((current) => ({ ...current, [pair.id]: "refreshing" }));

    try {
      const response = await fetch("/api/chart", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: pair.id,
          mode: data.mode,
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
        data.mode === "dexscreener" &&
        pair.dataSource === "dexscreener" &&
        Boolean(pair.pairAddress);

      if (expectedReadOnlyOhlcv && result.source !== "geckoterminal") {
        setChartRefreshStatus((current) => ({ ...current, [pair.id]: "using-last" }));
        return;
      }

      setChartOverrides((current) => ({
        ...current,
        [pair.id]: {
          chart: result.candles.map((candle) => candle.close),
          chartCandles: result.candles,
          chartSource: result.source,
          chartLabel: result.label,
          chartUpdatedAt: result.updatedAt,
          chartUnavailableReason: result.unavailableReason
        }
      }));
      setChartRefreshStatus((current) => ({ ...current, [pair.id]: "updated" }));
    } catch {
      setChartRefreshStatus((current) => ({ ...current, [pair.id]: "using-last" }));
    }
  }

  if (!selectedPairWithChart) {
    return (
      <main className="terminal-main-frame min-h-[calc(100vh-40px)] w-full overflow-x-hidden bg-base-black p-2">
        <section className="border border-base-line bg-base-panel p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-base-muted">
            Base Terminal Lite
          </p>
          <p className="mt-2 font-mono text-sm text-base-text">
            No demo pairs are available from the active read-only provider.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="terminal-main-frame flex min-h-[calc(100vh-40px)] w-full flex-col overflow-x-hidden bg-base-black p-2">
      {data.fallbackReason ? (
        <div className="mb-2 shrink-0 border border-base-amber/45 bg-base-amber/10 px-2 py-1.5 font-mono text-[10px] tracking-[0.12em] text-base-amber">
          {data.fallbackReason}
        </div>
      ) : null}
      <section className="terminal-main-grid grid min-w-0 grid-cols-1 gap-2.5">
        <aside className="terminal-left-column min-w-0 space-y-2">
          <OpportunityFeed
            id="new-pairs"
            title="New Pairs"
            marker="A"
            kind="new"
            pairs={data.newPairs}
            showFallbackLabels={data.mode === "dexscreener"}
            selectedPairId={selectedPairWithChart.id}
            onSelect={setSelectedPairId}
          />
          <OpportunityFeed
            title="Volume Inflow"
            marker="B"
            kind="inflow"
            pairs={data.volumeInflows}
            showFallbackLabels={data.mode === "dexscreener"}
            selectedPairId={selectedPairWithChart.id}
            onSelect={setSelectedPairId}
          />
          <OpportunityFeed
            title="Momentum"
            marker="C"
            kind="momentum"
            pairs={data.momentumPairs}
            showFallbackLabels={data.mode === "dexscreener"}
            selectedPairId={selectedPairWithChart.id}
            onSelect={setSelectedPairId}
          />
        </aside>

        <section className="terminal-center-column min-w-0 space-y-2">
          <SelectedPairPanel
            pair={selectedPairWithChart}
            marketDataMode={data.mode}
            chartRefreshStatus={chartRefreshStatus[selectedPairWithChart.id] ?? "idle"}
            onRefreshChart={handleRefreshChart}
          />
          <PairDetailTabs
            pair={selectedPairWithChart}
            activeTab={activeTab}
            onTabChange={setActiveTab}
          />
        </section>

        <SwapTicket
          pair={selectedPairWithChart}
          marketDataMode={data.mode}
          amount={amount}
          onAmountChange={setAmount}
          estimatedOutput={estimatedOutput}
        />
      </section>
    </main>
  );
}

function OpportunityFeed({
  id,
  title,
  marker,
  kind,
  pairs,
  showFallbackLabels,
  selectedPairId,
  onSelect
}: {
  id?: string;
  title: string;
  marker: string;
  kind: FeedKind;
  pairs: BasePair[];
  showFallbackLabels: boolean;
  selectedPairId: string;
  onSelect: (id: string) => void;
}) {
  const livePairs =
    showFallbackLabels ? pairs.filter((pair) => pair.dataSource !== "mock") : pairs;
  const fallbackPairs =
    showFallbackLabels ? pairs.filter((pair) => pair.dataSource === "mock") : [];

  return (
    <section id={id} className="terminal-feed-panel flex min-h-0 flex-col overflow-hidden border border-base-line bg-base-panel">
      <div className="flex min-h-8 shrink-0 items-center justify-between border-b border-base-line bg-base-raised px-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-base-muted">{marker}</span>
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-base-text">
            {title}
          </h2>
        </div>
        <span className="border border-base-mint/40 bg-base-mint/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-base-mint">
          View all
        </span>
      </div>
      <div className="grid shrink-0 grid-cols-[minmax(104px,1.4fr)_34px_56px_56px_44px] border-b border-base-line bg-base-elevated px-2 py-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-base-muted">
        <span>Pair</span>
        <span>Age</span>
        <span className="text-right">Liquidity</span>
        <span className="text-right">24h Vol</span>
        <span className="text-right">{kind === "momentum" ? "Score" : "Delta"}</span>
      </div>
      <div className="terminal-feed-body min-h-0">
        {livePairs.map((pair) => (
          <FeedRow
            key={`${title}-${pair.id}`}
            kind={kind}
            pair={pair}
            selectedPairId={selectedPairId}
            onSelect={onSelect}
          />
        ))}

        {livePairs.length === 0 && fallbackPairs.length === 0 ? (
          <FeedEmptyState kind={kind} />
        ) : null}

        {fallbackPairs.length > 0 ? (
          <div className="border-b border-base-line bg-base-amber/10 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-base-amber">
            Demo fallback
          </div>
        ) : null}

        {fallbackPairs.map((pair) => (
          <FeedRow
            key={`${title}-fallback-${pair.id}`}
            kind={kind}
            pair={pair}
            selectedPairId={selectedPairId}
            onSelect={onSelect}
            isFallbackRow
          />
        ))}
      </div>
    </section>
  );
}

function FeedEmptyState({ kind }: { kind: FeedKind }) {
  if (kind === "new") {
    return (
      <div className="border-b border-base-line px-2 py-4 text-[11px] text-base-muted last:border-b-0">
        <p className="font-mono text-base-text">No qualified new Base pairs found.</p>
        <p className="mt-1">Try Volume Inflow or Momentum.</p>
      </div>
    );
  }

  return (
    <div className="border-b border-base-line px-2 py-4 text-[11px] text-base-muted last:border-b-0">
      <p className="font-mono text-base-text">No qualified pairs found.</p>
      <p className="mt-1">Read-only market data is limited right now.</p>
    </div>
  );
}

function FeedRow({
  kind,
  pair,
  selectedPairId,
  onSelect,
  isFallbackRow = false
}: {
  kind: FeedKind;
  pair: BasePair;
  selectedPairId: string;
  onSelect: (id: string) => void;
  isFallbackRow?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(pair.id)}
      className={cx(
        "grid min-h-10 w-full grid-cols-[minmax(104px,1.4fr)_34px_56px_56px_44px] items-center border-b border-base-line px-2 py-1 text-left text-[11px] last:border-b-0 hover:bg-base-mint/5",
        selectedPairId === pair.id && "bg-base-mint/10"
      )}
    >
      <span className="flex min-w-0 items-start gap-1.5">
        <span
          className={cx(
            "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
            isFallbackRow ? "bg-base-amber" : "bg-base-mint"
          )}
        />
        <span className="min-w-0">
          <span className="block truncate font-mono font-semibold text-base-text">
            {pair.pair}
          </span>
          <span
            className={cx(
              "block truncate text-[9px] leading-3",
              isFallbackRow ? "font-mono text-base-amber" : "text-base-muted"
            )}
          >
            {getFeedRowSubtitle(pair, isFallbackRow)}
          </span>
        </span>
      </span>
      <span className="font-mono text-[10px] text-base-muted">{pair.age}</span>
      <span className="text-right font-mono text-[10px] text-base-text">
        {formatCompactCurrency(pair.liquidity)}
      </span>
      <span className="text-right font-mono text-[10px] text-base-text">
        {formatCompactCurrency(pair.volume24h)}
      </span>
      <span
        className={cx(
          "text-right font-mono text-[10px]",
          pair.change24h >= 0 ? "text-base-mint" : "text-base-rose"
        )}
      >
        {kind === "momentum"
          ? pair.momentumScore
          : kind === "inflow"
            ? `+${formatCompactCurrency(pair.inflow24h)}`
            : formatPercent(pair.change24h)}
      </span>
    </button>
  );
}

function getFeedRowSubtitle(pair: BasePair, isFallbackRow: boolean) {
  if (isFallbackRow) {
    return `Demo fallback - ${pair.dex}`;
  }

  return pair.project && pair.project !== pair.baseToken
    ? `${pair.project} - ${pair.dex}`
    : pair.dex;
}

function SelectedPairPanel({
  pair,
  marketDataMode,
  chartRefreshStatus,
  onRefreshChart
}: {
  pair: BasePair;
  marketDataMode: MarketTerminalSnapshot["mode"];
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
    <section className="terminal-selected-panel flex min-h-0 flex-col overflow-hidden border border-base-line bg-base-panel">
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
          detail="+262%"
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
        <Metric label="Age" value={pair.age} detail="New" />
        <Metric label="Risk score" value={`${pair.riskScore} / 100`} detail={pair.riskLabel} tone="mint" />
      </div>

      <div className="terminal-selected-body flex min-h-0 flex-1 flex-col gap-2 p-2">
        <MockChart
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

function MockChart({
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
    refreshStatus === "using-last"
      ? "Using last available chart"
      : pair.chartUnavailableReason && pair.chartSource !== "geckoterminal"
        ? "Using synthetic fallback"
        : undefined;

  return (
    <div className="terminal-chart-panel market-scanline flex min-h-[280px] flex-1 flex-col overflow-hidden border border-base-line bg-base-panel">
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
        className="terminal-chart-svg h-[235px] w-full max-w-full shrink-0 p-2"
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

function SwapTicket({
  pair,
  marketDataMode,
  amount,
  onAmountChange,
  estimatedOutput
}: {
  pair: BasePair;
  marketDataMode: MarketTerminalSnapshot["mode"];
  amount: string;
  onAmountChange: (value: string) => void;
  estimatedOutput: number;
}) {
  const modeWarning =
    marketDataMode === "dexscreener"
      ? "Read-only market data. No real funds will be used."
      : "This is demo data. No real funds will be used.";
  const modeLabel =
    marketDataMode === "dexscreener"
      ? "Read-only mode - no transaction will be sent"
      : "Demo mode - no transaction will be sent";

  return (
    <aside className="terminal-swap-ticket min-w-0 border border-base-line bg-base-panel">
      <div className="flex min-h-10 shrink-0 items-center justify-between border-b border-base-line bg-base-raised px-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-base-muted">
            Swap selected pair
          </p>
          <h2 className="text-[12px] font-semibold text-base-text">{pair.pair}</h2>
        </div>
        <Settings size={14} className="text-base-muted" aria-hidden="true" />
      </div>

      <div className="terminal-swap-body flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3">
        <TokenBox
          label="From"
          token={pair.quoteToken}
          sublabel="Base"
          rightLabel={`Max: 0.2451 ${pair.quoteToken}`}
          value={amount}
          onValueChange={onAmountChange}
        />

        <div className="flex shrink-0 justify-center">
          <span className="grid h-7 w-7 place-items-center border border-base-line bg-base-panel font-mono text-base-muted">
            v
          </span>
        </div>

        <TokenBox
          label="To (Estimated)"
          token={pair.baseToken}
          sublabel="Base"
          value={formatNumber(estimatedOutput)}
          readOnly
        />

        <div className="border border-base-line bg-base-elevated p-2">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-base-muted">
              Route preview (best)
            </p>
            <span className="border border-base-mint/40 bg-base-mint/10 px-1.5 py-0.5 font-mono text-[10px] text-base-mint">
              100%
            </span>
          </div>
          <RouteRow label={pair.dex} value={pair.route} />
          <RouteRow label="Price impact" value="-0.24%" tone="mint" />
          <RouteRow label="Minimum received" value={`${formatNumber(estimatedOutput * 0.99)} ${pair.baseToken}`} />
          <RouteRow label="Network fee (est.)" value="$0.84" />
        </div>

        <div className="space-y-1.5 text-[11px]">
          <RouteRow label="Slippage tolerance" value="0.50%" />
          <RouteRow label="Price impact" value="-0.24%" tone="mint" />
          <RouteRow label="Platform fee" value="0.10% (Est. $0.33)" />
        </div>

        <div className="terminal-swap-footer mt-auto space-y-2 pt-1">
          <div className="border border-base-amber/45 bg-base-amber/10 p-2 text-[11px] leading-4 text-base-muted">
            Low liquidity: higher price impact and slippage risk. {modeWarning}
          </div>

          <button
            type="button"
            disabled
            className="flex h-9 w-full items-center justify-center gap-2 border border-base-line bg-base-raised text-[12px] font-semibold text-base-muted"
          >
            <LockKeyhole size={14} aria-hidden="true" />
            Review Swap
          </button>

          <p className="text-center font-mono text-[10px] uppercase tracking-[0.12em] text-base-muted">
            {modeLabel}
          </p>
        </div>
      </div>
    </aside>
  );
}

function TokenBox({
  label,
  token,
  sublabel,
  rightLabel,
  value,
  onValueChange,
  readOnly = false
}: {
  label: string;
  token: string;
  sublabel: string;
  rightLabel?: string;
  value: string;
  onValueChange?: (value: string) => void;
  readOnly?: boolean;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.12em] text-base-muted">
        <span>{label}</span>
        {rightLabel ? <span className="font-mono text-base-mint">{rightLabel}</span> : null}
      </div>
      <div className="grid min-w-0 grid-cols-[104px_minmax(0,1fr)] border border-base-line bg-base-panel 2xl:grid-cols-[116px_minmax(0,1fr)]">
        <div className="flex min-w-0 items-center gap-2 border-r border-base-line bg-base-elevated px-2 py-1.5">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-base-mint/15 font-mono text-[10px] font-semibold text-base-mint">
            {token.slice(0, 2)}
          </span>
          <div className="min-w-0">
            <p className="truncate font-mono text-[13px] font-semibold text-base-text">{token}</p>
            <p className="text-[10px] text-base-muted">{sublabel}</p>
          </div>
        </div>
        <input
          value={value}
          readOnly={readOnly}
          inputMode="decimal"
          onChange={(event) => onValueChange?.(event.target.value)}
          className="h-12 min-w-0 bg-base-panel px-3 text-right font-mono text-[17px] text-base-text outline-none 2xl:text-[19px]"
        />
      </div>
    </label>
  );
}

function RouteRow({
  label,
  value,
  tone = "default"
}: {
  label: string;
  value: string;
  tone?: "default" | "mint";
}) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-2 border-b border-base-line py-1 last:border-b-0">
      <span className="min-w-0 text-[11px] text-base-muted">{label}</span>
      <span
        className={cx(
          "max-w-[62%] break-words text-right font-mono text-[11px] font-semibold leading-4",
          tone === "mint" ? "text-base-mint" : "text-base-text"
        )}
      >
        {value}
      </span>
    </div>
  );
}

function PairDetailTabs({
  pair,
  activeTab,
  onTabChange
}: {
  pair: BasePair;
  activeTab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
}) {
  return (
    <section id="risk" className="terminal-detail-tabs flex min-h-0 flex-col overflow-hidden border border-base-line bg-base-panel">
      <div className="grid h-8 shrink-0 grid-cols-4 border-b border-base-line bg-base-raised">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={cx(
              "h-full min-w-0 border-r border-base-line px-2 text-[11px] font-semibold uppercase tracking-[0.14em] last:border-r-0",
              activeTab === tab.id
                ? "bg-base-panel text-base-mint"
                : "text-base-muted hover:text-base-text"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="terminal-detail-body min-h-0 flex-1 overflow-y-auto p-2">{renderTab(pair, activeTab)}</div>
    </section>
  );
}

function renderTab(pair: BasePair, activeTab: DetailTab) {
  if (activeTab === "overview") {
    return (
      <div className="grid gap-2 md:grid-cols-4">
        <OverviewCell label="Pair" value={pair.pair} />
        <OverviewCell label="DEX" value={pair.dex} />
        <OverviewCell label="Route" value={pair.route} />
        <OverviewCell label="Risk" value={`${pair.riskScore} / 100`} />
      </div>
    );
  }

  if (activeTab === "liquidity") {
    return (
      <div className="grid gap-2 md:grid-cols-4">
        <OverviewCell label="Pool liquidity" value={pair.liquidityDetail.poolLiquidity} />
        <OverviewCell label="LP change" value={pair.liquidityDetail.lpChange} />
        <OverviewCell label="Depth" value={pair.liquidityDetail.depth} />
        <OverviewCell label="Route source" value={pair.liquidityDetail.routeSource} />
      </div>
    );
  }

  if (activeTab === "activity") {
    return (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left text-[11px]">
          <thead>
            <tr className="border-b border-base-line bg-base-elevated text-[10px] uppercase tracking-[0.12em] text-base-muted">
              <th className="px-2 py-1.5">Time</th>
              <th className="px-2 py-1.5">Side</th>
              <th className="px-2 py-1.5">Amount</th>
              <th className="px-2 py-1.5">Value</th>
              <th className="px-2 py-1.5">Wallet</th>
            </tr>
          </thead>
          <tbody>
            {pair.activity.map((event) => (
              <tr key={`${event.time}-${event.wallet}`} className="h-8 border-b border-base-line last:border-b-0">
                <td className="px-2 py-1.5 font-mono text-base-muted">{event.time}</td>
                <td
                  className={cx(
                    "px-2 py-1.5 font-mono uppercase",
                    event.side === "buy" ? "text-base-mint" : "text-base-rose"
                  )}
                >
                  {event.side}
                </td>
                <td className="px-2 py-1.5 font-mono text-base-text">{event.amount}</td>
                <td className="px-2 py-1.5 font-mono text-base-text">{event.value}</td>
                <td className="px-2 py-1.5 font-mono text-base-muted">{event.wallet}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr_1fr]">
      <div>
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-base-muted">
          Contract Risk
        </h3>
        <div className="space-y-1">
          {pair.riskChecks.slice(0, 4).map((check) => (
            <RiskRow key={check.label} label={check.label} value={check.value} ok={check.ok} />
          ))}
        </div>
      </div>
      <div>
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-base-muted">
          Holder Concentration
        </h3>
        <RiskRow label="Top 10 Holders" value={pair.holders.top10} ok />
        <RiskRow label="Top 50 Holders" value={pair.holders.top50} ok />
        <RiskRow label="Top 100 Holders" value={pair.holders.top100} ok={pair.riskScore < 50} />
        <RiskRow label="Active Holders (24h)" value={pair.holders.active24h} ok />
      </div>
      <div>
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-base-muted">
          LP & Security
        </h3>
        <RiskRow label="LP Provider" value={pair.dex} ok />
        <RiskRow label="LP Lock" value={pair.lpLock.status} ok={pair.riskScore < 50} />
        <RiskRow label="Lock Provider" value={pair.lpLock.provider} ok />
        <RiskRow label="Lock Expires" value={pair.lpLock.expires} ok />
      </div>
      <div>
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-base-muted">
          Safety Summary
        </h3>
        <div className="flex items-center gap-4">
          <div
            className="grid h-20 w-20 place-items-center rounded-full border border-base-line"
            style={{
              background: `conic-gradient(rgb(var(--color-mint)) ${(100 - pair.riskScore) * 3.6}deg, rgb(var(--color-raised)) 0deg)`
            }}
          >
            <div className="grid h-12 w-12 place-items-center rounded-full border border-base-line bg-base-panel">
              <span className="font-mono text-lg font-semibold text-base-mint">
                {pair.riskScore}
              </span>
            </div>
          </div>
          <div className="space-y-1 text-[11px] text-base-muted">
            <p><span className="text-base-mint">0-30</span> Low</p>
            <p><span className="text-base-amber">31-60</span> Medium</p>
            <p><span className="text-base-rose">61-100</span> High</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function OverviewCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-base-line bg-base-elevated p-2">
      <p className="text-[10px] uppercase tracking-[0.12em] text-base-muted">{label}</p>
      <p className="mt-1 font-mono text-[13px] font-semibold text-base-text">{value}</p>
    </div>
  );
}

function RiskRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="grid grid-cols-[1fr_auto_18px] items-center gap-2 border-b border-base-line py-1 text-[11px] last:border-b-0">
      <span className="text-base-text">{label}</span>
      <span className="font-mono text-base-text">{value}</span>
      <ShieldCheck
        size={13}
        className={ok ? "text-base-mint" : "text-base-amber"}
        aria-hidden="true"
      />
    </div>
  );
}
