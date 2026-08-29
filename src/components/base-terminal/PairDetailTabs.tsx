import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { AlertTriangle, Copy, ExternalLink } from "lucide-react";
import { cx } from "@/lib/format";
import type { BasePair } from "@/types/baseTerminal";
import type { DetailTab } from "@/components/base-terminal/types";
import { useI18n } from "@/i18n/I18nProvider";
import { localizeAgeLabel, type TranslationKey } from "@/i18n/dictionaries";
import { getChange24h, getLiquidityUsd, getPairAgeMinutes, getVolume24h } from "@/lib/base-terminal/discovery";
import { getBaseScanAddressUrl } from "@/lib/safeUrl";

const tabs: Array<{ id: DetailTab; labelKey: TranslationKey }> = [
  { id: "overview", labelKey: "details.overview" },
  { id: "risk", labelKey: "details.risk" },
  { id: "liquidity", labelKey: "details.liquidity" },
  { id: "activity", labelKey: "details.activity" }
];

export function PairDetailTabs({
  pair,
  activeTab,
  onTabChange,
  providerStale
}: {
  pair: BasePair;
  activeTab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
  providerStale: boolean;
}) {
  const i18n = useI18n();
  return (
    <section id="risk" className="flex min-h-0 flex-col overflow-hidden border border-base-line bg-base-panel">
      <div className="grid h-10 shrink-0 grid-cols-4 border-b border-base-line bg-base-raised" role="tablist" aria-label={i18n.t("details.aria")}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`pair-detail-tab-${tab.id}`}
            aria-controls={`pair-detail-panel-${tab.id}`}
            aria-selected={activeTab === tab.id}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => onTabChange(tab.id)}
            onKeyDown={(event) => handleTabKeyDown(event, tab.id, onTabChange)}
            className={cx(
              "h-full min-w-0 border-r border-base-line px-2 text-[11px] font-semibold uppercase tracking-[0.14em] last:border-r-0",
              activeTab === tab.id
                ? "bg-base-panel text-base-mint"
                : "text-base-muted hover:text-base-text"
            )}
          >
            {i18n.t(tab.labelKey)}
          </button>
        ))}
      </div>
      <div id={`pair-detail-panel-${activeTab}`} role="tabpanel" aria-labelledby={`pair-detail-tab-${activeTab}`} tabIndex={0} className="min-h-0 flex-1 overflow-y-auto p-2 outline-none">
        {renderTab(pair, activeTab, providerStale, i18n)}
      </div>
    </section>
  );
}

function renderTab(pair: BasePair, activeTab: DetailTab, providerStale: boolean, i18n: ReturnType<typeof useI18n>) {
  const { t, locale, formatCompactCurrency, formatPercent } = i18n;
  const change24h = getChange24h(pair);
  const volume24h = getVolume24h(pair);
  if (activeTab === "overview") {
    return (
      <div className="space-y-2">
        <div className="grid gap-2 md:grid-cols-4">
          <OverviewCell label={t("details.pair")} value={pair.pair} />
          <OverviewCell label="DEX" value={pair.dexName ?? pair.dex} />
          <OverviewCell label={t("details.chain")} value={pair.chainId ?? "Base"} />
          <OverviewCell label={t("details.pairAge")} value={localizeAgeLabel(pair.age, locale)} />
          <OverviewCell label={t("details.priceUsd")} value={pair.priceUsd} />
          <OverviewCell label={t("details.priceNative")} value={pair.priceNative ?? pair.price} />
          <OverviewCell label="FDV" value={formatOptionalCurrency(pair.fdv, formatCompactCurrency, t("common.noData"))} />
          <OverviewCell label={t("details.marketCap")} value={formatOptionalCurrency(pair.marketCap, formatCompactCurrency, t("common.noData"))} />
        </div>

        <div className="grid gap-2 lg:grid-cols-3">
          <AddressCell
            label={t("details.pairAddress")}
            value={pair.pairAddress}
            links={[
              getExternalLink("DexScreener", pair.sourceUrl),
              getExternalLink("BaseScan", getBaseScanAddressUrl(pair.pairAddress))
            ]}
          />
          <AddressCell
            label={t("details.baseTokenAddress")}
            value={pair.baseTokenAddress}
            links={[getExternalLink("BaseScan", getBaseScanAddressUrl(pair.baseTokenAddress))]}
          />
          <AddressCell
            label={t("details.quoteTokenAddress")}
            value={pair.quoteTokenAddress}
            links={[getExternalLink("BaseScan", getBaseScanAddressUrl(pair.quoteTokenAddress))]}
          />
        </div>

        <div className="grid gap-2 md:grid-cols-4">
          <OverviewCell
            label={t("details.change", { timeframe: "5m" })}
            value={formatOptionalPercent(pair.priceChanges?.m5, formatPercent, t("common.noData"))}
            tone={getChangeTone(pair.priceChanges?.m5)}
          />
          <OverviewCell
            label={t("details.change", { timeframe: "1h" })}
            value={formatOptionalPercent(pair.priceChanges?.h1, formatPercent, t("common.noData"))}
            tone={getChangeTone(pair.priceChanges?.h1)}
          />
          <OverviewCell
            label={t("details.change", { timeframe: "6h" })}
            value={formatOptionalPercent(pair.priceChanges?.h6, formatPercent, t("common.noData"))}
            tone={getChangeTone(pair.priceChanges?.h6)}
          />
          <OverviewCell
            label={t("details.change", { timeframe: "24h" })}
            value={formatOptionalPercent(change24h, formatPercent, t("common.noData"))}
            tone={getChangeTone(change24h)}
          />
        </div>

        <div className="grid gap-2 md:grid-cols-4">
          <OverviewCell label={t("details.volume", { timeframe: "5m" })} value={formatOptionalCompactCurrency(pair.volumes?.m5, formatCompactCurrency, t("common.noData"))} />
          <OverviewCell label={t("details.volume", { timeframe: "1h" })} value={formatOptionalCompactCurrency(pair.volumes?.h1, formatCompactCurrency, t("common.noData"))} />
          <OverviewCell label={t("details.volume", { timeframe: "6h" })} value={formatOptionalCompactCurrency(pair.volumes?.h6, formatCompactCurrency, t("common.noData"))} />
          <OverviewCell
            label={t("details.volume", { timeframe: "24h" })}
            value={formatOptionalCompactCurrency(volume24h, formatCompactCurrency, t("common.noData"))}
          />
        </div>

        <div className="grid gap-2 md:grid-cols-4">
          <OverviewCell label={t("details.buysSells", { timeframe: "5m" })} value={formatTxnWindow(pair.txns?.m5, t("common.noData"))} />
          <OverviewCell label={t("details.buysSells", { timeframe: "1h" })} value={formatTxnWindow(pair.txns?.h1, t("common.noData"))} />
          <OverviewCell label={t("details.buysSells", { timeframe: "6h" })} value={formatTxnWindow(pair.txns?.h6, t("common.noData"))} />
          <OverviewCell label={t("details.buysSells", { timeframe: "24h" })} value={formatTxnWindow(pair.txns?.h24, t("common.noData"))} />
        </div>

        <PublicSignalsPanel pair={pair} providerStale={providerStale} />
      </div>
    );
  }

  if (activeTab === "liquidity") {
    return (
      <div className="grid gap-2 md:grid-cols-4">
        <OverviewCell label={t("details.poolLiquidity")} value={pair.liquidityDetail.poolLiquidity} />
        <OverviewCell label={t("details.lpChange")} value={pair.liquidityDetail.lpChange} />
        <OverviewCell label={t("details.depth")} value={pair.liquidityDetail.depth} />
        <OverviewCell label={t("details.routeSource")} value={pair.liquidityDetail.routeSource} />
      </div>
    );
  }

  if (activeTab === "activity") {
    return (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left text-[11px]">
          <thead>
            <tr className="border-b border-base-line bg-base-elevated text-[10px] uppercase tracking-[0.12em] text-base-muted">
              <th className="px-2 py-1.5">{t("details.window")}</th>
              <th className="px-2 py-1.5">{t("details.transactions")}</th>
              <th className="px-2 py-1.5">{t("chart.volume")}</th>
              <th className="px-2 py-1.5">{t("details.source")}</th>
            </tr>
          </thead>
          <tbody>
            {pair.activity.map((event) => (
              <tr key={`${event.time}-${event.wallet}`} className="h-8 border-b border-base-line last:border-b-0">
                <td className="px-2 py-1.5 font-mono text-base-muted">{event.time}</td>
                <td className="px-2 py-1.5 font-mono text-base-text">{event.amount}</td>
                <td className="px-2 py-1.5 font-mono text-base-text">{event.value}</td>
                <td className="px-2 py-1.5 font-mono text-base-muted">{event.wallet}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <PublicSignalsPanel pair={pair} providerStale={providerStale} />
      <div className="rounded-sm border border-base-amber/35 bg-base-amber/10 p-3 text-[11px] leading-5 text-base-amber">
        <p className="font-semibold text-base-text">
          {pair.dataSource === "mock" ? t("details.demoSafetyTitle") : t("details.safetyUnavailableTitle")}
        </p>
        <p>
          {pair.dataSource === "mock"
            ? t("details.demoSafetyBody")
            : t("details.safetyUnavailableBody")}
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <RiskGroup title={t("details.contractChecks")} rows={pair.riskChecks.slice(0, 4).map((check) => [check.label, check.value])} />
        <RiskGroup title={t("details.holderData")} rows={[[t("details.topHolders", { count: 10 }), pair.holders.top10], [t("details.topHolders", { count: 50 }), pair.holders.top50], [t("details.topHolders", { count: 100 }), pair.holders.top100], [t("details.activeHolders"), pair.holders.active24h]]} />
        <RiskGroup title={t("details.lpToken")} rows={[["DEX", pair.dexName ?? pair.dex], [t("details.lpLock"), pair.lpLock.status], [t("details.lockProvider"), pair.lpLock.provider], [t("details.tax"), `${pair.taxes.buy} / ${pair.taxes.sell}`]]} />
      </div>
    </div>
  );
}

function OverviewCell({
  label,
  value,
  tone = "default"
}: {
  label: string;
  value: string;
  tone?: "default" | "mint" | "rose";
}) {
  return (
    <div className="border border-base-line bg-base-elevated p-2">
      <p className="text-[10px] uppercase tracking-[0.12em] text-base-muted">{label}</p>
      <p
        className={cx(
          "mt-1 font-mono text-[13px] font-semibold",
          tone === "mint"
            ? "text-base-mint"
            : tone === "rose"
              ? "text-base-rose"
              : "text-base-text"
        )}
      >
        {value}
      </p>
    </div>
  );
}

function AddressCell({
  label,
  value,
  links
}: {
  label: string;
  value: string | undefined;
  links: Array<{ label: string; href: string } | undefined>;
}) {
  const { t } = useI18n();
  const usableLinks = links.filter((link): link is { label: string; href: string } =>
    Boolean(link?.href)
  );

  return (
    <div className="min-w-0 border border-base-line bg-base-elevated p-2">
      <p className="text-[10px] uppercase tracking-[0.12em] text-base-muted">{label}</p>
      <p
        className="mt-1 break-all font-mono text-[11px] font-semibold text-base-text"
        title={value}
      >
        {value ?? t("common.noData")}
      </p>
      {value || usableLinks.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {value ? <CopyValueButton value={value} label={label} /> : null}
          {usableLinks.map((link) => (
            <ExternalDataLink key={`${label}-${link.label}`} href={link.href} label={link.label} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CopyValueButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<number | undefined>(undefined);
  const { t } = useI18n();

  useEffect(() => () => {
    if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
  }, []);

  async function copyValue() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = window.setTimeout(() => {
        resetTimerRef.current = undefined;
        setCopied(false);
      }, 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={copyValue}
      className="inline-flex h-5 items-center gap-1 border border-base-line bg-base-panel px-1.5 font-mono text-[10px] text-base-muted hover:border-base-mint hover:text-base-mint"
      aria-label={t("details.copyAria", { label })}
    >
      <Copy size={10} aria-hidden="true" />
      {copied ? t("details.copied") : t("details.copy")}
    </button>
  );
}

function ExternalDataLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex h-5 items-center gap-1 border border-base-line bg-base-panel px-1.5 font-mono text-[10px] text-base-muted hover:border-base-mint hover:text-base-mint"
    >
      <ExternalLink size={10} aria-hidden="true" />
      {label}
    </a>
  );
}

function PublicSignalsPanel({
  pair,
  providerStale
}: {
  pair: BasePair;
  providerStale: boolean;
}) {
  const { t } = useI18n();
  const signals = getPublicMarketSignals(pair, providerStale, t);

  return (
    <div className="border border-base-line bg-base-elevated p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-base-muted">
          {t("details.publicSignals")}
        </p>
        <span className="font-mono text-[10px] text-base-muted">{t("details.heuristics")}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {signals.map((signal) => (
          <span
            key={signal}
            className="border border-base-amber/40 bg-base-amber/10 px-1.5 py-0.5 font-mono text-[10px] text-base-amber"
          >
            {signal}
          </span>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-base-muted">
        {t("details.signalsBody")}
      </p>
    </div>
  );
}

function getPublicMarketSignals(pair: BasePair, providerStale: boolean, t: (key: TranslationKey) => string) {
  const signals: string[] = [];
  const liquidity = getLiquidityUsd(pair);
  const volume24h = getVolume24h(pair);
  const ageMinutes = getPairAgeMinutes(pair);
  const volumeLiquidityRatio = typeof liquidity === "number" && liquidity > 0 && typeof volume24h === "number" ? volume24h / liquidity : undefined;
  const shortTermMove = Math.max(
    Math.abs(pair.priceChanges?.m5 ?? 0),
    Math.abs(pair.priceChanges?.h1 ?? 0),
    Math.abs(pair.priceChanges?.h6 ?? 0)
  );

  if (pair.stale || providerStale) {
    signals.push(t("details.signal.stale"));
  }

  if (typeof liquidity === "number" && liquidity > 0 && liquidity < 50_000) {
    signals.push(t("details.signal.lowLiquidity"));
  }

  if (typeof volumeLiquidityRatio === "number" && volumeLiquidityRatio >= 2) {
    signals.push(t("details.signal.volumeLiquidity"));
  }

  if (typeof ageMinutes === "number" && ageMinutes >= 0 && ageMinutes <= 24 * 60) {
    signals.push(t("details.signal.newPair"));
  }

  if (!pair.pairCreatedAt) {
    signals.push(t("details.signal.missingAge"));
  }

  if (shortTermMove >= 15) {
    signals.push(t("details.signal.largeMove"));
  }

  return signals.length > 0 ? signals : [t("details.signal.none")];
}

function getExternalLink(label: string, href: string | undefined) {
  return href ? { label, href } : undefined;
}

function formatOptionalCurrency(value: number | undefined, formatter: (value: number) => string, fallback: string) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? formatter(value) : fallback;
}

function formatOptionalCompactCurrency(value: number | undefined, formatter: (value: number) => string, fallback: string) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? formatter(value) : fallback;
}

function formatOptionalPercent(value: number | undefined, formatter: (value: number) => string, fallback: string) {
  return typeof value === "number" && Number.isFinite(value) ? formatter(value) : fallback;
}

function getChangeTone(value: number | undefined) {
  if (typeof value !== "number" || value === 0) {
    return "default";
  }

  return value > 0 ? "mint" : "rose";
}

function formatTxnWindow(window: { buys: number; sells: number } | undefined, fallback: string) {
  return window ? `${window.buys} / ${window.sells}` : fallback;
}

function RiskGroup({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <div className="rounded-sm bg-base-elevated p-3">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-base-muted">{title}</h3>
      {rows.map(([label, value]) => <RiskRow key={label} label={label} value={value} />)}
    </div>
  );
}

function RiskRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[1fr_auto_18px] items-center gap-2 border-b border-base-line py-1 text-[11px] last:border-b-0">
      <span className="text-base-text">{label}</span>
      <span className="font-mono text-base-text">{value}</span>
      <AlertTriangle
        size={13}
        className="text-base-amber"
        aria-hidden="true"
      />
    </div>
  );
}

function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, currentTab: DetailTab, onTabChange: (tab: DetailTab) => void) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
  event.preventDefault();
  const currentIndex = tabs.findIndex((tab) => tab.id === currentTab);
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? tabs.length - 1
      : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  const nextTab = tabs[nextIndex];
  onTabChange(nextTab.id);
  window.requestAnimationFrame(() => document.getElementById(`pair-detail-tab-${nextTab.id}`)?.focus());
}
