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
import { StatePanel } from "@/components/ui/CalmComponents";

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
    <section className="pulse-surface overflow-hidden rounded-panel" data-testid="live-pulse-strip" aria-label={t("pulse.title")}>
      <div className="flex items-center justify-between gap-3 px-3 pb-2 pt-3 sm:px-4">
        <div className="flex items-center gap-2">
          <span className="relative grid h-7 w-7 place-items-center rounded-pill bg-freshness-live/10 text-freshness-live">
            <Radio size={14} aria-hidden="true" />
            <span className="absolute right-0 top-0 h-2 w-2 rounded-pill bg-freshness-live shadow-raised" />
          </span>
          <div>
            <h2 className="text-label font-bold tracking-eyebrow text-content-primary">{t("pulse.title")}</h2>
            <p className="text-meta text-content-secondary">{t("pulse.verifiedChanges", { source: snapshot.providerName })}</p>
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
            className="pulse-event min-w-[250px] snap-start rounded-card bg-surface-interactive/70 px-3 py-3 text-left outline-none transition hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-default"
          >
            <div className="flex items-center justify-between gap-2">
              <span className={cx("text-meta font-bold uppercase tracking-eyebrow", signalTone(signal))}>{t(signalKey(signal.type))}</span>
              <span className="font-mono text-meta text-content-secondary">{formatRelativeTime(signal.createdAt)}</span>
            </div>
            <p className="mt-1 truncate text-data font-semibold text-content-primary">{signal.pair ?? signal.headline}</p>
            <p className="mt-1 line-clamp-2 text-meta leading-4 text-content-secondary">{localizeSignalDetail(signal, locale, t)}</p>
          </button>
        )) : (
          <div className="min-w-full rounded-card bg-surface-interactive/55 px-3 py-3 sm:min-w-[420px]">
            <p className="flex items-center gap-2 text-label font-semibold text-content-primary"><Clock3 size={13} className="text-freshness-live" /> {t("pulse.listening")}</p>
            <p className="mt-1 text-meta text-content-secondary">{t("pulse.firstSnapshot")}</p>
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
    <section className="pulse-surface overflow-hidden rounded-panel" data-testid="opportunity-stream">
      <div className="flex flex-wrap items-end justify-between gap-3 px-3 pb-2 pt-3 sm:px-4">
        <div>
          <p className="text-meta font-bold uppercase tracking-eyebrow text-content-secondary">{t("opportunity.eyebrow")}</p>
          <h2 className="mt-1 text-title-sm font-semibold tracking-tight text-content-primary">{t("opportunity.title")}</h2>
          <p className="mt-1 text-meta text-content-secondary">{t("opportunity.subtitle")}</p>
        </div>
        <span className="font-mono text-meta text-content-secondary">{t("opportunity.candidates", { count: items.length })}</span>
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
              "min-h-9 shrink-0 rounded-pill px-3 text-meta font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-focus",
              tab === item.id ? "bg-surface-selected text-content-primary shadow-raised" : "bg-surface-interactive text-content-secondary hover:text-content-primary"
            )}
          >
            {t(item.label as TranslationKey)}
          </button>
        ))}
      </div>

      <div className="grid gap-2 px-3 pb-3 sm:grid-cols-2 sm:px-4 xl:grid-cols-3" data-testid="opportunity-cards">
        {items.length > 0 ? items.slice(0, 6).map(({ pair, signal, reason }) => (
          <article key={`${tab}-${pair.id}-${signal?.key ?? "baseline"}`} className="group rounded-card bg-surface-interactive/65 p-3 transition hover:bg-surface-raised">
            <div className="flex items-start gap-3">
              <button type="button" onClick={() => onSelect(pair.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none">
                <PairAvatarStack baseSymbol={pair.baseToken} quoteSymbol={pair.quoteToken} baseLogoUrl={pair.tokenLogoUrl} quoteLogoUrl={pair.quoteTokenLogoUrl} size="md" />
                <span className="min-w-0">
                  <span className="block truncate text-body font-semibold text-content-primary">{pair.pair}</span>
                  <span className="block truncate text-meta text-content-secondary">{pair.dexName ?? pair.dex} · {localizeAgeLabel(pair.age, locale)}</span>
                </span>
              </button>
              <button type="button" onClick={() => onTogglePin(pair)} aria-label={t(isPairPinned(pair) ? "a11y.unpin" : "a11y.pin", { pair: pair.pair })} className={cx("grid h-8 w-8 place-items-center rounded-pill bg-surface-panel text-content-secondary outline-none", isPairPinned(pair) && "text-brand-accent")}>
                <Star size={13} fill={isPairPinned(pair) ? "currentColor" : "none"} />
              </button>
            </div>
            <button type="button" onClick={() => onSelect(pair.id)} className="mt-3 w-full text-left outline-none">
              <div className="grid grid-cols-3 gap-2">
                <OpportunityMetric label={t("opportunity.price")} value={pair.priceUsd} />
                <OpportunityMetric label={t("opportunity.change24h")} value={formatOptionalPercent(getChange24h(pair), localPercent)} tone={changeTone(getChange24h(pair))} />
                <OpportunityMetric label={t("opportunity.liquidityMetric")} value={formatOptionalUsd(getLiquidityUsd(pair), localCurrency)} />
              </div>
              <p className="mt-3 min-h-8 text-meta leading-4 text-content-secondary"><span className="font-semibold text-content-primary">{t("opportunity.whyNow")}</span> {signal ? localizeSignalDetail(signal, locale, t) : reason}</p>
              <div className="mt-2 flex items-center justify-between gap-2 text-meta text-content-secondary">
                <span>{t("opportunity.volume24h", { value: formatOptionalUsd(getVolume24h(pair), localCurrency) })}</span>
                <Freshness timestamp={signal?.sourceUpdatedAt ?? snapshot.sourceUpdatedAt} delayed={pair.stale || snapshot.freshness === "delayed"} compact />
              </div>
            </button>
          </article>
        )) : (
          <StatePanel className="col-span-full text-center" title={t("opportunity.empty")} body={t("opportunity.emptyBody")} />
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
    <section className="pulse-surface h-full overflow-hidden rounded-panel" data-testid="market-activity-panel">
      <div className="flex items-center justify-between gap-3 px-3 pb-2 pt-3">
        <div>
          <p className="text-meta font-bold uppercase tracking-eyebrow text-content-secondary">{t("workspace.activityTitle")}</p>
          <h3 className="mt-1 text-title-sm font-semibold text-content-primary">{t("workspace.activityFor", { pair: pair.pair })}</h3>
        </div>
        <Freshness timestamp={snapshot.sourceUpdatedAt} delayed={pair.stale || snapshot.freshness === "delayed"} compact />
      </div>
      <div className="space-y-2 px-3 pb-3">
        {pairSignals.length > 0 ? pairSignals.map((signal) => (
          <button key={signal.key} type="button" className="w-full rounded-card bg-surface-interactive/70 p-3 text-left">
            <span className="flex items-center justify-between gap-2"><span className={cx("text-meta font-bold uppercase", signalTone(signal))}>{t(signalKey(signal.type))}</span><span className="font-mono text-meta text-content-secondary">{formatRelativeTime(signal.createdAt)}</span></span>
            <span className="mt-1 block text-meta leading-4 text-content-secondary">{localizeSignalDetail(signal, locale, t)}</span>
          </button>
        )) : windows.map((window) => {
          const txns = pair.txns?.[window];
          const volume = pair.volumes?.[window];
          return (
            <div key={window} className="grid grid-cols-[44px_1fr_auto] items-center gap-2 rounded-card bg-surface-interactive/55 px-3 py-2">
              <span className="font-mono text-meta font-bold uppercase text-content-secondary">{formatWindow(window)}</span>
              <span className="text-meta text-content-secondary">{txns ? t("workspace.transactions", { count: txns.buys + txns.sells }) : t("workspace.transactionsUnavailable")}</span>
              <span className="font-mono text-meta text-content-primary">{formatOptionalUsd(volume, localCurrency)}</span>
            </div>
          );
        })}
        {pairSignals.length === 0 && windows.length === 0 ? <p className="rounded-card bg-surface-interactive/55 p-3 text-meta leading-5 text-content-secondary">{t("workspace.noActivity")}</p> : null}
        <p className="text-meta leading-4 text-content-secondary">{t("workspace.activitySource")}</p>
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
  return <span><span className="block text-meta uppercase tracking-eyebrow text-content-secondary">{label}</span><span className={cx("mt-1 block truncate font-mono text-meta font-semibold", tone === "up" ? "text-market-positive" : tone === "down" ? "text-market-negative" : "text-content-primary")}>{value}</span></span>;
}

function Freshness({ timestamp, delayed, compact = false }: { timestamp: string; delayed: boolean; compact?: boolean }) {
  const { t, formatRelativeTime } = useI18n();
  return <span className={cx("inline-flex items-center gap-1 rounded-pill font-mono", compact ? "text-meta" : "bg-surface-interactive px-2 py-1 text-meta", delayed ? "text-freshness-delayed" : "text-freshness-live")}><span className={cx("h-1.5 w-1.5 rounded-pill", delayed ? "bg-freshness-delayed" : "bg-freshness-live")} />{delayed ? t("common.delayed") : formatRelativeTime(timestamp)}</span>;
}

function signalTone(signal: PulseSignal) {
  if (signal.type === "data_delayed") return "text-freshness-delayed";
  if (signal.type === "new_pool" || signal.type === "new_opportunity") return "text-network-base";
  if (signal.type === "volume_burst") return "text-market-volume";
  if (signal.direction === "down") return "text-market-negative";
  if (signal.direction === "up") return "text-market-positive";
  return "text-content-secondary";
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
