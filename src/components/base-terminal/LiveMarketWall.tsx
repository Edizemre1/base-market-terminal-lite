"use client";

import { ChevronRight, ChevronsDown, ChevronsUp } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MarketSignalBadges } from "@/components/base-terminal/MarketSignalBadges";
import { PairAvatarStack } from "@/components/TokenIdentity";
import type { MarketTerminalSnapshot } from "@/data/providers";
import { useI18n } from "@/i18n/I18nProvider";
import { buildLiveMarketWall, type LiquidityDirection, type LiveWallEntry, type LiveWallLane, type LiveWallLaneId, type LiveWallTimeframe } from "@/lib/base-terminal/liveMarketWall";
import { cx } from "@/lib/format";
import { safeReadJson, safeSetStorageItem } from "@/lib/safeStorage";
import type { BasePair } from "@/types/baseTerminal";
import { getMarketPresentation } from "@/lib/base-terminal/marketPresentation";

const WALL_STORAGE_KEY = "mergen-terminal:live-wall:v1";
const TIMEFRAMES: LiveWallTimeframe[] = ["m5", "h1", "h24"];

export function LiveMarketWall({ snapshot, placementSnapshot = snapshot, selectedPair, onSelect, onInteractionChange }: {
  snapshot: MarketTerminalSnapshot;
  placementSnapshot?: MarketTerminalSnapshot;
  selectedPair: BasePair;
  onSelect: (pairId: string) => void;
  onInteractionChange: (locked: boolean) => void;
}) {
  const { t, locale, formatCompactCurrency, formatPercent } = useI18n();
  const [timeframe, setTimeframe] = useState<LiveWallTimeframe>("h24");
  const [liquidityDirection, setLiquidityDirection] = useState<LiquidityDirection>("all");
  const [expandedLane, setExpandedLane] = useState<LiveWallLaneId>();
  const [activeLane, setActiveLane] = useState<LiveWallLaneId>("new");
  const [loaded, setLoaded] = useState(false);
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());
  const previousValuesRef = useRef<Map<string, string> | undefined>(undefined);
  const hoverRef = useRef(false);
  const focusRef = useRef(false);

  useEffect(() => {
    const stored = safeReadJson<{ timeframe?: LiveWallTimeframe }>(WALL_STORAGE_KEY, {});
    if (stored.timeframe && TIMEFRAMES.includes(stored.timeframe)) setTimeframe(stored.timeframe);
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded) safeSetStorageItem(WALL_STORAGE_KEY, JSON.stringify({ timeframe }));
  }, [loaded, timeframe]);

  const wall = useMemo(() => {
    const placement = buildLiveMarketWall(placementSnapshot, { timeframe, allowCrossLaneRepeats: false, liquidityDirection, limit: 12 });
    if (placementSnapshot === snapshot) return placement;
    const live = buildLiveMarketWall(snapshot, { timeframe, allowCrossLaneRepeats: false, liquidityDirection, limit: 12 });
    const livePairs = new Map(snapshot.allPairs.map((pair) => [pair.id, pair]));
    const liveOpportunities = new Map(snapshot.opportunities.map((opportunity) => [opportunity.id, opportunity]));
    const liveByLane = new Map(live.lanes.flatMap((lane) => lane.entries.map((entry) => [`${lane.id}:${entry.opportunity.id}`, entry] as const)));
    const liveByOpportunity = new Map(live.lanes.flatMap((lane) => lane.entries.map((entry) => [entry.opportunity.id, entry] as const)));
    return {
      ...live,
      lanes: placement.lanes.map((lane) => {
        const liveLane = live.lanes.find((candidate) => candidate.id === lane.id) ?? lane;
        return {
          ...liveLane,
          entries: lane.entries.map((entry) => {
            const liveEntry = liveByLane.get(`${lane.id}:${entry.opportunity.id}`) ?? liveByOpportunity.get(entry.opportunity.id);
            return liveEntry ?? {
              ...entry,
              opportunity: liveOpportunities.get(entry.opportunity.id) ?? entry.opportunity,
              pair: livePairs.get(entry.pair.id) ?? entry.pair
            };
          })
        };
      })
    };
  }, [liquidityDirection, placementSnapshot, snapshot, timeframe]);
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
  return <section className="min-w-0" data-testid="live-market-wall" data-live-wall-timeframe={timeframe} data-visible-opportunities={visibleOpportunityCount} data-cross-lane-duplicates={duplicateCount} onMouseEnter={() => { hoverRef.current = true; syncLock(); }} onMouseLeave={() => { hoverRef.current = false; syncLock(); }} onFocusCapture={() => { focusRef.current = true; syncLock(); }} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { focusRef.current = false; syncLock(); } }}>
    <header className="mb-2 flex flex-wrap items-end justify-between gap-2 px-1">
      <div><p className="text-meta font-bold uppercase tracking-eyebrow text-content-secondary">{t("terminalV3.wall")}</p><h2 className="mt-1 text-title-sm font-semibold text-content-primary">{t("terminalV3.wallSubtitle")}</h2></div>
      <div className="flex items-center justify-end gap-1"><span className="mr-1 hidden text-meta uppercase tracking-eyebrow text-content-secondary sm:inline">{t("terminalV3.timeframe")}</span>{TIMEFRAMES.map((item) => <button key={item} type="button" onClick={() => setTimeframe(item)} aria-pressed={timeframe === item} className={cx("h-control-touch rounded-control px-3 font-mono text-meta md:h-control-s", timeframe === item ? "bg-surface-selected text-content-primary" : "bg-surface-interactive text-content-secondary")}>{displayWindow(item)}</button>)}</div>
    </header>
    <div className="mb-2 grid grid-cols-2 gap-1 pb-1 md:hidden" role="tablist" aria-label={t("terminalV3.lanes")} data-testid="live-wall-lane-switcher">{renderedLanes.map((lane) => <button key={lane.id} type="button" role="tab" aria-selected={activeLane === lane.id} onClick={() => setActiveLane(lane.id)} className={cx("min-h-control-touch rounded-control px-2 text-meta font-semibold", activeLane === lane.id ? "bg-surface-selected text-content-primary" : "bg-surface-interactive text-content-secondary")}>{laneTitle(lane, t)}</button>)}</div>
    <div className="live-wall-grid" data-testid="live-wall-lanes">
      {renderedLanes.map((lane) => <LiveWallLaneCard key={lane.id} lane={lane} mobileActive={activeLane === lane.id} availableEntryCount={wall.lanes.find((item) => item.id === lane.id)?.entries.length ?? lane.entries.length} expanded={expandedLane === lane.id} onExpandedChange={(expanded) => setExpandedLane(expanded ? lane.id : undefined)} selectedPair={selectedPair} snapshot={snapshot} highlighted={highlighted} liquidityDirection={liquidityDirection} onLiquidityDirection={setLiquidityDirection} onSelect={onSelect} formatCompactCurrency={formatCompactCurrency} formatPercent={formatPercent} locale={locale} />)}
    </div>
  </section>;
}

function LiveWallLaneCard({ lane, mobileActive, availableEntryCount, expanded, onExpandedChange, selectedPair, snapshot, highlighted, liquidityDirection, onLiquidityDirection, onSelect, formatCompactCurrency, formatPercent, locale }: {
  lane: LiveWallLane;
  mobileActive: boolean;
  availableEntryCount: number;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  selectedPair: BasePair;
  snapshot: MarketTerminalSnapshot;
  highlighted: Set<string>;
  liquidityDirection: LiquidityDirection;
  onLiquidityDirection: (value: LiquidityDirection) => void;
  onSelect: (pairId: string) => void;
  formatCompactCurrency: (value: number) => string;
  formatPercent: (value: number) => string;
  locale: "tr" | "en";
}) {
  const { t } = useI18n();
  const title = laneTitle(lane, t);
  return <article className={cx("live-wall-lane pulse-surface overflow-hidden rounded-card", laneAccent(lane.id), !mobileActive && "hidden md:block")} data-testid={`live-wall-lane-${lane.id}`} data-lane-count={lane.entries.length} data-lane-eligible={lane.eligibleCount} data-lane-rejected={lane.rejectedCount} data-lane-rejection-reasons={JSON.stringify(lane.rejectionReasons)} data-lane-fallback={lane.fallback || undefined} data-lane-freshness={lane.freshness}>
    <header className="flex min-h-12 items-start justify-between gap-2 px-3 pb-1 pt-2"><div className="min-w-0"><p className="truncate text-label font-semibold text-content-primary">{title}</p><p className="mt-1 flex items-center gap-2 font-mono text-meta text-content-secondary"><span className={cx("h-2 w-2 rounded-pill", lane.freshness === "fresh" ? "bg-freshness-live" : lane.freshness === "delayed" ? "bg-freshness-delayed" : "bg-content-secondary")} />{lane.baselinePending ? t("terminalV3.baselinePending") : `${lane.eligibleCount} · ${lane.timeframe === "age" ? "7d" : lane.timeframe === "snapshot" ? `${snapshot.comparison.previousGeneratedAt ? "Δ" : "—"}` : displayWindow(lane.timeframe)}`}</p></div>{availableEntryCount > 4 ? <button type="button" onClick={() => onExpandedChange(!expanded)} aria-expanded={expanded} className="inline-flex min-h-control-touch shrink-0 items-center gap-1 px-2 text-meta font-semibold text-content-secondary hover:text-content-primary" data-testid={`lane-expand-${lane.id}`}>{t(expanded ? "terminalV3.collapseLane" : "terminalV3.expandLane", { count: availableEntryCount })}{expanded ? <ChevronsUp size={12} /> : <ChevronsDown size={12} />}</button> : null}</header>
    {lane.id === "liquidity" ? <div className="mx-2 mb-1 grid grid-cols-3 gap-1">{(["all", "added", "removed"] as const).map((value) => <button key={value} type="button" onClick={() => onLiquidityDirection(value)} aria-pressed={liquidityDirection === value} className={cx("min-h-control-touch rounded-control px-1 text-meta", liquidityDirection === value ? "bg-surface-selected text-content-primary" : "bg-surface-interactive text-content-secondary")}>{t(value === "all" ? "terminalV3.liquidityAll" : value === "added" ? "terminalV3.liquidityAdded" : "terminalV3.liquidityRemoved")}</button>)}</div> : null}
    <div className="divide-y divide-border-subtle/40">
      {lane.entries.map((entry) => <LiveWallRow key={entry.opportunity.id} entry={entry} selected={entry.opportunity.poolMarketIds.includes(selectedPair.id)} highlighted={highlighted.has(`${lane.id}:${entry.opportunity.id}`)} onSelect={onSelect} formatCompactCurrency={formatCompactCurrency} formatPercent={formatPercent} locale={locale} />)}
      {lane.entries.length === 0 ? <p className="flex min-h-16 items-center px-3 py-2 text-meta leading-4 text-content-secondary">{t("terminalV3.noVerifiedMarkets")}</p> : null}
    </div>
    <footer className="px-3 py-1 text-right font-mono text-meta text-content-secondary">{t("terminalV3.updated", { time: formatObservedTime(snapshot.receivedAt, locale) })}</footer>
  </article>;
}

function LiveWallRow({ entry, selected, highlighted, onSelect, formatCompactCurrency, formatPercent, locale }: { entry: LiveWallEntry; selected: boolean; highlighted: boolean; onSelect: (pairId: string) => void; formatCompactCurrency: (value: number) => string; formatPercent: (value: number) => string; locale: "tr" | "en" }) {
  const { t } = useI18n();
  const { opportunity, pair, metric } = entry;
  const presentation = getMarketPresentation(pair, opportunity);
  const primary = formatWallMetric(metric, formatCompactCurrency, formatPercent, locale, t);
  const secondary = secondaryWallMetric(metric, entry, formatCompactCurrency, formatPercent, t);
  return <button type="button" onClick={() => onSelect(pair.id)} className={cx("group grid min-h-row-comfortable w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-interactive focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus motion-reduce:transition-none", selected && "bg-surface-selected")} aria-label={t("terminalV3.inspect", { pair: presentation.symbol })} data-testid={`wall-row-${opportunity.id}`} data-opportunity-id={opportunity.id} data-quality-band={opportunity.qualityBand} data-liquidity-state={opportunity.liquidityState} data-freshness={pair.stale ? "delayed" : "fresh"}>
    <span className="flex min-w-0 items-center gap-2"><PairAvatarStack baseSymbol={pair.baseToken} quoteSymbol={pair.quoteToken} baseLogoUrl={pair.tokenLogoUrl} quoteLogoUrl={pair.quoteTokenLogoUrl} baseAddress={opportunity.focusTokenAddress} quoteAddress={pair.quoteTokenAddress} baseName={opportunity.focusTokenName} chainId={pair.chainId} observedAt={pair.sourceUpdatedAt} size="sm" /><span className="min-w-0"><strong className="block truncate font-mono text-data text-content-primary">{presentation.symbol}</strong><small className="block truncate text-meta text-content-secondary">{presentation.route.kind === "unpriced" ? t("terminalV3.unpriced") : presentation.route.kind === "direct_usdc" ? t("terminalV3.directUsdc") : t("terminalV3.viaQuote", { quote: presentation.route.quote })} · {secondary}</small></span></span>
    <span className="flex items-center gap-2"><MarketSignalBadges opportunity={opportunity} pair={pair} maximumMarketBadges={1} presentation="rowPrimary" /><span className={cx("min-w-[58px] text-right font-mono text-data font-semibold tabular-nums", metricTone(metric), highlighted && "market-update-flash")} data-cell-updated={highlighted || undefined}>{primary}</span><ChevronRight size={14} className="text-content-secondary" aria-hidden="true" /></span>
  </button>;
}

function laneTitle(lane: LiveWallLane, t: ReturnType<typeof useI18n>["t"]) {
  if (lane.id === "new") return t("terminalV3.lane.new");
  if (lane.id === "gainers") return t("terminalV3.lane.gainers");
  if (lane.id === "losers") return t("terminalV3.lane.losers");
  if (lane.id === "volume") return t(lane.fallback ? "terminalV3.lane.volumeLeaders" : "terminalV3.lane.volumeInflow");
  if (lane.id === "liquidity") return t(lane.fallback ? "terminalV3.lane.liquidityLeaders" : "terminalV3.lane.liquidityMovers");
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
  if (metric.kind === "volume_inflow" || metric.kind === "volume_leader" || metric.kind === "liquidity_leader") return "text-market-volume";
  if (metric.kind === "age") return "text-network-base";
  return "text-content-primary";
}

function formatWallMetric(metric: LiveWallEntry["metric"], currency: (value: number) => string, percent: (value: number) => string, locale: "tr" | "en", t: ReturnType<typeof useI18n>["t"]) {
  if (metric.kind === "age") return formatAge(metric.current, locale);
  if (metric.kind === "change") return percent(metric.current);
  if (metric.kind === "volume_inflow") return `+${currency(metric.delta ?? 0)}`;
  if (metric.kind === "volume_leader") return currency(metric.current);
  if (metric.kind === "liquidity_added" || metric.kind === "liquidity_removed") return `${(metric.delta ?? 0) >= 0 ? "+" : "−"}${currency(Math.abs(metric.delta ?? 0))}`;
  if (metric.kind === "liquidity_leader") return currency(metric.current);
  return t("terminalV3.tradeCount", { count: Math.round(metric.current) });
}

function secondaryWallMetric(metric: LiveWallEntry["metric"], entry: LiveWallEntry, currency: (value: number) => string, percent: (value: number) => string, t: ReturnType<typeof useI18n>["t"]) {
  if (metric.kind === "age") return entry.opportunity.poolCount === 1 ? t("terminalV3.onePool") : t("terminalV3.poolCount", { count: entry.opportunity.poolCount });
  if (metric.kind === "change") return `${displayWindow(metric.window as LiveWallTimeframe)} · ${formatOptionalCurrency(entry.opportunity.aggregate.liquidityUsd, currency)}`;
  if (metric.kind === "volume_inflow") return `${metric.ratio?.toFixed(2)}× · ${currency(metric.current)}`;
  if (metric.kind === "volume_leader") return `${displayWindow(metric.window as LiveWallTimeframe)} · ${t("terminalV3.baselinePending")}`;
  if (metric.kind === "liquidity_added" || metric.kind === "liquidity_removed") return t("terminalV3.previousToCurrent", { previous: formatOptionalCurrency(metric.previous, currency), current: formatOptionalCurrency(metric.current, currency) });
  if (metric.kind === "liquidity_leader") return t("terminalV3.currentLiquidity");
  return `${displayWindow(metric.window as LiveWallTimeframe)} · ${formatOptionalCurrency(entry.opportunity.aggregate.volumes?.[metric.window as LiveWallTimeframe], currency)}`;
}

function formatOptionalCurrency(value: number | undefined, currency: (value: number) => string) {
  return typeof value === "number" && Number.isFinite(value) ? currency(value) : "—";
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
