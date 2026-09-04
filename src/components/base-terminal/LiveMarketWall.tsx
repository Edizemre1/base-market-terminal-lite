"use client";

import { Activity, ChevronsDown, ChevronsUp, Eye } from "lucide-react";
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

  return <section className="pulse-surface overflow-hidden rounded-card" data-testid="live-pulse-rail" aria-label={t("terminalV3.livePulse")} onMouseEnter={pause} onMouseLeave={resume} onFocusCapture={pause} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) resume(); }}>
    <div className="flex min-h-14 items-stretch gap-2 overflow-x-auto px-2 py-2 motion-reduce:scroll-auto">
      <div className="sticky left-0 z-layer-sticky flex w-24 shrink-0 items-center gap-2 bg-surface-panel pr-2"><span className="grid h-8 w-8 place-items-center rounded-pill bg-freshness-live/10 text-freshness-live"><Activity size={14} /></span><span><b className="block text-meta uppercase tracking-eyebrow text-freshness-live">{t("terminalV3.livePulse")}</b><small className="text-meta text-content-secondary">{rows.length}</small></span></div>
      {rows.length ? rows.map((signal) => <button key={signal.key} type="button" disabled={!signal.pairId} onClick={() => signal.pairId && onSelect(signal.pairId)} className="group min-w-[250px] max-w-[320px] shrink-0 rounded-control bg-surface-interactive/75 px-3 py-2 text-left outline-none transition-colors hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-focus motion-reduce:transition-none" data-pulse-event={signal.type}>
        <span className="flex items-center justify-between gap-2"><strong className="truncate text-meta text-content-primary">{signal.pair ?? t(PULSE_EVENT_KEYS[signal.type])}</strong><span className={cx("shrink-0 font-mono text-meta", signal.direction === "up" ? "text-market-positive" : signal.direction === "down" ? "text-market-negative" : "text-content-secondary")}>{formatPulseValue(signal, formatCompactCurrency, formatPercent)}</span></span>
        <span className="mt-1 flex items-center justify-between gap-2 text-meta text-content-secondary"><span className="truncate">{t(PULSE_EVENT_KEYS[signal.type])}</span><span className="shrink-0">{signal.timeframe === "snapshot" || !signal.timeframe ? t("alerts.snapshot") : signal.timeframe} · {formatObservedTime(signal.createdAt, locale)}</span></span>
        <span className="mt-1 block truncate text-meta text-content-secondary/80">{signal.source} · {t(PULSE_FRESHNESS_KEYS[signal.freshness ?? "fresh"])}</span>
      </button>) : <p className="flex min-w-[300px] items-center text-meta text-content-secondary">{t("terminalV3.livePulseEmpty")}</p>}
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
  const [expandedLane, setExpandedLane] = useState<LiveWallLaneId>();
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

  const wall = useMemo(() => buildLiveMarketWall(snapshot, { timeframe, allowCrossLaneRepeats, liquidityDirection, limit: 12 }), [allowCrossLaneRepeats, liquidityDirection, snapshot, timeframe]);
  const renderedLanes = useMemo(() => wall.lanes.map((lane) => ({ ...lane, entries: lane.entries.slice(0, expandedLane === lane.id ? 12 : 4) })), [expandedLane, wall.lanes]);
  const renderedIds = renderedLanes.flatMap((lane) => lane.entries.map((entry) => entry.opportunity.id));
  const visibleOpportunityCount = new Set(renderedIds).size;
  const duplicateCount = renderedIds.length - visibleOpportunityCount;
  useEffect(() => {
    const values = new Map(wall.lanes.flatMap((lane) => lane.entries.map((entry) => [`${lane.id}:${entry.opportunity.id}`, JSON.stringify(entry.metric)] as const)));
    const previous = previousValuesRef.current;
    previousValuesRef.current = values;
    if (!previous) return;
    const changed = new Set([...values].filter(([key, value]) => previous.has(key) && previous.get(key) !== value).map(([key]) => key));
    if (!changed.size) return;
    setHighlighted(changed);
    const timer = window.setTimeout(() => setHighlighted(new Set()), 900);
    return () => window.clearTimeout(timer);
  }, [wall]);

  const syncLock = useCallback(() => onInteractionChange(hoverRef.current || focusRef.current), [onInteractionChange]);
  const handleScroll = useCallback(() => {
    onInteractionChange(true);
    if (scrollTimerRef.current) window.clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = window.setTimeout(syncLock, 900);
  }, [onInteractionChange, syncLock]);
  useEffect(() => () => { if (scrollTimerRef.current) window.clearTimeout(scrollTimerRef.current); }, []);

  return <section className="min-w-0" data-testid="live-market-wall" data-live-wall-timeframe={timeframe} data-visible-opportunities={visibleOpportunityCount} data-cross-lane-duplicates={duplicateCount} onMouseEnter={() => { hoverRef.current = true; syncLock(); }} onMouseLeave={() => { hoverRef.current = false; syncLock(); }} onFocusCapture={() => { focusRef.current = true; syncLock(); }} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { focusRef.current = false; syncLock(); } }}>
    <header className="mb-2 flex flex-wrap items-end justify-between gap-2 px-1">
      <div><p className="text-meta font-bold uppercase tracking-eyebrow text-content-secondary">{t("terminalV3.wall")}</p><h2 className="mt-1 text-title-sm font-semibold text-content-primary">{t("terminalV3.wallSubtitle")}</h2><p className="mt-1 flex flex-wrap gap-2 font-mono text-meta text-content-secondary"><span data-testid="wall-visible-unique">{t("terminalV3.visibleUnique", { count: visibleOpportunityCount })}</span><span data-testid="wall-duplicate-count">{t("terminalV3.duplicateCount", { count: duplicateCount })}</span></p></div>
      <div className="flex flex-wrap items-center justify-end gap-2"><span className="mr-1 text-meta uppercase tracking-eyebrow text-content-secondary">{t("terminalV3.timeframe")}</span>{TIMEFRAMES.map((item) => <button key={item} type="button" onClick={() => setTimeframe(item)} aria-pressed={timeframe === item} className={cx("min-h-9 rounded-control px-3 font-mono text-meta", timeframe === item ? "bg-surface-selected text-content-primary" : "bg-surface-interactive text-content-secondary")}>{displayWindow(item)}</button>)}<label className="ml-1 flex min-h-9 items-center gap-2 rounded-control bg-surface-interactive px-2 text-meta text-content-secondary"><input type="checkbox" checked={allowCrossLaneRepeats} onChange={(event) => setAllowCrossLaneRepeats(event.target.checked)} />{allowCrossLaneRepeats ? t("terminalV3.allowRepeats") : t("terminalV3.diverseMode")}</label></div>
    </header>
    <div className="live-wall-grid" onScroll={handleScroll} data-testid="live-wall-lanes">
      {renderedLanes.map((lane) => <LiveWallLaneCard key={lane.id} lane={lane} availableEntryCount={wall.lanes.find((item) => item.id === lane.id)?.entries.length ?? lane.entries.length} expanded={expandedLane === lane.id} onExpandedChange={(expanded) => setExpandedLane(expanded ? lane.id : undefined)} selectedPair={selectedPair} snapshot={snapshot} highlighted={highlighted} liquidityDirection={liquidityDirection} onLiquidityDirection={setLiquidityDirection} onSelect={onSelect} onTrade={onTrade} formatCompactCurrency={formatCompactCurrency} formatPercent={formatPercent} locale={locale} />)}
    </div>
  </section>;
}

function LiveWallLaneCard({ lane, availableEntryCount, expanded, onExpandedChange, selectedPair, snapshot, highlighted, liquidityDirection, onLiquidityDirection, onSelect, onTrade, formatCompactCurrency, formatPercent, locale }: {
  lane: LiveWallLane;
  availableEntryCount: number;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
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
  return <article className={cx("live-wall-lane pulse-surface overflow-hidden rounded-card", laneAccent(lane.id))} data-testid={`live-wall-lane-${lane.id}`} data-lane-count={lane.entries.length} data-lane-eligible={lane.eligibleCount} data-lane-fallback={lane.fallback || undefined} data-lane-freshness={lane.freshness}>
    <header className="flex min-h-12 items-start justify-between gap-2 px-3 pb-1 pt-2"><div className="min-w-0"><p className="truncate text-label font-semibold text-content-primary">{title}</p><p className="mt-1 flex items-center gap-2 font-mono text-meta text-content-secondary"><span className={cx("h-2 w-2 rounded-pill", lane.freshness === "fresh" ? "bg-freshness-live" : lane.freshness === "delayed" ? "bg-freshness-delayed" : "bg-content-secondary")} />{lane.baselinePending ? t("terminalV3.baselinePending") : `${lane.eligibleCount} · ${lane.timeframe === "age" ? "7d" : lane.timeframe === "snapshot" ? `${snapshot.comparison.previousGeneratedAt ? "Δ" : "—"}` : displayWindow(lane.timeframe)}`}</p></div>{availableEntryCount > 4 ? <button type="button" onClick={() => onExpandedChange(!expanded)} aria-expanded={expanded} className="inline-flex min-h-8 shrink-0 items-center gap-1 px-2 text-meta font-semibold text-content-secondary hover:text-content-primary" data-testid={`lane-expand-${lane.id}`}>{t(expanded ? "terminalV3.collapseLane" : "terminalV3.expandLane", { count: availableEntryCount })}{expanded ? <ChevronsUp size={12} /> : <ChevronsDown size={12} />}</button> : null}</header>
    {lane.id === "liquidity" ? <div className="mx-2 mb-1 grid grid-cols-3 gap-1">{(["all", "added", "removed"] as const).map((value) => <button key={value} type="button" onClick={() => onLiquidityDirection(value)} aria-pressed={liquidityDirection === value} className={cx("min-h-8 rounded-control px-1 text-meta", liquidityDirection === value ? "bg-surface-selected text-content-primary" : "bg-surface-interactive text-content-secondary")}>{t(value === "all" ? "terminalV3.liquidityAll" : value === "added" ? "terminalV3.liquidityAdded" : "terminalV3.liquidityRemoved")}</button>)}</div> : null}
    <div className="divide-y divide-border-subtle/40">
      {lane.entries.map((entry) => <LiveWallRow key={entry.opportunity.id} entry={entry} selected={entry.opportunity.poolMarketIds.includes(selectedPair.id)} highlighted={highlighted.has(`${lane.id}:${entry.opportunity.id}`)} onSelect={onSelect} onTrade={onTrade} formatCompactCurrency={formatCompactCurrency} formatPercent={formatPercent} locale={locale} />)}
      {lane.entries.length === 0 ? <p className="flex min-h-36 items-center px-3 text-meta leading-4 text-content-secondary">{t("terminalV3.noVerifiedMarkets")}</p> : null}
    </div>
    <footer className="px-3 py-1 text-right font-mono text-meta text-content-secondary">{t("terminalV3.updated", { time: formatObservedTime(snapshot.receivedAt, locale) })}</footer>
  </article>;
}

function LiveWallRow({ entry, selected, highlighted, onSelect, onTrade, formatCompactCurrency, formatPercent, locale }: { entry: LiveWallEntry; selected: boolean; highlighted: boolean; onSelect: (pairId: string) => void; onTrade: (pair: BasePair, side: "buy" | "sell") => void; formatCompactCurrency: (value: number) => string; formatPercent: (value: number) => string; locale: "tr" | "en" }) {
  const { t } = useI18n();
  const { opportunity, pair, metric } = entry;
  const primary = formatWallMetric(metric, formatCompactCurrency, formatPercent, locale, t);
  const secondary = secondaryWallMetric(metric, entry, formatCompactCurrency, formatPercent, t);
  return <div className={cx("group grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 px-2 py-1 transition-colors motion-reduce:transition-none", selected && "bg-surface-selected")} data-testid={`wall-row-${opportunity.id}`} data-opportunity-id={opportunity.id} data-quality-band={opportunity.qualityBand} data-liquidity-state={opportunity.liquidityState} data-freshness={pair.stale ? "delayed" : "fresh"}>
    <button type="button" onClick={() => onSelect(pair.id)} className="flex min-w-0 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-focus" aria-label={t("terminalV3.inspect", { pair: opportunity.focusTokenSymbol })}><PairAvatarStack baseSymbol={pair.baseToken} quoteSymbol={pair.quoteToken} baseLogoUrl={pair.tokenLogoUrl} quoteLogoUrl={pair.quoteTokenLogoUrl} baseAddress={opportunity.focusTokenAddress} quoteAddress={pair.quoteTokenAddress} baseName={opportunity.focusTokenName} chainId={pair.chainId} observedAt={pair.sourceUpdatedAt} size="sm" /><span className="min-w-0"><strong className="block truncate font-mono text-data text-content-primary">{opportunity.focusTokenSymbol}</strong><small className="block truncate text-meta text-content-secondary">{pair.dexName ?? pair.dex} · {secondary}</small><small className="block truncate text-meta text-content-secondary/80">{opportunity.qualityBand} · {t(`terminalV3.liquidityState.${opportunity.liquidityState}`)} · {pair.stale ? t("common.delayed") : t("terminalV3.fresh")}</small></span></button>
    <span className="flex items-center gap-1"><span className="flex max-w-[82px] overflow-hidden"><MarketSignalBadges opportunity={opportunity} pair={pair} maximumMarketBadges={3} presentation="rowPrimary" /></span><span className={cx("min-w-[54px] rounded-control px-1 text-right font-mono text-data font-semibold tabular-nums", metricTone(metric), highlighted && "market-update-flash")} data-cell-updated={highlighted || undefined}>{primary}</span><button type="button" onClick={() => onSelect(pair.id)} className="grid h-8 w-8 place-items-center rounded-control bg-surface-interactive text-content-secondary opacity-70 hover:text-content-primary focus-visible:opacity-100" aria-label={t("terminalV3.inspect", { pair: opportunity.focusTokenSymbol })}><Eye size={12} /></button>{opportunity.rankingEligibility ? <button type="button" onClick={() => onTrade(pair, "buy")} className="h-8 rounded-control bg-brand-action px-2 text-meta font-bold text-content-on-accent">{t("trade.checkQuote")}</button> : null}</span>
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
  if (metric.kind === "change" || metric.kind === "liquidity_added") return metric.current >= 0 ? "text-market-positive" : "text-market-negative";
  if (metric.kind === "liquidity_removed") return "text-market-negative";
  if (metric.kind === "volume_inflow" || metric.kind === "volume_leader") return "text-market-volume";
  if (metric.kind === "age") return "text-network-base";
  return "text-content-primary";
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
  if (metric.kind === "change") return `${displayWindow(metric.window as LiveWallTimeframe)} · ${formatOptionalCurrency(entry.opportunity.aggregate.liquidityUsd, currency)}`;
  if (metric.kind === "volume_inflow") return `${metric.ratio?.toFixed(2)}× · ${currency(metric.current)}`;
  if (metric.kind === "volume_leader") return `${displayWindow(metric.window as LiveWallTimeframe)} · ${t("terminalV3.baselinePending")}`;
  if (metric.kind === "liquidity_added" || metric.kind === "liquidity_removed") return t("terminalV3.previousToCurrent", { previous: formatOptionalCurrency(metric.previous, currency), current: formatOptionalCurrency(metric.current, currency) });
  return `${displayWindow(metric.window as LiveWallTimeframe)} · ${formatOptionalCurrency(entry.opportunity.aggregate.volumes?.[metric.window as LiveWallTimeframe], currency)}`;
}

function formatOptionalCurrency(value: number | undefined, currency: (value: number) => string) {
  return typeof value === "number" && Number.isFinite(value) ? currency(value) : "—";
}

function formatPulseValue(signal: PulseSignal, currency: (value: number) => string, percent: (value: number) => string) {
  if (signal.currentValue === undefined) return signal.value === undefined ? "" : signal.metric === "price_change_percent" ? percent(signal.value) : String(signal.value);
  const format = signal.metric === "price_usd" || signal.metric === "volume_usd" || signal.metric === "liquidity_usd" ? currency : signal.metric === "price_change_percent" ? percent : (value: number) => String(value);
  return `${signal.previousValue === undefined ? "—" : format(signal.previousValue)} → ${format(signal.currentValue)}`;
}

function displayWindow(value: LiveWallTimeframe | "snapshot") {
  return value === "snapshot" ? "Δ" : value === "m5" ? "5m" : value === "h1" ? "1h" : "24h";
}

function formatAge(minutes: number, locale: "tr" | "en") {
  if (minutes < 60) return `${Math.max(0, Math.round(minutes))}${locale === "tr" ? "dk" : "m"}`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)}${locale === "tr" ? "sa" : "h"}`;
  return `${Math.round(minutes / (24 * 60))}${locale === "tr" ? "g" : "d"}`;
}

function formatObservedTime(value: string, locale: "tr" | "en") {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleTimeString(locale === "tr" ? "tr-TR" : "en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "UTC" }) : "—";
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
