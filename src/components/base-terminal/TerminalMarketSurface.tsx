"use client";

import { ArrowDownUp, Eye, Filter, RotateCcw, Settings2, Star } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MarketTerminalSnapshot } from "@/data/providers";
import { useI18n } from "@/i18n/I18nProvider";
import { localizeAgeLabel } from "@/i18n/dictionaries";
import { getMarketInvariantAttributes, getNormalizedMarketModel } from "@/lib/base-terminal/marketModel";
import {
  buildOpportunityLanes,
  DEFAULT_MARKET_FILTERS,
  filterAndSortMarkets,
  type MarketFilters,
  type MarketSortKey,
  type TerminalLane
} from "@/lib/base-terminal/terminalMarket";
import { cx } from "@/lib/format";
import { safeReadJson, safeSetStorageItem } from "@/lib/safeStorage";
import type { BasePair } from "@/types/baseTerminal";
import { PairAvatarStack } from "@/components/TokenIdentity";

const MATRIX_STORAGE_KEY = "mergen-terminal:market-matrix:v3";
const DEFAULT_COLUMNS = ["age", "price", "change5m", "change1h", "change24h", "volume5m", "volume1h", "volume24h", "transactions", "liquidity", "fdv", "marketCap", "freshness"] as const;
type MatrixColumn = typeof DEFAULT_COLUMNS[number];
type MatrixPreferences = { filters: MarketFilters; density: "compact" | "comfortable"; columns: MatrixColumn[] };

export function LiveMarketTape({ snapshot, onSelect }: { snapshot: MarketTerminalSnapshot; onSelect: (id: string) => void }) {
  const { t, formatPercent } = useI18n();
  const rows = useMemo(() => filterAndSortMarkets(snapshot.allPairs, DEFAULT_MARKET_FILTERS).slice(0, 15), [snapshot.allPairs]);
  const previousValuesRef = useRef<Map<string, string> | undefined>(undefined);
  const [changedPairIds, setChangedPairIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    const nextValues = new Map(rows.map((pair) => [pair.id, `${pair.priceUsdValue ?? "missing"}:${pair.priceChanges?.m5 ?? "missing"}`]));
    const previousValues = previousValuesRef.current;
    previousValuesRef.current = nextValues;
    if (!previousValues) return;
    const changed = new Set(rows.filter((pair) => previousValues.has(pair.id) && previousValues.get(pair.id) !== nextValues.get(pair.id)).map((pair) => pair.id));
    if (!changed.size) return;
    setChangedPairIds(changed);
    const timer = window.setTimeout(() => setChangedPairIds(new Set()), 1_200);
    return () => window.clearTimeout(timer);
  }, [rows]);
  return (
    <section className="pulse-surface overflow-hidden rounded-xl" data-testid="live-market-tape" aria-label={t("terminalV3.tape")}>
      <div className="flex min-h-10 items-center gap-2 overflow-x-auto px-2 py-1.5">
        <span className="sticky left-0 z-10 shrink-0 rounded-full bg-base-panel px-2 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-base-mint">{t("terminalV3.live")}</span>
        {rows.map((pair) => {
          const change = pair.priceChanges?.m5;
          return <button key={pair.id} type="button" onClick={() => onSelect(pair.id)} className={cx("flex min-h-8 shrink-0 items-center gap-2 rounded-full bg-base-elevated px-2.5 text-left outline-none hover:bg-base-mint/10 focus-visible:ring-2 focus-visible:ring-base-mint/50", changedPairIds.has(pair.id) && "market-update-flash")} data-testid={`tape-${pair.id}`}>
            <span className="font-mono text-[10px] font-semibold text-base-text">{pair.pair.replace(" / ", "/")}</span>
            <span className="font-mono text-[10px] text-base-muted">{displayPrice(pair)}</span>
            <span className={cx("font-mono text-[10px]", change === undefined ? "text-base-muted" : change >= 0 ? "text-base-mint" : "text-base-rose")}>{change === undefined ? "5m N/A" : `5m ${formatPercent(change)}`}</span>
            <span className="text-[9px] text-base-muted">{pair.stale ? t("common.delayed") : t("terminalV3.fresh")}</span>
          </button>;
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
  const lanes = useMemo(() => buildOpportunityLanes(snapshot.allPairs), [snapshot.allPairs]);
  return <section aria-label={t("terminalV3.lanes")} data-testid="opportunity-lanes" className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
    {lanes.map((lane) => <MarketLane key={lane.id} lane={lane} selectedPair={selectedPair} onSelect={onSelect} onTrade={onTrade} isPairPinned={isPairPinned} onTogglePin={onTogglePin} />)}
  </section>;
}

function MarketLane({ lane, selectedPair, onSelect, onTrade, isPairPinned, onTogglePin }: {
  lane: TerminalLane;
  selectedPair: BasePair;
  onSelect: (id: string) => void;
  onTrade: (pair: BasePair, side: "buy" | "sell") => void;
  isPairPinned: (pair: BasePair) => boolean;
  onTogglePin: (pair: BasePair) => void;
}) {
  const { t, locale, formatCompactCurrency, formatPercent } = useI18n();
  return <article className="pulse-surface min-w-0 overflow-hidden rounded-xl" data-testid={`opportunity-lane-${lane.id}`}>
    <header className="flex min-h-10 items-center justify-between border-b border-base-line/60 px-3">
      <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-base-text">{t(`terminalV3.lane.${lane.id}`)}</h2>
      <span className="font-mono text-[9px] text-base-muted">{lane.pairs.length}</span>
    </header>
    {lane.fallback ? <p className="border-b border-base-amber/20 bg-base-amber/5 px-3 py-1.5 text-[9px] leading-4 text-base-amber">{t(`terminalV3.lane.${lane.id}Fallback`)}</p> : null}
    <div className="divide-y divide-base-line/50">
      {lane.pairs.map((pair) => {
        const model = getNormalizedMarketModel(pair);
        const change = lane.id === "moving" ? model.change1h : model.change24h;
        return <div key={pair.id} {...getMarketInvariantAttributes(pair)} className={cx("grid grid-cols-[minmax(0,1fr)_auto] gap-2 p-2", pair.id === selectedPair.id && "bg-base-mint/5")}>
          <button type="button" onClick={() => onSelect(pair.id)} className="flex min-h-11 min-w-0 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-base-mint/50">
            <PairAvatarStack baseSymbol={pair.baseToken} quoteSymbol={pair.quoteToken} baseLogoUrl={pair.tokenLogoUrl} quoteLogoUrl={pair.quoteTokenLogoUrl} size="sm" />
            <span className="min-w-0">
              <span className="block truncate font-mono text-[11px] font-semibold text-base-text">{pair.pair}</span>
              <span className="block truncate text-[9px] text-base-muted">{pair.dexName ?? pair.dex} · {model.ageMinutes === undefined ? t("common.noData") : localizeAgeLabel(pair.age, locale)}</span>
              <span className="mt-0.5 block truncate font-mono text-[9px] text-base-muted">{displayPrice(pair)} · {change === undefined ? t("common.noData") : formatPercent(change)} · {model.liquidityUsd === undefined ? t("common.noData") : formatCompactCurrency(model.liquidityUsd)}</span>
            </span>
          </button>
          <span className="flex items-center gap-1">
            <button type="button" onClick={() => onTogglePin(pair)} className={cx("grid h-8 w-8 place-items-center rounded-sm text-base-muted hover:bg-base-elevated hover:text-base-mint", isPairPinned(pair) && "text-base-mint")} aria-label={t(isPairPinned(pair) ? "a11y.unpin" : "a11y.pin", { pair: pair.pair })}><Star size={12} fill={isPairPinned(pair) ? "currentColor" : "none"} /></button>
            <button type="button" onClick={() => onTrade(pair, "buy")} className="h-8 rounded-sm bg-base-mint/10 px-2 text-[9px] font-bold text-base-mint hover:bg-base-mint/20">{t("trade.buy")}</button>
          </span>
        </div>;
      })}
      {lane.pairs.length === 0 ? <p className="p-4 text-[10px] leading-5 text-base-muted">{t("terminalV3.noVerifiedMarkets")}</p> : null}
    </div>
  </article>;
}

export function MarketMatrix({ pairs, selectedPair, onSelect, onTrade, isPairPinned, onTogglePin, onInteractionChange, watchlistOnly = false }: {
  pairs: BasePair[];
  selectedPair: BasePair;
  onSelect: (id: string) => void;
  onTrade: (pair: BasePair, side: "buy" | "sell") => void;
  isPairPinned: (pair: BasePair) => boolean;
  onTogglePin: (pair: BasePair) => void;
  onInteractionChange: (locked: boolean) => void;
  watchlistOnly?: boolean;
}) {
  const { t, locale, formatCompactCurrency, formatPercent } = useI18n();
  const [preferences, setPreferences] = useState<MatrixPreferences>(() => ({ filters: DEFAULT_MARKET_FILTERS, density: "compact", columns: [...DEFAULT_COLUMNS] }));
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const saved = safeReadJson<Partial<MatrixPreferences>>(MATRIX_STORAGE_KEY, {});
    setPreferences(normalizePreferences(saved));
    setLoaded(true);
  }, []);
  useEffect(() => { if (loaded) safeSetStorageItem(MATRIX_STORAGE_KEY, JSON.stringify(preferences)); }, [loaded, preferences]);
  const source = useMemo(() => watchlistOnly ? pairs.filter(isPairPinned) : pairs, [isPairPinned, pairs, watchlistOnly]);
  const rows = useMemo(() => filterAndSortMarkets(source, preferences.filters), [preferences.filters, source]);
  const filters = preferences.filters;
  const activeFilters = [filters.query && t("terminalV3.filter.search", { value: filters.query }), filters.minimumLiquidity !== undefined && t("terminalV3.filter.liquidity", { value: formatCompactCurrency(filters.minimumLiquidity) }), filters.minimumVolume24h !== undefined && t("terminalV3.filter.volume", { value: formatCompactCurrency(filters.minimumVolume24h) }), filters.maximumAgeMinutes !== undefined && t("terminalV3.filter.age", { value: filters.maximumAgeMinutes }), filters.change !== "all" && t(`terminalV3.filter.${filters.change}`)].filter((value): value is string => Boolean(value));

  const patchFilters = (patch: Partial<MarketFilters>) => setPreferences((current) => ({ ...current, filters: { ...current.filters, ...patch } }));
  const toggleColumn = (column: MatrixColumn) => setPreferences((current) => ({ ...current, columns: current.columns.includes(column) ? current.columns.filter((item) => item !== column) : [...current.columns, column] }));
  return <section className="pulse-surface min-w-0 overflow-hidden rounded-xl" data-testid="market-matrix" onMouseEnter={() => onInteractionChange(true)} onMouseLeave={() => onInteractionChange(false)} onFocusCapture={() => onInteractionChange(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onInteractionChange(false); }}>
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-base-line/60 px-3 py-2">
      <div><p className="text-[9px] font-bold uppercase tracking-[0.14em] text-base-mint">{t("terminalV3.matrixEyebrow")}</p><h2 className="text-[14px] font-semibold text-base-text">{watchlistOnly ? t("nav.watchlist") : t("terminalV3.matrix")}</h2></div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-full bg-base-elevated px-2 py-1 font-mono text-[10px] text-base-muted" data-testid="market-result-count">{t("common.results", { count: rows.length })}</span>
        <button type="button" onClick={() => setPreferences((current) => ({ ...current, density: current.density === "compact" ? "comfortable" : "compact" }))} className="inline-flex min-h-9 items-center gap-1 rounded-sm bg-base-elevated px-2 text-[10px] text-base-muted"><ArrowDownUp size={12} />{t(`terminalV3.density.${preferences.density}`)}</button>
        <details className="relative"><summary className="flex min-h-9 cursor-pointer list-none items-center gap-1 rounded-sm bg-base-elevated px-2 text-[10px] text-base-muted"><Settings2 size={12} />{t("terminalV3.columns")}</summary><div className="absolute right-0 top-10 z-30 grid w-48 gap-1 rounded-lg border border-base-line bg-base-panel p-2 shadow-xl">{DEFAULT_COLUMNS.map((column) => <label key={column} className="flex min-h-8 items-center gap-2 text-[10px] text-base-muted"><input type="checkbox" checked={preferences.columns.includes(column)} onChange={() => toggleColumn(column)} />{t(`terminalV3.column.${column}`)}</label>)}</div></details>
      </div>
    </header>
    <div className="grid gap-2 border-b border-base-line/60 bg-base-elevated/40 p-2 sm:grid-cols-2 xl:grid-cols-6">
      <label className="xl:col-span-2"><span className="sr-only">{t("header.search")}</span><input value={filters.query} onChange={(event) => patchFilters({ query: event.target.value })} placeholder={t("header.searchPlaceholder")} className="h-10 w-full rounded-sm border border-base-line bg-base-panel px-2 text-[11px] outline-none focus:border-base-mint" /></label>
      <NumberBox label={t("market.advanced.minLiquidity")} value={filters.minimumLiquidity} onChange={(minimumLiquidity) => patchFilters({ minimumLiquidity })} />
      <NumberBox label={t("market.advanced.minVolume")} value={filters.minimumVolume24h} onChange={(minimumVolume24h) => patchFilters({ minimumVolume24h })} />
      <select aria-label={t("terminalV3.changeFilter")} value={filters.change} onChange={(event) => patchFilters({ change: event.target.value as MarketFilters["change"] })} className="h-10 rounded-sm border border-base-line bg-base-panel px-2 text-[11px]"><option value="all">{t("terminalV3.filter.all")}</option><option value="gainers">{t("terminalV3.filter.gainers")}</option><option value="losers">{t("terminalV3.filter.losers")}</option></select>
      <button type="button" onClick={() => setPreferences((current) => ({ ...current, filters: DEFAULT_MARKET_FILTERS }))} className="inline-flex min-h-10 items-center justify-center gap-1 rounded-sm border border-base-line bg-base-panel px-2 text-[10px] text-base-muted hover:text-base-text"><RotateCcw size={12} />{t("market.advanced.reset")}</button>
    </div>
    {activeFilters.length ? <div className="flex flex-wrap gap-1 border-b border-base-line/60 px-3 py-2" data-testid="active-filter-chips"><Filter size={12} className="text-base-mint" />{activeFilters.map((filter) => <span key={filter} className="rounded-full bg-base-mint/10 px-2 py-0.5 text-[9px] text-base-mint">{filter}</span>)}</div> : null}
    <div className="hidden max-h-[620px] overflow-auto lg:block">
      <table className="w-full min-w-[1120px] border-collapse text-left">
        <thead className="sticky top-0 z-10 bg-base-elevated text-[9px] uppercase tracking-[0.08em] text-base-muted"><tr><th className="px-2 py-2">{t("market.market")}</th><th className="px-2 py-2">{t("details.source")}</th>{preferences.columns.map((column) => <th key={column} className="px-2 py-2 text-right"><SortButton column={column} filters={filters} patchFilters={patchFilters} /></th>)}<th className="px-2 py-2 text-right">{t("terminalV3.actions")}</th></tr></thead>
        <tbody>{rows.slice(0, 80).map((pair) => <MatrixRow key={pair.id} pair={pair} columns={preferences.columns} density={preferences.density} selected={pair.id === selectedPair.id} onSelect={onSelect} onTrade={onTrade} isPinned={isPairPinned(pair)} onTogglePin={onTogglePin} locale={locale} formatCompactCurrency={formatCompactCurrency} formatPercent={formatPercent} />)}</tbody>
      </table>
    </div>
    <div className="divide-y divide-base-line/60 lg:hidden">{rows.slice(0, 60).map((pair) => <MobileMarketCard key={pair.id} pair={pair} selected={pair.id === selectedPair.id} onSelect={onSelect} onTrade={onTrade} isPinned={isPairPinned(pair)} onTogglePin={onTogglePin} />)}</div>
    {rows.length === 0 ? <div className="p-8 text-center text-[11px] text-base-muted"><p className="font-semibold text-base-text">{t("market.noMatches")}</p><p className="mt-1">{t("market.noMatchesBody")}</p></div> : null}
  </section>;
}

function MatrixRow({ pair, columns, density, selected, onSelect, onTrade, isPinned, onTogglePin, locale, formatCompactCurrency, formatPercent }: {
  pair: BasePair; columns: MatrixColumn[]; density: MatrixPreferences["density"]; selected: boolean; onSelect: (id: string) => void; onTrade: (pair: BasePair, side: "buy" | "sell") => void; isPinned: boolean; onTogglePin: (pair: BasePair) => void; locale: "tr" | "en"; formatCompactCurrency: (value: number) => string; formatPercent: (value: number) => string;
}) {
  const { t } = useI18n();
  const model = getNormalizedMarketModel(pair);
  return <tr {...getMarketInvariantAttributes(pair)} className={cx("border-t border-base-line/50 hover:bg-base-mint/5", selected && "bg-base-mint/10")} data-testid={`matrix-row-${pair.id}`}>
    <td className="p-0"><button type="button" onClick={() => onSelect(pair.id)} className={cx("flex w-full min-w-[170px] items-center gap-2 px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-base-mint/50", density === "compact" ? "min-h-11" : "min-h-14")}><PairAvatarStack baseSymbol={pair.baseToken} quoteSymbol={pair.quoteToken} baseLogoUrl={pair.tokenLogoUrl} quoteLogoUrl={pair.quoteTokenLogoUrl} size="sm" /><span className="min-w-0"><span className="block truncate font-mono text-[11px] font-semibold">{pair.pair}</span><span className="block truncate text-[9px] text-base-muted">{pair.project}</span></span></button></td>
    <td className="px-2 text-[9px] text-base-muted"><span className="block">{pair.dexName ?? pair.dex}</span><span className="font-mono">{pair.dataSource ?? t("common.unknown")}</span></td>
    {columns.map((column) => <td key={column} className="px-2 text-right font-mono text-[10px] text-base-text">{formatMatrixValue(column, pair, model, locale, formatCompactCurrency, formatPercent, t)}</td>)}
    <td className="px-2"><span className="flex justify-end gap-1"><button type="button" onClick={() => onTogglePin(pair)} className={cx("grid h-8 w-8 place-items-center rounded-sm bg-base-elevated text-base-muted", isPinned && "text-base-mint")} aria-label={t(isPinned ? "a11y.unpin" : "a11y.pin", { pair: pair.pair })}><Star size={12} fill={isPinned ? "currentColor" : "none"} /></button><button type="button" onClick={() => onSelect(pair.id)} className="grid h-8 w-8 place-items-center rounded-sm bg-base-elevated text-base-muted" aria-label={t("terminalV3.inspect", { pair: pair.pair })}><Eye size={12} /></button><button type="button" onClick={() => onTrade(pair, "buy")} className="h-8 rounded-sm bg-base-mint/10 px-2 text-[9px] font-bold text-base-mint">{t("trade.buy")}</button><button type="button" onClick={() => onTrade(pair, "sell")} className="h-8 rounded-sm bg-base-rose/10 px-2 text-[9px] font-bold text-base-rose">{t("trade.sell")}</button></span></td>
  </tr>;
}

function MobileMarketCard({ pair, selected, onSelect, onTrade, isPinned, onTogglePin }: { pair: BasePair; selected: boolean; onSelect: (id: string) => void; onTrade: (pair: BasePair, side: "buy" | "sell") => void; isPinned: boolean; onTogglePin: (pair: BasePair) => void }) {
  const { t, formatCompactCurrency, formatPercent } = useI18n();
  const model = getNormalizedMarketModel(pair);
  return <article className={cx("p-3", selected && "bg-base-mint/10")} data-testid={`matrix-row-${pair.id}`}><div className="flex items-center gap-2"><button type="button" onClick={() => onSelect(pair.id)} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left"><PairAvatarStack baseSymbol={pair.baseToken} quoteSymbol={pair.quoteToken} baseLogoUrl={pair.tokenLogoUrl} quoteLogoUrl={pair.quoteTokenLogoUrl} size="md" /><span className="min-w-0"><span className="block truncate font-mono text-[12px] font-semibold">{pair.pair}</span><span className="block truncate text-[10px] text-base-muted">{pair.dexName ?? pair.dex} · {displayPrice(pair)}</span></span></button><button type="button" onClick={() => onTogglePin(pair)} className={cx("grid h-11 w-11 place-items-center rounded-sm bg-base-elevated text-base-muted", isPinned && "text-base-mint")}><Star size={14} fill={isPinned ? "currentColor" : "none"} /></button></div><div className="mt-2 grid grid-cols-3 gap-1 text-center font-mono text-[9px]"><span className="rounded-sm bg-base-elevated p-2"><b className={model.change24h === undefined ? "text-base-muted" : model.change24h >= 0 ? "text-base-mint" : "text-base-rose"}>{model.change24h === undefined ? "N/A" : formatPercent(model.change24h)}</b><small className="mt-1 block text-base-muted">24h</small></span><span className="rounded-sm bg-base-elevated p-2"><b>{model.volume24hUsd === undefined ? "N/A" : formatCompactCurrency(model.volume24hUsd)}</b><small className="mt-1 block text-base-muted">{t("market.volume24h")}</small></span><span className="rounded-sm bg-base-elevated p-2"><b>{model.liquidityUsd === undefined ? "N/A" : formatCompactCurrency(model.liquidityUsd)}</b><small className="mt-1 block text-base-muted">{t("market.liquidity")}</small></span></div><div className="mt-2 grid grid-cols-2 gap-2"><button type="button" onClick={() => onTrade(pair, "buy")} className="min-h-11 rounded-sm bg-base-mint/10 text-[11px] font-bold text-base-mint">{t("trade.buy")}</button><button type="button" onClick={() => onTrade(pair, "sell")} className="min-h-11 rounded-sm bg-base-rose/10 text-[11px] font-bold text-base-rose">{t("trade.sell")}</button></div></article>;
}

export function PinnedMarketGrid({ pairs, onSelect, onUnpin }: { pairs: BasePair[]; onSelect: (id: string) => void; onUnpin: (pair: BasePair) => void }) {
  const { t, formatPercent } = useI18n();
  return <section className="pulse-surface overflow-hidden rounded-xl" data-testid="pinned-multichart"><header className="flex items-center justify-between border-b border-base-line/60 px-3 py-2"><div><p className="text-[9px] font-bold uppercase tracking-[0.14em] text-base-mint">{t("terminalV3.multichart")}</p><h2 className="text-[14px] font-semibold">{t("terminalV3.pinnedMarkets")}</h2></div><span className="font-mono text-[10px] text-base-muted">{pairs.length}/4</span></header>{pairs.length ? <div className="grid gap-px bg-base-line/60 sm:grid-cols-2">{pairs.slice(0, 4).map((pair) => { const candles = pair.chartSource === "geckoterminal" ? pair.chartCandles ?? [] : []; const path = sparkPath(candles.map((candle) => candle.close)); return <article key={pair.id} className="bg-base-panel p-3"><div className="flex items-center justify-between"><button type="button" onClick={() => onSelect(pair.id)} className="font-mono text-[11px] font-semibold hover:text-base-mint">{pair.pair}</button><button type="button" onClick={() => onUnpin(pair)} className="min-h-8 px-2 text-[9px] text-base-muted">{t("terminalV3.unpin")}</button></div><div className="mt-1 flex items-center justify-between text-[9px] text-base-muted"><span>{pair.dexName ?? pair.dex}</span><span className={pair.change24h >= 0 ? "text-base-mint" : "text-base-rose"}>{formatPercent(pair.change24h)}</span></div>{path ? <svg viewBox="0 0 280 90" className="mt-2 h-24 w-full" role="img" aria-label={t("terminalV3.miniChart", { pair: pair.pair })}><path d={path} fill="none" stroke="rgb(var(--color-mint))" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg> : <div className="mt-2 grid h-24 place-items-center rounded-sm bg-base-elevated text-center text-[10px] leading-5 text-base-muted">{t("chart.unavailableBody")}</div>}</article>; })}</div> : <div className="p-6 text-center text-[11px] leading-5 text-base-muted">{t("terminalV3.pinEmpty")}</div>}</section>;
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
    sortBy: (["pair", "age", "price", "change5m", "change1h", "change24h", "volume5m", "volume1h", "volume24h", "liquidity", "fdv", "marketCap", "transactions", "freshness"] as MarketSortKey[]).includes(savedFilters.sortBy as MarketSortKey) ? savedFilters.sortBy as MarketSortKey : DEFAULT_MARKET_FILTERS.sortBy,
    sortDirection: savedFilters.sortDirection === "asc" ? "asc" : "desc"
  };
  const columns = Array.isArray(value.columns) ? value.columns.filter((column): column is MatrixColumn => DEFAULT_COLUMNS.includes(column as MatrixColumn)) : [...DEFAULT_COLUMNS];
  return { filters, density: value.density === "comfortable" ? "comfortable" : "compact", columns: columns.length ? [...new Set(columns)] : [...DEFAULT_COLUMNS] };
}

function validOptionalFilterNumber(value: unknown) { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined; }

function displayPrice(pair: BasePair) { return typeof pair.priceUsdValue === "number" && Number.isFinite(pair.priceUsdValue) && pair.priceUsdValue > 0 ? pair.priceUsd : "N/A"; }

function sparkPath(values: number[]) {
  if (values.length < 2 || values.some((value) => !Number.isFinite(value))) return undefined;
  const min = Math.min(...values); const max = Math.max(...values); const spread = max - min || 1;
  return values.map((value, index) => `${index === 0 ? "M" : "L"} ${(index / (values.length - 1) * 280).toFixed(1)} ${(86 - ((value - min) / spread) * 80).toFixed(1)}`).join(" ");
}
