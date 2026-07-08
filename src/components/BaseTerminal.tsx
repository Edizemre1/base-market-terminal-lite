"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Copy, LockKeyhole, Settings, ShieldCheck, Star } from "lucide-react";
import type { MarketTerminalSnapshot } from "@/data/providers";
import { cx, formatCompactCurrency, formatNumber, formatPercent } from "@/lib/format";
import type { BasePair } from "@/types/baseTerminal";

type FeedKind = "new" | "inflow" | "momentum";
type DetailTab = "overview" | "risk" | "liquidity" | "activity";

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
  const selectedPair =
    data.allPairs.find((pair) => pair.id === selectedPairId) ?? data.allPairs[0];
  const amountNumber = Number.parseFloat(amount);
  const cleanAmount = Number.isFinite(amountNumber) && amountNumber > 0 ? amountNumber : 0;
  const estimatedOutput = useMemo(() => {
    if (!selectedPair) {
      return 0;
    }

    const base = selectedPair.liquidity / Math.max(selectedPair.riskScore, 1);
    return cleanAmount * base * selectedPair.volumeMultiple;
  }, [cleanAmount, selectedPair]);

  if (!selectedPair) {
    return (
      <main className="min-h-[calc(100vh-40px)] w-full overflow-x-hidden bg-base-black p-2">
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
    <main className="min-h-[calc(100vh-40px)] w-full overflow-x-hidden bg-base-black p-2">
      {data.fallbackReason ? (
        <div className="mb-2 border border-base-amber/45 bg-base-amber/10 px-2 py-1.5 font-mono text-[10px] tracking-[0.12em] text-base-amber">
          {data.fallbackReason}
        </div>
      ) : null}
      <section className="grid min-h-[610px] min-w-0 grid-cols-1 gap-2.5 xl:grid-cols-[300px_minmax(0,1fr)_390px] 2xl:grid-cols-[320px_minmax(0,1fr)_410px]">
        <aside className="min-w-0 space-y-2">
          <OpportunityFeed
            id="new-pairs"
            title="New Pairs"
            marker="A"
            kind="new"
            pairs={data.newPairs}
            selectedPairId={selectedPair.id}
            onSelect={setSelectedPairId}
          />
          <OpportunityFeed
            title="Volume Inflow"
            marker="B"
            kind="inflow"
            pairs={data.volumeInflows}
            selectedPairId={selectedPair.id}
            onSelect={setSelectedPairId}
          />
          <OpportunityFeed
            title="Momentum"
            marker="C"
            kind="momentum"
            pairs={data.momentumPairs}
            selectedPairId={selectedPair.id}
            onSelect={setSelectedPairId}
          />
        </aside>

        <section className="min-w-0 space-y-2">
          <SelectedPairPanel pair={selectedPair} marketDataMode={data.mode} />
          <PairDetailTabs
            pair={selectedPair}
            activeTab={activeTab}
            onTabChange={setActiveTab}
          />
        </section>

        <SwapTicket
          pair={selectedPair}
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
  selectedPairId,
  onSelect
}: {
  id?: string;
  title: string;
  marker: string;
  kind: FeedKind;
  pairs: BasePair[];
  selectedPairId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <section id={id} className="border border-base-line bg-base-panel">
      <div className="flex min-h-8 items-center justify-between border-b border-base-line bg-base-raised px-2">
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
      <div className="grid grid-cols-[minmax(0,1fr)_42px_68px_70px_58px] border-b border-base-line bg-base-elevated px-2 py-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-base-muted">
        <span>Pair</span>
        <span>Age</span>
        <span className="text-right">Liquidity</span>
        <span className="text-right">24h Vol</span>
        <span className="text-right">{kind === "momentum" ? "Score" : "Delta"}</span>
      </div>
      <div>
        {pairs.map((pair) => (
          <button
            key={`${title}-${pair.id}`}
            type="button"
            onClick={() => onSelect(pair.id)}
            className={cx(
              "grid h-8 w-full grid-cols-[minmax(0,1fr)_42px_68px_70px_58px] items-center border-b border-base-line px-2 text-left text-[11px] last:border-b-0 hover:bg-base-mint/5",
              selectedPairId === pair.id && "bg-base-mint/10"
            )}
          >
            <span className="flex min-w-0 items-center gap-1.5 font-mono font-semibold text-base-text">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-base-mint" />
              <span className="truncate">{pair.pair}</span>
            </span>
            <span className="font-mono text-base-muted">{pair.age}</span>
            <span className="text-right font-mono text-base-text">
              {formatCompactCurrency(pair.liquidity)}
            </span>
            <span className="text-right font-mono text-base-text">
              {formatCompactCurrency(pair.volume24h)}
            </span>
            <span
              className={cx(
                "text-right font-mono",
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
        ))}
      </div>
    </section>
  );
}

function SelectedPairPanel({
  pair,
  marketDataMode
}: {
  pair: BasePair;
  marketDataMode: MarketTerminalSnapshot["mode"];
}) {
  const readOnlyDetail = marketDataMode === "dexscreener" ? "Read-only feed" : "+mock";

  return (
    <section className="border border-base-line bg-base-panel">
      <div className="flex min-h-10 items-center justify-between gap-3 border-b border-base-line bg-base-raised px-3">
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

      <div className="grid gap-1 border-b border-base-line p-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
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

      <div className="p-2">
        <MockChart pair={pair} />
        <div className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
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

function MockChart({ pair }: { pair: BasePair }) {
  const width = 720;
  const height = 250;
  const min = Math.min(...pair.chart);
  const max = Math.max(...pair.chart);
  const spread = max - min || 1;
  const step = width / Math.max(pair.chart.length - 1, 1);
  const path = pair.chart
    .map((point, index) => {
      const x = index * step;
      const y = height - ((point - min) / spread) * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <div className="market-scanline border border-base-line bg-base-panel">
      <div className="flex items-center justify-between border-b border-base-line bg-base-raised px-2 py-1.5">
        <div>
          <p className="font-mono text-[12px] font-semibold text-base-text">
            {pair.pair.replace(" / ", "/")} - 1h chart preview - {pair.dex} (Base)
          </p>
          <p className="font-mono text-[10px] text-base-mint">
            O {pair.price} H {pair.price} L {pair.price} C {pair.price} {formatPercent(pair.change24h)}
          </p>
          <p className="font-mono text-[10px] text-base-muted">
            Synthetic preview path; live OHLCV is not connected.
          </p>
        </div>
        <span className="border border-base-mint/40 bg-base-mint/10 px-1.5 py-0.5 font-mono text-[10px] text-base-mint">
          Volume {formatCompactCurrency(pair.volume24h)}
        </span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[270px] w-full max-w-full p-2" aria-hidden="true">
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
        {pair.chart.map((point, index) => {
          const x = index * step;
          const y = height - ((point - min) / spread) * height;
          const positive = index === 0 || point >= pair.chart[index - 1];
          return (
            <g key={`c-${index}`}>
              <line
                x1={x}
                x2={x}
                y1={Math.max(0, y - 18)}
                y2={Math.min(height, y + 18)}
                stroke={positive ? "rgb(var(--color-mint))" : "rgb(var(--color-rose))"}
                strokeWidth="1"
              />
              <rect
                x={x - 3}
                y={positive ? y - 10 : y}
                width="6"
                height="10"
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
    <div className="min-h-[92px] border border-base-line bg-base-panel p-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-base-muted">
          {label}
        </p>
        {icon ? <span className="text-base-mint">{icon}</span> : null}
      </div>
      <p className="mt-3 font-mono text-[14px] font-semibold text-base-text">{value}</p>
      {bar !== undefined ? (
        <div className="mt-2 h-1.5 bg-base-elevated">
          <div className="h-full bg-base-mint" style={{ width: `${clamped}%` }} />
        </div>
      ) : null}
      <p className="mt-2 text-[11px] text-base-muted">{detail}</p>
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
    <aside className="sticky top-12 min-w-0 self-start border border-base-line bg-base-panel">
      <div className="flex min-h-10 items-center justify-between border-b border-base-line bg-base-raised px-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-base-muted">
            Swap selected pair
          </p>
          <h2 className="text-[12px] font-semibold text-base-text">{pair.pair}</h2>
        </div>
        <Settings size={14} className="text-base-muted" aria-hidden="true" />
      </div>

      <div className="space-y-3 p-3">
        <TokenBox
          label="From"
          token={pair.quoteToken}
          sublabel="Base"
          rightLabel={`Max: 0.2451 ${pair.quoteToken}`}
          value={amount}
          onValueChange={onAmountChange}
        />

        <div className="flex justify-center">
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
      <div className="grid min-w-0 grid-cols-[108px_minmax(0,1fr)] border border-base-line bg-base-panel 2xl:grid-cols-[120px_minmax(0,1fr)]">
        <div className="flex min-w-0 items-center gap-2 border-r border-base-line bg-base-elevated px-2 py-2">
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
          className="h-14 min-w-0 bg-base-panel px-3 text-right font-mono text-[18px] text-base-text outline-none 2xl:text-[20px]"
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
    <section id="risk" className="border border-base-line bg-base-panel">
      <div className="grid h-9 grid-cols-4 border-b border-base-line bg-base-raised">
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
      <div className="p-3">{renderTab(pair, activeTab)}</div>
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
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr_1fr_1fr]">
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
