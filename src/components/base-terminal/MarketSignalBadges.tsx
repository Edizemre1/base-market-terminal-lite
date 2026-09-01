"use client";

import {
  Activity,
  BarChart3,
  Clock3,
  ClockAlert,
  DatabaseZap,
  Droplets,
  Flame,
  Gauge,
  Layers3,
  Rocket,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Sparkles,
  TrendingUp,
  TriangleAlert,
  type LucideIcon
} from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { MarketTerminalSnapshot } from "@/data/providers";
import type { TokenOpportunity } from "@/lib/base-terminal/opportunityModel";
import {
  SIGNAL_FILTER_TYPES,
  computeMarketSignalSnapshot,
  reconcileMarketSignalSnapshots,
  selectVisibleMarketSignals,
  type MarketSignalBadge,
  type MarketSignalIconKey,
  type MarketSignalSnapshot,
  type MarketSignalTone,
  type MarketSignalType
} from "@/lib/base-terminal/marketSignals";
import type { BasePair } from "@/types/baseTerminal";
import { useI18n } from "@/i18n/I18nProvider";
import { cx, normalizeCompactNumberText } from "@/lib/format";

export const MARKET_SIGNAL_ICONS: Readonly<Record<MarketSignalIconKey, LucideIcon>> = Object.freeze({
  sparkles: Sparkles,
  clock: Clock3,
  trending: TrendingUp,
  rocket: Rocket,
  activity: Activity,
  bars: BarChart3,
  flame: Flame,
  droplets: Droplets,
  gauge: Gauge,
  warning: TriangleAlert,
  layers: Layers3,
  shield_check: ShieldCheck,
  shield_question: ShieldQuestion,
  shield_alert: ShieldAlert,
  clock_alert: ClockAlert,
  database_alert: DatabaseZap
});

export const MARKET_SIGNAL_OPEN_POOLS_EVENT = "market-signal:open-pools";

type SignalContextValue = {
  snapshot: MarketTerminalSnapshot;
  signals: MarketSignalSnapshot;
};

const MarketSignalContext = createContext<SignalContextValue | undefined>(undefined);

export function MarketSignalProvider({ snapshot, children }: { snapshot: MarketTerminalSnapshot; children: ReactNode }) {
  const [signals, setSignals] = useState(() => reconcileMarketSignalSnapshots(undefined, computeMarketSignalSnapshot(snapshot)));
  useEffect(() => {
    setSignals((previous) => reconcileMarketSignalSnapshots(previous, computeMarketSignalSnapshot(snapshot, {}, previous)));
  }, [snapshot]);
  const value = useMemo(() => ({ snapshot, signals }), [signals, snapshot]);
  return <MarketSignalContext.Provider value={value}>{children}</MarketSignalContext.Provider>;
}

export function useMarketSignalContext() {
  const context = useContext(MarketSignalContext);
  if (!context) throw new Error("MarketSignalProvider is required.");
  return context;
}

export function useMarketSignals({ opportunity, pair, scope = "opportunity" }: { opportunity?: TokenOpportunity; pair?: BasePair; scope?: "opportunity" | "pool" }) {
  const { signals } = useMarketSignalContext();
  if (scope === "pool" && pair) return signals.byPoolId[pair.id] ?? [];
  const opportunityId = opportunity?.id ?? pair?.opportunityId;
  return opportunityId ? signals.byOpportunityId[opportunityId] ?? [] : pair ? signals.byPoolId[pair.id] ?? [] : [];
}

export type MarketSignalPresentation = "rowCritical" | "rowPrimary" | "inspectorDetails" | "hiddenNeutral";

export function presentMarketSignals(badges: readonly MarketSignalBadge[], presentation: MarketSignalPresentation) {
  if (presentation === "hiddenNeutral") return [];
  if (presentation === "inspectorDetails") return [...badges];
  const excluded = presentation === "rowCritical"
    ? new Set<MarketSignalType>(["contract_verified", "security_unknown", "delayed", "multi_pool", "deep_liquidity", "high_volume", "most_traded"])
    : new Set<MarketSignalType>(["contract_verified", "security_unknown", "delayed"]);
  return badges.filter((badge) => !excluded.has(badge.type));
}

export function MarketSignalBadges({ opportunity, pair, scope = "opportunity", maximumMarketBadges = 2, className, presentation = "inspectorDetails" }: {
  opportunity?: TokenOpportunity;
  pair?: BasePair;
  scope?: "opportunity" | "pool";
  maximumMarketBadges?: number;
  className?: string;
  presentation?: MarketSignalPresentation;
}) {
  const allBadges = useMarketSignals({ opportunity, pair, scope });
  const badges = presentMarketSignals(allBadges, presentation);
  const selection = selectVisibleMarketSignals(badges, maximumMarketBadges);
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [transientOpen, setTransientOpen] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState<{ left: number; top: number; width: number }>();
  const rootRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const popoverId = useId();
  const visible = open || transientOpen;
  const cancelScheduledClose = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = undefined;
  }, []);
  const showTransient = useCallback(() => {
    cancelScheduledClose();
    setTransientOpen(true);
  }, [cancelScheduledClose]);
  const scheduleTransientClose = useCallback(() => {
    cancelScheduledClose();
    closeTimerRef.current = setTimeout(() => setTransientOpen(false), 120);
  }, [cancelScheduledClose]);
  useEffect(() => {
    if (!visible) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) {
        setOpen(false);
        setTransientOpen(false);
      }
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setTransientOpen(false);
        rootRef.current?.querySelector("button")?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeEscape); };
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    const positionPopover = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(330, window.innerWidth - 24);
      const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
      const top = rect.bottom + 4 + 380 <= window.innerHeight ? rect.bottom + 4 : Math.max(12, rect.top - 384);
      setPopoverPosition({ left, top, width });
    };
    positionPopover();
    window.addEventListener("resize", positionPopover);
    window.addEventListener("scroll", positionPopover, true);
    return () => {
      window.removeEventListener("resize", positionPopover);
      window.removeEventListener("scroll", positionPopover, true);
    };
  }, [visible]);
  useEffect(() => () => cancelScheduledClose(), [cancelScheduledClose]);
  if (!badges.length) return null;
  const subject = opportunity?.focusTokenSymbol ?? pair?.pair ?? t("marketSignal.market");
  const opportunityId = opportunity?.id ?? pair?.opportunityId;
  const openPoolDetails = opportunityId ? () => {
    setOpen(false);
    setTransientOpen(false);
    window.dispatchEvent(new CustomEvent(MARKET_SIGNAL_OPEN_POOLS_EVENT, { detail: { opportunityId } }));
  } : undefined;
  const popover = visible && popoverPosition ? <div
    ref={popoverRef}
    id={popoverId}
    role="dialog"
    aria-label={t("marketSignal.details", { market: subject })}
    className="fixed z-layer-popover rounded-panel border border-border-subtle bg-surface-panel p-3 text-left shadow-popover"
    style={{ left: popoverPosition.left, top: popoverPosition.top, width: popoverPosition.width }}
    onPointerEnter={showTransient}
    onPointerLeave={scheduleTransientClose}
    onFocus={showTransient}
    onBlur={scheduleTransientClose}
    onClick={(event) => event.stopPropagation()}
    data-testid="market-signal-popover"
  >
    <span className="flex items-center justify-between gap-2"><strong className="text-meta text-content-primary">{t("marketSignal.title")}</strong><span className="font-mono text-meta uppercase text-content-secondary">{scope === "pool" ? t("marketSignal.poolScope") : t("marketSignal.opportunityScope")}</span></span>
    <span className="mt-2 grid max-h-72 gap-2 overflow-y-auto">
      {selection.all.map((badge) => <SignalDetail key={badge.id} badge={badge} locale={locale} onOpenPoolDetails={openPoolDetails} />)}
    </span>
    <span className="mt-2 block border-t border-border-subtle pt-2 text-meta leading-4 text-content-secondary">{t("marketSignal.disclaimer")}</span>
  </div> : null;
  return <span
    ref={rootRef}
    className={cx("relative inline-flex shrink-0", className)}
    data-testid="market-signal-group"
    data-signal-count={badges.length}
    onPointerEnter={showTransient}
    onPointerLeave={scheduleTransientClose}
    onFocus={showTransient}
    onBlur={scheduleTransientClose}
  >
    <button
      type="button"
      className="inline-flex min-h-11 items-center gap-1 rounded-pill px-1 outline-none focus-visible:ring-2 focus-visible:ring-focus"
      aria-label={t("marketSignal.open", { market: subject, count: badges.length })}
      aria-expanded={visible}
      aria-controls={popoverId}
      onClick={(event) => {
        event.stopPropagation();
        cancelScheduledClose();
        setOpen((current) => !current);
      }}
    >
      {selection.visible.map((badge) => <SignalGlyph key={badge.id} badge={badge} />)}
      {selection.hiddenCount > 0 ? <span className="grid h-6 min-w-6 place-items-center rounded-pill border border-border-subtle bg-surface-interactive px-1 font-mono text-meta text-content-secondary">+{selection.hiddenCount}</span> : null}
    </button>
    {typeof document !== "undefined" ? createPortal(popover, document.body) : null}
  </span>;
}

export function MarketSignalLegend({ selected, onChange }: { selected: readonly MarketSignalType[]; onChange: (types: MarketSignalType[]) => void }) {
  const { t } = useI18n();
  const selectedSet = new Set(selected);
  return <details className="relative" data-testid="market-signal-legend">
    <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1 rounded-control bg-surface-interactive px-2 text-meta text-content-secondary"><Activity size={12} aria-hidden="true" />{t("marketSignal.legend")}{selected.length ? <span className="rounded-pill bg-brand-accent/10 px-2 text-brand-accent">{selected.length}</span> : null}</summary>
    <div className="absolute right-0 top-10 z-layer-popover w-[min(360px,calc(100vw-24px))] rounded-panel border border-border-subtle bg-surface-panel p-3 shadow-popover">
      <div className="flex items-start justify-between gap-3"><div><p className="text-meta font-semibold text-content-primary">{t("marketSignal.filterTitle")}</p><p className="mt-1 text-meta leading-4 text-content-secondary">{t("marketSignal.filterBody")}</p></div>{selected.length ? <button type="button" onClick={() => onChange([])} className="min-h-8 shrink-0 rounded-control bg-surface-interactive px-2 text-meta text-content-secondary">{t("common.clear")}</button> : null}</div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {SIGNAL_FILTER_TYPES.map((type) => {
          const active = selectedSet.has(type);
          return <button key={type} type="button" aria-pressed={active} onClick={() => onChange(active ? selected.filter((item) => item !== type) : [...selected, type])} className={cx("flex min-h-10 items-center gap-2 rounded-control border px-2 text-left text-meta", active ? "border-border-selected bg-surface-selected text-content-primary" : "border-border-subtle bg-surface-interactive text-content-secondary")} data-signal-filter={type}><SignalGlyph badge={legendBadge(type)} />{t(`marketSignal.${type}`)}</button>;
        })}
      </div>
    </div>
  </details>;
}

function SignalGlyph({ badge }: { badge: MarketSignalBadge }) {
  const Icon = MARKET_SIGNAL_ICONS[badge.iconKey];
  const { t } = useI18n();
  return <span
    className={cx("grid h-6 w-6 place-items-center rounded-pill border", badgeToneClass(badge), badge.state === "entering" && "animate-[pulse_1.8s_ease-in-out_1] motion-reduce:animate-none", badge.state === "cooldown" && "opacity-55")}
    data-signal-type={badge.type}
    data-signal-state={badge.state}
    title={t(badge.shortLabelKey)}
    aria-hidden="true"
  ><Icon size={12} /></span>;
}

function SignalDetail({ badge, locale, onOpenPoolDetails }: { badge: MarketSignalBadge; locale: "tr" | "en"; onOpenPoolDetails?: () => void }) {
  const { t } = useI18n();
  const Icon = MARKET_SIGNAL_ICONS[badge.iconKey];
  return <span className="rounded-card border border-border-subtle bg-surface-interactive p-2" data-signal-detail={badge.type}>
    <span className="flex items-center gap-2"><span className={cx("grid h-7 w-7 shrink-0 place-items-center rounded-pill border", badgeToneClass(badge))}><Icon size={13} aria-hidden="true" /></span><span><strong className="block text-meta text-content-primary">{t(badge.labelKey)}</strong><span className="block font-mono text-meta uppercase text-content-secondary">{t(`marketSignal.state.${badge.state}`)}</span></span></span>
    <span className="mt-2 block text-meta leading-4 text-content-secondary">{t(`marketSignal.reason.${badge.type}`)}</span>
    {badge.metric ? <span className="mt-1 block font-mono text-meta leading-4 text-content-primary">{formatMetric(badge.metric, locale)} · {t("marketSignal.threshold", { value: formatMetricValue(badge.metric.threshold, badge.metric.unit, locale), window: badge.metric.window })}{badge.metric.comparisonValue !== undefined ? ` · ${t("marketSignal.comparison", { value: formatMetricValue(badge.metric.comparisonValue, badge.metric.unit === "ratio" ? "usd" : badge.metric.unit, locale) })}` : ""}</span> : null}
    {badge.metric?.volumeUsd !== undefined ? <span className="mt-1 block font-mono text-meta leading-4 text-content-secondary">{t("marketSignal.volumeEvidence", { value: formatMetricValue(badge.metric.volumeUsd, "usd", locale), window: badge.metric.window })}</span> : null}
    {badge.metric?.liquidityUsd !== undefined ? <span className="block font-mono text-meta leading-4 text-content-secondary">{t("marketSignal.liquidityEvidence", { value: formatMetricValue(badge.metric.liquidityUsd, "usd", locale) })}</span> : null}
    {badge.metric?.primaryDex ? <span className="block font-mono text-meta leading-4 text-content-secondary">{t("marketSignal.primaryDex", { value: badge.metric.primaryDex })}</span> : null}
    {badge.metric?.freshness ? <span className="block font-mono text-meta leading-4 text-content-secondary">{t("marketSignal.freshness", { value: t(`marketSignal.freshnessValue.${badge.metric.freshness}`) })}</span> : null}
    {badge.type === "multi_pool" && onOpenPoolDetails ? <button type="button" onClick={onOpenPoolDetails} className="mt-2 min-h-9 rounded-control bg-brand-accent/10 px-2 text-meta font-semibold text-brand-accent">{t("marketSignal.poolAction")}</button> : null}
    <span className="mt-1 block break-words font-mono text-meta leading-4 text-content-secondary">{t("marketSignal.source")}: {badge.source}<br />{t("marketSignal.observed")}: {formatUtc(badge.observedAt)}<br />{t("marketSignal.expires")}: {formatUtc(badge.expiresAt)}<br />{t("marketSignal.reasonCode")}: {badge.reasonCode}</span>
  </span>;
}

function legendBadge(type: MarketSignalType): MarketSignalBadge {
  const spec: Record<MarketSignalType, [MarketSignalTone, MarketSignalIconKey]> = {
    just_launched: ["info", "sparkles"], new_market: ["info", "clock"], gaining_fast: ["positive", "trending"], breakout: ["positive", "rocket"], volume_surge: ["positive", "activity"], high_volume: ["positive", "bars"], most_traded: ["positive", "activity"], deep_liquidity: ["positive", "droplets"], moving_now: ["positive", "flame"], volatile: ["warning", "gauge"], thin_liquidity: ["warning", "warning"], multi_pool: ["info", "layers"], contract_verified: ["positive", "shield_check"], security_unknown: ["neutral", "shield_question"], risk_flagged: ["critical", "shield_alert"], delayed: ["warning", "clock_alert"], incomplete_data: ["neutral", "database_alert"]
  };
  const [tone, iconKey] = spec[type];
  return { id: `legend:${type}`, type, tone, iconKey, labelKey: `marketSignal.${type}`, shortLabelKey: `marketSignal.${type}.short`, reasonCode: "legend", source: "legend", observedAt: new Date(0).toISOString(), expiresAt: new Date(0).toISOString(), priority: 0, state: "active", scope: "opportunity", subjectId: "legend" };
}

function badgeToneClass(badge: MarketSignalBadge) {
  if (badge.type === "contract_verified") return "border-trust-verified/45 bg-trust-verified/10 text-trust-verified";
  if (badge.type === "risk_flagged") return "border-trust-risk/55 bg-trust-risk/10 text-trust-risk";
  if (badge.type === "volume_surge" || badge.type === "high_volume") return "border-market-volume/45 bg-market-volume/10 text-market-volume";
  if (badge.type === "gaining_fast" || badge.type === "breakout" || badge.type === "moving_now") return "border-market-positive/45 bg-market-positive/10 text-market-positive";
  if (badge.type === "just_launched" || badge.type === "new_market") return "border-network-base/45 bg-network-base/10 text-network-base";
  if (badge.tone === "info") return "border-trust-verified/45 bg-trust-verified/10 text-trust-verified";
  if (badge.tone === "warning") return "border-freshness-delayed/45 bg-freshness-delayed/10 text-freshness-delayed";
  if (badge.tone === "critical") return "border-trust-risk/55 bg-trust-risk/10 text-trust-risk";
  if (badge.tone === "positive") return "border-market-positive/45 bg-market-positive/10 text-market-positive";
  return "border-border-subtle bg-surface-interactive text-content-secondary";
}

function formatMetric(metric: NonNullable<MarketSignalBadge["metric"]>, locale: "tr" | "en") {
  return `${formatMetricValue(metric.value, metric.unit, locale)} · ${metric.window}`;
}

function formatMetricValue(value: number, unit: NonNullable<MarketSignalBadge["metric"]>["unit"], locale: "tr" | "en") {
  if (unit === "usd") return normalizeCompactNumberText(new Intl.NumberFormat(locale === "tr" ? "tr-TR" : "en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }).format(value));
  if (unit === "percent") return `${new Intl.NumberFormat(locale === "tr" ? "tr-TR" : "en-US", { maximumFractionDigits: 2 }).format(value)}%`;
  if (unit === "ratio") return `${value.toFixed(2)}×`;
  if (unit === "minutes") return `${Math.round(value)}m`;
  return new Intl.NumberFormat(locale === "tr" ? "tr-TR" : "en-US", { maximumFractionDigits: 2 }).format(value);
}

function formatUtc(value: string) {
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? "N/A" : `${timestamp.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}
