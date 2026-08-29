"use client";

import { RefreshCw, SlidersHorizontal, Star, X } from "lucide-react";
import type { ProviderHealthState } from "@/components/TerminalSearchContext";
import { useMemo, useState } from "react";
import { PairAvatarStack } from "@/components/TokenIdentity";
import type { MarketTerminalSnapshot } from "@/data/providers";
import {
  DEFAULT_DISCOVERY_FILTERS,
  DISCOVERY_CATEGORIES,
  DISCOVERY_MIN_LIQUIDITY_USD,
  buildDiscoveryRows,
  getChange24h,
  getDiscoveryDexOptions,
  getLiquidityUsd,
  getPairAgeMinutes,
  getVolume24h,
  hasActiveDiscoveryFilters,
  isDiscoveryDataComplete,
  type DiscoveryCategory,
  type DiscoveryFilters,
  type DiscoveryRow,
  type DiscoverySort
} from "@/lib/base-terminal/discovery";
import { cx, formatCompactCurrency, formatPercent } from "@/lib/format";
import type { BasePair } from "@/types/baseTerminal";

export function MarketDiscovery({
  snapshot,
  selectedPair,
  recentPairIds,
  onSelect,
  isPairPinned,
  onTogglePin,
  pendingUpdateCount,
  onApplyPendingUpdates,
  onRefresh,
  refreshStatus,
  onInteractionChange,
  updatedPairIds
}: {
  snapshot: MarketTerminalSnapshot;
  selectedPair: BasePair;
  recentPairIds: string[];
  onSelect: (id: string) => void;
  isPairPinned: (pair: BasePair) => boolean;
  onTogglePin: (pair: BasePair) => void;
  pendingUpdateCount: number;
  onApplyPendingUpdates: () => void;
  onRefresh: () => void;
  refreshStatus: ProviderHealthState["status"];
  onInteractionChange: (active: boolean) => void;
  updatedPairIds: string[];
}) {
  const [category, setCategory] = useState<DiscoveryCategory>("volume");
  const [filters, setFilters] = useState<DiscoveryFilters>(DEFAULT_DISCOVERY_FILTERS);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [showSelected, setShowSelected] = useState(false);
  const dexOptions = useMemo(() => getDiscoveryDexOptions(snapshot.allPairs), [snapshot.allPairs]);
  const categoryCounts = useMemo(
    () =>
      Object.fromEntries(
        DISCOVERY_CATEGORIES.map(({ id }) => [
          id,
          buildDiscoveryRows({
            pairs: snapshot.allPairs,
            category: id,
            filters: DEFAULT_DISCOVERY_FILTERS,
            isPairPinned,
            recentPairIds
          }).length
        ])
      ) as Record<DiscoveryCategory, number>,
    [isPairPinned, recentPairIds, snapshot.allPairs]
  );
  const rows = useMemo(
    () =>
      buildDiscoveryRows({
        pairs: snapshot.allPairs,
        category,
        filters,
        isPairPinned,
        recentPairIds
      }),
    [category, filters, isPairPinned, recentPairIds, snapshot.allPairs]
  );
  const selectedOutsideFilters = !rows.some(({ pair }) => pair.id === selectedPair.id);
  const visibleRows = useMemo(() => {
    const limited = rows.slice(0, 24);
    return showSelected && selectedOutsideFilters
      ? [{ pair: selectedPair }, ...limited.filter(({ pair }) => pair.id !== selectedPair.id)]
      : limited;
  }, [rows, selectedOutsideFilters, selectedPair, showSelected]);
  const currentCategory = DISCOVERY_CATEGORIES.find(({ id }) => id === category)!;
  const freshnessLabel = formatSnapshotFreshness(snapshot.generatedAt);

  function patchFilters(patch: Partial<DiscoveryFilters>) {
    setFilters((current) => ({ ...current, ...patch }));
    setShowSelected(false);
  }

  function resetFilters() {
    setFilters(DEFAULT_DISCOVERY_FILTERS);
    setShowSelected(false);
  }

  return (
    <section
      id="market-discovery"
      className="pulse-surface overflow-hidden rounded-xl"
      data-testid="market-discovery"
      onPointerEnter={() => onInteractionChange(true)}
      onPointerLeave={() => onInteractionChange(false)}
      onFocusCapture={() => onInteractionChange(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onInteractionChange(false);
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-base-line/60 px-3 py-3 sm:px-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-base-mint">
            Market Discovery · Live Board
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h2 className="text-[16px] font-semibold text-base-text">Stable updates while you inspect</h2>
            <span className="font-mono text-[10px] text-base-muted">
              {formatSnapshotFreshness(snapshot.generatedAt)} · {snapshot.providerName}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshStatus === "refreshing"}
            data-testid="refresh-market-board"
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-base-elevated px-2.5 font-mono text-[10px] text-base-muted hover:text-base-mint disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw size={11} className={refreshStatus === "refreshing" ? "animate-spin" : undefined} />
            {refreshStatus === "refreshing" ? "Checking" : "Refresh board"}
          </button>
          {pendingUpdateCount > 0 ? (
            <button
              type="button"
              onClick={onApplyPendingUpdates}
              data-testid="apply-market-updates"
              className="inline-flex h-8 items-center rounded-full bg-base-mint px-3 text-[10px] font-bold text-[#031411] shadow-[0_0_18px_rgb(var(--color-mint)/0.16)]"
            >
              {pendingUpdateCount} new market updates
            </button>
          ) : null}
          <span className="font-mono text-[11px] text-base-muted" data-testid="discovery-result-count">
            {rows.length} results
          </span>
          <button
            type="button"
            onClick={() => setAdvancedOpen((open) => !open)}
            aria-expanded={advancedOpen}
            className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-base-line bg-base-panel px-2.5 text-[11px] font-semibold text-base-muted outline-none hover:border-base-mint hover:text-base-text focus-visible:ring-2 focus-visible:ring-base-mint/40"
          >
            <SlidersHorizontal size={13} aria-hidden="true" />
            Filters
          </button>
          {hasActiveDiscoveryFilters(filters) ? (
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex h-8 items-center gap-1 px-1.5 text-[11px] text-base-amber outline-none hover:text-base-text focus-visible:ring-2 focus-visible:ring-base-mint/40"
            >
              <X size={12} aria-hidden="true" />
              Clear
            </button>
          ) : null}
        </div>
      </div>

      <div className="border-b border-base-line px-3 py-2">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Market categories">
          {DISCOVERY_CATEGORIES.map((item) => {
            const disabled = categoryCounts[item.id] === 0 && item.id !== category;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={category === item.id}
                disabled={disabled}
                title={disabled ? `${item.description}; no qualified data` : item.description}
                data-testid={`discovery-category-${item.id}`}
                onClick={() => {
                  setCategory(item.id);
                  setShowSelected(false);
                }}
                className={cx(
                  "min-h-10 rounded-sm border px-2.5 text-[11px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-base-mint/40 disabled:cursor-not-allowed disabled:opacity-35 sm:min-h-8",
                  category === item.id
                    ? "border-base-mint/45 bg-base-mint/10 text-base-mint"
                    : "border-transparent text-base-muted hover:border-base-line hover:bg-base-elevated hover:text-base-text"
                )}
              >
                {item.label}
                <span className="ml-1 font-mono text-[9px] opacity-70">{categoryCounts[item.id]}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[10px] font-medium text-base-muted">Quick filters</span>
          <QuickFilter label="Fresh" active={filters.quickFresh} onClick={() => patchFilters({ quickFresh: !filters.quickFresh })} />
          <QuickFilter label="Liquid" active={filters.quickLiquid} onClick={() => patchFilters({ quickLiquid: !filters.quickLiquid })} />
          <QuickFilter label="Moving" active={filters.quickMoving} onClick={() => patchFilters({ quickMoving: !filters.quickMoving })} />
          <QuickFilter label="High Volume" active={filters.quickHighVolume} onClick={() => patchFilters({ quickHighVolume: !filters.quickHighVolume })} />
          <QuickFilter label="Watched" active={filters.quickWatched} onClick={() => patchFilters({ quickWatched: !filters.quickWatched })} />
          <span className="ml-auto text-[10px] text-base-muted">{currentCategory.description}</span>
        </div>
      </div>

      {advancedOpen ? (
        <AdvancedFilters
          filters={filters}
          dexOptions={dexOptions}
          onChange={patchFilters}
          onReset={resetFilters}
        />
      ) : null}

      {category === "volatile" ? (
        <p className="border-b border-base-amber/30 bg-base-amber/10 px-3 py-1.5 text-[11px] text-base-amber">
          Volatility ranks absolute price movement. It does not mean the market is rising or safe.
        </p>
      ) : null}

      {selectedOutsideFilters ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-base-amber/35 bg-base-amber/10 px-3 py-2 text-[11px] text-base-amber">
          <span>{selectedPair.pair} is hidden by this category or the current filters.</span>
          <button
            type="button"
            onClick={() => setShowSelected(true)}
            className="font-semibold underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-base-amber/40"
          >
            Show selected
          </button>
          <button
            type="button"
            onClick={resetFilters}
            className="font-semibold underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-base-amber/40"
          >
            Clear filters
          </button>
        </div>
      ) : null}

      <div className="hidden max-h-[230px] overflow-auto lg:block">
        <table className="w-full min-w-[700px] border-collapse text-left">
          <thead className="bg-base-elevated text-[10px] font-semibold uppercase tracking-[0.08em] text-base-muted">
            <tr>
              <th className="px-3 py-2">Market</th>
              <th className="px-2 py-2">Age</th>
              <th className="px-2 py-2 text-right">Price / change</th>
              <th className="px-2 py-2 text-right">24h volume</th>
              <th className="px-2 py-2 text-right">Liquidity</th>
              <th className="px-2 py-2">Data status</th>
              <th className="w-10 px-2 py-2"><span className="sr-only">Watchlist</span></th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <DiscoveryTableRow
                key={row.pair.id}
                row={row}
                freshness={freshnessLabel}
                selected={row.pair.id === selectedPair.id}
                updated={updatedPairIds.includes(row.pair.id)}
                isPinned={isPairPinned(row.pair)}
                onSelect={onSelect}
                onTogglePin={onTogglePin}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="divide-y divide-base-line lg:hidden">
        {visibleRows.map((row) => (
          <DiscoveryMobileCard
            key={row.pair.id}
            row={row}
            freshness={freshnessLabel}
            selected={row.pair.id === selectedPair.id}
            updated={updatedPairIds.includes(row.pair.id)}
            isPinned={isPairPinned(row.pair)}
            onSelect={onSelect}
            onTogglePin={onTogglePin}
          />
        ))}
      </div>

      {visibleRows.length === 0 ? (
        <div className="px-4 py-8 text-center text-[12px] text-base-muted">
          <p className="font-semibold text-base-text">No qualified markets match.</p>
          <p className="mt-1">Choose another category or clear the active filters.</p>
        </div>
      ) : null}
    </section>
  );
}

function DiscoveryTableRow({
  row,
  freshness,
  selected,
  updated,
  isPinned,
  onSelect,
  onTogglePin
}: {
  row: DiscoveryRow;
  freshness: string;
  selected: boolean;
  updated: boolean;
  isPinned: boolean;
  onSelect: (id: string) => void;
  onTogglePin: (pair: BasePair) => void;
}) {
  const { pair } = row;
  const change24h = getChange24h(pair);

  return (
    <tr
      className={cx("border-t border-base-line/60 hover:bg-base-mint/5", selected && "bg-base-mint/10", updated && "market-update-flash")}
      data-testid={`discovery-row-${pair.id}`}
    >
      <td className="p-0">
        <button type="button" onClick={() => onSelect(pair.id)} className="flex min-h-14 w-full items-center gap-2 px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-base-mint/40">
          <PairAvatarStack baseSymbol={pair.baseToken} quoteSymbol={pair.quoteToken} baseLogoUrl={pair.tokenLogoUrl} quoteLogoUrl={pair.quoteTokenLogoUrl} size="sm" />
          <span className="min-w-0">
            <span className="block truncate font-mono text-[12px] font-semibold text-base-text">{pair.pair}</span>
            <span className="block truncate text-[10px] text-base-muted">{pair.dexName ?? pair.dex} · {pair.project}</span>
          </span>
        </button>
      </td>
      <td className="px-2 py-2 font-mono text-[11px] text-base-muted">{formatAge(pair)}</td>
      <td className="px-2 py-2 text-right font-mono text-[11px]">
        <span className="block text-base-text">{pair.priceUsdValue || pair.dataSource === "mock" ? pair.priceUsd : "N/A"}</span>
        <span className={getChangeTone(change24h)}>{formatOptionalPercent(change24h)}</span>
        <span className="block text-[9px] text-base-muted">5m {formatOptionalPercent(pair.priceChanges?.m5)} · 1h {formatOptionalPercent(pair.priceChanges?.h1)}</span>
      </td>
      <td className="px-2 py-2 text-right font-mono text-[11px] text-base-text">{formatOptionalCurrency(getVolume24h(pair))}</td>
      <td className="px-2 py-2 text-right font-mono text-[11px] text-base-text">{formatOptionalCurrency(getLiquidityUsd(pair))}</td>
      <td className="px-2 py-2 text-[10px] text-base-muted">
        {row.activityScore !== undefined ? <span className="mr-1 inline-flex rounded-sm border border-base-cyan/30 bg-base-cyan/10 px-1.5 py-0.5 font-mono text-base-cyan">Activity {row.activityScore}</span> : null}
        <span className={cx("inline-flex rounded-sm border px-1.5 py-0.5", pair.stale ? "border-base-amber/35 bg-base-amber/10 text-base-amber" : "border-base-line bg-base-elevated")}>{getDataStatus(pair)}</span>
        <span className="mt-1 block font-mono text-[9px] text-base-muted">{freshness}</span>
      </td>
      <td className="px-2 py-2">
        <PinButton pair={pair} isPinned={isPinned} onTogglePin={onTogglePin} />
      </td>
    </tr>
  );
}

function DiscoveryMobileCard(props: Parameters<typeof DiscoveryTableRow>[0]) {
  const { row, freshness, selected, isPinned, onSelect, onTogglePin } = props;
  const { pair } = row;
  const change = getChange24h(pair);

  return (
    <article className={cx("p-3", selected && "bg-base-mint/10", props.updated && "market-update-flash")} data-testid={`discovery-row-${pair.id}`}>
      <div className="flex items-start gap-2">
        <button type="button" onClick={() => onSelect(pair.id)} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-base-mint/40">
          <PairAvatarStack baseSymbol={pair.baseToken} quoteSymbol={pair.quoteToken} baseLogoUrl={pair.tokenLogoUrl} quoteLogoUrl={pair.quoteTokenLogoUrl} size="md" />
          <span className="min-w-0">
            <span className="block truncate font-mono text-[13px] font-semibold text-base-text">{pair.pair}</span>
            <span className="block truncate text-[11px] text-base-muted">{pair.dexName ?? pair.dex} · {formatAge(pair)}</span>
          </span>
        </button>
        <PinButton pair={pair} isPinned={isPinned} onTogglePin={onTogglePin} />
      </div>
      <button type="button" onClick={() => onSelect(pair.id)} className="mt-2 grid min-h-11 w-full grid-cols-3 gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-base-mint/40">
        <MobileMetric label="Price / 24h" value={pair.priceUsdValue || pair.dataSource === "mock" ? pair.priceUsd : "N/A"} detail={formatOptionalPercent(change)} tone={getChangeTone(change)} />
        <MobileMetric label="Volume" value={formatOptionalCurrency(getVolume24h(pair))} detail="24h" />
        <MobileMetric label="Liquidity" value={formatOptionalCurrency(getLiquidityUsd(pair))} detail={`${getDataStatus(pair)} · ${freshness}`} />
      </button>
    </article>
  );
}

function AdvancedFilters({
  filters,
  dexOptions,
  onChange,
  onReset
}: {
  filters: DiscoveryFilters;
  dexOptions: string[];
  onChange: (patch: Partial<DiscoveryFilters>) => void;
  onReset: () => void;
}) {
  return (
    <div className="grid gap-2 border-b border-base-line bg-base-elevated p-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="discovery-advanced-filters">
      <NumberFilter label="Minimum liquidity ($)" value={filters.minLiquidity} onChange={(value) => onChange({ minLiquidity: value })} />
      <NumberFilter label="Minimum 24h volume ($)" value={filters.minVolume} onChange={(value) => onChange({ minVolume: value })} />
      <NumberFilter label="Minimum age (minutes)" value={filters.minAgeMinutes} onChange={(value) => onChange({ minAgeMinutes: value })} />
      <NumberFilter label="Maximum age (minutes)" value={filters.maxAgeMinutes} onChange={(value) => onChange({ maxAgeMinutes: value })} />
      <NumberFilter label="Minimum 24h change (%)" value={filters.minChange24h} onChange={(value) => onChange({ minChange24h: value })} />
      <NumberFilter label="Maximum 24h change (%)" value={filters.maxChange24h} onChange={(value) => onChange({ maxChange24h: value })} />
      <SelectFilter label="DEX" value={filters.dex} onChange={(value) => onChange({ dex: value })} options={[{ value: "all", label: "All DEXes" }, ...dexOptions.map((dex) => ({ value: dex, label: dex }))]} />
      <SelectFilter label="Sort" value={filters.sort} onChange={(value) => onChange({ sort: value as DiscoverySort })} options={[
        { value: "category", label: "Category default" },
        { value: "price-change-desc", label: "24h change" },
        { value: "volume-desc", label: "24h volume" },
        { value: "liquidity-desc", label: "Liquidity" },
        { value: "age-asc", label: "Newest" }
      ]} />
      <CheckFilter label="Verified/data-complete only" checked={filters.completeOnly} onChange={(checked) => onChange({ completeOnly: checked })} />
      <CheckFilter label="Hide stale" checked={filters.hideStale} onChange={(checked) => onChange({ hideStale: checked })} />
      <CheckFilter label={`Hide liquidity below ${formatCompactCurrency(DISCOVERY_MIN_LIQUIDITY_USD)}`} checked={filters.hideLowLiquidity} onChange={(checked) => onChange({ hideLowLiquidity: checked })} />
      <button type="button" onClick={onReset} className="min-h-10 rounded-sm border border-base-line bg-base-panel px-3 text-[11px] font-semibold text-base-muted outline-none hover:border-base-mint hover:text-base-text focus-visible:ring-2 focus-visible:ring-base-mint/40">Reset all filters</button>
    </div>
  );
}

function QuickFilter({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button type="button" aria-pressed={active} onClick={onClick} className={cx("min-h-10 rounded-full border px-2.5 text-[10px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-base-mint/40 sm:min-h-7", active ? "border-base-mint/45 bg-base-mint/10 text-base-mint" : "border-base-line bg-base-panel text-base-muted hover:text-base-text")}>{label}</button>;
}

function NumberFilter({ label, value, onChange }: { label: string; value?: number; onChange: (value: number | undefined) => void }) {
  return <label className="text-[10px] font-medium text-base-muted"><span className="mb-1 block">{label}</span><input type="number" value={value ?? ""} onChange={(event) => onChange(readOptionalNumber(event.target.value))} className="h-9 w-full rounded-sm border border-base-line bg-base-panel px-2 font-mono text-[11px] text-base-text outline-none focus:border-base-mint" /></label>;
}

function SelectFilter({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  return <label className="text-[10px] font-medium text-base-muted"><span className="mb-1 block">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="h-9 w-full rounded-sm border border-base-line bg-base-panel px-2 text-[11px] text-base-text outline-none focus:border-base-mint">{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

function CheckFilter({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="flex min-h-10 items-center gap-2 rounded-sm border border-base-line bg-base-panel px-2 text-[11px] text-base-muted"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-[rgb(var(--color-mint))]" />{label}</label>;
}

function PinButton({ pair, isPinned, onTogglePin }: { pair: BasePair; isPinned: boolean; onTogglePin: (pair: BasePair) => void }) {
  return <button type="button" data-testid={`pin-discovery-${pair.id}`} onClick={() => onTogglePin(pair)} aria-label={isPinned ? `Unpin ${pair.pair}` : `Pin ${pair.pair}`} className={cx("grid h-9 w-9 shrink-0 place-items-center rounded-sm border border-base-line bg-base-elevated text-base-muted outline-none hover:border-base-mint hover:text-base-mint focus-visible:ring-2 focus-visible:ring-base-mint/40", isPinned && "border-base-mint/45 bg-base-mint/10 text-base-mint")}><Star size={14} fill={isPinned ? "currentColor" : "none"} aria-hidden="true" /></button>;
}

function MobileMetric({ label, value, detail, tone = "text-base-muted" }: { label: string; value: string; detail: string; tone?: string }) {
  return <span className="min-w-0 rounded-sm bg-base-elevated p-2"><span className="block text-[9px] uppercase tracking-[0.08em] text-base-muted">{label}</span><span className="mt-1 block truncate font-mono text-[11px] font-semibold text-base-text">{value}</span><span className={cx("block truncate font-mono text-[9px]", tone)}>{detail}</span></span>;
}

function getDataStatus(pair: BasePair) {
  if (pair.dataSource === "mock") return "Demo data";
  if (pair.stale) return "Stale data";
  return isDiscoveryDataComplete(pair) ? "Complete fields" : "Partial · unknown ≠ safe";
}

function formatSnapshotFreshness(value: string) {
  if (value === "mock-static") return "Sample dataset";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Cached" : `Updated ${date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" })} UTC`;
}

function formatAge(pair: BasePair) {
  return getPairAgeMinutes(pair) === undefined ? "N/A" : pair.age;
}

function formatOptionalCurrency(value: number | undefined) {
  return value === undefined ? "N/A" : formatCompactCurrency(value);
}

function formatOptionalPercent(value: number | undefined) {
  return value === undefined ? "N/A" : formatPercent(value);
}

function getChangeTone(value: number | undefined) {
  if (value === undefined || value === 0) return "text-base-muted";
  return value > 0 ? "text-base-mint" : "text-base-rose";
}

function readOptionalNumber(value: string) {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
