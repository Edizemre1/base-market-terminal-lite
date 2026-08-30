"use client";

import { ArrowDownUp, Eye, Filter, Layers3, RotateCcw, Settings2, Star, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MarketTerminalSnapshot } from "@/data/providers";
import { useI18n } from "@/i18n/I18nProvider";
import { localizeAgeLabel, type TranslationKey } from "@/i18n/dictionaries";
import { getMarketInvariantAttributes, getNormalizedMarketModel } from "@/lib/base-terminal/marketModel";
import {
  buildTokenOpportunityLanes,
  DEFAULT_MARKET_FILTERS,
  filterAndSortMarkets,
  type MarketFilters,
  type MarketSortKey,
  type TokenOpportunityLane
} from "@/lib/base-terminal/terminalMarket";
import { cx } from "@/lib/format";
import { safeReadJson, safeSetStorageItem } from "@/lib/safeStorage";
import type { BasePair } from "@/types/baseTerminal";
import { PairAvatarStack } from "@/components/TokenIdentity";
import { orientPairToOpportunity, type TokenOpportunity } from "@/lib/base-terminal/opportunityModel";
import { MarketSignalBadges, MarketSignalLegend, useMarketSignalContext } from "@/components/base-terminal/MarketSignalBadges";
import { hasMarketSignal, SIGNAL_FILTER_TYPES, type MarketSignalType } from "@/lib/base-terminal/marketSignals";

const MATRIX_STORAGE_KEY = "mergen-terminal:market-matrix:v3";
const DEFAULT_COLUMNS = ["age", "price", "change5m", "change1h", "change24h", "volume5m", "volume1h", "volume24h", "transactions", "liquidity", "fdv", "marketCap", "freshness"] as const;
type MatrixColumn = typeof DEFAULT_COLUMNS[number];
type MatrixPreferences = { filters: MarketFilters; density: "compact" | "comfortable"; columns: MatrixColumn[]; signalTypes: MarketSignalType[] };
type OpportunityRow = { opportunity: TokenOpportunity; pair: BasePair };

export function LiveMarketTape({ snapshot, onSelect }: { snapshot: MarketTerminalSnapshot; onSelect: (id: string) => void }) {
  const { t, formatPercent } = useI18n();
  const rows = useMemo(() => snapshot.opportunities
    .filter((opportunity) => opportunity.quality === "active")
    .map((opportunity) => ({ opportunity, pair: getOpportunityPair(snapshot, opportunity) }))
    .filter((row): row is OpportunityRow => Boolean(row.pair))
    .sort((left, right) => (right.opportunity.aggregate.volumes?.h24 ?? -1) - (left.opportunity.aggregate.volumes?.h24 ?? -1) || left.opportunity.id.localeCompare(right.opportunity.id))
    .slice(0, 15), [snapshot]);
  const previousValuesRef = useRef<Map<string, string> | undefined>(undefined);
  const [changedPairIds, setChangedPairIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    const nextValues = new Map(rows.map(({ opportunity, pair }) => [opportunity.id, `${pair.priceUsdValue ?? "missing"}:${pair.priceChanges?.m5 ?? "missing"}`]));
    const previousValues = previousValuesRef.current;
    previousValuesRef.current = nextValues;
    if (!previousValues) return;
    const changed = new Set(rows.filter(({ opportunity }) => previousValues.has(opportunity.id) && previousValues.get(opportunity.id) !== nextValues.get(opportunity.id)).map(({ opportunity }) => opportunity.id));
    if (!changed.size) return;
    setChangedPairIds(changed);
    const timer = window.setTimeout(() => setChangedPairIds(new Set()), 1_200);
    return () => window.clearTimeout(timer);
  }, [rows]);
  return (
    <section className="pulse-surface overflow-hidden rounded-xl" data-testid="live-market-tape" aria-label={t("terminalV3.tape")}>
      <div className="flex min-h-10 items-center gap-2 overflow-x-auto px-2 py-1.5">
        <span className="sticky left-0 z-10 shrink-0 rounded-full bg-base-panel px-2 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-base-mint">{t("terminalV3.live")}</span>
        {rows.map(({ opportunity, pair }) => {
          const change = pair.priceChanges?.m5;
          return <span key={opportunity.id} className={cx("flex shrink-0 items-center rounded-full bg-base-elevated", changedPairIds.has(opportunity.id) && "market-update-flash")} data-testid={`tape-${safeTestId(opportunity.id)}`} data-opportunity-id={opportunity.id}><button type="button" onClick={() => onSelect(opportunity.primaryMarketId)} className="flex min-h-11 items-center gap-2 rounded-l-full px-2.5 text-left outline-none hover:bg-base-mint/10 focus-visible:ring-2 focus-visible:ring-base-mint/50">
            <span className="font-mono text-[10px] font-semibold text-base-text">{opportunity.focusTokenSymbol}</span>
            <span className="font-mono text-[10px] text-base-muted">{displayPrice(pair)}</span>
            <span className={cx("font-mono text-[10px]", change === undefined ? "text-base-muted" : change >= 0 ? "text-base-mint" : "text-base-rose")}>{change === undefined ? "5m N/A" : `5m ${formatPercent(change)}`}</span>
            <span className="rounded-full bg-base-panel px-1.5 py-0.5 text-[8px] text-base-muted">{poolCountLabel(opportunity.poolCount, t)}</span>
            <span className="text-[9px] text-base-muted">{pair.stale ? t("common.delayed") : t("terminalV3.fresh")}</span>
          </button><MarketSignalBadges opportunity={opportunity} pair={pair} maximumMarketBadges={1} className="pr-1" /></span>;
        })}
      </div>
    </section>
  );
}

export function OpportunityLanes({ snapshot, selectedPair, onSelect, onTrade, isPairPinned, onTogglePin }: {
  snapshot: MarketTerminalSnapshot;
  selectedPair: BasePair;
  onSelect: (id: string) => void;
  onTrade: (pair: BasePair, side: "buy" | "sell") => void;
  isPairPinned: (pair: BasePair) => boolean;
  onTogglePin: (pair: BasePair) => void;
}) {
  const { t } = useI18n();
  const lanes = useMemo(() => buildTokenOpportunityLanes(snapshot), [snapshot]);
  return <section aria-label={t("terminalV3.lanes")} data-testid="opportunity-lanes" className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
    {lanes.map((lane) => <MarketLane key={lane.id} lane={lane} snapshot={snapshot} selectedPair={selectedPair} onSelect={onSelect} onTrade={onTrade} isPairPinned={isPairPinned} onTogglePin={onTogglePin} />)}
  </section>;
}

function MarketLane({ lane, snapshot, selectedPair, onSelect, onTrade, isPairPinned, onTogglePin }: {
  lane: TokenOpportunityLane;
  snapshot: MarketTerminalSnapshot;
  selectedPair: BasePair;
  onSelect: (id: string) => void;
  onTrade: (pair: BasePair, side: "buy" | "sell") => void;
  isPairPinned: (pair: BasePair) => boolean;
  onTogglePin: (pair: BasePair) => void;
}) {
  const { t, locale, formatCompactCurrency, formatPercent } = useI18n();
  const comparisonSeconds = snapshot.comparison.previousGeneratedAt
    ? Math.max(1, Math.round((Date.parse(snapshot.generatedAt) - Date.parse(snapshot.comparison.previousGeneratedAt)) / 1_000))
    : undefined;
  return <article className="pulse-surface min-w-0 overflow-hidden rounded-xl" data-testid={`opportunity-lane-${lane.id}`}>
    <header className="flex min-h-10 items-center justify-between gap-2 border-b border-base-line/60 px-3 py-1.5">
      <div><h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-base-text">{t(lane.id === "volume" && lane.fallback ? "terminalV3.lane.volumeLeaders" : `terminalV3.lane.${lane.id}`)}</h2>{lane.id === "volume" && !lane.fallback && comparisonSeconds ? <p className="mt-0.5 text-[8px] text-base-muted">{t("terminalV3.lane.surgeWindow", { count: comparisonSeconds })}</p> : null}</div>
      <span className="font-mono text-[9px] text-base-muted">{lane.opportunities.length}</span>
    </header>
    {lane.fallback ? <p className="border-b border-base-amber/20 bg-base-amber/5 px-3 py-1.5 text-[9px] leading-4 text-base-amber">{t(`terminalV3.lane.${lane.id}Fallback`)}</p> : null}
    <div className="divide-y divide-base-line/50">
      {lane.opportunities.map((opportunity) => {
        const pair = getOpportunityPair(snapshot, opportunity);
        if (!pair) return null;
        const model = getNormalizedMarketModel(pair);
        const change = lane.id === "moving" ? model.change1h : model.change24h;
        return <div key={opportunity.id} {...getMarketInvariantAttributes(pair)} data-opportunity-id={opportunity.id} data-focus-token-address={opportunity.focusTokenAddress} data-pool-count={opportunity.poolCount} data-pool-age-minutes={model.ageMinutes} data-quality={opportunity.quality} className={cx("grid grid-cols-[minmax(0,1fr)_auto] gap-2 p-2", opportunity.poolMarketIds.includes(selectedPair.id) && "bg-base-mint/5")}>
          <button type="button" onClick={() => onSelect(opportunity.primaryMarketId)} className="flex min-h-11 min-w-0 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-base-mint/50">
            <PairAvatarStack baseSymbol={pair.baseToken} quoteSymbol={pair.quoteToken} baseLogoUrl={pair.tokenLogoUrl} quoteLogoUrl={pair.quoteTokenLogoUrl} size="sm" />
            <span className="min-w-0">
              <span className="block truncate font-mono text-[11px] font-semibold text-base-text">{opportunity.focusTokenSymbol}</span>
              <span className="block truncate text-[9px] text-base-muted">{pair.dexName ?? pair.dex} · {poolCountLabel(opportunity.poolCount, t)} · {model.ageMinutes === undefined ? t("common.noData") : localizeAgeLabel(pair.age, locale)}{lane.id === "new" && opportunity.categoryEligibility.justLaunched ? ` · ${t("terminalV3.justLaunched")}` : ""}{opportunity.quality === "thin" ? ` · ${t("terminalV3.thinLiquidity")}` : ""}</span>
              <span className="mt-0.5 grid grid-cols-3 gap-1 font-mono text-[8px] text-base-muted"><span title={t("terminalV3.metric.price")}>P {displayPrice(pair)}</span><span title={t("terminalV3.metric.change")}>Δ {change === undefined ? t("common.noData") : formatPercent(change)}</span><span title={t("terminalV3.metric.liquidity")}>L {opportunity.aggregate.liquidityUsd === undefined ? t("common.noData") : formatCompactCurrency(opportunity.aggregate.liquidityUsd)}</span></span>
            </span>
          </button>
          <span className="flex items-center gap-1">
            <MarketSignalBadges opportunity={opportunity} pair={pair} maximumMarketBadges={1} />
            <button type="button" onClick={() => onTogglePin(pair)} className={cx("grid h-8 w-8 place-items-center rounded-sm text-base-muted hover:bg-base-elevated hover:text-base-mint", isPairPinned(pair) && "text-base-mint")} aria-label={t(isPairPinned(pair) ? "a11y.unpin" : "a11y.pin", { pair: pair.pair })}><Star size={12} fill={isPairPinned(pair) ? "currentColor" : "none"} /></button>
            <button type="button" onClick={() => onTrade(pair, "buy")} className="h-8 rounded-sm bg-base-mint/10 px-2 text-[9px] font-bold text-base-mint hover:bg-base-mint/20">{t("trade.buy")}</button>
          </span>
        </div>;
      })}
      {lane.opportunities.length === 0 ? <p className="p-4 text-[10px] leading-5 text-base-muted">{t("terminalV3.noVerifiedMarkets")}</p> : null}
    </div>
  </article>;
}

export function MarketMatrix({ snapshot, selectedPair, onSelect, onTrade, isPairPinned, onTogglePin, onInteractionChange, watchlistOnly = false }: {
  snapshot: MarketTerminalSnapshot;
  selectedPair: BasePair;
  onSelect: (id: string) => void;
  onTrade: (pair: BasePair, side: "buy" | "sell") => void;
  isPairPinned: (pair: BasePair) => boolean;
  onTogglePin: (pair: BasePair) => void;
  onInteractionChange: (locked: boolean) => void;
  watchlistOnly?: boolean;
}) {
  const { t, locale, formatCompactCurrency, formatPercent } = useI18n();
  const [preferences, setPreferences] = useState<MatrixPreferences>(() => ({ filters: DEFAULT_MARKET_FILTERS, density: "compact", columns: [...DEFAULT_COLUMNS], signalTypes: [] }));
  const [loaded, setLoaded] = useState(false);
  const [matrixView, setMatrixView] = useState<"tokens" | "pools">("tokens");
  const [visibleLimit, setVisibleLimit] = useState(80);
  const [openOpportunityId, setOpenOpportunityId] = useState<string>();
  const { signals: signalSnapshot } = useMarketSignalContext();
  useEffect(() => {
    const saved = safeReadJson<Partial<MatrixPreferences>>(MATRIX_STORAGE_KEY, {});
    setPreferences(normalizePreferences(saved));
    setLoaded(true);
  }, []);
  useEffect(() => { if (loaded) safeSetStorageItem(MATRIX_STORAGE_KEY, JSON.stringify(preferences)); }, [loaded, preferences]);
  const opportunityRows = useMemo(() => buildOpportunityMatrixPairs(snapshot), [snapshot]);
  const dexOptions = useMemo(() => [...new Map(snapshot.allPairs.flatMap((pair) => {
    const value = (pair.dexId ?? pair.dexName ?? pair.dex).trim().toLocaleLowerCase("en-US");
    const label = pair.dexName ?? pair.dex;
    return value ? [[value, label] as const] : [];
  })).entries()].sort((left, right) => left[1].localeCompare(right[1])), [snapshot.allPairs]);
  const quoteOptions = useMemo(() => {
    const entries = [...new Map(snapshot.allPairs.flatMap((pair) => {
      const address = pair.quoteTokenAddress?.trim().toLocaleLowerCase("en-US");
      return address ? [[address, pair.quoteToken] as const] : [];
    })).entries()];
    const symbolCounts = new Map<string, number>();
    for (const [, symbol] of entries) symbolCounts.set(symbol, (symbolCounts.get(symbol) ?? 0) + 1);
    return entries
      .map(([address, symbol]) => [address, (symbolCounts.get(symbol) ?? 0) > 1 ? `${symbol} · ${shortAddress(address)}` : symbol] as const)
      .sort((left, right) => left[1].localeCompare(right[1]));
  }, [snapshot.allPairs]);
  const source = useMemo(() => {
    const rows = matrixView === "tokens" ? opportunityRows : snapshot.allPairs;
    return watchlistOnly ? rows.filter(isPairPinned) : rows;
  }, [isPairPinned, matrixView, opportunityRows, snapshot.allPairs, watchlistOnly]);
  const rows = useMemo(() => {
    const query = preferences.filters.query.trim().toLocaleLowerCase("en-US");
    const scoped = source
      .filter((pair) => matchesMarketContext(pair, snapshot, preferences.filters, matrixView))
      .filter((pair) => hasMarketSignal(matrixView === "tokens" && pair.opportunityId ? signalSnapshot.byOpportunityId[pair.opportunityId] : signalSnapshot.byPoolId[pair.id], preferences.signalTypes))
      .filter((pair) => matrixView !== "tokens" || !query || opportunitySearchText(pair, snapshot).includes(query));
    return filterAndSortMarkets(scoped, {
      ...preferences.filters,
      query: matrixView === "tokens" && query ? "" : preferences.filters.query,
      dex: "",
      quoteTokenAddress: "",
      category: "all"
    });
  }, [matrixView, preferences.filters, preferences.signalTypes, signalSnapshot, snapshot, source]);
  const openOpportunity = snapshot.opportunities.find((opportunity) => opportunity.id === openOpportunityId);
  const filters = preferences.filters;
  const activeFilters = [filters.query && t("terminalV3.filter.search", { value: filters.query }), filters.minimumLiquidity !== undefined && t("terminalV3.filter.liquidity", { value: formatCompactCurrency(filters.minimumLiquidity) }), filters.minimumVolume24h !== undefined && t("terminalV3.filter.volume", { value: formatCompactCurrency(filters.minimumVolume24h) }), filters.maximumAgeMinutes !== undefined && t("terminalV3.filter.age", { value: filters.maximumAgeMinutes }), filters.change !== "all" && t(`terminalV3.filter.${filters.change}`), filters.dex && t("terminalV3.filter.dexValue", { value: dexOptions.find(([value]) => value === filters.dex)?.[1] ?? filters.dex }), filters.quoteTokenAddress && t("terminalV3.filter.quoteValue", { value: quoteOptions.find(([value]) => value === filters.quoteTokenAddress)?.[1] ?? shortAddress(filters.quoteTokenAddress) }), filters.category && filters.category !== "all" && t("terminalV3.filter.categoryValue", { value: t(`terminalV3.filter.category.${filters.category}`) }), ...preferences.signalTypes.map((type) => t(`marketSignal.${type}`))].filter((value): value is string => Boolean(value));

  const patchFilters = (patch: Partial<MarketFilters>) => setPreferences((current) => ({ ...current, filters: { ...current.filters, ...patch } }));
  const toggleColumn = (column: MatrixColumn) => setPreferences((current) => ({ ...current, columns: current.columns.includes(column) ? current.columns.filter((item) => item !== column) : [...current.columns, column] }));
  return <section className="pulse-surface min-w-0 overflow-hidden rounded-xl" data-testid="market-matrix" onMouseEnter={() => onInteractionChange(true)} onMouseLeave={() => onInteractionChange(false)} onFocusCapture={() => onInteractionChange(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onInteractionChange(false); }}>
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-base-line/60 px-3 py-2">
      <div><p className="text-[9px] font-bold uppercase tracking-[0.14em] text-base-mint">{t("terminalV3.matrixEyebrow")}</p><h2 className="text-[14px] font-semibold text-base-text">{watchlistOnly ? t("nav.watchlist") : t("terminalV3.matrix")}</h2></div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-full bg-base-elevated px-2 py-1 font-mono text-[10px] text-base-muted" data-testid="market-result-count">{t("common.results", { count: rows.length })}</span>
        <span className="inline-flex rounded-sm bg-base-elevated p-0.5" data-testid="market-view-toggle"><button type="button" aria-pressed={matrixView === "tokens"} onClick={() => { setMatrixView("tokens"); setVisibleLimit(80); }} className={cx("min-h-8 rounded-sm px-2 text-[10px]", matrixView === "tokens" ? "bg-base-mint/15 text-base-mint" : "text-base-muted")}>{t("terminalV3.tokensView")}</button><button type="button" aria-pressed={matrixView === "pools"} onClick={() => { setMatrixView("pools"); setVisibleLimit(80); }} className={cx("min-h-8 rounded-sm px-2 text-[10px]", matrixView === "pools" ? "bg-base-mint/15 text-base-mint" : "text-base-muted")}>{t("terminalV3.poolsView")}</button></span>
        <MarketSignalLegend selected={preferences.signalTypes} onChange={(signalTypes) => setPreferences((current) => ({ ...current, signalTypes }))} />
        <button type="button" onClick={() => setPreferences((current) => ({ ...current, density: current.density === "compact" ? "comfortable" : "compact" }))} className="inline-flex min-h-9 items-center gap-1 rounded-sm bg-base-elevated px-2 text-[10px] text-base-muted"><ArrowDownUp size={12} />{t(`terminalV3.density.${preferences.density}`)}</button>
        <details className="relative"><summary className="flex min-h-9 cursor-pointer list-none items-center gap-1 rounded-sm bg-base-elevated px-2 text-[10px] text-base-muted"><Settings2 size={12} />{t("terminalV3.columns")}</summary><div className="absolute right-0 top-10 z-30 grid w-48 gap-1 rounded-lg border border-base-line bg-base-panel p-2 shadow-xl">{DEFAULT_COLUMNS.map((column) => <label key={column} className="flex min-h-8 items-center gap-2 text-[10px] text-base-muted"><input type="checkbox" checked={preferences.columns.includes(column)} onChange={() => toggleColumn(column)} />{t(`terminalV3.column.${column}`)}</label>)}</div></details>
      </div>
    </header>
    <div className="grid gap-2 border-b border-base-line/60 bg-base-elevated/40 p-2 sm:grid-cols-2 xl:grid-cols-5 2xl:grid-cols-10">
      <label className="xl:col-span-2"><span className="sr-only">{t("header.search")}</span><input value={filters.query} onChange={(event) => patchFilters({ query: event.target.value })} placeholder={t("header.searchPlaceholder")} className="h-10 w-full rounded-sm border border-base-line bg-base-panel px-2 text-[11px] outline-none focus:border-base-mint" /></label>
      <NumberBox label={t("market.advanced.minLiquidity")} value={filters.minimumLiquidity} onChange={(minimumLiquidity) => patchFilters({ minimumLiquidity })} />
      <NumberBox label={t("market.advanced.minVolume")} value={filters.minimumVolume24h} onChange={(minimumVolume24h) => patchFilters({ minimumVolume24h })} />
      <select aria-label={t("terminalV3.changeFilter")} value={filters.change} onChange={(event) => patchFilters({ change: event.target.value as MarketFilters["change"] })} className="h-10 rounded-sm border border-base-line bg-base-panel px-2 text-[11px]"><option value="all">{t("terminalV3.filter.all")}</option><option value="gainers">{t("terminalV3.filter.gainers")}</option><option value="losers">{t("terminalV3.filter.losers")}</option></select>
      <select aria-label={t("terminalV3.filter.dex")} value={filters.dex ?? ""} onChange={(event) => patchFilters({ dex: event.target.value })} className="h-10 rounded-sm border border-base-line bg-base-panel px-2 text-[11px]"><option value="">{t("terminalV3.filter.allDexes")}</option>{dexOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <select aria-label={t("terminalV3.filter.quote")} value={filters.quoteTokenAddress ?? ""} onChange={(event) => patchFilters({ quoteTokenAddress: event.target.value })} className="h-10 rounded-sm border border-base-line bg-base-panel px-2 text-[11px]"><option value="">{t("terminalV3.filter.allQuotes")}</option>{quoteOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <select aria-label={t("terminalV3.filter.category")} value={filters.category ?? "all"} onChange={(event) => patchFilters({ category: event.target.value as MarketFilters["category"] })} className="h-10 rounded-sm border border-base-line bg-base-panel px-2 text-[11px]"><option value="all">{t("terminalV3.filter.category.all")}</option>{(["new", "moving", "volume", "liquidity"] as const).map((category) => <option key={category} value={category}>{t(`terminalV3.filter.category.${category}`)}</option>)}</select>
      <button type="button" onClick={() => setPreferences((current) => ({ ...current, filters: DEFAULT_MARKET_FILTERS, signalTypes: [] }))} className="inline-flex min-h-10 items-center justify-center gap-1 rounded-sm border border-base-line bg-base-panel px-2 text-[10px] text-base-muted hover:text-base-text"><RotateCcw size={12} />{t("market.advanced.reset")}</button>
    </div>
    {activeFilters.length ? <div className="flex flex-wrap gap-1 border-b border-base-line/60 px-3 py-2" data-testid="active-filter-chips"><Filter size={12} className="text-base-mint" />{activeFilters.map((filter) => <span key={filter} className="rounded-full bg-base-mint/10 px-2 py-0.5 text-[9px] text-base-mint">{filter}</span>)}</div> : null}
    <div className="hidden max-h-[620px] overflow-auto lg:block">
      <table className={cx("w-full border-collapse text-left", matrixView === "pools" ? "min-w-[1520px]" : "min-w-[1180px]")}>
        <thead className="sticky top-0 z-10 bg-base-elevated text-[9px] uppercase tracking-[0.08em] text-base-muted"><tr><th className="px-2 py-2">{t("market.market")}</th><th className="px-2 py-2">{t("terminalV3.dex")}</th><th className="px-2 py-2">{t("terminalV3.dataProvider")}</th>{matrixView === "pools" ? <><th className="px-2 py-2">{t("terminalV3.poolAddress")}</th><th className="px-2 py-2">{t("terminalV3.quoteToken")}</th><th className="px-2 py-2">{t("terminalV3.orientation")}</th></> : null}{preferences.columns.map((column) => <th key={column} className="px-2 py-2 text-right"><SortButton column={column} filters={filters} patchFilters={patchFilters} /></th>)}<th className="px-2 py-2 text-right">{t("terminalV3.actions")}</th></tr></thead>
        <tbody>{rows.slice(0, visibleLimit).map((pair) => <MatrixRow key={`${matrixView}:${pair.id}`} pair={pair} opportunity={matrixView === "tokens" ? snapshot.opportunities.find((item) => item.id === pair.opportunityId) : undefined} matrixView={matrixView} columns={preferences.columns} density={preferences.density} selected={matrixView === "tokens" ? pair.opportunityId === selectedPair.opportunityId : pair.id === selectedPair.id} onSelect={onSelect} onTrade={onTrade} onInspectPools={setOpenOpportunityId} isPinned={isPairPinned(pair)} onTogglePin={onTogglePin} locale={locale} formatCompactCurrency={formatCompactCurrency} formatPercent={formatPercent} />)}</tbody>
      </table>
    </div>
    <div className="divide-y divide-base-line/60 lg:hidden">{rows.slice(0, Math.min(visibleLimit, 60)).map((pair) => <MobileMarketCard key={`${matrixView}:${pair.id}`} pair={pair} opportunity={matrixView === "tokens" ? snapshot.opportunities.find((item) => item.id === pair.opportunityId) : undefined} selected={matrixView === "tokens" ? pair.opportunityId === selectedPair.opportunityId : pair.id === selectedPair.id} onSelect={onSelect} onTrade={onTrade} onInspectPools={setOpenOpportunityId} isPinned={isPairPinned(pair)} onTogglePin={onTogglePin} />)}</div>
    {rows.length > visibleLimit ? <div className="border-t border-base-line/60 p-3 text-center"><button type="button" onClick={() => setVisibleLimit((current) => Math.min(rows.length, current + 80))} className="min-h-10 rounded-sm bg-base-elevated px-4 text-[10px] font-semibold text-base-muted hover:text-base-text">{t("terminalV3.loadMore", { count: Math.min(80, rows.length - visibleLimit) })}</button></div> : null}
    {rows.length === 0 ? <div className="p-8 text-center text-[11px] text-base-muted"><p className="font-semibold text-base-text">{t("market.noMatches")}</p><p className="mt-1">{t("market.noMatchesBody")}</p></div> : null}
    {openOpportunity ? <PoolDrawer opportunity={openOpportunity} pairs={snapshot.allPairs.filter((pair) => openOpportunity.poolMarketIds.includes(pair.id))} onClose={() => setOpenOpportunityId(undefined)} onSelect={onSelect} onTrade={onTrade} /> : null}
  </section>;
}

function MatrixRow({ pair, opportunity, matrixView, columns, density, selected, onSelect, onTrade, onInspectPools, isPinned, onTogglePin, locale, formatCompactCurrency, formatPercent }: {
  pair: BasePair; opportunity?: TokenOpportunity; matrixView: "tokens" | "pools"; columns: MatrixColumn[]; density: MatrixPreferences["density"]; selected: boolean; onSelect: (id: string) => void; onTrade: (pair: BasePair, side: "buy" | "sell") => void; onInspectPools: (id: string) => void; isPinned: boolean; onTogglePin: (pair: BasePair) => void; locale: "tr" | "en"; formatCompactCurrency: (value: number) => string; formatPercent: (value: number) => string;
}) {
  const { t } = useI18n();
  const model = getNormalizedMarketModel(pair);
  return <tr {...getMarketInvariantAttributes(pair)} className={cx("border-t border-base-line/50 hover:bg-base-mint/5", selected && "bg-base-mint/10")} data-testid={`matrix-row-${pair.id}`} data-opportunity-id={opportunity?.id} data-focus-token-address={opportunity?.focusTokenAddress} data-pool-count={opportunity?.poolCount}>
    <td className="p-0"><div className="flex min-w-[220px] items-center"><button type="button" onClick={() => onSelect(pair.id)} className={cx("flex min-w-0 flex-1 items-center gap-2 px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-base-mint/50", density === "compact" ? "min-h-11" : "min-h-14")}><PairAvatarStack baseSymbol={pair.baseToken} quoteSymbol={pair.quoteToken} baseLogoUrl={pair.tokenLogoUrl} quoteLogoUrl={pair.quoteTokenLogoUrl} size="sm" /><span className="min-w-0"><span className="block truncate font-mono text-[11px] font-semibold">{opportunity?.focusTokenSymbol ?? pair.pair}</span><span className="block truncate text-[9px] text-base-muted">{opportunity ? `${opportunity.focusTokenName} · ${poolCountLabel(opportunity.poolCount, t)}` : `${pair.project} · ${shortAddress(pair.pairAddress)}`}</span></span></button><MarketSignalBadges opportunity={opportunity} pair={pair} scope={matrixView === "pools" ? "pool" : "opportunity"} maximumMarketBadges={1} className="pr-1" /></div></td>
    <td className="px-2 text-[9px] text-base-muted">{pair.dexName ?? pair.dex}{pair.isPrimaryMarket ? <span className="ml-1 rounded-full bg-base-mint/10 px-1.5 py-0.5 text-[8px] text-base-mint">{t("terminalV3.primary")}</span> : null}</td>
    <td className="px-2 font-mono text-[9px] text-base-muted">{opportunity ? opportunity.sourceProviders.join(" + ") : (pair.dataProviders ?? [pair.dataSource]).filter(Boolean).join(" + ") || t("common.unknown")}</td>
    {matrixView === "pools" ? <><td className="px-2 font-mono text-[9px] text-base-muted" title={pair.pairAddress}>{shortAddress(pair.pairAddress)}</td><td className="px-2 text-[9px] text-base-muted">{pair.quoteToken}</td><td className="px-2 text-[9px] text-base-muted">{pair.poolOrientation ?? "pair"}</td></> : null}
    {columns.map((column) => <td key={column} className="px-2 text-right font-mono text-[10px] text-base-text">{formatMatrixValue(column, pair, model, locale, formatCompactCurrency, formatPercent, t)}</td>)}
    <td className="px-2"><span className="flex justify-end gap-1"><button type="button" onClick={() => onTogglePin(pair)} className={cx("grid h-8 w-8 place-items-center rounded-sm bg-base-elevated text-base-muted", isPinned && "text-base-mint")} aria-label={t(isPinned ? "a11y.unpin" : "a11y.pin", { pair: pair.pair })}><Star size={12} fill={isPinned ? "currentColor" : "none"} /></button><button type="button" onClick={() => opportunity ? onInspectPools(opportunity.id) : onSelect(pair.id)} className="grid h-8 w-8 place-items-center rounded-sm bg-base-elevated text-base-muted" aria-label={t("terminalV3.inspect", { pair: pair.pair })}>{opportunity ? <Layers3 size={12} /> : <Eye size={12} />}</button><button type="button" onClick={() => onTrade(pair, "buy")} className="h-8 rounded-sm bg-base-mint/10 px-2 text-[9px] font-bold text-base-mint">{t("trade.buy")}</button><button type="button" onClick={() => onTrade(pair, "sell")} className="h-8 rounded-sm bg-base-rose/10 px-2 text-[9px] font-bold text-base-rose">{t("trade.sell")}</button></span></td>
  </tr>;
}

function MobileMarketCard({ pair, opportunity, selected, onSelect, onTrade, onInspectPools, isPinned, onTogglePin }: { pair: BasePair; opportunity?: TokenOpportunity; selected: boolean; onSelect: (id: string) => void; onTrade: (pair: BasePair, side: "buy" | "sell") => void; onInspectPools: (id: string) => void; isPinned: boolean; onTogglePin: (pair: BasePair) => void }) {
  const { t, formatCompactCurrency, formatPercent } = useI18n();
  const model = getNormalizedMarketModel(pair);
  return <article className={cx("p-3", selected && "bg-base-mint/10")} data-testid={`market-card-${pair.id}`} data-opportunity-id={opportunity?.id} data-focus-token-address={opportunity?.focusTokenAddress} data-pool-count={opportunity?.poolCount}><div className="flex items-center gap-2"><button type="button" onClick={() => onSelect(pair.id)} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left"><PairAvatarStack baseSymbol={pair.baseToken} quoteSymbol={pair.quoteToken} baseLogoUrl={pair.tokenLogoUrl} quoteLogoUrl={pair.quoteTokenLogoUrl} size="md" /><span className="min-w-0"><span className="block truncate font-mono text-[12px] font-semibold">{opportunity?.focusTokenSymbol ?? pair.pair}</span><span className="block truncate text-[10px] text-base-muted">{pair.dexName ?? pair.dex} · {opportunity ? poolCountLabel(opportunity.poolCount, t) : shortAddress(pair.pairAddress)} · {displayPrice(pair)}</span></span></button><button type="button" onClick={() => onTogglePin(pair)} className={cx("grid h-11 w-11 place-items-center rounded-sm bg-base-elevated text-base-muted", isPinned && "text-base-mint")}><Star size={14} fill={isPinned ? "currentColor" : "none"} /></button>{opportunity ? <button type="button" onClick={() => onInspectPools(opportunity.id)} className="grid h-11 w-11 place-items-center rounded-sm bg-base-elevated text-base-muted" aria-label={t("terminalV3.inspect", { pair: opportunity.focusTokenSymbol })}><Layers3 size={14} /></button> : null}</div><div className="mt-1 flex justify-end"><MarketSignalBadges opportunity={opportunity} pair={pair} scope={opportunity ? "opportunity" : "pool"} /></div><div className="mt-2 grid grid-cols-3 gap-1 text-center font-mono text-[9px]"><span className="rounded-sm bg-base-elevated p-2"><b className={model.change24h === undefined ? "text-base-muted" : model.change24h >= 0 ? "text-base-mint" : "text-base-rose"}>{model.change24h === undefined ? "N/A" : formatPercent(model.change24h)}</b><small className="mt-1 block text-base-muted">24h</small></span><span className="rounded-sm bg-base-elevated p-2"><b>{model.volume24hUsd === undefined ? "N/A" : formatCompactCurrency(model.volume24hUsd)}</b><small className="mt-1 block text-base-muted">{t("market.volume24h")}</small></span><span className="rounded-sm bg-base-elevated p-2"><b>{model.liquidityUsd === undefined ? "N/A" : formatCompactCurrency(model.liquidityUsd)}</b><small className="mt-1 block text-base-muted">{t("market.liquidity")}</small></span></div><div className="mt-2 grid grid-cols-2 gap-2"><button type="button" onClick={() => onTrade(pair, "buy")} className="min-h-11 rounded-sm bg-base-mint/10 text-[11px] font-bold text-base-mint">{t("trade.buy")}</button><button type="button" onClick={() => onTrade(pair, "sell")} className="min-h-11 rounded-sm bg-base-rose/10 text-[11px] font-bold text-base-rose">{t("trade.sell")}</button></div></article>;
}

export function PinnedMarketGrid({ pairs, onSelect, onUnpin }: { pairs: BasePair[]; onSelect: (id: string) => void; onUnpin: (pair: BasePair) => void }) {
  const { t, formatPercent } = useI18n();
  return <section className="pulse-surface overflow-hidden rounded-xl" data-testid="pinned-multichart"><header className="flex items-center justify-between border-b border-base-line/60 px-3 py-2"><div><p className="text-[9px] font-bold uppercase tracking-[0.14em] text-base-mint">{t("terminalV3.multichart")}</p><h2 className="text-[14px] font-semibold">{t("terminalV3.pinnedMarkets")}</h2></div><span className="font-mono text-[10px] text-base-muted">{pairs.length}/4</span></header>{pairs.length ? <div className="grid gap-px bg-base-line/60 sm:grid-cols-2">{pairs.slice(0, 4).map((pair) => { const candles = pair.chartSource === "geckoterminal" ? pair.chartCandles ?? [] : []; const path = sparkPath(candles.map((candle) => candle.close)); return <article key={pair.id} className="bg-base-panel p-3"><div className="flex items-center justify-between gap-2"><button type="button" onClick={() => onSelect(pair.id)} className="font-mono text-[11px] font-semibold hover:text-base-mint">{pair.pair}</button><span className="flex items-center"><MarketSignalBadges pair={pair} maximumMarketBadges={1} /><button type="button" onClick={() => onUnpin(pair)} className="min-h-8 px-2 text-[9px] text-base-muted">{t("terminalV3.unpin")}</button></span></div><div className="mt-1 flex items-center justify-between text-[9px] text-base-muted"><span>{pair.dexName ?? pair.dex}</span><span className={pair.change24h >= 0 ? "text-base-mint" : "text-base-rose"}>{formatPercent(pair.change24h)}</span></div>{path ? <svg viewBox="0 0 280 90" className="mt-2 h-24 w-full" role="img" aria-label={t("terminalV3.miniChart", { pair: pair.pair })}><path d={path} fill="none" stroke="rgb(var(--color-mint))" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg> : <div className="mt-2 grid h-24 place-items-center rounded-sm bg-base-elevated text-center text-[10px] leading-5 text-base-muted">{t("chart.unavailableBody")}</div>}</article>; })}</div> : <div className="p-6 text-center text-[11px] leading-5 text-base-muted">{t("terminalV3.pinEmpty")}</div>}</section>;
}

function PoolDrawer({ opportunity, pairs, onClose, onSelect, onTrade }: { opportunity: TokenOpportunity; pairs: BasePair[]; onClose: () => void; onSelect: (id: string) => void; onTrade: (pair: BasePair, side: "buy" | "sell") => void }) {
  const { t, locale, formatCompactCurrency } = useI18n();
  return <div className="fixed inset-0 z-[95] flex items-end justify-end bg-black/70" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside role="dialog" aria-modal="true" aria-label={t("terminalV3.poolDrawer", { token: opportunity.focusTokenSymbol })} className="max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl border border-base-line bg-base-panel p-4 shadow-2xl sm:max-w-xl sm:rounded-l-2xl sm:rounded-tr-none" data-testid="pool-drawer"><header className="flex items-start justify-between gap-3"><div><p className="text-[9px] font-bold uppercase tracking-[0.14em] text-base-mint">{t("terminalV3.executionPools")}</p><h2 className="mt-1 text-lg font-semibold">{opportunity.focusTokenSymbol} · {poolCountLabel(opportunity.poolCount, t)}</h2><p className="mt-1 break-all font-mono text-[9px] text-base-muted">{opportunity.focusTokenAddress}</p><MarketSignalBadges opportunity={opportunity} className="mt-1" /></div><button type="button" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-full bg-base-elevated text-base-muted" aria-label={t("terminalV3.closePools")}><X size={16} /></button></header><div className="mt-4 space-y-2">{pairs.map((pair) => { const model = getNormalizedMarketModel(pair); return <article key={pair.id} className="rounded-lg border border-base-line bg-base-elevated/55 p-3" data-testid={`pool-detail-${pair.id}`}><div className="flex items-start justify-between gap-3"><div><p className="font-mono text-[11px] font-semibold">{pair.pair}</p><p className="mt-1 text-[9px] text-base-muted">{pair.dexName ?? pair.dex} · {(pair.dataProviders ?? [pair.dataSource]).filter(Boolean).join(" + ")} {pair.isPrimaryMarket ? `· ${t("terminalV3.primary")}` : ""}</p><MarketSignalBadges pair={pair} scope="pool" maximumMarketBadges={1} /></div><span className="rounded-full bg-base-panel px-2 py-1 text-[8px] uppercase text-base-muted">{pair.poolOrientation ?? "pair"}</span></div><dl className="mt-3 grid grid-cols-2 gap-2 text-[9px] sm:grid-cols-3"><PoolFact label={t("terminalV3.dex")} value={pair.dexName ?? pair.dex} /><PoolFact label={t("terminalV3.dataProvider")} value={(pair.dataProviders ?? [pair.dataSource]).filter(Boolean).join(" + ") || t("common.unknown")} /><PoolFact label={t("terminalV3.metric.price")} value={displayPrice(pair)} /><PoolFact label={t("market.age")} value={model.ageMinutes === undefined ? "N/A" : localizeAgeLabel(pair.age, locale)} /><PoolFact label={t("market.liquidity")} value={model.liquidityUsd === undefined ? "N/A" : formatCompactCurrency(model.liquidityUsd)} /><PoolFact label={t("market.volume24h")} value={model.volume24hUsd === undefined ? "N/A" : formatCompactCurrency(model.volume24hUsd)} /><PoolFact label={t("terminalV3.quoteToken")} value={pair.quoteToken} /><PoolFact label={t("terminalV3.orientation")} value={pair.poolOrientation ?? "pair"} /><PoolFact label={t("terminalV3.primary")} value={pair.isPrimaryMarket ? t("terminalV3.primary") : "—"} /><PoolFact label={t("details.source")} value={pair.stale ? t("common.delayed") : t("terminalV3.fresh")} /><PoolFact label={t("terminalV3.poolAddress")} value={shortAddress(pair.pairAddress)} /></dl><p className="mt-2 break-all font-mono text-[8px] text-base-muted">{pair.pairAddress}</p><div className="mt-3 grid grid-cols-3 gap-2"><button type="button" onClick={() => { onSelect(pair.id); onClose(); }} className="min-h-9 rounded-sm bg-base-panel text-[9px] font-semibold text-base-muted">{t("terminalV3.inspect", { pair: pair.pair })}</button><button type="button" onClick={() => { onTrade(pair, "buy"); onClose(); }} className="min-h-9 rounded-sm bg-base-mint/10 text-[9px] font-bold text-base-mint">{t("trade.buy")}</button><button type="button" onClick={() => { onTrade(pair, "sell"); onClose(); }} className="min-h-9 rounded-sm bg-base-rose/10 text-[9px] font-bold text-base-rose">{t("trade.sell")}</button></div></article>; })}</div></aside></div>;
}

function PoolFact({ label, value }: { label: string; value: string }) {
  return <div className="rounded-sm bg-base-panel p-2"><dt className="uppercase tracking-[0.08em] text-base-muted">{label}</dt><dd className="mt-1 truncate font-mono text-base-text">{value}</dd></div>;
}

function buildOpportunityMatrixPairs(snapshot: MarketTerminalSnapshot) {
  const rows: BasePair[] = [];
  for (const opportunity of snapshot.opportunities) {
    if (opportunity.quality === "expired") continue;
    const pair = getOpportunityPair(snapshot, opportunity);
    if (!pair) continue;
    rows.push({
        ...pair,
        pair: opportunity.focusTokenSymbol,
        project: opportunity.focusTokenName,
        baseTokenAddress: opportunity.focusTokenAddress,
        tokenLogoUrl: opportunity.focusTokenLogoUrl ?? pair.tokenLogoUrl,
        liquidityUsd: opportunity.aggregate.liquidityUsd,
        volumes: opportunity.aggregate.volumes,
        txns: opportunity.aggregate.transactions,
        poolCount: opportunity.poolCount,
        opportunityId: opportunity.id,
        isPrimaryMarket: true
      });
  }
  return rows;
}

function getOpportunityPair(snapshot: MarketTerminalSnapshot, opportunity: TokenOpportunity) {
  const pair = snapshot.allPairs.find((item) => item.id === opportunity.primaryMarketId);
  return pair ? orientPairToOpportunity(pair, opportunity) : undefined;
}

function opportunitySearchText(pair: BasePair, snapshot: MarketTerminalSnapshot) {
  const opportunity = snapshot.opportunities.find((item) => item.id === pair.opportunityId);
  const pools = opportunity ? snapshot.allPairs.filter((item) => opportunity.poolMarketIds.includes(item.id)) : [];
  return [pair.pair, pair.project, pair.baseToken, pair.quoteToken, opportunity?.focusTokenAddress, ...pools.flatMap((pool) => [pool.pairAddress, pool.baseTokenAddress, pool.quoteTokenAddress, pool.dexName, pool.dex])]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("en-US");
}

function matchesMarketContext(pair: BasePair, snapshot: MarketTerminalSnapshot, filters: MarketFilters, matrixView: "tokens" | "pools") {
  const opportunity = pair.opportunityId ? snapshot.opportunities.find((item) => item.id === pair.opportunityId) : undefined;
  const pools = matrixView === "tokens" && opportunity
    ? snapshot.allPairs.filter((item) => opportunity.poolMarketIds.includes(item.id))
    : [pair];
  if (filters.dex && !pools.some((pool) => [pool.dexId, pool.dexName, pool.dex].some((value) => value?.trim().toLocaleLowerCase("en-US") === filters.dex))) return false;
  if (filters.quoteTokenAddress && !pools.some((pool) => pool.quoteTokenAddress?.trim().toLocaleLowerCase("en-US") === filters.quoteTokenAddress)) return false;
  if (!filters.category || filters.category === "all") return true;
  if (!opportunity) return false;
  if (filters.category === "new") return opportunity.categoryEligibility.newlyCreated;
  if (filters.category === "moving") return opportunity.categoryEligibility.moving;
  if (filters.category === "liquidity") return opportunity.categoryEligibility.liquidity;
  const current = opportunity.aggregate.volumes?.h1;
  const previous = snapshot.comparison.opportunityVolume1h[opportunity.id];
  return snapshot.comparison.status === "ready" && current !== undefined && previous !== undefined && previous > 0 && current / previous >= 1.8;
}

function SortButton({ column, filters, patchFilters }: { column: MatrixColumn; filters: MarketFilters; patchFilters: (patch: Partial<MarketFilters>) => void }) {
  const { t } = useI18n();
  const sortKey = column as MarketSortKey;
  return <button type="button" onClick={() => patchFilters({ sortBy: sortKey, sortDirection: filters.sortBy === sortKey && filters.sortDirection === "desc" ? "asc" : "desc" })} className="inline-flex items-center gap-1">{t(`terminalV3.column.${column}`)}{filters.sortBy === sortKey ? (filters.sortDirection === "asc" ? "↑" : "↓") : null}</button>;
}

function NumberBox({ label, value, onChange }: { label: string; value?: number; onChange: (value?: number) => void }) { return <label className="relative"><span className="sr-only">{label}</span><input type="number" min="0" value={value ?? ""} onChange={(event) => { const parsed = Number(event.target.value); onChange(event.target.value !== "" && Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined); }} placeholder={label} className="h-10 w-full rounded-sm border border-base-line bg-base-panel px-2 font-mono text-[10px] outline-none focus:border-base-mint" /></label>; }

function formatMatrixValue(column: MatrixColumn, pair: BasePair, model: ReturnType<typeof getNormalizedMarketModel>, locale: "tr" | "en", currency: (value: number) => string, percent: (value: number) => string, t: (key: never, values?: never) => string) {
  if (column === "age") return model.ageMinutes === undefined ? "N/A" : localizeAgeLabel(pair.age, locale);
  if (column === "price") return displayPrice(pair);
  if (column === "change5m") return model.change5m === undefined ? "N/A" : percent(model.change5m);
  if (column === "change1h") return model.change1h === undefined ? "N/A" : percent(model.change1h);
  if (column === "change24h") return model.change24h === undefined ? "N/A" : percent(model.change24h);
  if (column === "volume5m") return model.volume5mUsd === undefined ? "N/A" : currency(model.volume5mUsd);
  if (column === "volume1h") return model.volume1hUsd === undefined ? "N/A" : currency(model.volume1hUsd);
  if (column === "volume24h") return model.volume24hUsd === undefined ? "N/A" : currency(model.volume24hUsd);
  if (column === "liquidity") return model.liquidityUsd === undefined ? "N/A" : currency(model.liquidityUsd);
  if (column === "fdv") return pair.fdv === undefined ? "N/A" : currency(pair.fdv);
  if (column === "marketCap") return pair.marketCap === undefined ? "N/A" : currency(pair.marketCap);
  if (column === "transactions") { const tx = pair.txns?.h24; return tx ? String(tx.buys + tx.sells) : "N/A"; }
  return pair.stale ? String(t("common.delayed" as never)) : String(t("terminalV3.fresh" as never));
}

function normalizePreferences(value: Partial<MatrixPreferences>): MatrixPreferences {
  const savedFilters = value.filters && typeof value.filters === "object" ? value.filters as Partial<MarketFilters> : {};
  const filters: MarketFilters = {
    query: typeof savedFilters.query === "string" ? savedFilters.query.slice(0, 160) : "",
    minimumLiquidity: validOptionalFilterNumber(savedFilters.minimumLiquidity),
    minimumVolume24h: validOptionalFilterNumber(savedFilters.minimumVolume24h),
    maximumAgeMinutes: validOptionalFilterNumber(savedFilters.maximumAgeMinutes),
    change: savedFilters.change === "gainers" || savedFilters.change === "losers" ? savedFilters.change : "all",
    dex: typeof savedFilters.dex === "string" ? savedFilters.dex.slice(0, 100).trim().toLocaleLowerCase("en-US") : "",
    quoteTokenAddress: typeof savedFilters.quoteTokenAddress === "string" && /^0x[0-9a-f]{40}$/i.test(savedFilters.quoteTokenAddress) ? savedFilters.quoteTokenAddress.toLocaleLowerCase("en-US") : "",
    category: savedFilters.category === "new" || savedFilters.category === "moving" || savedFilters.category === "volume" || savedFilters.category === "liquidity" ? savedFilters.category : "all",
    sortBy: (["pair", "age", "price", "change5m", "change1h", "change24h", "volume5m", "volume1h", "volume24h", "liquidity", "fdv", "marketCap", "transactions", "freshness"] as MarketSortKey[]).includes(savedFilters.sortBy as MarketSortKey) ? savedFilters.sortBy as MarketSortKey : DEFAULT_MARKET_FILTERS.sortBy,
    sortDirection: savedFilters.sortDirection === "asc" ? "asc" : "desc"
  };
  const columns = Array.isArray(value.columns) ? value.columns.filter((column): column is MatrixColumn => DEFAULT_COLUMNS.includes(column as MatrixColumn)) : [...DEFAULT_COLUMNS];
  const signalTypes = Array.isArray(value.signalTypes) ? value.signalTypes.filter((type): type is MarketSignalType => SIGNAL_FILTER_TYPES.includes(type as typeof SIGNAL_FILTER_TYPES[number])) : [];
  return { filters, density: value.density === "comfortable" ? "comfortable" : "compact", columns: columns.length ? [...new Set(columns)] : [...DEFAULT_COLUMNS], signalTypes: [...new Set(signalTypes)] };
}

function validOptionalFilterNumber(value: unknown) { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined; }

function displayPrice(pair: BasePair) { return typeof pair.priceUsdValue === "number" && Number.isFinite(pair.priceUsdValue) && pair.priceUsdValue > 0 ? pair.priceUsd : "N/A"; }

function sparkPath(values: number[]) {
  if (values.length < 2 || values.some((value) => !Number.isFinite(value))) return undefined;
  const min = Math.min(...values); const max = Math.max(...values); const spread = max - min || 1;
  return values.map((value, index) => `${index === 0 ? "M" : "L"} ${(index / (values.length - 1) * 280).toFixed(1)} ${(86 - ((value - min) / spread) * 80).toFixed(1)}`).join(" ");
}

function shortAddress(value: string | undefined) {
  return value && value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value ?? "N/A";
}

function safeTestId(value: string) {
  return value.replace(/[^a-z0-9_-]/gi, "-");
}

function poolCountLabel(count: number, t: (key: TranslationKey, values?: Record<string, string | number>) => string) {
  return count === 1 ? t("terminalV3.onePool") : t("terminalV3.poolCount", { count });
}
