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
import { useI18n } from "@/i18n/I18nProvider";
import { localizeAgeLabel, type TranslationKey } from "@/i18n/dictionaries";

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
  { id: "breaking", label: "opportunity.breaking" },
  { id: "fresh", label: "opportunity.fresh" },
  { id: "volume", label: "opportunity.volume" },
  { id: "momentum", label: "opportunity.momentum" },
  { id: "liquidity", label: "opportunity.liquidity" },
  { id: "watchlist", label: "opportunity.watchlist" }
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
  const { t, locale, formatRelativeTime } = useI18n();
  const visibleSignals = signals.slice(0, 8);

  return (
    <section className="pulse-surface overflow-hidden rounded-xl" data-testid="live-pulse-strip" aria-label={t("pulse.title")}>
      <div className="flex items-center justify-between gap-3 px-3 pb-2 pt-3 sm:px-4">
        <div className="flex items-center gap-2">
          <span className="relative grid h-7 w-7 place-items-center rounded-full bg-base-mint/10 text-base-mint">
            <Radio size={14} aria-hidden="true" />
            <span className="absolute right-0 top-0 h-2 w-2 rounded-full bg-base-mint shadow-[0_0_10px_rgb(var(--color-mint)/0.75)]" />
          </span>
          <div>
            <h2 className="text-[12px] font-bold tracking-[0.08em] text-base-text">{t("pulse.title")}</h2>
            <p className="text-[10px] text-base-muted">{t("pulse.verifiedChanges", { source: snapshot.providerName })}</p>
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
              <span className={cx("text-[10px] font-bold uppercase tracking-[0.1em]", signalTone(signal))}>{t(signalKey(signal.type))}</span>
              <span className="font-mono text-[10px] text-base-muted">{formatRelativeTime(signal.createdAt)}</span>
            </div>
            <p className="mt-1 truncate text-[13px] font-semibold text-base-text">{signal.pair ?? signal.headline}</p>
            <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-base-muted">{localizeSignalDetail(signal, locale, t)}</p>
          </button>
        )) : (
          <div className="min-w-full rounded-lg bg-base-elevated/55 px-3 py-3 sm:min-w-[420px]">
            <p className="flex items-center gap-2 text-[12px] font-semibold text-base-text"><Clock3 size={13} className="text-base-mint" /> {t("pulse.listening")}</p>
            <p className="mt-1 text-[11px] text-base-muted">{t("pulse.firstSnapshot")}</p>
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
  const { t, locale, formatCompactCurrency: localCurrency, formatPercent: localPercent } = useI18n();
  const [tab, setTab] = useState<OpportunityTab>("breaking");
  const items = useMemo(
    () => buildOpportunityItems(tab, snapshot, signals, sinceLastSignals, isPairPinned, locale, t, localCurrency, localPercent),
    [isPairPinned, locale, localCurrency, localPercent, signals, sinceLastSignals, snapshot, t, tab]
  );

  return (
    <section className="pulse-surface overflow-hidden rounded-xl" data-testid="opportunity-stream">
      <div className="flex flex-wrap items-end justify-between gap-3 px-3 pb-2 pt-3 sm:px-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-base-mint">{t("opportunity.eyebrow")}</p>
          <h2 className="mt-1 text-[18px] font-semibold tracking-tight text-base-text">{t("opportunity.title")}</h2>
          <p className="mt-1 text-[11px] text-base-muted">{t("opportunity.subtitle")}</p>
        </div>
        <span className="font-mono text-[10px] text-base-muted">{t("opportunity.candidates", { count: items.length })}</span>
      </div>

      <div className="flex gap-1 overflow-x-auto px-3 pb-2 sm:flex-wrap sm:px-4" role="tablist" aria-label={t("opportunity.categories")}>
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
            {t(item.label as TranslationKey)}
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
                  <span className="block truncate text-[10px] text-base-muted">{pair.dexName ?? pair.dex} · {localizeAgeLabel(pair.age, locale)}</span>
                </span>
              </button>
              <button type="button" onClick={() => onTogglePin(pair)} aria-label={t(isPairPinned(pair) ? "a11y.unpin" : "a11y.pin", { pair: pair.pair })} className={cx("grid h-8 w-8 place-items-center rounded-full bg-base-panel text-base-muted outline-none", isPairPinned(pair) && "text-base-mint")}>
                <Star size={13} fill={isPairPinned(pair) ? "currentColor" : "none"} />
              </button>
            </div>
            <button type="button" onClick={() => onSelect(pair.id)} className="mt-3 w-full text-left outline-none">
              <div className="grid grid-cols-3 gap-2">
                <OpportunityMetric label={t("opportunity.price")} value={pair.priceUsd} />
                <OpportunityMetric label={t("opportunity.change24h")} value={formatOptionalPercent(getChange24h(pair), localPercent)} tone={changeTone(getChange24h(pair))} />
                <OpportunityMetric label={t("opportunity.liquidityMetric")} value={formatOptionalUsd(getLiquidityUsd(pair), localCurrency)} />
              </div>
              <p className="mt-3 min-h-8 text-[11px] leading-4 text-base-muted"><span className="font-semibold text-base-text">{t("opportunity.whyNow")}</span> {signal ? localizeSignalDetail(signal, locale, t) : reason}</p>
              <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-base-muted">
                <span>{t("opportunity.volume24h", { value: formatOptionalUsd(getVolume24h(pair), localCurrency) })}</span>
                <Freshness timestamp={signal?.sourceUpdatedAt ?? snapshot.sourceUpdatedAt} delayed={pair.stale || snapshot.freshness === "delayed"} compact />
              </div>
            </button>
          </article>
        )) : (
          <div className="col-span-full rounded-lg bg-base-elevated/55 px-4 py-5 text-center">
            <p className="text-[13px] font-semibold text-base-text">{t("opportunity.empty")}</p>
            <p className="mt-1 text-[11px] text-base-muted">{t("opportunity.emptyBody")}</p>
          </div>
        )}
      </div>
    </section>
  );
}

export function MarketActivityPanel({ pair, signals, snapshot }: { pair: BasePair; signals: PulseSignal[]; snapshot: MarketTerminalSnapshot }) {
  const { t, locale, formatCompactCurrency: localCurrency, formatRelativeTime } = useI18n();
  const pairSignals = signals.filter((signal) => signal.pairId === pair.id).slice(0, 6);
  const windows = (["m5", "h1", "h6", "h24"] as const).filter((window) => pair.txns?.[window] || pair.volumes?.[window]);

  return (
    <section className="pulse-surface h-full overflow-hidden rounded-xl" data-testid="market-activity-panel">
      <div className="flex items-center justify-between gap-3 px-3 pb-2 pt-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-base-mint">{t("workspace.activityTitle")}</p>
          <h3 className="mt-1 text-[15px] font-semibold text-base-text">{t("workspace.activityFor", { pair: pair.pair })}</h3>
        </div>
        <Freshness timestamp={snapshot.sourceUpdatedAt} delayed={pair.stale || snapshot.freshness === "delayed"} compact />
      </div>
      <div className="space-y-2 px-3 pb-3">
        {pairSignals.length > 0 ? pairSignals.map((signal) => (
          <button key={signal.key} type="button" className="w-full rounded-lg bg-base-elevated/70 p-2.5 text-left">
            <span className="flex items-center justify-between gap-2"><span className={cx("text-[10px] font-bold uppercase", signalTone(signal))}>{t(signalKey(signal.type))}</span><span className="font-mono text-[10px] text-base-muted">{formatRelativeTime(signal.createdAt)}</span></span>
            <span className="mt-1 block text-[11px] leading-4 text-base-muted">{localizeSignalDetail(signal, locale, t)}</span>
          </button>
        )) : windows.map((window) => {
          const txns = pair.txns?.[window];
          const volume = pair.volumes?.[window];
          return (
            <div key={window} className="grid grid-cols-[44px_1fr_auto] items-center gap-2 rounded-lg bg-base-elevated/55 px-2.5 py-2">
              <span className="font-mono text-[10px] font-bold uppercase text-base-mint">{formatWindow(window)}</span>
              <span className="text-[11px] text-base-muted">{txns ? t("workspace.transactions", { count: txns.buys + txns.sells }) : t("workspace.transactionsUnavailable")}</span>
              <span className="font-mono text-[11px] text-base-text">{formatOptionalUsd(volume, localCurrency)}</span>
            </div>
          );
        })}
        {pairSignals.length === 0 && windows.length === 0 ? <p className="rounded-lg bg-base-elevated/55 p-3 text-[11px] leading-5 text-base-muted">{t("workspace.noActivity")}</p> : null}
        <p className="text-[10px] leading-4 text-base-muted">{t("workspace.activitySource")}</p>
      </div>
    </section>
  );
}

function buildOpportunityItems(
  tab: OpportunityTab,
  snapshot: MarketTerminalSnapshot,
  signals: PulseSignal[],
  sinceLast: PulseSignal[],
  isPinned: (pair: BasePair) => boolean,
  locale: "tr" | "en",
  t: (key: TranslationKey, values?: Record<string, string | number>) => string,
  currency: (value: number) => string,
  percent: (value: number) => string
): OpportunityItem[] {
  const pairById = new Map(snapshot.allPairs.map((pair) => [pair.id, pair]));
  const fromSignals = (source: PulseSignal[]) => source.map((signal) => ({ signal, pair: signal.pairId ? pairById.get(signal.pairId) : undefined })).filter((row): row is { signal: PulseSignal; pair: BasePair } => Boolean(row.pair));

  if (tab === "breaking") {
    const eventRows = fromSignals(signals);
    if (eventRows.length > 0) return eventRows.map(({ pair, signal }) => ({ pair, signal, reason: signal.detail }));
    return snapshot.allPairs.filter(isQualifiedMarket).map((pair) => ({ pair, reason: t("opportunity.baseline", { score: calculateActivityScore(pair) ?? t("common.unavailable") }) })).filter((row) => calculateActivityScore(row.pair) !== undefined).sort((left, right) => (calculateActivityScore(right.pair) ?? 0) - (calculateActivityScore(left.pair) ?? 0));
  }
  if (tab === "fresh") return snapshot.allPairs.filter((pair) => isQualifiedMarket(pair) && (getPairAgeMinutes(pair) ?? Infinity) <= 7 * 24 * 60).sort((a, b) => (getPairAgeMinutes(a) ?? Infinity) - (getPairAgeMinutes(b) ?? Infinity)).map((pair) => ({ pair, reason: t("opportunity.freshReason", { age: localizeAgeLabel(pair.age, locale), liquidity: formatOptionalUsd(getLiquidityUsd(pair), currency) }) }));
  if (tab === "volume") return fromSignals(signals.filter((signal) => signal.type === "volume_burst")).map(({ pair, signal }) => ({ pair, signal, reason: signal.detail }));
  if (tab === "momentum") return snapshot.allPairs.filter((pair) => isQualifiedMarket(pair) && (pair.priceChanges?.h1 ?? 0) > 0).sort((a, b) => (b.priceChanges?.h1 ?? 0) - (a.priceChanges?.h1 ?? 0)).map((pair) => ({ pair, reason: t("opportunity.momentumReason", { change: formatOptionalPercent(pair.priceChanges?.h1, percent), volume: formatOptionalUsd(getVolume24h(pair), currency) }) }));
  if (tab === "liquidity") return fromSignals(signals.filter((signal) => signal.type === "liquidity_change")).map(({ pair, signal }) => ({ pair, signal, reason: signal.detail }));
  if (tab === "leaders") return snapshot.allPairs.filter((pair) => isQualifiedMarket(pair) && (getPairAgeMinutes(pair) ?? 0) >= 30 * 24 * 60).sort((a, b) => (getLiquidityUsd(b) ?? 0) - (getLiquidityUsd(a) ?? 0)).map((pair) => ({ pair, reason: t("opportunity.freshReason", { age: localizeAgeLabel(pair.age, locale), liquidity: formatOptionalUsd(getLiquidityUsd(pair), currency) }) }));
  if (tab === "watchlist") return snapshot.allPairs.filter(isPinned).map((pair) => ({ pair, signal: signals.find((signal) => signal.pairId === pair.id && signal.type === "watchlist_move"), reason: signals.find((signal) => signal.pairId === pair.id) ? localizeSignalDetail(signals.find((signal) => signal.pairId === pair.id)!, locale, t) : t("opportunity.watchlistReason") }));
  return fromSignals(sinceLast).map(({ pair, signal }) => ({ pair, signal, reason: signal.detail }));
}

function OpportunityMetric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "up" | "down" }) {
  return <span><span className="block text-[9px] uppercase tracking-[0.1em] text-base-muted">{label}</span><span className={cx("mt-0.5 block truncate font-mono text-[11px] font-semibold", tone === "up" ? "text-base-mint" : tone === "down" ? "text-base-rose" : "text-base-text")}>{value}</span></span>;
}

function Freshness({ timestamp, delayed, compact = false }: { timestamp: string; delayed: boolean; compact?: boolean }) {
  const { t, formatRelativeTime } = useI18n();
  return <span className={cx("inline-flex items-center gap-1 rounded-full font-mono", compact ? "text-[9px]" : "bg-base-elevated px-2 py-1 text-[10px]", delayed ? "text-base-amber" : "text-base-mint")}><span className={cx("h-1.5 w-1.5 rounded-full", delayed ? "bg-base-amber" : "bg-base-mint")} />{delayed ? t("common.delayed") : formatRelativeTime(timestamp)}</span>;
}

function signalTone(signal: PulseSignal) {
  if (signal.type === "data_delayed") return "text-base-amber";
  if (signal.direction === "down") return "text-base-rose";
  return "text-base-mint";
}

function formatOptionalUsd(value: number | undefined, formatter: (value: number) => string = formatCompactCurrency) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? formatter(value) : "N/A";
}

function formatOptionalPercent(value: number | undefined, formatter: (value: number) => string = formatPercent) {
  return typeof value === "number" && Number.isFinite(value) ? formatter(value) : "N/A";
}

function signalKey(type: PulseSignal["type"]): TranslationKey { return `signal.${type}` as TranslationKey; }

function localizeSignalDetail(signal: PulseSignal, locale: "tr" | "en", t: (key: TranslationKey, values?: Record<string, string | number>) => string) {
  if (locale === "en") return signal.detail;
  const value = typeof signal.value === "number" ? ` · ${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(signal.value)}` : "";
  return t("signal.verified", { pair: signal.pair ?? signal.headline, timeframe: signal.timeframe ?? "anlık", value });
}

function changeTone(value: number | undefined) {
  return typeof value !== "number" || value === 0 ? "default" : value > 0 ? "up" : "down";
}

function formatWindow(value: "m5" | "h1" | "h6" | "h24") {
  return ({ m5: "5m", h1: "1h", h6: "6h", h24: "24h" } as const)[value];
}
