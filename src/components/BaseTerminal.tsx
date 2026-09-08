"use client";

import { BriefcaseBusiness, Rows3, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useChartData } from "@/components/base-terminal/hooks/useChartData";
import { useSelectedPairState } from "@/components/base-terminal/hooks/useSelectedPairState";
import { LiveMarketTape, MarketMatrix, PinnedMarketGrid, PoolDrawer } from "@/components/base-terminal/TerminalMarketSurface";
import { LiveMarketWall } from "@/components/base-terminal/LiveMarketWall";
import { MARKET_SIGNAL_OPEN_INSPECTOR_EVENT, MarketSignalProvider } from "@/components/base-terminal/MarketSignalBadges";
import { TradeabilityProvider } from "@/components/base-terminal/AssetTradeabilityBadges";
import type { DetailTab } from "@/components/base-terminal/types";
import {
  useTerminalSearch,
  type ProviderHealthState
} from "@/components/TerminalSearchContext";
import type { MarketTerminalSnapshot } from "@/data/providers";
import { getChartCacheKey, getPairFromParam, getShareablePairKey } from "@/lib/base-terminal/pairs";
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
import {
  commitTerminalNavigation,
  normalizeTerminalView,
  readTerminalLocation,
  TERMINAL_NAVIGATION_EVENT,
  type TerminalLocation,
  type TerminalView
} from "@/lib/base-terminal/terminalNavigation";
import { fetchTerminalSnapshot } from "@/lib/base-terminal/terminalSnapshotClient";

const BASE_USDC_ADDRESS = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const BASE_WETH_ADDRESS = "0x4200000000000000000000000000000000000006";

type PendingSnapshot = {
  snapshot: MarketTerminalSnapshot;
  signals: PulseSignal[];
  changedPairIds: string[];
};

const AlertCenter = dynamic(() => import("@/components/base-terminal/AlertCenter").then((module) => module.AlertCenter), { ssr: false });
const ContextInspector = dynamic(() => import("@/components/base-terminal/ContextInspector").then((module) => module.ContextInspector), { ssr: false });
const MarketActivityPanel = dynamic(() => import("@/components/base-terminal/PulseTerminalPanels").then((module) => module.MarketActivityPanel), { ssr: false });
const PairDetailTabs = dynamic(() => import("@/components/base-terminal/PairDetailTabs").then((module) => module.PairDetailTabs), { ssr: false });
const SelectedPairPanel = dynamic(() => import("@/components/base-terminal/SelectedPairPanel").then((module) => module.SelectedPairPanel), { ssr: false });
const TradeDock = dynamic(() => import("@/components/base-terminal/TradeDock").then((module) => module.TradeDock), { ssr: false });

export function BaseTerminal({
  data,
  initialPairParam,
  initialViewParam
}: {
  data: MarketTerminalSnapshot;
  initialPairParam?: string;
  initialViewParam?: string;
}) {
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
  const [placementSnapshot, setPlacementSnapshot] = useState(data);
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const [amount, setAmount] = useState("0.10");
  const [tradePair, setTradePair] = useState<BasePair>();
  const [tradeSide, setTradeSide] = useState<"buy" | "sell">("buy");
  const [providerHealth, setProviderHealth] = useState<ProviderHealthState>(() => buildProviderHealth(data, "idle"));
  const [pulseSignals, setPulseSignals] = useState<PulseSignal[]>(data.recentSignals);
  const [pendingSnapshot, setPendingSnapshot] = useState<PendingSnapshot>();
  const [interactionLocked, setInteractionLocked] = useState(false);
  const initialLocationRef = useRef<TerminalLocation | undefined>(undefined);
  if (!initialLocationRef.current) {
    initialLocationRef.current = typeof window === "undefined"
      ? {
        view: normalizeTerminalView(initialViewParam),
        pair: initialPairParam,
        overlay: initialPairParam && normalizeTerminalView(initialViewParam) !== "workspace"
          ? "market_inspector"
          : "none"
      }
      : readTerminalLocation();
  }
  const initialLocation = initialLocationRef.current;
  const subscribeToView = useCallback((notify: () => void) => {
    window.addEventListener(TERMINAL_NAVIGATION_EVENT, notify);
    window.addEventListener("popstate", notify);
    return () => {
      window.removeEventListener(TERMINAL_NAVIGATION_EVENT, notify);
      window.removeEventListener("popstate", notify);
    };
  }, []);
  const readView = useCallback(() => readTerminalLocation().view, []);
  const readServerView = useCallback(() => initialLocation.view, [initialLocation.view]);
  const view = useSyncExternalStore(subscribeToView, readView, readServerView);
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
    initialPairParam: initialLocation.pair ?? initialPairParam
  });
  const { chartOverrides, chartRefreshStatus, refreshPairChart } = useChartData(snapshotRef);
  const selectedPairWithLiveChart = useMemo(() => {
    if (!selectedPair) return undefined;
    const hydrated = { ...selectedPair, ...chartOverrides[getChartCacheKey(selectedPair)] };
    const opportunity = snapshotData.opportunities.find((item) => item.id === selectedPair.opportunityId);
    const oriented = orientPairToOpportunity(hydrated, opportunity);
    const displayPrice = opportunity?.canonicalPrice.value ?? opportunity?.observedPriceUsd?.value;
    return displayPrice === undefined ? oriented : { ...oriented, priceUsdValue: displayPrice, priceUsd: formatUsd(displayPrice), price: formatUsd(displayPrice), qualityBand: opportunity?.qualityBand, liquidityState: opportunity?.liquidityState };
  }, [chartOverrides, selectedPair, snapshotData.opportunities]);
  const defaultTradePair = useMemo(() => {
    const wethOpportunity = snapshotData.opportunities.find((item) => item.focusTokenAddress.toLowerCase() === BASE_WETH_ADDRESS);
    const exactMarket = wethOpportunity ? snapshotData.allPairs.find((item) => item.id === wethOpportunity.primaryMarketId) : undefined;
    if (exactMarket && wethOpportunity) return orientPairToOpportunity({ ...exactMarket, opportunityId: wethOpportunity.id, focusTokenAddress: wethOpportunity.focusTokenAddress, focusTokenSymbol: wethOpportunity.focusTokenSymbol, focusTokenName: wethOpportunity.focusTokenName }, wethOpportunity);
    return buildDefaultTradeContext(selectedPairWithLiveChart);
  }, [selectedPairWithLiveChart, snapshotData.allPairs, snapshotData.opportunities]);
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
    if (typeof window === "undefined") return;
    if (pendingSnapshot) {
      setPlacementSnapshot(snapshotRef.current);
      setPendingSnapshot(undefined);
    }
    overlay.closeAll();
    commitTerminalNavigation({ view: nextView, overlay: "none" });
  }, [overlay, pendingSnapshot]);

  const openPair = useCallback((pairId: string) => {
    handleSelectPairById(pairId);
    const nextPair = snapshotRef.current.allPairs.find((pair) => pair.id === pairId);
    if (!nextPair || typeof window === "undefined") return;
    commitTerminalNavigation({ view, pair: getShareablePairKey(nextPair), overlay: "market_inspector" });
    overlay.open("market_inspector", { pairId: nextPair.id });
  }, [handleSelectPairById, overlay, view]);

  const openTrade = useCallback((pair: BasePair, side: "buy" | "sell") => {
    if (snapshotRef.current.allPairs.some((item) => item.id === pair.id)) handleSelectPairById(pair.id);
    setTradePair(pair);
    setTradeSide(side);
    overlay.open("trade_drawer", { pairId: pair.id, side });
  }, [handleSelectPairById, overlay]);

  useEffect(() => {
    const openSignalEvidence = (event: Event) => {
      const opportunityId = (event as CustomEvent<{ opportunityId?: string }>).detail?.opportunityId;
      const opportunity = snapshotRef.current.opportunities.find((item) => item.id === opportunityId);
      const pair = opportunity ? snapshotRef.current.allPairs.find((item) => item.id === opportunity.primaryMarketId) : undefined;
      if (!pair) return;
      handleSelectPairById(pair.id);
      commitTerminalNavigation({ view, pair: getShareablePairKey(pair), overlay: "market_inspector" });
      overlay.open("market_inspector", { pairId: pair.id, tab: "signals" });
    };
    window.addEventListener(MARKET_SIGNAL_OPEN_INSPECTOR_EVENT, openSignalEvidence);
    return () => window.removeEventListener(MARKET_SIGNAL_OPEN_INSPECTOR_EVENT, openSignalEvidence);
  }, [handleSelectPairById, overlay, view]);

  const openWorkspace = useCallback((pair: BasePair) => {
    handleSelectPairById(pair.id);
    overlay.closeAll();
    if (typeof window === "undefined") return;
    commitTerminalNavigation({ view: "workspace", pair: getShareablePairKey(pair), overlay: "none" });
  }, [handleSelectPairById, overlay]);

  useEffect(() => {
    snapshotRef.current = snapshotData;
  }, [snapshotData]);

  useEffect(() => {
    const sync = (event?: Event) => {
      const detail = event instanceof CustomEvent ? event.detail as TerminalLocation : readTerminalLocation();
      const nextPair = detail.pair ? getPairFromParam(snapshotRef.current.allPairs, detail.pair) : undefined;
      if (nextPair) handleSelectPairById(nextPair.id);
      setPlacementSnapshot(snapshotRef.current);
      setPendingSnapshot(undefined);
      if (detail.view === "workspace" || detail.overlay === "none") overlay.closeAll();
      else if (detail.overlay === "market_inspector" && nextPair) overlay.open("market_inspector", { pairId: nextPair.id });
    };
    window.addEventListener(TERMINAL_NAVIGATION_EVENT, sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener(TERMINAL_NAVIGATION_EVENT, sync);
      window.removeEventListener("popstate", sync);
    };
  }, [handleSelectPairById, overlay]);

  useEffect(() => {
    if (!initialLocation.pair || view === "workspace" || initialLocation.view === "workspace") return;
    if (activeOverlayTypeRef.current !== "none") return;
    openOverlay("market_inspector");
  }, [initialLocation.pair, initialLocation.view, openOverlay, view]);

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
    setPlacementSnapshot(data);
    snapshotRef.current = data;
    setPulseSignals((current) => mergePulseSignals(current, data.recentSignals));
    setProviderHealth(buildProviderHealth(data, "idle"));
  }, [data]);

  const applyPlacement = useCallback((candidate: PendingSnapshot) => {
    const next = preserveSelectedPair(candidate.snapshot, selectedPairRef.current);
    setPlacementSnapshot(next);
    setPendingSnapshot(undefined);
  }, []);

  const refreshProviderSnapshot = useCallback(async (forceOnchain = false) => {
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
      const nextSnapshot = await fetchTerminalSnapshot(`/api/market-snapshot?data=${mode}${forceOnchain ? "&onchain=1" : ""}`, abortController.signal);
      if (snapshotRefreshRequestIdRef.current !== requestId) return;
      if (!shouldAcceptMarketSnapshot(snapshotRef.current, nextSnapshot)) {
        setProviderHealth(buildProviderHealth(snapshotRef.current, "idle"));
        return;
      }
      if (shouldKeepCurrentSnapshotOnRefresh(snapshotRef.current, nextSnapshot)) {
        throw new Error("Provider returned fallback-only refresh");
      }

      const currentSnapshot = snapshotRef.current;
      const changedPairIds = getChangedPairIds(currentSnapshot, nextSnapshot);
      const changedOpportunityIds = coalescePendingOpportunityIds([], changedPairIds.map((pairId) => nextSnapshot.opportunities.find((opportunity) => opportunity.poolMarketIds.includes(pairId))?.id ?? pairId));
      const signals = mergePulseSignals(nextSnapshot.recentSignals, diffMarketSnapshots(currentSnapshot, nextSnapshot, {
        watchedPairIds: watchedPairIdsRef.current
      }));
      const candidate = { snapshot: nextSnapshot, signals, changedPairIds: changedOpportunityIds };
      const liveSnapshot = preserveSelectedPair(nextSnapshot, selectedPairRef.current);
      snapshotRef.current = liveSnapshot;
      setSnapshotData(liveSnapshot);
      setPulseSignals((existing) => mergePulseSignals(existing, signals));
      setProviderHealth(buildProviderHealth(liveSnapshot, "idle"));
      if (shouldQueueMarketUpdate(changedPairIds.length, interactionLockedRef.current)) {
        setPendingSnapshot((current) => ({
          snapshot: candidate.snapshot,
          signals: mergePulseSignals(current?.signals ?? [], candidate.signals),
          changedPairIds: coalescePendingOpportunityIds(current?.changedPairIds ?? [], candidate.changedPairIds)
        }));
      } else {
        setPlacementSnapshot(liveSnapshot);
        setPendingSnapshot(undefined);
      }
    } catch {
      if (abortController.signal.aborted) return;
      if (snapshotRefreshRequestIdRef.current === requestId) {
        setProviderHealth((current) => current
          ? { ...current, status: "failed", sourceDelayed: true, failureReason: "Refresh failed; using last good data." }
          : buildProviderHealth(snapshotRef.current, "failed", "Refresh failed; using last good data."));
      }
    } finally {
      if (snapshotRefreshRequestIdRef.current === requestId) snapshotRefreshInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (snapshotData.mode !== "dexscreener") return;
    const source = new EventSource("/api/opportunity-stream");
    const handleConfirmedPool = () => void refreshProviderSnapshot(true);
    source.addEventListener("pool_confirmed", handleConfirmedPool);
    return () => {
      source.removeEventListener("pool_confirmed", handleConfirmedPool);
      source.close();
    };
  }, [refreshProviderSnapshot, snapshotData.mode]);

  useEffect(() => {
    if (!pendingSnapshot || !shouldAutoApplyPendingUpdate({ interactionLocked, overlayOpen: overlay.active.type !== "none", quietForMs: UPDATE_AUTO_APPLY_QUIET_MS })) return;
    const timeoutId = window.setTimeout(() => applyPlacement(pendingSnapshot), UPDATE_AUTO_APPLY_QUIET_MS);
    return () => window.clearTimeout(timeoutId);
  }, [applyPlacement, interactionLocked, overlay.active.type, pendingSnapshot]);

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
      ? { ...current, status: "failed", stale: true, sourceDelayed: true, failureReason: "Offline; using last good data." }
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
      <main id="terminal-main" tabIndex={-1} className="min-h-[calc(100vh-56px)] scroll-mt-16 bg-surface-canvas p-4 outline-none" data-testid="pulse-terminal" data-terminal-view={view}>
        <TradeabilityProvider><div className="mx-auto max-w-3xl space-y-3">
          <StatePanel kind="unavailable" title={t("terminal.unavailableTitle")} body={t("terminal.unavailableBody")} />
          {overlay.active.type === "trade_drawer" || (overlay.active.type === "transaction_review" && overlay.suspended?.type === "trade_drawer") ? <TradeDrawer onClose={overlay.close} suspended={overlay.active.type !== "trade_drawer"}><TradeDock pair={tradePair ?? defaultTradePair} marketDataMode={snapshotData.mode} amount={amount} onAmountChange={setAmount} side={tradeSide} onSideChange={setTradeSide} onInteractionChange={(locked) => setInteractionLock("trade", locked)} /></TradeDrawer> : null}
        </div></TradeabilityProvider>
      </main>
    );
  }

  const inspectorOpen = overlay.active.type === "market_inspector";
  const openPoolOpportunity = overlay.active.type === "pool_drawer" ? snapshotData.opportunities.find((item) => item.id === overlay.active.payload?.opportunityId) : undefined;
  const marketBoardOpen = overlay.active.type === "market_board" || ((overlay.active.type === "filters" || overlay.active.type === "columns") && overlay.suspended?.type === "market_board");
  const marketBoard = <ResponsiveMarketBoard open={marketBoardOpen} suspended={marketBoardOpen && overlay.active.type !== "market_board"} onOpen={() => overlay.open("market_board")} onClose={overlay.close}><MarketMatrix snapshot={snapshotData} placementSnapshot={placementSnapshot} selectedPair={selectedPairWithLiveChart} onSelect={openPair} isPairPinned={isPairPinned} onInteractionChange={(locked) => setInteractionLock("market-board", locked)} watchlistOnly={view === "watchlist"} /></ResponsiveMarketBoard>;
  return <main id="terminal-main" tabIndex={-1} className="min-h-[calc(100vh-56px)] w-full scroll-mt-16 overflow-x-hidden bg-surface-canvas px-3 py-3 outline-none sm:px-4 lg:px-6" data-testid="pulse-terminal" data-terminal-view={view}><h1 className="sr-only">{viewTitle}</h1>
    <MarketSignalProvider snapshot={snapshotData}><TradeabilityProvider><div className="mx-auto max-w-[2200px] space-y-3">
      {snapshotData.fallbackReason ? <div className="rounded-card bg-freshness-delayed/10 px-3 py-2 text-meta text-freshness-delayed">{t("terminal.unavailableBody")}</div> : null}

      {view === "terminal" ? <><LiveMarketTape snapshot={snapshotData} placementSnapshot={placementSnapshot} onSelect={openPair} onRefresh={() => void refreshProviderSnapshot()} refreshing={providerHealth.status === "refreshing"} delayed={providerHealth.stale} sourceDelayed={providerHealth.sourceDelayed && !providerHealth.stale} pendingUpdateCount={pendingSnapshot?.changedPairIds.length} onApplyUpdates={pendingSnapshot ? () => applyPlacement(pendingSnapshot) : undefined} /><LiveMarketWall snapshot={snapshotData} placementSnapshot={placementSnapshot} selectedPair={selectedPairWithLiveChart} onSelect={openPair} onInteractionChange={(locked) => setInteractionLock("live-wall", locked)} /><section className={cx("grid min-w-0 items-start gap-3", inspectorOpen && "cmi-inspector-grid")} data-testid="terminal-workspace"><div className="min-w-0">{marketBoard}</div><ContextInspector pair={selectedPairWithLiveChart} snapshot={snapshotData} onTrade={openTrade} onOpenWorkspace={openWorkspace} /></section></> : null}

      {view === "markets" ? <section className={cx("grid min-w-0 items-start gap-3", inspectorOpen && "cmi-inspector-grid")}><div className="min-w-0 space-y-3"><LiveMarketTape snapshot={snapshotData} placementSnapshot={placementSnapshot} onSelect={openPair} onRefresh={() => void refreshProviderSnapshot()} refreshing={providerHealth.status === "refreshing"} delayed={providerHealth.stale} sourceDelayed={providerHealth.sourceDelayed && !providerHealth.stale} pendingUpdateCount={pendingSnapshot?.changedPairIds.length} onApplyUpdates={pendingSnapshot ? () => applyPlacement(pendingSnapshot) : undefined} />{marketBoard}</div><ContextInspector pair={selectedPairWithLiveChart} snapshot={snapshotData} onTrade={openTrade} onOpenWorkspace={openWorkspace} /></section> : null}

      {view === "watchlist" ? <section className={cx("grid min-w-0 items-start gap-3", inspectorOpen && "cmi-inspector-grid")}><div className="min-w-0 space-y-3"><PinnedMarketGrid pairs={pinnedMarketPairs} onSelect={openPair} onUnpin={togglePinnedPair} />{marketBoard}</div><ContextInspector pair={selectedPairWithLiveChart} snapshot={snapshotData} onTrade={openTrade} onOpenWorkspace={openWorkspace} /></section> : null}

      {view === "workspace" ? <section className="space-y-3" data-testid="pair-workspace"><div className="flex items-center justify-between gap-2 px-1"><div><p className="text-meta font-bold uppercase tracking-eyebrow text-content-secondary">{t("workspace.selected")}</p><h1 className="text-base font-semibold">{selectedPairWithLiveChart.focusTokenSymbol ?? selectedPairWithLiveChart.baseToken}</h1></div><button type="button" onClick={() => navigateView("terminal")} className="min-h-10 rounded-control bg-surface-interactive px-3 text-meta text-content-secondary">{t("common.backToMarkets")}</button></div><section className="grid min-w-0 gap-3 2xl:grid-cols-[minmax(0,3fr)_minmax(280px,2fr)]"><SelectedPairPanel pair={selectedPairWithLiveChart} marketDataMode={snapshotData.mode} chartRefreshStatus={chartRefreshStatus[getChartCacheKey(selectedPairWithLiveChart)] ?? "idle"} onRefreshChart={refreshPairChart} /><MarketActivityPanel pair={selectedPairWithLiveChart} signals={pulseSignals} snapshot={snapshotData} /></section><PairDetailTabs pair={selectedPairWithLiveChart} activeTab={activeTab} onTabChange={setActiveTab} providerStale={providerHealth.stale} /><div className="flex justify-end"><button type="button" onClick={() => openTrade(selectedPairWithLiveChart, "buy")} className="min-h-11 rounded-control bg-brand-action px-6 text-meta font-bold text-content-on-accent">{t("trade.checkQuote")}</button></div></section> : null}

      {view === "alerts" ? <section className="mx-auto w-full max-w-3xl" data-testid="alerts-workspace"><AlertCenter snapshot={snapshotData} selectedPair={selectedPairWithLiveChart} signals={pulseSignals} embedded /></section> : null}
      {view === "portfolio" ? <section className="pulse-surface rounded-panel p-6" data-testid="portfolio-workspace"><BriefcaseBusiness size={20} className="text-content-secondary" /><h2 className="mt-3 text-lg font-semibold">{t("portfolio.title")}</h2><p className="mt-2 max-w-2xl text-meta leading-6 text-content-secondary">{t("portfolio.scope")}</p><div className="mt-4 rounded-card bg-surface-interactive p-4 text-meta text-content-secondary">{t("portfolio.empty")}</div></section> : null}

      {openPoolOpportunity ? <PoolDrawer opportunity={openPoolOpportunity} pairs={snapshotData.allPairs.filter((pair) => openPoolOpportunity.poolMarketIds.includes(pair.id))} onClose={overlay.close} onSelect={openPair} onTrade={openTrade} /> : null}
      {overlay.active.type === "trade_drawer" || (overlay.active.type === "transaction_review" && overlay.suspended?.type === "trade_drawer") ? <TradeDrawer onClose={overlay.close} suspended={overlay.active.type !== "trade_drawer"}><TradeDock pair={tradePair ?? selectedPairWithLiveChart} marketDataMode={snapshotData.mode} amount={amount} onAmountChange={setAmount} side={tradeSide} onSideChange={setTradeSide} onInteractionChange={(locked) => setInteractionLock("trade", locked)} /></TradeDrawer> : null}
    </div></TradeabilityProvider></MarketSignalProvider>
  </main>;
}

function TradeDrawer({ onClose, children, suspended = false }: { onClose: () => void; children: ReactNode; suspended?: boolean }) {
  const { t } = useI18n();
  return <div className="fixed inset-0 z-layer-drawer flex items-end justify-end bg-surface-scrim/75 lg:bg-surface-scrim/35" aria-hidden={suspended || undefined} onMouseDown={(event) => { if (!suspended && event.target === event.currentTarget) onClose(); }}><div role="dialog" aria-modal="true" aria-label={t("trade.dock")} data-overlay-root="trade_drawer" className={cx("max-h-[calc(100dvh-56px)] w-full overflow-y-auto rounded-t-overlay bg-surface-panel px-2 cmi-safe-footer pt-2 shadow-overlay lg:h-full lg:max-h-none lg:w-inspector lg:max-w-inspector lg:rounded-l-overlay lg:rounded-tr-seam lg:border-l lg:border-border-subtle lg:p-3", suspended && "pointer-events-none")}><button type="button" onClick={onClose} className="mb-2 ml-auto grid h-11 w-11 place-items-center rounded-pill bg-surface-interactive text-content-secondary" aria-label={t("trade.closeDock")} data-overlay-autofocus><X size={16} aria-hidden="true" /></button>{children}</div></div>;
}

function ResponsiveMarketBoard({ open, suspended, onOpen, onClose, children }: { open: boolean; suspended: boolean; onOpen: () => void; onClose: () => void; children: ReactNode }) {
  const { t } = useI18n();
  if (!open) return <><button type="button" onClick={onOpen} className="flex min-h-control-touch w-full items-center justify-between rounded-card border border-border-subtle bg-surface-panel px-3 text-label font-semibold text-content-primary md:hidden" data-testid="open-market-board"><span className="inline-flex items-center gap-2"><Rows3 size={16} />{t("terminalV3.openBoard")}</span><span className="text-meta text-content-secondary">{t("terminalV3.boardSheetHint")}</span></button><div className="hidden md:block">{children}</div></>;
  return <div className="fixed inset-0 z-layer-drawer flex items-end justify-end bg-surface-scrim/75 md:hidden" aria-hidden={suspended || undefined} onMouseDown={(event) => { if (!suspended && event.target === event.currentTarget) onClose(); }}><section role="dialog" aria-modal="true" aria-label={t("terminalV3.matrix")} data-overlay-root="market_board" className={cx("max-h-[calc(100dvh-56px)] w-full overflow-y-auto rounded-t-overlay border border-border-subtle bg-surface-panel p-3 cmi-safe-footer shadow-overlay", suspended && "pointer-events-none")} data-testid="market-board-sheet"><header className="mb-3 flex items-center justify-between gap-3"><div><p className="text-meta font-bold uppercase tracking-eyebrow text-content-secondary">{t("terminalV3.matrixEyebrow")}</p><h2 className="text-title-sm font-semibold">{t("terminalV3.matrix")}</h2></div><button type="button" onClick={onClose} className="cmi-icon-button h-control-touch w-control-touch" aria-label={t("terminalV3.closeBoard")} data-overlay-autofocus><X size={16} /></button></header>{children}</section></div>;
}

function formatUsd(value: number) {
  return value >= 1 ? `$${value.toLocaleString("en-US", { maximumFractionDigits: 6 })}` : `$${value.toPrecision(6)}`;
}

function buildDefaultTradeContext(template?: BasePair): BasePair {
  return {
    ...(template ?? {
      holders: { top10: "—", top50: "—", top100: "—", total: "—", active24h: "—" },
      poolAge: "—",
      flags: [],
      taxes: { buy: "—", sell: "—" },
      lpLock: { status: "—", provider: "—", expires: "—" },
      riskChecks: [],
      liquidityDetail: { poolLiquidity: "—", lpChange: "—", depth: "—", routeSource: "—" },
      activity: []
    }),
    id: "base:trade:usdc-weth",
    pair: "WETH / USDC",
    baseToken: "WETH",
    quoteToken: "USDC",
    project: "Wrapped Ether",
    address: BASE_WETH_ADDRESS,
    route: "USDC → WETH",
    dex: "Route discovery",
    age: "—",
    price: "—",
    priceUsd: "—",
    chart: [],
    baseTokenAddress: BASE_WETH_ADDRESS,
    quoteTokenAddress: BASE_USDC_ADDRESS,
    focusTokenAddress: BASE_WETH_ADDRESS,
    focusTokenSymbol: "WETH",
    focusTokenName: "Wrapped Ether",
    opportunityId: undefined,
    pairAddress: undefined,
    priceUsdValue: undefined,
    liquidityUsd: undefined,
    liquidity: undefined,
    volumes: undefined,
    volume24h: undefined,
    priceChanges: undefined,
    change24h: undefined,
    txns: undefined,
    metadataStatus: "complete",
    metadataVerificationState: "verified",
    dataSource: undefined,
    dataProviders: undefined,
    sourceUpdatedAt: undefined,
    stale: false
  };
}
