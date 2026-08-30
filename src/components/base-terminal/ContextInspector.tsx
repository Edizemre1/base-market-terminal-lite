"use client";

import { ExternalLink, Layers3, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MarketTerminalSnapshot } from "@/data/providers";
import { useI18n } from "@/i18n/I18nProvider";
import { localizeAgeLabel } from "@/i18n/dictionaries";
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

  return <div className="max-lg:fixed max-lg:inset-0 max-lg:z-[82] max-lg:flex max-lg:items-end max-lg:bg-black/70" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) overlay.close(); }}>
    <aside ref={panelRef} role="dialog" aria-modal="true" aria-label={t("details.aria")} className="pulse-surface max-h-[88dvh] w-full overflow-y-auto rounded-t-2xl border border-base-line bg-base-panel shadow-2xl lg:sticky lg:top-[64px] lg:max-h-[calc(100dvh-76px)] lg:w-[350px] lg:rounded-lg" data-testid="context-inspector" data-overlay-root="market_inspector" data-market-key={model.key}>
      <header className="sticky top-0 z-10 border-b border-base-line/60 bg-base-panel p-3">
        <div className="flex items-start gap-2"><PairAvatarStack baseSymbol={pair.baseToken} quoteSymbol={pair.quoteToken} baseLogoUrl={pair.tokenLogoUrl} quoteLogoUrl={pair.quoteTokenLogoUrl} baseAddress={opportunity?.focusTokenAddress ?? pair.baseTokenAddress} quoteAddress={pair.quoteTokenAddress} baseName={opportunity?.focusTokenName ?? pair.project} chainId={pair.chainId} observedAt={pair.sourceUpdatedAt} size="md" /><span className="min-w-0 flex-1"><p className="text-[8px] font-bold uppercase tracking-[0.14em] text-base-mint">{t("workspace.selected")}</p><h2 className="truncate font-mono text-sm font-semibold" data-testid="selected-pair-title">{pair.pair}</h2><p className="truncate text-[9px] text-base-muted">{pair.dexName ?? pair.dex} · {displayPrice(pair)}</p></span><button type="button" onClick={overlay.close} className="grid h-11 w-11 place-items-center rounded-full bg-base-elevated text-base-muted" aria-label={t("trade.closeDock")}><X size={16} /></button></div>
        <div className="mt-3 flex overflow-x-auto" role="tablist">{tabs.map((item) => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)} className={cx("min-h-9 shrink-0 border-b-2 px-2 text-[8px] font-semibold", tab === item.id ? "border-base-mint text-base-mint" : "border-transparent text-base-muted")}>{item.label}</button>)}</div>
      </header>
      <div className="p-3">
        {tab === "overview" ? <><dl className="grid grid-cols-2 gap-2"><Fact label={t("terminalV3.column.price")} value={displayPrice(pair)} /><Fact label="1h" value={model.change1h === undefined ? "—" : formatPercent(model.change1h)} /><Fact label={t("terminalV3.column.volume24h")} value={model.volume24hUsd === undefined ? "—" : formatCompactCurrency(model.volume24hUsd)} /><Fact label={t("terminalV3.column.liquidity")} value={model.liquidityUsd === undefined ? "—" : formatCompactCurrency(model.liquidityUsd)} /><Fact label={t("terminalV3.column.age")} value={model.ageMinutes === undefined ? "—" : localizeAgeLabel(pair.age, locale)} /><Fact label={t("terminalV3.poolsView")} value={String(opportunity?.poolCount ?? 1)} /></dl><div className="mt-3 flex flex-wrap gap-1"><MarketSignalBadges opportunity={opportunity} pair={pair} maximumMarketBadges={2} presentation="rowPrimary" /><AssetTradeabilityBadges opportunity={opportunity} pair={pair} presentation="rowCritical" /></div></> : null}
        {tab === "signals" ? <section><p className="text-[10px] leading-5 text-base-muted">{t("marketSignal.disclaimer")}</p><div className="mt-3"><MarketSignalBadges opportunity={opportunity} pair={pair} maximumMarketBadges={12} presentation="inspectorDetails" /></div></section> : null}
        {tab === "pools" ? <section><p className="text-[10px] text-base-muted">{t("terminalV3.executionPools")}</p><div className="mt-2 space-y-1">{pools.map((pool) => <div key={pool.id} className="flex min-h-11 items-center justify-between gap-2 rounded-sm bg-base-elevated px-3"><span className="min-w-0"><strong className="block truncate font-mono text-[9px]">{pool.pair}</strong><small className="block truncate text-[8px] text-base-muted">{pool.dexName ?? pool.dex} · {shortAddress(pool.pairAddress)}</small></span><span className="font-mono text-[8px] text-base-muted">{displayPrice(pool)}</span></div>)}</div>{opportunity ? <button type="button" onClick={() => overlay.open("pool_drawer", { opportunityId: opportunity.id })} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-sm bg-base-elevated text-[10px] font-semibold text-base-mint"><Layers3 size={14} />{t("terminalV3.executionPools")}</button> : null}</section> : null}
        {tab === "identity" ? <section><AssetTradeabilityBadges opportunity={opportunity} pair={pair} compact={false} presentation="inspectorDetails" /><dl className="mt-3 space-y-2"><WideFact label={t("details.baseTokenAddress")} value={opportunity?.focusTokenAddress ?? pair.baseTokenAddress ?? "—"} /><WideFact label={t("details.quoteTokenAddress")} value={pair.quoteTokenAddress ?? "—"} /><WideFact label={t("details.pairAddress")} value={pair.pairAddress ?? "—"} /><WideFact label={t("details.chain")} value="Base · 8453" /></dl></section> : null}
        {tab === "trade" ? <section><AssetTradeabilityBadges opportunity={opportunity} pair={pair} compact={false} presentation="inspectorDetails" /><p className="mt-3 rounded-sm bg-base-elevated p-3 text-[9px] leading-5 text-base-muted">{t("trade.explicitActions")}</p></section> : null}
        <div className="mt-4 grid grid-cols-2 gap-2"><button type="button" onClick={() => onTrade(pair, "buy")} className="min-h-11 rounded-sm bg-base-mint/10 text-[10px] font-bold text-base-mint">{t("trade.buy")}</button><button type="button" onClick={() => onTrade(pair, "sell")} className="min-h-11 rounded-sm bg-base-rose/10 text-[10px] font-bold text-base-rose">{t("trade.sell")}</button></div>
        <button type="button" onClick={() => onOpenWorkspace(pair)} className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-sm bg-base-elevated text-[10px] font-semibold text-base-muted"><ExternalLink size={13} />{t("workspace.marketWorkspace")}</button>
      </div>
    </aside>
  </div>;
}

function Fact({ label, value }: { label: string; value: string }) { return <div className="rounded-sm bg-base-elevated p-2"><dt className="text-[8px] uppercase tracking-[0.08em] text-base-muted">{label}</dt><dd className="mt-1 truncate font-mono text-[10px] text-base-text">{value}</dd></div>; }
function WideFact({ label, value }: { label: string; value: string }) { return <div className="rounded-sm bg-base-elevated p-2"><dt className="text-[8px] text-base-muted">{label}</dt><dd className="mt-1 break-all font-mono text-[9px] text-base-text">{value}</dd></div>; }
function displayPrice(pair: BasePair) { return typeof pair.priceUsdValue === "number" && Number.isFinite(pair.priceUsdValue) && pair.priceUsdValue > 0 ? pair.priceUsd : "N/A"; }
function shortAddress(value: string | undefined) { return value && value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value ?? "N/A"; }
