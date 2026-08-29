"use client";

import { Clock3, Radio, Star } from "lucide-react";
import { useMemo, useState } from "react";
import { PairAvatarStack } from "@/components/TokenIdentity";
import type { MarketTerminalSnapshot } from "@/data/providers";
import {
  calculateActivityScore,
  getChange24h,
  getLiquidityUsd,
  getPairAgeMinutes,
  getVolume24h
} from "@/lib/base-terminal/discovery";
import { isQualifiedMarket, type PulseSignal } from "@/lib/base-terminal/pulse";
import { cx, formatCompactCurrency, formatPercent } from "@/lib/format";
import type { BasePair } from "@/types/baseTerminal";

type OpportunityTab =
  | "breaking"
  | "fresh"
  | "volume"
  | "momentum"
  | "liquidity"
  | "leaders"
  | "watchlist"
  | "since";

type OpportunityItem = {
  pair: BasePair;
  signal?: PulseSignal;
  reason: string;
};

const OPPORTUNITY_TABS: Array<{ id: OpportunityTab; label: string }> = [
  { id: "breaking", label: "Breaking Now" },
  { id: "fresh", label: "Fresh on Base" },
  { id: "volume", label: "Volume Bursts" },
  { id: "momentum", label: "Gaining Momentum" },
  { id: "liquidity", label: "Liquidity Movers" },
  { id: "leaders", label: "Established Leaders" },
  { id: "watchlist", label: "Watchlist Moves" },
  { id: "since", label: "Since Last Visit" }
];

export function LivePulseStrip({
  snapshot,
  signals,
  onSelect
}: {
  snapshot: MarketTerminalSnapshot;
  signals: PulseSignal[];
  onSelect: (id: string) => void;
}) {
  const visibleSignals = signals.slice(0, 8);

  return (
    <section className="pulse-surface overflow-hidden rounded-xl" data-testid="live-pulse-strip" aria-label="Live Pulse">
      <div className="flex items-center justify-between gap-3 px-3 pb-2 pt-3 sm:px-4">
        <div className="flex items-center gap-2">
          <span className="relative grid h-7 w-7 place-items-center rounded-full bg-base-mint/10 text-base-mint">
            <Radio size={14} aria-hidden="true" />
            <span className="absolute right-0 top-0 h-2 w-2 rounded-full bg-base-mint shadow-[0_0_10px_rgb(var(--color-mint)/0.75)]" />
          </span>
          <div>
            <h2 className="text-[12px] font-bold tracking-[0.08em] text-base-text">LIVE PULSE</h2>
            <p className="text-[10px] text-base-muted">Verified changes · {snapshot.providerName}</p>
          </div>
        </div>
        <Freshness timestamp={snapshot.sourceUpdatedAt} delayed={snapshot.freshness === "delayed"} />
      </div>

      <div className="flex snap-x gap-2 overflow-x-auto px-3 pb-3 sm:px-4" data-testid="pulse-event-list">
        {visibleSignals.length > 0 ? visibleSignals.map((signal) => (
          <button
            key={signal.key}
            type="button"
            disabled={!signal.pairId}
            onClick={() => signal.pairId && onSelect(signal.pairId)}
            className="pulse-event min-w-[250px] snap-start rounded-lg bg-base-elevated/70 px-3 py-2.5 text-left outline-none transition hover:bg-base-raised focus-visible:ring-2 focus-visible:ring-base-mint/50 disabled:cursor-default"
          >
            <div className="flex items-center justify-between gap-2">
              <span className={cx("text-[10px] font-bold uppercase tracking-[0.1em]", signalTone(signal))}>{formatSignalType(signal.type)}</span>
              <span className="font-mono text-[10px] text-base-muted">{relativeAge(signal.createdAt)}</span>
            </div>
            <p className="mt-1 truncate text-[13px] font-semibold text-base-text">{signal.pair ?? signal.headline}</p>
            <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-base-muted">{signal.detail}</p>
          </button>
        )) : (
          <div className="min-w-full rounded-lg bg-base-elevated/55 px-3 py-3 sm:min-w-[420px]">
            <p className="flex items-center gap-2 text-[12px] font-semibold text-base-text"><Clock3 size={13} className="text-base-mint" /> Listening for the next verified change</p>
            <p className="mt-1 text-[11px] text-base-muted">No change event is invented for the first snapshot. The terminal will compare the next healthy snapshot with this baseline.</p>
          </div>
        )}
      </div>
    </section>
  );
}

export function OpportunityStream({
  snapshot,
  signals,
  sinceLastSignals,
  onSelect,
  isPairPinned,
  onTogglePin
}: {
  snapshot: MarketTerminalSnapshot;
  signals: PulseSignal[];
  sinceLastSignals: PulseSignal[];
  onSelect: (id: string) => void;
  isPairPinned: (pair: BasePair) => boolean;
  onTogglePin: (pair: BasePair) => void;
}) {
  const [tab, setTab] = useState<OpportunityTab>("breaking");
  const items = useMemo(
    () => buildOpportunityItems(tab, snapshot, signals, sinceLastSignals, isPairPinned),
    [isPairPinned, signals, sinceLastSignals, snapshot, tab]
  );

  return (
    <section className="pulse-surface overflow-hidden rounded-xl" data-testid="opportunity-stream">
      <div className="flex flex-wrap items-end justify-between gap-3 px-3 pb-2 pt-3 sm:px-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-base-mint">Opportunity Stream</p>
          <h2 className="mt-1 text-[18px] font-semibold tracking-tight text-base-text">Why markets are surfacing now</h2>
          <p className="mt-1 text-[11px] text-base-muted">Evidence-backed discovery, never a buy or safety claim.</p>
        </div>
        <span className="font-mono text-[10px] text-base-muted">{items.length} verified candidates</span>
      </div>

      <div className="flex gap-1 overflow-x-auto px-3 pb-2 sm:flex-wrap sm:px-4" role="tablist" aria-label="Opportunity categories">
        {OPPORTUNITY_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            data-testid={`opportunity-tab-${item.id}`}
            className={cx(
              "min-h-9 shrink-0 rounded-full px-3 text-[11px] font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-base-mint/40",
              tab === item.id ? "bg-base-mint text-[#031411] shadow-[0_0_18px_rgb(var(--color-mint)/0.16)]" : "bg-base-elevated text-base-muted hover:text-base-text"
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="grid gap-2 px-3 pb-3 sm:grid-cols-2 sm:px-4 xl:grid-cols-3" data-testid="opportunity-cards">
        {items.length > 0 ? items.slice(0, 6).map(({ pair, signal, reason }) => (
          <article key={`${tab}-${pair.id}-${signal?.key ?? "baseline"}`} className="group rounded-lg bg-base-elevated/65 p-3 transition hover:bg-base-raised">
            <div className="flex items-start gap-2.5">
              <button type="button" onClick={() => onSelect(pair.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none">
                <PairAvatarStack baseSymbol={pair.baseToken} quoteSymbol={pair.quoteToken} baseLogoUrl={pair.tokenLogoUrl} quoteLogoUrl={pair.quoteTokenLogoUrl} size="md" />
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-semibold text-base-text">{pair.pair}</span>
                  <span className="block truncate text-[10px] text-base-muted">{pair.dexName ?? pair.dex} · {pair.age}</span>
                </span>
              </button>
              <button type="button" onClick={() => onTogglePin(pair)} aria-label={isPairPinned(pair) ? `Unpin ${pair.pair}` : `Pin ${pair.pair}`} className={cx("grid h-8 w-8 place-items-center rounded-full bg-base-panel text-base-muted outline-none", isPairPinned(pair) && "text-base-mint")}>
                <Star size={13} fill={isPairPinned(pair) ? "currentColor" : "none"} />
              </button>
            </div>
            <button type="button" onClick={() => onSelect(pair.id)} className="mt-3 w-full text-left outline-none">
              <div className="grid grid-cols-3 gap-2">
                <OpportunityMetric label="Price" value={pair.priceUsd} />
                <OpportunityMetric label="24h" value={formatOptionalPercent(getChange24h(pair))} tone={changeTone(getChange24h(pair))} />
                <OpportunityMetric label="Liquidity" value={formatOptionalUsd(getLiquidityUsd(pair))} />
              </div>
              <p className="mt-3 min-h-8 text-[11px] leading-4 text-base-muted"><span className="font-semibold text-base-text">Why now:</span> {signal?.detail ?? reason}</p>
              <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-base-muted">
                <span>{formatOptionalUsd(getVolume24h(pair))} 24h volume</span>
                <Freshness timestamp={signal?.sourceUpdatedAt ?? snapshot.sourceUpdatedAt} delayed={pair.stale || snapshot.freshness === "delayed"} compact />
              </div>
            </button>
          </article>
        )) : (
          <div className="col-span-full rounded-lg bg-base-elevated/55 px-4 py-5 text-center">
            <p className="text-[13px] font-semibold text-base-text">No verified event for this stream yet</p>
            <p className="mt-1 text-[11px] text-base-muted">The terminal will not manufacture history or movement while it waits for qualified source data.</p>
          </div>
        )}
      </div>
    </section>
  );
}

export function MarketActivityPanel({ pair, signals, snapshot }: { pair: BasePair; signals: PulseSignal[]; snapshot: MarketTerminalSnapshot }) {
  const pairSignals = signals.filter((signal) => signal.pairId === pair.id).slice(0, 6);
  const windows = (["m5", "h1", "h6", "h24"] as const).filter((window) => pair.txns?.[window] || pair.volumes?.[window]);

  return (
    <section className="pulse-surface h-full overflow-hidden rounded-xl" data-testid="market-activity-panel">
      <div className="flex items-center justify-between gap-3 px-3 pb-2 pt-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-base-mint">Confirmed Market Changes</p>
          <h3 className="mt-1 text-[15px] font-semibold text-base-text">{pair.pair} activity</h3>
        </div>
        <Freshness timestamp={snapshot.sourceUpdatedAt} delayed={pair.stale || snapshot.freshness === "delayed"} compact />
      </div>
      <div className="space-y-2 px-3 pb-3">
        {pairSignals.length > 0 ? pairSignals.map((signal) => (
          <button key={signal.key} type="button" className="w-full rounded-lg bg-base-elevated/70 p-2.5 text-left">
            <span className="flex items-center justify-between gap-2"><span className={cx("text-[10px] font-bold uppercase", signalTone(signal))}>{formatSignalType(signal.type)}</span><span className="font-mono text-[10px] text-base-muted">{relativeAge(signal.createdAt)}</span></span>
            <span className="mt-1 block text-[11px] leading-4 text-base-muted">{signal.detail}</span>
          </button>
        )) : windows.map((window) => {
          const txns = pair.txns?.[window];
          const volume = pair.volumes?.[window];
          return (
            <div key={window} className="grid grid-cols-[44px_1fr_auto] items-center gap-2 rounded-lg bg-base-elevated/55 px-2.5 py-2">
              <span className="font-mono text-[10px] font-bold uppercase text-base-mint">{formatWindow(window)}</span>
              <span className="text-[11px] text-base-muted">{txns ? `${txns.buys + txns.sells} aggregate transactions` : "Transaction count unavailable"}</span>
              <span className="font-mono text-[11px] text-base-text">{formatOptionalUsd(volume)}</span>
            </div>
          );
        })}
        {pairSignals.length === 0 && windows.length === 0 ? <p className="rounded-lg bg-base-elevated/55 p-3 text-[11px] leading-5 text-base-muted">The provider does not expose individual swaps or verified aggregate activity for this pair. No fake live trade tape is shown.</p> : null}
        <p className="text-[10px] leading-4 text-base-muted">DexScreener aggregate windows are shown when available. Wallet identities and individual swaps are not inferred.</p>
      </div>
    </section>
  );
}

function buildOpportunityItems(
  tab: OpportunityTab,
  snapshot: MarketTerminalSnapshot,
  signals: PulseSignal[],
  sinceLast: PulseSignal[],
  isPinned: (pair: BasePair) => boolean
): OpportunityItem[] {
  const pairById = new Map(snapshot.allPairs.map((pair) => [pair.id, pair]));
  const fromSignals = (source: PulseSignal[]) => source.map((signal) => ({ signal, pair: signal.pairId ? pairById.get(signal.pairId) : undefined })).filter((row): row is { signal: PulseSignal; pair: BasePair } => Boolean(row.pair));

  if (tab === "breaking") {
    const eventRows = fromSignals(signals);
    if (eventRows.length > 0) return eventRows.map(({ pair, signal }) => ({ pair, signal, reason: signal.detail }));
    return snapshot.allPairs.filter(isQualifiedMarket).map((pair) => ({ pair, reason: `Current verified Activity Score ${calculateActivityScore(pair) ?? "unavailable"}; this is a baseline, not a change event.` })).filter((row) => calculateActivityScore(row.pair) !== undefined).sort((left, right) => (calculateActivityScore(right.pair) ?? 0) - (calculateActivityScore(left.pair) ?? 0));
  }
  if (tab === "fresh") return snapshot.allPairs.filter((pair) => isQualifiedMarket(pair) && (getPairAgeMinutes(pair) ?? Infinity) <= 7 * 24 * 60).sort((a, b) => (getPairAgeMinutes(a) ?? Infinity) - (getPairAgeMinutes(b) ?? Infinity)).map((pair) => ({ pair, reason: `Verified pool age ${pair.age}; liquidity ${formatOptionalUsd(getLiquidityUsd(pair))}.` }));
  if (tab === "volume") return fromSignals(signals.filter((signal) => signal.type === "volume_burst")).map(({ pair, signal }) => ({ pair, signal, reason: signal.detail }));
  if (tab === "momentum") return snapshot.allPairs.filter((pair) => isQualifiedMarket(pair) && (pair.priceChanges?.h1 ?? 0) > 0).sort((a, b) => (b.priceChanges?.h1 ?? 0) - (a.priceChanges?.h1 ?? 0)).map((pair) => ({ pair, reason: `Verified 1h change ${formatOptionalPercent(pair.priceChanges?.h1)} with ${formatOptionalUsd(getVolume24h(pair))} 24h volume.` }));
  if (tab === "liquidity") return fromSignals(signals.filter((signal) => signal.type === "liquidity_change")).map(({ pair, signal }) => ({ pair, signal, reason: signal.detail }));
  if (tab === "leaders") return snapshot.allPairs.filter((pair) => isQualifiedMarket(pair) && (getPairAgeMinutes(pair) ?? 0) >= 30 * 24 * 60).sort((a, b) => (getLiquidityUsd(b) ?? 0) - (getLiquidityUsd(a) ?? 0)).map((pair) => ({ pair, reason: `Established pool with ${formatOptionalUsd(getLiquidityUsd(pair))} verified liquidity and age ${pair.age}.` }));
  if (tab === "watchlist") return snapshot.allPairs.filter(isPinned).map((pair) => ({ pair, signal: signals.find((signal) => signal.pairId === pair.id && signal.type === "watchlist_move"), reason: signals.find((signal) => signal.pairId === pair.id)?.detail ?? "Saved on this device; no new verified movement event yet." }));
  return fromSignals(sinceLast).map(({ pair, signal }) => ({ pair, signal, reason: signal.detail }));
}

function OpportunityMetric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "up" | "down" }) {
  return <span><span className="block text-[9px] uppercase tracking-[0.1em] text-base-muted">{label}</span><span className={cx("mt-0.5 block truncate font-mono text-[11px] font-semibold", tone === "up" ? "text-base-mint" : tone === "down" ? "text-base-rose" : "text-base-text")}>{value}</span></span>;
}

function Freshness({ timestamp, delayed, compact = false }: { timestamp: string; delayed: boolean; compact?: boolean }) {
  return <span className={cx("inline-flex items-center gap-1 rounded-full font-mono", compact ? "text-[9px]" : "bg-base-elevated px-2 py-1 text-[10px]", delayed ? "text-base-amber" : "text-base-mint")}><span className={cx("h-1.5 w-1.5 rounded-full", delayed ? "bg-base-amber" : "bg-base-mint")} />{delayed ? "Delayed" : relativeAge(timestamp)}</span>;
}

function signalTone(signal: PulseSignal) {
  if (signal.type === "data_delayed") return "text-base-amber";
  if (signal.direction === "down") return "text-base-rose";
  return "text-base-mint";
}

function formatSignalType(type: PulseSignal["type"]) {
  return type.replaceAll("_", " ");
}

function relativeAge(value: string) {
  const age = Date.now() - Date.parse(value);
  if (!Number.isFinite(age) || age < 0) return "now";
  if (age < 60_000) return `${Math.max(1, Math.floor(age / 1000))}s ago`;
  if (age < 3_600_000) return `${Math.floor(age / 60_000)}m ago`;
  return `${Math.floor(age / 3_600_000)}h ago`;
}

function formatOptionalUsd(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? formatCompactCurrency(value) : "N/A";
}

function formatOptionalPercent(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? formatPercent(value) : "N/A";
}

function changeTone(value: number | undefined) {
  return typeof value !== "number" || value === 0 ? "default" : value > 0 ? "up" : "down";
}

function formatWindow(value: "m5" | "h1" | "h6" | "h24") {
  return ({ m5: "5m", h1: "1h", h6: "6h", h24: "24h" } as const)[value];
}
