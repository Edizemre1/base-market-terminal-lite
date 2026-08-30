"use client";

import { BriefcaseBusiness, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertCenter } from "@/components/base-terminal/AlertCenter";
import { useChartData } from "@/components/base-terminal/hooks/useChartData";
import { useSelectedPairState } from "@/components/base-terminal/hooks/useSelectedPairState";
import { PairDetailTabs } from "@/components/base-terminal/PairDetailTabs";
import {
  MarketActivityPanel
} from "@/components/base-terminal/PulseTerminalPanels";
import { SelectedPairPanel } from "@/components/base-terminal/SelectedPairPanel";
import { TradeDock } from "@/components/base-terminal/TradeDock";
import { LiveMarketTape, MarketMatrix, PinnedMarketGrid } from "@/components/base-terminal/TerminalMarketSurface";
import { LiveMarketWall, LivePulseRail } from "@/components/base-terminal/LiveMarketWall";
import { ContextInspector } from "@/components/base-terminal/ContextInspector";
import { MarketSignalProvider } from "@/components/base-terminal/MarketSignalBadges";
import { TradeabilityProvider } from "@/components/base-terminal/AssetTradeabilityBadges";
import type { DetailTab } from "@/components/base-terminal/types";
import {
  useTerminalSearch,
  type ProviderHealthState
} from "@/components/TerminalSearchContext";
import type { MarketTerminalSnapshot } from "@/data/providers";
import { getChartCacheKey, getShareablePairKey } from "@/lib/base-terminal/pairs";
import { coalescePendingOpportunityIds, getSnapshotRefreshCadence, shouldAutoApplyPendingUpdate, shouldQueueMarketUpdate, UPDATE_AUTO_APPLY_QUIET_MS } from "@/lib/base-terminal/liveUpdates";
import {
  diffMarketSnapshots,
  getChangedPairIds,
  mergePulseSignals,
  type PulseSignal
} from "@/lib/base-terminal/pulse";
import {
  buildProviderHealth,
  preserveSelectedPair,
  shouldAcceptMarketSnapshot,
  shouldKeepCurrentSnapshotOnRefresh
} from "@/lib/base-terminal/providerHealth";
import { cx } from "@/lib/format";
import type { BasePair } from "@/types/baseTerminal";
import { useI18n } from "@/i18n/I18nProvider";
import { APP_NAME } from "@/lib/appInfo";
import { orientPairToOpportunity } from "@/lib/base-terminal/opportunityModel";
import { useOverlayManager } from "@/components/OverlayManager";
import { StatePanel } from "@/components/ui/CalmComponents";

type PendingSnapshot = {
  snapshot: MarketTerminalSnapshot;
  signals: PulseSignal[];
  changedPairIds: string[];
};

type TerminalView = "terminal" | "markets" | "watchlist" | "portfolio" | "alerts" | "workspace";

export function BaseTerminal({
  data,
  initialPairParam,
  initialViewParam
}: {
  data: MarketTerminalSnapshot;
  initialPairParam?: string;
  initialViewParam?: string;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const overlay = useOverlayManager();
  const openOverlay = overlay.open;
  const {
    pinnedPairs,
    registerPairs,
    registerProviderHealth,
    registerSelectedPair,
    registerSelectPairHandler,
    isPairPinned,
    togglePinnedPair
  } = useTerminalSearch();
  const [snapshotData, setSnapshotData] = useState(data);
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const [amount, setAmount] = useState("0.10");
  const [tradeSide, setTradeSide] = useState<"buy" | "sell">("buy");
  const [providerHealth, setProviderHealth] = useState<ProviderHealthState>(() => buildProviderHealth(data, "idle"));
  const [pulseSignals, setPulseSignals] = useState<PulseSignal[]>(data.recentSignals);
  const [pendingSnapshot, setPendingSnapshot] = useState<PendingSnapshot>();
  const [interactionLocked, setInteractionLocked] = useState(false);
  const [view, setView] = useState<TerminalView>(() => normalizeTerminalView(initialViewParam));
  const snapshotRef = useRef(snapshotData);
  const selectedPairRef = useRef<BasePair | undefined>(undefined);
  const activeOverlayTypeRef = useRef(overlay.active.type);
  activeOverlayTypeRef.current = overlay.active.type;
  const interactionLockedRef = useRef(false);
  const watchedPairIdsRef = useRef<string[]>([]);
  const snapshotRefreshInFlightRef = useRef(false);
  const snapshotRefreshRequestIdRef = useRef(0);
  const refreshAbortRef = useRef<AbortController | undefined>(undefined);
  const interactionLocksRef = useRef(new Set<string>());
  const setInteractionLock = useCallback((reason: string, locked: boolean) => {
    if (locked) interactionLocksRef.current.add(reason);
    else interactionLocksRef.current.delete(reason);
    setInteractionLocked(interactionLocksRef.current.size > 0);
  }, []);
  const { selectedPair, handleSelectPairById } = useSelectedPairState({
    initialSnapshot: data,
    snapshotData,
    snapshotRef,
    initialPairParam
  });
  const { chartOverrides, chartRefreshStatus, refreshPairChart } = useChartData(snapshotRef);
  const selectedPairWithLiveChart = useMemo(() => {
    if (!selectedPair) return undefined;
    const hydrated = { ...selectedPair, ...chartOverrides[getChartCacheKey(selectedPair)] };
    const opportunity = snapshotData.opportunities.find((item) => item.id === selectedPair.opportunityId);
    return orientPairToOpportunity(hydrated, opportunity);
  }, [chartOverrides, selectedPair, snapshotData.opportunities]);
  const viewTitle = useMemo(() => {
    if (view === "markets") return t("route.marketsTitle");
    if (view === "watchlist") return t("route.watchlistTitle");
    if (view === "alerts") return t("route.alertsTitle");
    if (view === "portfolio") return t("route.portfolioTitle");
    if (view === "workspace") return t("route.pairTitle", { pair: selectedPairWithLiveChart?.pair ?? "Base" });
    return t("route.terminalTitle");
  }, [selectedPairWithLiveChart?.pair, t, view]);

  useEffect(() => {
    document.title = `${viewTitle} | ${APP_NAME}`;
  }, [viewTitle]);

  const navigateView = useCallback((nextView: TerminalView) => {
    setView(nextView);
    if (typeof window === "undefined") return;
    const nextUrl = new URL(window.location.href);
    if (nextView === "terminal") nextUrl.searchParams.delete("view");
    else nextUrl.searchParams.set("view", nextView);
    router.replace(`${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`, { scroll: false });
  }, [router]);

  const openPair = useCallback((pairId: string) => {
    handleSelectPairById(pairId);
    const nextPair = snapshotRef.current.allPairs.find((pair) => pair.id === pairId);
    if (!nextPair || typeof window === "undefined") return;
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("pair", getShareablePairKey(nextPair));
    router.push(`${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`, { scroll: false });
    overlay.open("market_inspector", { pairId: nextPair.id });
  }, [handleSelectPairById, overlay, router]);

  const openTrade = useCallback((pair: BasePair, side: "buy" | "sell") => {
    handleSelectPairById(pair.id);
    setTradeSide(side);
    overlay.open("trade_drawer", { pairId: pair.id, side });
  }, [handleSelectPairById, overlay]);

  const openWorkspace = useCallback((pair: BasePair) => {
    handleSelectPairById(pair.id);
    setView("workspace");
    overlay.closeAll();
    if (typeof window === "undefined") return;
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("view", "workspace");
    nextUrl.searchParams.set("pair", getShareablePairKey(pair));
    router.push(`${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`, { scroll: false });
  }, [handleSelectPairById, overlay, router]);

  useEffect(() => {
    snapshotRef.current = snapshotData;
  }, [snapshotData]);

  useEffect(() => {
    const nextView = normalizeTerminalView(initialViewParam);
    setView(nextView);
  }, [initialPairParam, initialViewParam]);

  useEffect(() => {
    if (!initialPairParam || view === "workspace" || normalizeTerminalView(initialViewParam) === "workspace") return;
    if (activeOverlayTypeRef.current !== "none" && activeOverlayTypeRef.current !== "market_inspector") return;
    openOverlay("market_inspector");
  }, [initialPairParam, initialViewParam, openOverlay, view]);

  useEffect(() => {
    watchedPairIdsRef.current = pinnedPairs
      .map((pair) => pair.currentPairId ?? pair.id)
      .filter((id): id is string => Boolean(id));
  }, [pinnedPairs]);

  useEffect(() => {
    interactionLockedRef.current = interactionLocked;
  }, [interactionLocked]);

  useEffect(() => {
    setInteractionLock("overlay", overlay.active.type !== "none");
    return () => setInteractionLock("overlay", false);
  }, [overlay.active.type, setInteractionLock]);

  useEffect(() => {
    setSnapshotData(data);
    snapshotRef.current = data;
    setPulseSignals((current) => mergePulseSignals(current, data.recentSignals));
    setProviderHealth(buildProviderHealth(data, "idle"));
  }, [data]);

  const applySnapshot = useCallback((candidate: PendingSnapshot) => {
    const current = snapshotRef.current;
    const next = preserveSelectedPair(candidate.snapshot, selectedPairRef.current);
    const events = candidate.signals.length > 0
      ? candidate.signals
      : diffMarketSnapshots(current, next, { watchedPairIds: watchedPairIdsRef.current });
    snapshotRef.current = next;
    setSnapshotData(next);
    setPulseSignals((existing) => mergePulseSignals(existing, events));
    setPendingSnapshot(undefined);
    setProviderHealth(buildProviderHealth(next, "idle"));
  }, []);

  const refreshProviderSnapshot = useCallback(async () => {
    if (snapshotRefreshInFlightRef.current) return;

    const requestId = snapshotRefreshRequestIdRef.current + 1;
    snapshotRefreshRequestIdRef.current = requestId;
    snapshotRefreshInFlightRef.current = true;
    refreshAbortRef.current?.abort();
    const abortController = new AbortController();
    refreshAbortRef.current = abortController;
    setProviderHealth((current) => current
      ? { ...current, status: "refreshing", failureReason: undefined }
      : buildProviderHealth(snapshotRef.current, "refreshing"));

    try {
      const mode = snapshotRef.current.mode === "dexscreener" ? "dexscreener" : "mock";
      const response = await fetch(`/api/market-snapshot?data=${mode}`, {
        cache: "no-store",
        signal: abortController.signal
      });
      if (!response.ok) throw new Error("Snapshot refresh failed");
      const nextSnapshot = (await response.json()) as MarketTerminalSnapshot;
      if (snapshotRefreshRequestIdRef.current !== requestId) return;
      if (!shouldAcceptMarketSnapshot(snapshotRef.current, nextSnapshot)) {
        setProviderHealth(buildProviderHealth(snapshotRef.current, "idle"));
        return;
      }
      if (shouldKeepCurrentSnapshotOnRefresh(snapshotRef.current, nextSnapshot)) {
        throw new Error("Provider returned fallback-only refresh");
      }

      const changedPairIds = getChangedPairIds(snapshotRef.current, nextSnapshot);
      const changedOpportunityIds = coalescePendingOpportunityIds([], changedPairIds.map((pairId) => nextSnapshot.opportunities.find((opportunity) => opportunity.poolMarketIds.includes(pairId))?.id ?? pairId));
      const signals = mergePulseSignals(nextSnapshot.recentSignals, diffMarketSnapshots(snapshotRef.current, nextSnapshot, {
        watchedPairIds: watchedPairIdsRef.current
      }));
      const candidate = { snapshot: nextSnapshot, signals, changedPairIds: changedOpportunityIds };
      if (shouldQueueMarketUpdate(changedPairIds.length, interactionLockedRef.current)) {
        setPendingSnapshot((current) => ({
          snapshot: candidate.snapshot,
          signals: mergePulseSignals(current?.signals ?? [], candidate.signals),
          changedPairIds: coalescePendingOpportunityIds(current?.changedPairIds ?? [], candidate.changedPairIds)
        }));
        setProviderHealth(buildProviderHealth(nextSnapshot, "idle"));
      } else {
        applySnapshot(candidate);
      }
    } catch {
      if (abortController.signal.aborted) return;
      if (snapshotRefreshRequestIdRef.current === requestId) {
        setProviderHealth((current) => current
          ? { ...current, status: "failed", stale: true, failureReason: "Refresh failed; using last good data." }
          : buildProviderHealth(snapshotRef.current, "failed", "Refresh failed; using last good data."));
      }
    } finally {
      if (snapshotRefreshRequestIdRef.current === requestId) snapshotRefreshInFlightRef.current = false;
    }
  }, [applySnapshot]);

  useEffect(() => {
    if (!pendingSnapshot || !shouldAutoApplyPendingUpdate({ interactionLocked, overlayOpen: overlay.active.type !== "none", quietForMs: UPDATE_AUTO_APPLY_QUIET_MS })) return;
    const timeoutId = window.setTimeout(() => applySnapshot(pendingSnapshot), UPDATE_AUTO_APPLY_QUIET_MS);
    return () => window.clearTimeout(timeoutId);
  }, [applySnapshot, interactionLocked, overlay.active.type, pendingSnapshot]);

  useEffect(() => {
    registerPairs(snapshotData.allPairs);
    return () => registerPairs([]);
  }, [registerPairs, snapshotData.allPairs]);

  useEffect(() => {
    registerProviderHealth(providerHealth);
    return () => registerProviderHealth(undefined);
  }, [providerHealth, registerProviderHealth]);

  useEffect(() => {
    registerSelectedPair(selectedPairWithLiveChart?.id);
    return () => registerSelectedPair(undefined);
  }, [registerSelectedPair, selectedPairWithLiveChart?.id]);

  useEffect(() => {
    selectedPairRef.current = selectedPairWithLiveChart;
  }, [selectedPairWithLiveChart]);

  useEffect(() => {
    registerSelectPairHandler(openPair);
    return () => registerSelectPairHandler(undefined);
  }, [openPair, registerSelectPairHandler]);

  useEffect(() => {
    if (selectedPair) void refreshPairChart(selectedPair);
  }, [refreshPairChart, selectedPair, view]);

  const pinnedMarketPairs = useMemo(() => snapshotData.allPairs.filter(isPairPinned).slice(0, 4).map((pair) => ({ ...pair, ...chartOverrides[getChartCacheKey(pair)] })), [chartOverrides, isPairPinned, snapshotData.allPairs]);

  useEffect(() => {
    if (view !== "terminal" && view !== "watchlist") return;
    let active = true;
    void (async () => {
      for (const pair of snapshotRef.current.allPairs.filter(isPairPinned).slice(0, 4)) {
        if (!active) return;
        if (!chartOverrides[getChartCacheKey(pair)]?.chartCandles) await refreshPairChart(pair);
      }
    })();
    return () => { active = false; };
  }, [chartOverrides, isPairPinned, refreshPairChart, view]);

  useEffect(() => {
    if (snapshotData.mode !== "dexscreener") return;
    let timeoutId: number | undefined;
    let active = true;
    const schedule = (delay?: number) => {
      if (!active) return;
      const cadence = getSnapshotRefreshCadence(document.visibilityState === "visible" ? "visible" : "hidden");
      timeoutId = window.setTimeout(async () => {
        await refreshProviderSnapshot();
        schedule();
      }, delay ?? cadence);
    };
    const handleVisibility = () => {
      if (timeoutId) window.clearTimeout(timeoutId);
      schedule(document.visibilityState === "visible" ? 750 : getSnapshotRefreshCadence("hidden"));
    };
    document.addEventListener("visibilitychange", handleVisibility);
    schedule();
    return () => {
      active = false;
      if (timeoutId) window.clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", handleVisibility);
      refreshAbortRef.current?.abort();
    };
  }, [refreshProviderSnapshot, snapshotData.mode]);

  useEffect(() => {
    if (snapshotData.mode !== "dexscreener") return;
    const handleOnline = () => void refreshProviderSnapshot();
    const handleOffline = () => setProviderHealth((current) => current
      ? { ...current, status: "failed", stale: true, failureReason: "Offline; using last good data." }
      : buildProviderHealth(snapshotRef.current, "failed", "Offline; using last good data."));
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [refreshProviderSnapshot, snapshotData.mode]);

  if (!selectedPairWithLiveChart) {
    return (
      <main id="terminal-main" tabIndex={-1} className="min-h-[calc(100vh-56px)] scroll-mt-16 bg-surface-canvas p-4 outline-none">
        <StatePanel kind="unavailable" className="mx-auto max-w-3xl" title={t("terminal.unavailableTitle")} body={t("terminal.unavailableBody")} />
      </main>
    );
  }

  const inspectorOpen = overlay.active.type === "market_inspector";
  const marketBoard = <MarketMatrix snapshot={snapshotData} selectedPair={selectedPairWithLiveChart} onSelect={openPair} onTrade={openTrade} isPairPinned={isPairPinned} onTogglePin={togglePinnedPair} onInteractionChange={(locked) => setInteractionLock("market-board", locked)} watchlistOnly={view === "watchlist"} />;
  return <main id="terminal-main" tabIndex={-1} className="min-h-[calc(100vh-56px)] w-full scroll-mt-16 overflow-x-hidden bg-surface-canvas px-3 py-3 outline-none sm:px-4 lg:px-6" data-testid="pulse-terminal"><h1 className="sr-only">{viewTitle}</h1>
    <MarketSignalProvider snapshot={snapshotData}><TradeabilityProvider><div className="mx-auto max-w-[2200px] space-y-3">
      {snapshotData.fallbackReason ? <div className="rounded-card bg-freshness-delayed/10 px-3 py-2 text-meta text-freshness-delayed">{t("terminal.unavailableBody")}</div> : null}

      {view === "terminal" ? <><LiveMarketTape snapshot={snapshotData} onSelect={openPair} onRefresh={() => void refreshProviderSnapshot()} refreshing={providerHealth.status === "refreshing"} delayed={providerHealth.stale} pendingUpdateCount={pendingSnapshot?.changedPairIds.length} onApplyUpdates={pendingSnapshot ? () => applySnapshot(pendingSnapshot) : undefined} /><LivePulseRail signals={pulseSignals} onSelect={openPair} onInteractionChange={(locked) => setInteractionLock("pulse-rail", locked)} /><LiveMarketWall snapshot={snapshotData} selectedPair={selectedPairWithLiveChart} onSelect={openPair} onTrade={openTrade} onInteractionChange={(locked) => setInteractionLock("live-wall", locked)} /><section className={cx("grid min-w-0 items-start gap-3", inspectorOpen && "cmi-inspector-grid")} data-testid="terminal-workspace"><div className="min-w-0">{marketBoard}</div><ContextInspector pair={selectedPairWithLiveChart} snapshot={snapshotData} onTrade={openTrade} onOpenWorkspace={openWorkspace} /></section></> : null}

      {view === "markets" ? <section className={cx("grid min-w-0 items-start gap-3", inspectorOpen && "cmi-inspector-grid")}><div className="min-w-0 space-y-3"><LiveMarketTape snapshot={snapshotData} onSelect={openPair} onRefresh={() => void refreshProviderSnapshot()} refreshing={providerHealth.status === "refreshing"} delayed={providerHealth.stale} pendingUpdateCount={pendingSnapshot?.changedPairIds.length} onApplyUpdates={pendingSnapshot ? () => applySnapshot(pendingSnapshot) : undefined} />{marketBoard}</div><ContextInspector pair={selectedPairWithLiveChart} snapshot={snapshotData} onTrade={openTrade} onOpenWorkspace={openWorkspace} /></section> : null}

      {view === "watchlist" ? <section className={cx("grid min-w-0 items-start gap-3", inspectorOpen && "cmi-inspector-grid")}><div className="min-w-0 space-y-3"><PinnedMarketGrid pairs={pinnedMarketPairs} onSelect={openPair} onUnpin={togglePinnedPair} />{marketBoard}</div><ContextInspector pair={selectedPairWithLiveChart} snapshot={snapshotData} onTrade={openTrade} onOpenWorkspace={openWorkspace} /></section> : null}

      {view === "workspace" ? <section className="space-y-3" data-testid="pair-workspace"><div className="flex items-center justify-between gap-2 px-1"><div><p className="text-meta font-bold uppercase tracking-eyebrow text-content-secondary">{t("workspace.selected")}</p><h1 className="text-base font-semibold">{selectedPairWithLiveChart.pair}</h1></div><button type="button" onClick={() => navigateView("terminal")} className="min-h-10 rounded-control bg-surface-interactive px-3 text-meta text-content-secondary">{t("common.backToMarkets")}</button></div><section className="grid min-w-0 gap-3 2xl:grid-cols-[minmax(0,3fr)_minmax(280px,2fr)]"><SelectedPairPanel pair={selectedPairWithLiveChart} marketDataMode={snapshotData.mode} chartRefreshStatus={chartRefreshStatus[getChartCacheKey(selectedPairWithLiveChart)] ?? "idle"} onRefreshChart={refreshPairChart} /><MarketActivityPanel pair={selectedPairWithLiveChart} signals={pulseSignals} snapshot={snapshotData} /></section><PairDetailTabs pair={selectedPairWithLiveChart} activeTab={activeTab} onTabChange={setActiveTab} providerStale={providerHealth.stale} /><div className="flex justify-end"><button type="button" onClick={() => openTrade(selectedPairWithLiveChart, "buy")} className="min-h-11 rounded-control bg-brand-action px-6 text-meta font-bold text-content-on-accent">{t("trade.open")}</button></div></section> : null}

      {view === "alerts" ? <section className="mx-auto w-full max-w-3xl" data-testid="alerts-workspace"><AlertCenter snapshot={snapshotData} selectedPair={selectedPairWithLiveChart} signals={pulseSignals} embedded /></section> : null}
      {view === "portfolio" ? <section className="pulse-surface rounded-panel p-6" data-testid="portfolio-workspace"><BriefcaseBusiness size={20} className="text-content-secondary" /><h2 className="mt-3 text-lg font-semibold">{t("portfolio.title")}</h2><p className="mt-2 max-w-2xl text-meta leading-6 text-content-secondary">{t("portfolio.scope")}</p><div className="mt-4 rounded-card bg-surface-interactive p-4 text-meta text-content-secondary">{t("portfolio.empty")}</div></section> : null}

      {overlay.active.type === "trade_drawer" || ((overlay.active.type === "wallet_picker" || overlay.active.type === "transaction_review") && overlay.suspended?.type === "trade_drawer") ? <TradeDrawer onClose={overlay.close} suspended={overlay.active.type !== "trade_drawer"}><TradeDock pair={selectedPairWithLiveChart} marketDataMode={snapshotData.mode} amount={amount} onAmountChange={setAmount} side={tradeSide} onSideChange={setTradeSide} onInteractionChange={(locked) => setInteractionLock("trade", locked)} /></TradeDrawer> : null}
    </div></TradeabilityProvider></MarketSignalProvider>
  </main>;
}

function TradeDrawer({ onClose, children, suspended = false }: { onClose: () => void; children: ReactNode; suspended?: boolean }) {
  const { t } = useI18n();
  const sheetRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!sheetRef.current) return;
    sheetRef.current.querySelector<HTMLElement>("button")?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !sheetRef.current) return;
      const focusable = [...sheetRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href]")];
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", trapFocus);
    return () => document.removeEventListener("keydown", trapFocus);
  }, []);
  return <div className="fixed inset-0 z-layer-drawer flex items-end justify-end bg-surface-scrim/75 lg:bg-surface-scrim/35" aria-hidden={suspended || undefined} onMouseDown={(event) => { if (!suspended && event.target === event.currentTarget) onClose(); }}><div ref={sheetRef} role="dialog" aria-modal="true" aria-label={t("trade.dock")} data-overlay-root="trade_drawer" className={cx("max-h-[calc(100dvh-56px)] w-full overflow-y-auto rounded-t-overlay bg-surface-panel px-2 cmi-safe-footer pt-2 shadow-overlay lg:h-full lg:max-h-none lg:w-inspector lg:max-w-inspector lg:rounded-l-overlay lg:rounded-tr-seam lg:border-l lg:border-border-subtle lg:p-3", suspended && "pointer-events-none")}><button type="button" onClick={onClose} className="mb-2 ml-auto grid h-11 w-11 place-items-center rounded-pill bg-surface-interactive text-content-secondary" aria-label={t("trade.closeDock")}><X size={16} aria-hidden="true" /></button>{children}</div></div>;
}

function normalizeTerminalView(value: string | undefined): TerminalView {
  if (value === "markets" || value === "watchlist" || value === "alerts" || value === "portfolio" || value === "workspace") return value;
  if (value === "wallet") return "portfolio";
  return "terminal";
}
