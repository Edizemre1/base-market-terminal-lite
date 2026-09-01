"use client";

import { ExternalLink, Layers3, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MarketTerminalSnapshot } from "@/data/providers";
import { useI18n } from "@/i18n/I18nProvider";
import { getNormalizedMarketModel } from "@/lib/base-terminal/marketModel";
import { cx } from "@/lib/format";
import type { BasePair } from "@/types/baseTerminal";
import { PairAvatarStack } from "@/components/TokenIdentity";
import { MarketSignalBadges } from "@/components/base-terminal/MarketSignalBadges";
import { AssetTradeabilityBadges } from "@/components/base-terminal/AssetTradeabilityBadges";
import { useOverlayManager } from "@/components/OverlayManager";

type InspectorTab = "overview" | "signals" | "pools" | "identity" | "trade";

export function ContextInspector({ pair, snapshot, onTrade, onOpenWorkspace }: {
  pair: BasePair;
  snapshot: MarketTerminalSnapshot;
  onTrade: (pair: BasePair, side: "buy" | "sell") => void;
  onOpenWorkspace: (pair: BasePair) => void;
}) {
  const overlay = useOverlayManager();
  const { t, locale, formatCompactCurrency, formatPercent } = useI18n();
  const [tab, setTab] = useState<InspectorTab>("overview");
  const panelRef = useRef<HTMLElement>(null);
  const opportunity = useMemo(() => snapshot.opportunities.find((item) => item.id === pair.opportunityId), [pair.opportunityId, snapshot.opportunities]);
  const pools = useMemo(() => opportunity ? snapshot.allPairs.filter((item) => opportunity.poolMarketIds.includes(item.id)) : [pair], [opportunity, pair, snapshot.allPairs]);
  const model = getNormalizedMarketModel(pair);
  const anchor = snapshot.onchainPricing?.wethUsdcAnchor;
  const open = overlay.active.type === "market_inspector";

  useEffect(() => {
    if (!open) return;
    const requested = overlay.active.payload?.tab;
    setTab(requested === "signals" || requested === "pools" || requested === "identity" || requested === "trade" ? requested : "overview");
    window.setTimeout(() => panelRef.current?.querySelector<HTMLElement>("button")?.focus(), 0);
  }, [open, overlay.active.payload?.tab]);

  if (!open) return null;
  const tabs: Array<{ id: InspectorTab; label: string }> = [
    { id: "overview", label: t("details.overview") },
    { id: "signals", label: t("marketSignal.legend") },
    { id: "pools", label: t("terminalV3.poolsView") },
    { id: "identity", label: t("assetTradeability.identityStatus") },
    { id: "trade", label: t("terminalV3.column.tradeStatus") }
  ];

  return <div className="max-lg:fixed max-lg:inset-0 max-lg:z-layer-drawer max-lg:flex max-lg:items-end max-lg:bg-surface-scrim/75" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) overlay.close(); }}>
    <aside ref={panelRef} role="dialog" aria-modal="true" aria-label={t("details.aria")} className="pulse-surface max-h-sheet-max w-full overflow-y-auto rounded-t-overlay border border-border-subtle bg-surface-panel shadow-overlay lg:sticky lg:top-shell-header lg:max-h-[calc(100dvh-56px)] lg:w-inspector lg:rounded-card" data-testid="context-inspector" data-overlay-root="market_inspector" data-market-key={model.key}>
      <header className="sticky top-0 z-layer-sticky border-b border-border-subtle/60 bg-surface-panel p-3">
        <div className="flex items-start gap-2"><PairAvatarStack baseSymbol={pair.baseToken} quoteSymbol={pair.quoteToken} baseLogoUrl={pair.tokenLogoUrl} quoteLogoUrl={pair.quoteTokenLogoUrl} baseAddress={opportunity?.focusTokenAddress ?? pair.baseTokenAddress} quoteAddress={pair.quoteTokenAddress} baseName={opportunity?.focusTokenName ?? pair.project} chainId={pair.chainId} observedAt={pair.sourceUpdatedAt} size="md" /><span className="min-w-0 flex-1"><p className="text-meta font-bold uppercase tracking-eyebrow text-content-secondary">{t("workspace.selected")}</p><h2 className="truncate font-mono text-sm font-semibold" data-testid="selected-pair-title">{opportunity?.focusTokenSymbol ?? pair.pair}</h2><p className="truncate text-meta text-content-secondary">{opportunity ? formatOpportunityPrice(opportunity, t, pair) : displayPrice(pair)} · {opportunity ? `${opportunity.poolCount} ${t("terminalV3.poolsView").toLocaleLowerCase(locale)}` : pair.dexName ?? pair.dex}</p></span><button type="button" onClick={overlay.close} className="grid h-11 w-11 place-items-center rounded-pill bg-surface-interactive text-content-secondary" aria-label={t("trade.closeDock")}><X size={16} /></button></div>
        <dl className="mt-3 grid gap-1 rounded-card bg-surface-interactive p-2 text-meta"><div className="flex min-w-0 justify-between gap-2"><dt className="text-content-secondary">{t("details.baseTokenAddress")}</dt><dd className="truncate font-mono text-content-primary">{shortAddress(opportunity?.focusTokenAddress ?? pair.baseTokenAddress)}</dd></div><div className="flex min-w-0 justify-between gap-2"><dt className="text-content-secondary">{t("terminalV3.dataProvider")}</dt><dd className="truncate text-trust-verified">{(pair.dataProviders ?? [pair.dataSource]).filter(Boolean).join(" + ")}</dd></div><div className="flex min-w-0 justify-between gap-2"><dt className="text-content-secondary">{t("terminalV3.column.freshness")}</dt><dd className={pair.stale ? "text-freshness-delayed" : "text-freshness-live"}>{pair.stale ? t("common.delayed") : t("terminalV3.fresh")}</dd></div></dl>
        <div className="mt-3 flex overflow-x-auto" role="tablist">{tabs.map((item) => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)} className={cx("min-h-9 shrink-0 border-b-2 px-2 text-meta font-semibold outline-none focus-visible:ring-2 focus-visible:ring-focus", tab === item.id ? "border-network-base text-content-primary" : "border-transparent text-content-secondary")}>{item.label}</button>)}</div>
      </header>
      <div className="p-3">
        {tab === "overview" ? <>
          <dl className="grid grid-cols-2 gap-2"><Fact label={t("terminalV3.canonicalPrice")} value={formatCanonicalPrice(opportunity?.canonicalPrice) ?? t("terminalV3.pricingPending")} /><Fact label={t("terminalV3.pricingTier")} value={opportunity?.canonicalPrice.tier ?? "UNPRICED"} /><Fact label="1h" value={model.change1h === undefined ? "—" : formatPercent(model.change1h)} /><Fact label={t("terminalV3.column.volume24h")} value={model.volume24hUsd === undefined ? "—" : formatCompactCurrency(model.volume24hUsd)} /><Fact label={t("terminalV3.column.liquidity")} value={model.liquidityUsd === undefined ? "—" : formatCompactCurrency(model.liquidityUsd)} /><Fact label={t("terminalV3.poolsView")} value={String(opportunity?.poolCount ?? 1)} /><Fact label={t("terminalV3.metadataState")} value={opportunity?.metadataStatus ?? pair.metadataStatus ?? t("common.unknown")} /><Fact label={t("terminalV3.tradeabilityState")} value={opportunity?.tradeability ?? "market_data_only"} /></dl>
          {opportunity ? <><dl className="mt-2 space-y-2"><WideFact label={t("terminalV3.pricePath")} value={opportunity.canonicalPrice.sourcePoolKeys.length ? opportunity.canonicalPrice.sourcePoolKeys.join(" → ") : opportunity.canonicalPrice.reasonCode} /><WideFact label={t("terminalV3.pricingReason")} value={opportunity.canonicalPrice.reasonCode} /><WideFact label={t("terminalV3.rawPair")} value={pair.pair} /><WideFact label={t("terminalV3.dataProvider")} value={(pair.dataProviders ?? [pair.dataSource]).filter(Boolean).join(" + ") || t("common.unknown")} /><WideFact label={t("terminalV3.observedAt")} value={pair.sourceUpdatedAt ?? "—"} /><WideFact label={t("terminalV3.anchor")} value={anchor ? `${anchor.status ?? "unavailable"} · ${typeof anchor.value === "number" ? formatAnchorPrice(anchor.value) : anchor.reasonCode ?? "—"}` : "unavailable"} /><WideFact label={t("terminalV3.anchorSources")} value={anchor?.consensusPools?.join(" → ") ?? "—"} /><WideFact label={t("terminalV3.primaryPool")} value={opportunity.primaryMarketId} /></dl>
            <dl className="mt-2 space-y-2 rounded-card border border-border-subtle p-2"><WideFact label={t("terminalV3.qualityBand")} value={opportunity.qualityBand} /><WideFact label={t("terminalV3.observedPrice")} value={opportunity.observedPriceUsd ? `${formatCanonicalPrice({ value: opportunity.observedPriceUsd.value })} · ${opportunity.observedPriceUsd.provider} · ${opportunity.observedPriceUsd.observedAt}` : "—"} /><WideFact label={t("terminalV3.canonicalPrice")} value={formatCanonicalPrice(opportunity.canonicalPrice) ?? "—"} /><WideFact label={t("terminalV3.liquidityState")} value={opportunity.liquidityState} /><WideFact label={t("terminalV3.rankingEligibility")} value={t(opportunity.rankingEligibility ? "terminalV3.eligible" : "terminalV3.notEligible")} /><WideFact label={t("terminalV3.exclusionReason")} value={opportunity.exclusionReason ?? "—"} /><WideFact label={t("terminalV3.providerDiscoveryState")} value={opportunity.providerDiscoveryState} /><WideFact label={t("terminalV3.providerIndexedAt")} value={opportunity.providerIndexedAt ?? "—"} /><WideFact label={t("terminalV3.poolCreatedAt")} value={opportunity.newestPoolCreatedAt ?? "—"} /><WideFact label={t("terminalV3.firstSeenByMergen")} value={opportunity.firstSeenAt ?? "—"} /><WideFact label={t("terminalV3.exactProvenance")} value={opportunity.observedPriceUsd ? `${opportunity.observedPriceUsd.provider} · ${opportunity.observedPriceUsd.poolAddress} · ${opportunity.observedPriceUsd.reasonCode}` : opportunity.canonicalPrice.sourcePoolKeys.join(" → ") || "—"} /></dl></> : null}
          <div className="mt-3 flex flex-wrap gap-1"><MarketSignalBadges opportunity={opportunity} pair={pair} maximumMarketBadges={2} presentation="rowPrimary" /><AssetTradeabilityBadges opportunity={opportunity} pair={pair} presentation="rowCritical" /></div>
        </> : null}
        {tab === "signals" ? <section><p className="text-meta leading-5 text-content-secondary">{t("marketSignal.disclaimer")}</p><div className="mt-3"><MarketSignalBadges opportunity={opportunity} pair={pair} maximumMarketBadges={12} presentation="inspectorDetails" /></div></section> : null}
        {tab === "pools" ? <section><p className="text-meta text-content-secondary">{t("terminalV3.executionPools")}</p><div className="mt-2 space-y-1">{pools.map((pool) => <div key={pool.id} className="flex min-h-11 items-center justify-between gap-2 rounded-control bg-surface-interactive px-3"><span className="min-w-0"><strong className="block truncate font-mono text-meta">{pool.pair}</strong><small className="block truncate text-meta text-content-secondary">{pool.dexName ?? pool.dex} · {t("terminalV3.rawQuote")}: {pool.quoteToken} · {shortAddress(pool.pairAddress)}</small></span><span className="font-mono text-meta text-content-secondary">{pool.id === opportunity?.primaryMarketId ? t("terminalV3.primaryPool") : displayPrice(pool)}</span></div>)}</div>{opportunity ? <button type="button" onClick={() => overlay.open("pool_drawer", { opportunityId: opportunity.id })} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-control bg-surface-interactive text-meta font-semibold text-brand-accent"><Layers3 size={14} />{t("terminalV3.executionPools")}</button> : null}</section> : null}
        {tab === "identity" ? <section><AssetTradeabilityBadges opportunity={opportunity} pair={pair} compact={false} presentation="inspectorDetails" /><dl className="mt-3 space-y-2"><WideFact label={t("details.baseTokenAddress")} value={opportunity?.focusTokenAddress ?? pair.baseTokenAddress ?? "—"} /><WideFact label={t("details.quoteTokenAddress")} value={pair.quoteTokenAddress ?? "—"} /><WideFact label={t("details.pairAddress")} value={pair.pairAddress ?? "—"} /><WideFact label={t("details.chain")} value="Base · 8453" /></dl></section> : null}
        {tab === "trade" ? <section><AssetTradeabilityBadges opportunity={opportunity} pair={pair} compact={false} presentation="inspectorDetails" /><p className="mt-3 rounded-control bg-surface-interactive p-3 text-meta leading-5 text-content-secondary">{t("trade.explicitActions")}</p></section> : null}
        {opportunity?.rankingEligibility || snapshot.mode === "mock" ? <div className="mt-4 grid grid-cols-2 gap-2"><button type="button" onClick={() => onTrade(pair, "buy")} className="min-h-11 rounded-control bg-brand-action text-meta font-bold text-content-on-accent">{t("trade.buy")}</button><button type="button" onClick={() => onTrade(pair, "sell")} className="min-h-11 rounded-control bg-market-negative/10 text-meta font-bold text-market-negative">{t("trade.sell")}</button></div> : null}
        <button type="button" onClick={() => onOpenWorkspace(pair)} className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-control bg-surface-interactive text-meta font-semibold text-content-secondary"><ExternalLink size={13} />{t("workspace.marketWorkspace")}</button>
      </div>
    </aside>
  </div>;
}

function Fact({ label, value }: { label: string; value: string }) { return <div className="rounded-control bg-surface-interactive p-2"><dt className="text-meta uppercase tracking-eyebrow text-content-secondary">{label}</dt><dd className="mt-1 truncate font-mono text-meta text-content-primary">{value}</dd></div>; }
function WideFact({ label, value }: { label: string; value: string }) { return <div className="rounded-control bg-surface-interactive p-2"><dt className="text-meta text-content-secondary">{label}</dt><dd className="mt-1 break-all font-mono text-meta text-content-primary">{value}</dd></div>; }
function displayPrice(pair: BasePair) { return typeof pair.priceUsdValue === "number" && Number.isFinite(pair.priceUsdValue) && pair.priceUsdValue > 0 ? pair.priceUsd : "N/A"; }
function formatCanonicalPrice(price: { value?: number } | undefined) { return typeof price?.value === "number" && Number.isFinite(price.value) && price.value > 0 ? price.value >= 1 ? `$${price.value.toLocaleString("en-US", { maximumFractionDigits: 6 })}` : `$${price.value.toPrecision(6)}` : undefined; }
function formatOpportunityPrice(opportunity: MarketTerminalSnapshot["opportunities"][number], t: (key: import("@/i18n/dictionaries").TranslationKey) => string, pair: BasePair) { const canonical = formatCanonicalPrice(opportunity.canonicalPrice); if (canonical) return canonical; const observed = formatCanonicalPrice({ value: opportunity.observedPriceUsd?.value }); if (observed) return `${observed} · ${t("terminalV3.thinMarket")}`; const sample = pair.dataSource === "mock" ? formatCanonicalPrice({ value: pair.priceUsdValue }) : undefined; return sample ? `${sample} · ${t("header.demoFallback")}` : t("terminalV3.pricingPending"); }
function formatAnchorPrice(value: number) { return `$${value.toLocaleString("en-US", { maximumFractionDigits: 6 })}`; }
function shortAddress(value: string | undefined) { return value && value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value ?? "N/A"; }
