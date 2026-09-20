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
import { getMarketInvariantAttributes } from "@/lib/base-terminal/marketModel";
import { useI18n } from "@/i18n/I18nProvider";
import { localizeAgeLabel, type TranslationKey } from "@/i18n/dictionaries";
import { StatePanel } from "@/components/ui/CalmComponents";

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
  updatedPairIds,
  compact = false,
  initialCategory = "volume"
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
  compact?: boolean;
  initialCategory?: DiscoveryCategory;
}) {
  const { t, locale } = useI18n();
  const [category, setCategory] = useState<DiscoveryCategory>(initialCategory);
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
    const limited = rows.slice(0, compact ? 6 : 24);
    return showSelected && selectedOutsideFilters
      ? [{ pair: selectedPair }, ...limited.filter(({ pair }) => pair.id !== selectedPair.id)]
      : limited;
  }, [compact, rows, selectedOutsideFilters, selectedPair, showSelected]);
  const currentCategory = DISCOVERY_CATEGORIES.find(({ id }) => id === category)!;
  const freshnessLabel = formatSnapshotFreshness(snapshot.generatedAt, locale, t);

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
      className="pulse-surface overflow-hidden rounded-panel"
      data-testid="market-discovery"
      onPointerEnter={() => onInteractionChange(true)}
      onPointerLeave={() => onInteractionChange(false)}
      onFocusCapture={() => onInteractionChange(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onInteractionChange(false);
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border-subtle/60 px-3 py-3 sm:px-4">
        <div>
          <p className="text-meta font-bold uppercase tracking-eyebrow text-content-secondary">
            {compact ? t("market.compactEyebrow") : t("market.eyebrow")}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h2 className="text-title-sm font-semibold text-content-primary">{compact ? t("market.compactTitle") : t("market.title")}</h2>
            <span className="font-mono text-meta text-content-secondary">
              {formatSnapshotFreshness(snapshot.generatedAt, locale, t)} · {snapshot.providerName}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshStatus === "refreshing"}
            data-testid="refresh-market-board"
            className="inline-flex h-8 items-center gap-2 rounded-pill bg-surface-interactive px-3 font-mono text-meta text-content-secondary hover:text-content-primary disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw size={11} className={refreshStatus === "refreshing" ? "animate-spin" : undefined} />
            {refreshStatus === "refreshing" ? t("common.checking") : t("market.refresh")}
          </button>
          {pendingUpdateCount > 0 ? (
            <button
              type="button"
              onClick={onApplyPendingUpdates}
              data-testid="apply-market-updates"
              className="inline-flex h-8 items-center rounded-pill bg-brand-action px-3 text-meta font-bold text-content-on-accent shadow-raised"
            >
              {t("market.newUpdates", { count: pendingUpdateCount })}
            </button>
          ) : null}
          <span className="font-mono text-meta text-content-secondary" data-testid="discovery-result-count">
            {t("common.results", { count: rows.length })}
          </span>
          {!compact ? <button
            type="button"
            onClick={() => setAdvancedOpen((open) => !open)}
            aria-expanded={advancedOpen}
            className="inline-flex h-8 items-center gap-2 rounded-control border border-border-subtle bg-surface-panel px-3 text-meta font-semibold text-content-secondary outline-none hover:border-border-strong hover:text-content-primary focus-visible:ring-2 focus-visible:ring-focus"
          >
            <SlidersHorizontal size={13} aria-hidden="true" />
            {t("market.filters")}
          </button> : null}
          {!compact && hasActiveDiscoveryFilters(filters) ? (
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex h-8 items-center gap-1 px-2 text-meta text-freshness-delayed outline-none hover:text-content-primary focus-visible:ring-2 focus-visible:ring-focus"
            >
              <X size={12} aria-hidden="true" />
              {t("common.clear")}
            </button>
          ) : null}
        </div>
      </div>

      {!compact ? <div className="border-b border-border-subtle px-3 py-2">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label={t("market.categories")}>
          {DISCOVERY_CATEGORIES.map((item) => {
            const disabled = categoryCounts[item.id] === 0 && item.id !== category;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={category === item.id}
                disabled={disabled}
                title={t(categoryDescriptionKey(item.id))}
                data-testid={`discovery-category-${item.id}`}
                onClick={() => {
                  setCategory(item.id);
                  setShowSelected(false);
                }}
                className={cx(
                  "min-h-10 rounded-control border px-3 text-meta font-semibold outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-35 sm:min-h-8",
                  category === item.id
                    ? "border-brand-accent/45 bg-brand-accent/10 text-brand-accent"
                    : "border-transparent text-content-secondary hover:border-border-subtle hover:bg-surface-interactive hover:text-content-primary"
                )}
              >
                {t(categoryKey(item.id))}
                <span className="ml-1 font-mono text-meta opacity-70">{categoryCounts[item.id]}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="mr-1 text-meta font-medium text-content-secondary">{t("market.quickFilters")}</span>
          <QuickFilter label={t("market.fresh")} active={filters.quickFresh} onClick={() => patchFilters({ quickFresh: !filters.quickFresh })} />
          <QuickFilter label={t("market.liquid")} active={filters.quickLiquid} onClick={() => patchFilters({ quickLiquid: !filters.quickLiquid })} />
          <QuickFilter label={t("market.moving")} active={filters.quickMoving} onClick={() => patchFilters({ quickMoving: !filters.quickMoving })} />
          <QuickFilter label={t("market.highVolume")} active={filters.quickHighVolume} onClick={() => patchFilters({ quickHighVolume: !filters.quickHighVolume })} />
          <QuickFilter label={t("market.watched")} active={filters.quickWatched} onClick={() => patchFilters({ quickWatched: !filters.quickWatched })} />
          <span className="ml-auto text-meta text-content-secondary">{t(categoryDescriptionKey(currentCategory.id))}</span>
        </div>
      </div> : null}

      {!compact && advancedOpen ? (
        <AdvancedFilters
          filters={filters}
          dexOptions={dexOptions}
          onChange={patchFilters}
          onReset={resetFilters}
        />
      ) : null}

      {!compact && category === "volatile" ? (
        <p className="border-b border-freshness-delayed/30 bg-freshness-delayed/10 px-3 py-2 text-meta text-freshness-delayed">
          {t("market.volatilityWarning")}
        </p>
      ) : null}

      {!compact && selectedOutsideFilters ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-freshness-delayed/35 bg-freshness-delayed/10 px-3 py-2 text-meta text-freshness-delayed">
          <span>{t("market.hiddenSelected", { pair: selectedPair.pair })}</span>
          <button
            type="button"
            onClick={() => setShowSelected(true)}
            className="font-semibold underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-freshness-delayed/40"
          >
            {t("market.showSelected")}
          </button>
          <button
            type="button"
            onClick={resetFilters}
            className="font-semibold underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-freshness-delayed/40"
          >
            {t("market.clearFilters")}
          </button>
        </div>
      ) : null}

      <div className="hidden max-h-[230px] overflow-auto lg:block">
        <table className="w-full min-w-[700px] border-collapse text-left">
          <thead className="bg-surface-interactive text-meta font-semibold uppercase tracking-eyebrow text-content-secondary">
            <tr>
              <th className="px-3 py-2">{t("market.market")}</th>
              <th className="px-2 py-2">{t("market.age")}</th>
              <th className="px-2 py-2 text-right">{t("market.priceChange")}</th>
              <th className="px-2 py-2 text-right">{t("market.volume24h")}</th>
              <th className="px-2 py-2 text-right">{t("market.liquidity")}</th>
              <th className="px-2 py-2">{t("market.dataStatus")}</th>
              <th className="w-10 px-2 py-2"><span className="sr-only">{t("market.watchlist")}</span></th>
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

      <div className="divide-y divide-border-subtle lg:hidden">
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
        <StatePanel className="m-4 text-center" title={t("market.noMatches")} body={t("market.noMatchesBody")} />
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
  const { t, locale, formatCompactCurrency: localCurrency, formatPercent: localPercent } = useI18n();
  const { pair } = row;
  const change24h = getChange24h(pair);

  return (
    <tr
      {...getMarketInvariantAttributes(pair)}
      className={cx("border-t border-border-subtle/60 hover:bg-surface-interactive", selected && "bg-surface-selected")}
      data-testid={`discovery-row-${pair.id}`}
    >
      <td className="p-0">
        <button type="button" onClick={() => onSelect(pair.id)} className="flex min-h-14 w-full items-center gap-2 px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus">
          <PairAvatarStack baseSymbol={pair.baseToken} quoteSymbol={pair.quoteToken} baseLogoUrl={pair.tokenLogoUrl} quoteLogoUrl={pair.quoteTokenLogoUrl} size="sm" />
          <span className="min-w-0">
            <span className="block truncate font-mono text-label font-semibold text-content-primary">{pair.pair}</span>
            <span className="block truncate text-meta text-content-secondary">{pair.dexName ?? pair.dex} · {pair.project}</span>
          </span>
        </button>
      </td>
      <td className="px-2 py-2 font-mono text-meta text-content-secondary">{formatAge(pair, locale, t)}</td>
      <td className={cx("px-2 py-2 text-right font-mono text-meta", updated && "market-update-flash")} data-cell-updated={updated || undefined}>
        <span className="block text-content-primary">{getDisplayPrice(pair, t("common.noData"))}</span>
        <span className={getChangeTone(change24h)}>{formatOptionalPercent(change24h, localPercent)}</span>
        <span className="block text-meta text-content-secondary">5m {formatOptionalPercent(pair.priceChanges?.m5, localPercent)} · 1h {formatOptionalPercent(pair.priceChanges?.h1, localPercent)}</span>
      </td>
      <td title={formatFullCurrency(getVolume24h(pair), locale)} className="px-2 py-2 text-right font-mono text-meta text-content-primary">{formatOptionalCurrency(getVolume24h(pair), localCurrency)}</td>
      <td title={formatFullCurrency(getLiquidityUsd(pair), locale)} className="px-2 py-2 text-right font-mono text-meta text-content-primary">{formatOptionalCurrency(getLiquidityUsd(pair), localCurrency)}</td>
      <td className="px-2 py-2 text-meta text-content-secondary">
        {row.activityScore !== undefined ? <span className="mr-1 inline-flex rounded-control border border-trust-verified/30 bg-trust-verified/10 px-2 py-1 font-mono text-trust-verified">{t("market.activity", { score: row.activityScore })}</span> : null}
        <span className={cx("inline-flex rounded-control border px-2 py-1", pair.stale ? "border-freshness-delayed/35 bg-freshness-delayed/10 text-freshness-delayed" : "border-border-subtle bg-surface-interactive")}>{getDataStatus(pair, t)}</span>
        <span className="mt-1 block font-mono text-meta text-content-secondary">{freshness}</span>
      </td>
      <td className="px-2 py-2">
        <PinButton pair={pair} isPinned={isPinned} onTogglePin={onTogglePin} />
      </td>
    </tr>
  );
}

function DiscoveryMobileCard(props: Parameters<typeof DiscoveryTableRow>[0]) {
  const { t, locale, formatCompactCurrency: localCurrency, formatPercent: localPercent } = useI18n();
  const { row, freshness, selected, isPinned, onSelect, onTogglePin } = props;
  const { pair } = row;
  const change = getChange24h(pair);

  return (
    <article {...getMarketInvariantAttributes(pair)} className={cx("p-3", selected && "bg-surface-selected")} data-testid={`discovery-row-${pair.id}`}>
      <div className="flex items-start gap-2">
        <button type="button" onClick={() => onSelect(pair.id)} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-focus">
          <PairAvatarStack baseSymbol={pair.baseToken} quoteSymbol={pair.quoteToken} baseLogoUrl={pair.tokenLogoUrl} quoteLogoUrl={pair.quoteTokenLogoUrl} size="md" />
          <span className="min-w-0">
            <span className="block truncate font-mono text-data font-semibold text-content-primary">{pair.pair}</span>
            <span className="block truncate text-meta text-content-secondary">{pair.dexName ?? pair.dex} · {formatAge(pair, locale, t)}</span>
          </span>
        </button>
        <PinButton pair={pair} isPinned={isPinned} onTogglePin={onTogglePin} />
      </div>
      <button type="button" onClick={() => onSelect(pair.id)} className="mt-2 grid min-h-11 w-full grid-cols-3 gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-focus">
        <MobileMetric label={t("market.priceChange")} value={getDisplayPrice(pair, t("common.noData"))} detail={formatOptionalPercent(change, localPercent)} tone={getChangeTone(change)} updated={props.updated} />
        <MobileMetric label={t("market.volume24h")} value={formatOptionalCurrency(getVolume24h(pair), localCurrency)} detail={locale === "tr" ? "24s" : "24h"} />
        <MobileMetric label={t("market.liquidity")} value={formatOptionalCurrency(getLiquidityUsd(pair), localCurrency)} detail={`${getDataStatus(pair, t)} · ${freshness}`} />
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
  const { t, formatCompactCurrency: localCurrency } = useI18n();
  return (
    <div className="grid gap-2 border-b border-border-subtle bg-surface-interactive p-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="discovery-advanced-filters">
      <NumberFilter label={t("market.advanced.minLiquidity")} value={filters.minLiquidity} onChange={(value) => onChange({ minLiquidity: value })} />
      <NumberFilter label={t("market.advanced.minVolume")} value={filters.minVolume} onChange={(value) => onChange({ minVolume: value })} />
      <NumberFilter label={t("market.advanced.minAge")} value={filters.minAgeMinutes} onChange={(value) => onChange({ minAgeMinutes: value })} />
      <NumberFilter label={t("market.advanced.maxAge")} value={filters.maxAgeMinutes} onChange={(value) => onChange({ maxAgeMinutes: value })} />
      <NumberFilter label={t("market.advanced.minChange")} value={filters.minChange24h} onChange={(value) => onChange({ minChange24h: value })} />
      <NumberFilter label={t("market.advanced.maxChange")} value={filters.maxChange24h} onChange={(value) => onChange({ maxChange24h: value })} />
      <SelectFilter label="DEX" value={filters.dex} onChange={(value) => onChange({ dex: value })} options={[{ value: "all", label: t("market.advanced.allDexes") }, ...dexOptions.map((dex) => ({ value: dex, label: dex }))]} />
      <SelectFilter label={t("market.advanced.sort")} value={filters.sort} onChange={(value) => onChange({ sort: value as DiscoverySort })} options={[
        { value: "category", label: t("market.advanced.categoryDefault") },
        { value: "price-change-desc", label: t("workspace.change24h") },
        { value: "volume-desc", label: t("market.volume24h") },
        { value: "liquidity-desc", label: t("market.liquidity") },
        { value: "age-asc", label: t("market.advanced.newest") }
      ]} />
      <CheckFilter label={t("market.advanced.completeOnly")} checked={filters.completeOnly} onChange={(checked) => onChange({ completeOnly: checked })} />
      <CheckFilter label={t("market.advanced.hideStale")} checked={filters.hideStale} onChange={(checked) => onChange({ hideStale: checked })} />
      <CheckFilter label={t("market.advanced.hideLowLiquidity", { value: localCurrency(DISCOVERY_MIN_LIQUIDITY_USD) })} checked={filters.hideLowLiquidity} onChange={(checked) => onChange({ hideLowLiquidity: checked })} />
      <button type="button" onClick={onReset} className="min-h-10 rounded-control border border-border-subtle bg-surface-panel px-3 text-meta font-semibold text-content-secondary outline-none hover:border-border-strong hover:text-content-primary focus-visible:ring-2 focus-visible:ring-focus">{t("market.advanced.reset")}</button>
    </div>
  );
}

function QuickFilter({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button type="button" aria-pressed={active} onClick={onClick} className={cx("min-h-10 rounded-pill border px-3 text-meta font-semibold outline-none focus-visible:ring-2 focus-visible:ring-focus sm:min-h-7", active ? "border-brand-accent/45 bg-brand-accent/10 text-brand-accent" : "border-border-subtle bg-surface-panel text-content-secondary hover:text-content-primary")}>{label}</button>;
}

function NumberFilter({ label, value, onChange }: { label: string; value?: number; onChange: (value: number | undefined) => void }) {
  return <label className="text-meta font-medium text-content-secondary"><span className="mb-1 block">{label}</span><input type="number" value={value ?? ""} onChange={(event) => onChange(readOptionalNumber(event.target.value))} className="h-9 w-full rounded-control border border-border-subtle bg-surface-panel px-2 font-mono text-meta text-content-primary outline-none focus:border-focus" /></label>;
}

function SelectFilter({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  return <label className="text-meta font-medium text-content-secondary"><span className="mb-1 block">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="h-9 w-full rounded-control border border-border-subtle bg-surface-panel px-2 text-meta text-content-primary outline-none focus:border-focus">{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

function CheckFilter({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="flex min-h-10 items-center gap-2 rounded-control border border-border-subtle bg-surface-panel px-2 text-meta text-content-secondary"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-brand-action" />{label}</label>;
}

function PinButton({ pair, isPinned, onTogglePin }: { pair: BasePair; isPinned: boolean; onTogglePin: (pair: BasePair) => void }) {
  const { t } = useI18n();
  return <button type="button" data-testid={`pin-discovery-${pair.id}`} onClick={() => onTogglePin(pair)} aria-label={t(isPinned ? "a11y.unpin" : "a11y.pin", { pair: pair.pair })} className={cx("grid h-9 w-9 shrink-0 place-items-center rounded-control border border-border-subtle bg-surface-interactive text-content-secondary outline-none hover:border-border-strong hover:text-content-primary focus-visible:ring-2 focus-visible:ring-focus", isPinned && "border-brand-accent/45 bg-brand-accent/10 text-brand-accent")}><Star size={14} fill={isPinned ? "currentColor" : "none"} aria-hidden="true" /></button>;
}

function MobileMetric({ label, value, detail, tone = "text-content-secondary", updated = false }: { label: string; value: string; detail: string; tone?: string; updated?: boolean }) {
  return <span className={cx("min-w-0 rounded-control bg-surface-interactive p-2", updated && "market-update-flash")} data-cell-updated={updated || undefined}><span className="block text-meta uppercase tracking-eyebrow text-content-secondary">{label}</span><span className="mt-1 block truncate font-mono text-meta font-semibold text-content-primary">{value}</span><span className={cx("block truncate font-mono text-meta", tone)}>{detail}</span></span>;
}

function getDataStatus(pair: BasePair, t: (key: TranslationKey, values?: Record<string, string | number>) => string) {
  if (pair.dataSource === "mock") return t("market.demoData");
  if (pair.stale) return t("market.staleData");
  return isDiscoveryDataComplete(pair) ? t("market.completeFields") : t("market.partialFields");
}

function formatSnapshotFreshness(value: string, locale: "tr" | "en", t: (key: TranslationKey, values?: Record<string, string | number>) => string) {
  if (value === "mock-static") return t("market.sampleDataset");
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? t("market.cached") : t("market.updatedAt", { time: date.toLocaleTimeString(locale === "tr" ? "tr-TR" : "en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }) });
}

function categoryKey(category: DiscoveryCategory): TranslationKey { return `market.category.${category}` as TranslationKey; }
function categoryDescriptionKey(category: DiscoveryCategory): TranslationKey { return `market.categoryDescription.${category}` as TranslationKey; }

function formatAge(pair: BasePair, locale: "tr" | "en", t: (key: TranslationKey) => string) {
  return getPairAgeMinutes(pair) === undefined ? t("common.noData") : localizeAgeLabel(pair.age, locale);
}

function formatOptionalCurrency(value: number | undefined, formatter: (value: number) => string = formatCompactCurrency) {
  return value === undefined ? "N/A" : formatter(value);
}

function formatOptionalPercent(value: number | undefined, formatter: (value: number) => string = formatPercent) {
  return value === undefined ? "N/A" : formatter(value);
}

function getDisplayPrice(pair: BasePair, fallback: string) {
  return typeof pair.priceUsdValue === "number" && Number.isFinite(pair.priceUsdValue) && pair.priceUsdValue > 0 ? pair.priceUsd : fallback;
}

function formatFullCurrency(value: number | undefined, locale: "tr" | "en") {
  return typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat(locale === "tr" ? "tr-TR" : "en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value)
    : undefined;
}

function getChangeTone(value: number | undefined) {
  if (value === undefined || value === 0) return "text-content-secondary";
  return value > 0 ? "text-market-positive" : "text-market-negative";
}

function readOptionalNumber(value: string) {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
