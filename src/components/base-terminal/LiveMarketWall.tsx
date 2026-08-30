"use client";

import { Activity, ArrowRight, Eye } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MarketSignalBadges } from "@/components/base-terminal/MarketSignalBadges";
import { PairAvatarStack } from "@/components/TokenIdentity";
import type { MarketTerminalSnapshot } from "@/data/providers";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/dictionaries";
import { buildLiveMarketWall, type LiquidityDirection, type LiveWallEntry, type LiveWallLane, type LiveWallLaneId, type LiveWallTimeframe } from "@/lib/base-terminal/liveMarketWall";
import type { PulseEventType, PulseSignal } from "@/lib/base-terminal/pulse";
import { cx } from "@/lib/format";
import { safeReadJson, safeSetStorageItem } from "@/lib/safeStorage";
import type { BasePair } from "@/types/baseTerminal";

const WALL_STORAGE_KEY = "mergen-terminal:live-wall:v1";
const TIMEFRAMES: LiveWallTimeframe[] = ["m5", "h1", "h24"];

export function LivePulseRail({ signals, onSelect, onInteractionChange }: { signals: PulseSignal[]; onSelect: (pairId: string) => void; onInteractionChange: (locked: boolean) => void }) {
  const { t, locale, formatCompactCurrency, formatPercent } = useI18n();
  const latest = useMemo(() => signals.filter((signal) => signal.source && signal.sourceUpdatedAt).slice(0, 10), [signals]);
  const [frozen, setFrozen] = useState<PulseSignal[] | undefined>();
  const rows = frozen ?? latest;
  const pause = useCallback(() => { setFrozen((current) => current ?? latest); onInteractionChange(true); }, [latest, onInteractionChange]);
  const resume = useCallback(() => { setFrozen(undefined); onInteractionChange(false); }, [onInteractionChange]);

  return <section className="pulse-surface overflow-hidden rounded-lg" data-testid="live-pulse-rail" aria-label={t("terminalV3.livePulse")} onMouseEnter={pause} onMouseLeave={resume} onFocusCapture={pause} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) resume(); }}>
    <div className="flex min-h-14 items-stretch gap-2 overflow-x-auto px-2 py-1.5 motion-reduce:scroll-auto">
      <div className="sticky left-0 z-10 flex w-24 shrink-0 items-center gap-2 bg-base-panel pr-2"><span className="grid h-8 w-8 place-items-center rounded-full bg-base-mint/10 text-base-mint"><Activity size={14} /></span><span><b className="block text-[9px] uppercase tracking-[0.14em] text-base-mint">{t("terminalV3.livePulse")}</b><small className="text-[8px] text-base-muted">{rows.length}</small></span></div>
      {rows.length ? rows.map((signal) => <button key={signal.key} type="button" disabled={!signal.pairId} onClick={() => signal.pairId && onSelect(signal.pairId)} className="group min-w-[250px] max-w-[320px] shrink-0 rounded-md bg-base-elevated/75 px-2.5 py-1.5 text-left outline-none transition-colors hover:bg-base-mint/10 focus-visible:ring-2 focus-visible:ring-base-mint/50 motion-reduce:transition-none" data-pulse-event={signal.type}>
        <span className="flex items-center justify-between gap-2"><strong className="truncate text-[10px] text-base-text">{signal.pair ?? t(PULSE_EVENT_KEYS[signal.type])}</strong><span className={cx("shrink-0 font-mono text-[8px]", signal.direction === "up" ? "text-base-mint" : signal.direction === "down" ? "text-base-rose" : "text-base-muted")}>{formatPulseValue(signal, formatCompactCurrency, formatPercent)}</span></span>
        <span className="mt-0.5 flex items-center justify-between gap-2 text-[8px] text-base-muted"><span className="truncate">{t(PULSE_EVENT_KEYS[signal.type])}</span><span className="shrink-0">{signal.timeframe === "snapshot" || !signal.timeframe ? t("alerts.snapshot") : signal.timeframe} · {formatObservedTime(signal.createdAt, locale)}</span></span>
        <span className="mt-0.5 block truncate text-[7px] text-base-muted/80">{signal.source} · {t(PULSE_FRESHNESS_KEYS[signal.freshness ?? "fresh"])}</span>
      </button>) : <p className="flex min-w-[300px] items-center text-[9px] text-base-muted">{t("terminalV3.livePulseEmpty")}</p>}
    </div>
  </section>;
}

export function LiveMarketWall({ snapshot, selectedPair, onSelect, onTrade, onInteractionChange }: {
  snapshot: MarketTerminalSnapshot;
  selectedPair: BasePair;
  onSelect: (pairId: string) => void;
  onTrade: (pair: BasePair, side: "buy" | "sell") => void;
  onInteractionChange: (locked: boolean) => void;
}) {
  const { t, locale, formatCompactCurrency, formatPercent } = useI18n();
  const [timeframe, setTimeframe] = useState<LiveWallTimeframe>("h1");
  const [allowCrossLaneRepeats, setAllowCrossLaneRepeats] = useState(false);
  const [liquidityDirection, setLiquidityDirection] = useState<LiquidityDirection>("all");
  const [loaded, setLoaded] = useState(false);
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());
  const previousValuesRef = useRef<Map<string, string> | undefined>(undefined);
  const hoverRef = useRef(false);
  const focusRef = useRef(false);
  const scrollTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const stored = safeReadJson<{ timeframe?: LiveWallTimeframe; allowCrossLaneRepeats?: boolean }>(WALL_STORAGE_KEY, {});
    if (stored.timeframe && TIMEFRAMES.includes(stored.timeframe)) setTimeframe(stored.timeframe);
    setAllowCrossLaneRepeats(stored.allowCrossLaneRepeats === true);
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded) safeSetStorageItem(WALL_STORAGE_KEY, JSON.stringify({ timeframe, allowCrossLaneRepeats }));
  }, [allowCrossLaneRepeats, loaded, timeframe]);

  const wall = useMemo(() => buildLiveMarketWall(snapshot, { timeframe, allowCrossLaneRepeats, liquidityDirection }), [allowCrossLaneRepeats, liquidityDirection, snapshot, timeframe]);
  useEffect(() => {
    const values = new Map(wall.lanes.flatMap((lane) => lane.entries.map((entry) => [`${lane.id}:${entry.opportunity.id}`, JSON.stringify(entry.metric)] as const)));
    const previous = previousValuesRef.current;
    previousValuesRef.current = values;
    if (!previous) return;
    const changed = new Set([...values].filter(([key, value]) => previous.has(key) && previous.get(key) !== value).map(([key]) => key));
    if (!changed.size) return;
    setHighlighted(changed);
    const timer = window.setTimeout(() => setHighlighted(new Set()), 1_800);
    return () => window.clearTimeout(timer);
  }, [wall]);

  const syncLock = useCallback(() => onInteractionChange(hoverRef.current || focusRef.current), [onInteractionChange]);
  const handleScroll = useCallback(() => {
    onInteractionChange(true);
    if (scrollTimerRef.current) window.clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = window.setTimeout(syncLock, 900);
  }, [onInteractionChange, syncLock]);
  useEffect(() => () => { if (scrollTimerRef.current) window.clearTimeout(scrollTimerRef.current); }, []);

  return <section className="min-w-0" data-testid="live-market-wall" data-live-wall-timeframe={timeframe} data-visible-opportunities={wall.visibleOpportunityCount} data-cross-lane-duplicates={wall.duplicateCount} onMouseEnter={() => { hoverRef.current = true; syncLock(); }} onMouseLeave={() => { hoverRef.current = false; syncLock(); }} onFocusCapture={() => { focusRef.current = true; syncLock(); }} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { focusRef.current = false; syncLock(); } }}>
    <header className="mb-2 flex flex-wrap items-end justify-between gap-2 px-1">
      <div><p className="text-[9px] font-bold uppercase tracking-[0.16em] text-base-mint">{t("terminalV3.wall")}</p><h2 className="mt-0.5 text-sm font-semibold text-base-text sm:text-base">{t("terminalV3.wallSubtitle")}</h2><p className="mt-1 flex flex-wrap gap-2 font-mono text-[9px] text-base-muted"><span data-testid="wall-visible-unique">{t("terminalV3.visibleUnique", { count: wall.visibleOpportunityCount })}</span><span data-testid="wall-duplicate-count">{t("terminalV3.duplicateCount", { count: wall.duplicateCount })}</span></p></div>
      <div className="flex flex-wrap items-center justify-end gap-1.5"><span className="mr-1 text-[8px] uppercase tracking-[0.1em] text-base-muted">{t("terminalV3.timeframe")}</span>{TIMEFRAMES.map((item) => <button key={item} type="button" onClick={() => setTimeframe(item)} aria-pressed={timeframe === item} className={cx("min-h-9 rounded-sm px-3 font-mono text-[9px]", timeframe === item ? "bg-base-mint text-[#031411]" : "bg-base-elevated text-base-muted")}>{displayWindow(item)}</button>)}<label className="ml-1 flex min-h-9 items-center gap-2 rounded-sm bg-base-elevated px-2 text-[8px] text-base-muted"><input type="checkbox" checked={allowCrossLaneRepeats} onChange={(event) => setAllowCrossLaneRepeats(event.target.checked)} />{allowCrossLaneRepeats ? t("terminalV3.allowRepeats") : t("terminalV3.diverseMode")}</label></div>
    </header>
    <div className="live-wall-grid" onScroll={handleScroll} data-testid="live-wall-lanes">
      {wall.lanes.map((lane) => <LiveWallLaneCard key={lane.id} lane={lane} selectedPair={selectedPair} snapshot={snapshot} highlighted={highlighted} liquidityDirection={liquidityDirection} onLiquidityDirection={setLiquidityDirection} onSelect={onSelect} onTrade={onTrade} formatCompactCurrency={formatCompactCurrency} formatPercent={formatPercent} locale={locale} />)}
    </div>
  </section>;
}

function LiveWallLaneCard({ lane, selectedPair, snapshot, highlighted, liquidityDirection, onLiquidityDirection, onSelect, onTrade, formatCompactCurrency, formatPercent, locale }: {
  lane: LiveWallLane;
  selectedPair: BasePair;
  snapshot: MarketTerminalSnapshot;
  highlighted: Set<string>;
  liquidityDirection: LiquidityDirection;
  onLiquidityDirection: (value: LiquidityDirection) => void;
  onSelect: (pairId: string) => void;
  onTrade: (pair: BasePair, side: "buy" | "sell") => void;
  formatCompactCurrency: (value: number) => string;
  formatPercent: (value: number) => string;
  locale: "tr" | "en";
}) {
  const { t } = useI18n();
  const title = laneTitle(lane, t);
  return <article className={cx("live-wall-lane pulse-surface overflow-hidden rounded-lg", laneAccent(lane.id))} data-testid={`live-wall-lane-${lane.id}`} data-lane-count={lane.entries.length} data-lane-eligible={lane.eligibleCount} data-lane-fallback={lane.fallback || undefined}>
    <header className="flex min-h-12 items-start justify-between gap-2 px-2.5 pb-1 pt-2"><div className="min-w-0"><p className="truncate text-[10px] font-bold uppercase tracking-[0.08em] text-base-text">{title}</p><p className="mt-0.5 flex items-center gap-1.5 font-mono text-[8px] text-base-muted"><span className={cx("h-1.5 w-1.5 rounded-full", lane.freshness === "fresh" ? "bg-base-mint" : lane.freshness === "delayed" ? "bg-base-amber" : "bg-base-muted")} />{lane.baselinePending ? t("terminalV3.baselinePending") : `${lane.eligibleCount} · ${lane.timeframe === "age" ? "7d" : lane.timeframe === "snapshot" ? `${snapshot.comparison.previousGeneratedAt ? "Δ" : "—"}` : displayWindow(lane.timeframe)}`}</p></div><Link href={`/terminal?view=markets&data=${snapshot.mode}`} className="inline-flex min-h-8 shrink-0 items-center gap-1 px-1.5 text-[8px] font-semibold text-base-mint">{t("terminalV3.viewAll")}<ArrowRight size={10} /></Link></header>
    {lane.id === "liquidity" ? <div className="mx-2 mb-1 grid grid-cols-3 gap-1">{(["all", "added", "removed"] as const).map((value) => <button key={value} type="button" onClick={() => onLiquidityDirection(value)} aria-pressed={liquidityDirection === value} className={cx("min-h-7 rounded-sm px-1 text-[7px]", liquidityDirection === value ? "bg-base-mint/15 text-base-mint" : "bg-base-elevated text-base-muted")}>{t(value === "all" ? "terminalV3.liquidityAll" : value === "added" ? "terminalV3.liquidityAdded" : "terminalV3.liquidityRemoved")}</button>)}</div> : null}
    <div className="divide-y divide-base-line/40">
      {lane.entries.map((entry) => <LiveWallRow key={entry.opportunity.id} entry={entry} selected={entry.opportunity.poolMarketIds.includes(selectedPair.id)} highlighted={highlighted.has(`${lane.id}:${entry.opportunity.id}`)} onSelect={onSelect} onTrade={onTrade} formatCompactCurrency={formatCompactCurrency} formatPercent={formatPercent} locale={locale} />)}
      {lane.entries.length === 0 ? <p className="flex min-h-36 items-center px-3 text-[9px] leading-4 text-base-muted">{t("terminalV3.noVerifiedMarkets")}</p> : null}
    </div>
    <footer className="px-2.5 py-1 text-right font-mono text-[7px] text-base-muted">{t("terminalV3.updated", { time: formatObservedTime(snapshot.receivedAt, locale) })}</footer>
  </article>;
}

function LiveWallRow({ entry, selected, highlighted, onSelect, onTrade, formatCompactCurrency, formatPercent, locale }: { entry: LiveWallEntry; selected: boolean; highlighted: boolean; onSelect: (pairId: string) => void; onTrade: (pair: BasePair, side: "buy" | "sell") => void; formatCompactCurrency: (value: number) => string; formatPercent: (value: number) => string; locale: "tr" | "en" }) {
  const { t } = useI18n();
  const { opportunity, pair, metric } = entry;
  const primary = formatWallMetric(metric, formatCompactCurrency, formatPercent, locale, t);
  const secondary = secondaryWallMetric(metric, entry, formatCompactCurrency, formatPercent, t);
  return <div className={cx("group grid min-h-9 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 px-2 py-1 transition-colors motion-reduce:transition-none", selected && "bg-base-mint/10", highlighted && "market-update-flash")} data-testid={`wall-row-${opportunity.id}`} data-opportunity-id={opportunity.id}>
    <button type="button" onClick={() => onSelect(pair.id)} className="flex min-w-0 items-center gap-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-base-mint/50" aria-label={t("terminalV3.inspect", { pair: opportunity.focusTokenSymbol })}><PairAvatarStack baseSymbol={pair.baseToken} quoteSymbol={pair.quoteToken} baseLogoUrl={pair.tokenLogoUrl} quoteLogoUrl={pair.quoteTokenLogoUrl} baseAddress={opportunity.focusTokenAddress} quoteAddress={pair.quoteTokenAddress} baseName={opportunity.focusTokenName} chainId={pair.chainId} observedAt={pair.sourceUpdatedAt} size="sm" /><span className="min-w-0"><strong className="block truncate font-mono text-[9px] text-base-text">{opportunity.focusTokenSymbol}</strong><small className="block truncate text-[7px] text-base-muted">{pair.dexName ?? pair.dex} · {secondary}</small></span></button>
    <span className="flex items-center gap-1"><span className="flex max-w-[34px] overflow-hidden"><MarketSignalBadges opportunity={opportunity} pair={pair} maximumMarketBadges={1} presentation="rowPrimary" /></span><span className={cx("min-w-[54px] text-right font-mono text-[9px] font-semibold", metricTone(metric))}>{primary}</span><button type="button" onClick={() => onSelect(pair.id)} className="grid h-7 w-7 place-items-center rounded-sm bg-base-elevated text-base-muted opacity-70 hover:text-base-mint focus-visible:opacity-100" aria-label={t("terminalV3.inspect", { pair: opportunity.focusTokenSymbol })}><Eye size={11} /></button><button type="button" onClick={() => onTrade(pair, "buy")} className="min-h-7 rounded-sm bg-base-mint/10 px-2 text-[8px] font-bold text-base-mint">{t("trade.buy")}</button></span>
  </div>;
}

function laneTitle(lane: LiveWallLane, t: ReturnType<typeof useI18n>["t"]) {
  if (lane.id === "new") return t("terminalV3.lane.new");
  if (lane.id === "gainers") return t("terminalV3.lane.gainers");
  if (lane.id === "losers") return t("terminalV3.lane.losers");
  if (lane.id === "volume") return t(lane.fallback ? "terminalV3.lane.volumeLeaders" : "terminalV3.lane.volumeInflow");
  if (lane.id === "liquidity") return t("terminalV3.lane.liquidityMovers");
  return t("terminalV3.lane.traded");
}

function laneAccent(id: LiveWallLaneId) {
  if (id === "new") return "live-wall-accent-new";
  if (id === "gainers") return "live-wall-accent-positive";
  if (id === "losers") return "live-wall-accent-negative";
  if (id === "volume") return "live-wall-accent-volume";
  if (id === "liquidity") return "live-wall-accent-liquidity";
  return "live-wall-accent-traded";
}

function metricTone(metric: LiveWallEntry["metric"]) {
  if (metric.kind === "change" || metric.kind === "liquidity_added") return metric.current >= 0 ? "text-base-mint" : "text-base-rose";
  if (metric.kind === "liquidity_removed") return "text-base-rose";
  if (metric.kind === "volume_inflow") return "text-violet-300";
  if (metric.kind === "age") return "text-sky-300";
  return "text-base-text";
}

function formatWallMetric(metric: LiveWallEntry["metric"], currency: (value: number) => string, percent: (value: number) => string, locale: "tr" | "en", t: ReturnType<typeof useI18n>["t"]) {
  if (metric.kind === "age") return formatAge(metric.current, locale);
  if (metric.kind === "change") return percent(metric.current);
  if (metric.kind === "volume_inflow") return `+${currency(metric.delta ?? 0)}`;
  if (metric.kind === "volume_leader") return currency(metric.current);
  if (metric.kind === "liquidity_added" || metric.kind === "liquidity_removed") return `${(metric.delta ?? 0) >= 0 ? "+" : "−"}${currency(Math.abs(metric.delta ?? 0))}`;
  return t("terminalV3.tradeCount", { count: Math.round(metric.current) });
}

function secondaryWallMetric(metric: LiveWallEntry["metric"], entry: LiveWallEntry, currency: (value: number) => string, percent: (value: number) => string, t: ReturnType<typeof useI18n>["t"]) {
  if (metric.kind === "age") return entry.opportunity.poolCount === 1 ? t("terminalV3.onePool") : t("terminalV3.poolCount", { count: entry.opportunity.poolCount });
  if (metric.kind === "change") return `${displayWindow(metric.window as LiveWallTimeframe)} · ${currency(entry.opportunity.aggregate.liquidityUsd ?? 0)}`;
  if (metric.kind === "volume_inflow") return `${metric.ratio?.toFixed(2)}× · ${currency(metric.current)}`;
  if (metric.kind === "volume_leader") return `${displayWindow(metric.window as LiveWallTimeframe)} · ${t("terminalV3.baselinePending")}`;
  if (metric.kind === "liquidity_added" || metric.kind === "liquidity_removed") return t("terminalV3.previousToCurrent", { previous: currency(metric.previous ?? 0), current: currency(metric.current) });
  return `${displayWindow(metric.window as LiveWallTimeframe)} · ${currency(entry.opportunity.aggregate.volumes?.[metric.window as LiveWallTimeframe] ?? 0)}`;
}

function formatPulseValue(signal: PulseSignal, currency: (value: number) => string, percent: (value: number) => string) {
  if (signal.currentValue === undefined) return signal.value === undefined ? "" : signal.metric === "price_change_percent" ? percent(signal.value) : String(signal.value);
  const format = signal.metric === "price_usd" || signal.metric === "volume_usd" || signal.metric === "liquidity_usd" ? currency : signal.metric === "price_change_percent" ? percent : (value: number) => String(value);
  return `${signal.previousValue === undefined ? "—" : format(signal.previousValue)} → ${format(signal.currentValue)}`;
}

function displayWindow(value: LiveWallTimeframe) {
  return value === "m5" ? "5m" : value === "h1" ? "1h" : "24h";
}

function formatAge(minutes: number, locale: "tr" | "en") {
  if (minutes < 60) return `${Math.max(0, Math.round(minutes))}${locale === "tr" ? "dk" : "m"}`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)}${locale === "tr" ? "sa" : "h"}`;
  return `${Math.round(minutes / (24 * 60))}${locale === "tr" ? "g" : "d"}`;
}

function formatObservedTime(value: string, locale: "tr" | "en") {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleTimeString(locale === "tr" ? "tr-TR" : "en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "—";
}

const PULSE_EVENT_KEYS: Record<PulseEventType, TranslationKey> = {
  new_pool: "signal.new_pool",
  new_opportunity: "signal.new_opportunity",
  primary_market_changed: "signal.primary_market_changed",
  entered_trending: "signal.entered_trending",
  entered_top_gainers: "signal.entered_top_gainers",
  price_move: "signal.price_move",
  volume_burst: "signal.volume_burst",
  liquidity_change: "signal.liquidity_change",
  watchlist_move: "signal.watchlist_move",
  data_recovered: "signal.data_recovered",
  data_delayed: "signal.data_delayed"
};

const PULSE_FRESHNESS_KEYS: Record<NonNullable<PulseSignal["freshness"]>, TranslationKey> = {
  fresh: "marketSignal.freshnessValue.fresh",
  delayed: "marketSignal.freshnessValue.delayed",
  static: "marketSignal.freshnessValue.static"
};
