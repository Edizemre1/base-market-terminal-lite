"use client";

import { Activity, Bell, BriefcaseBusiness, DatabaseZap, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertCenter } from "@/components/base-terminal/AlertCenter";
import { useChartData } from "@/components/base-terminal/hooks/useChartData";
import { useSelectedPairState } from "@/components/base-terminal/hooks/useSelectedPairState";
import { PairDetailTabs } from "@/components/base-terminal/PairDetailTabs";
import {
  LivePulseStrip,
  MarketActivityPanel
} from "@/components/base-terminal/PulseTerminalPanels";
import { SelectedPairPanel } from "@/components/base-terminal/SelectedPairPanel";
import { TradeDock } from "@/components/base-terminal/TradeDock";
import { LiveMarketTape, MarketMatrix, OpportunityLanes, PinnedMarketGrid } from "@/components/base-terminal/TerminalMarketSurface";
import { MarketSignalProvider } from "@/components/base-terminal/MarketSignalBadges";
import { TradeabilityProvider } from "@/components/base-terminal/AssetTradeabilityBadges";
import type { DetailTab } from "@/components/base-terminal/types";
import {
  useTerminalSearch,
  type ProviderHealthState
} from "@/components/TerminalSearchContext";
import type { MarketTerminalSnapshot } from "@/data/providers";
import { getChartCacheKey, getShareablePairKey } from "@/lib/base-terminal/pairs";
import { getSnapshotRefreshCadence, shouldQueueMarketUpdate } from "@/lib/base-terminal/liveUpdates";
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

const AUTO_APPLY_DELAY_MS = 4_000;

type PendingSnapshot = {
  snapshot: MarketTerminalSnapshot;
  signals: PulseSignal[];
  changedPairIds: string[];
};

type TerminalView = "terminal" | "markets" | "watchlist" | "portfolio" | "alerts";

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
  const [mobileTradeOpen, setMobileTradeOpen] = useState(false);
  const snapshotRef = useRef(snapshotData);
  const selectedPairRef = useRef<BasePair | undefined>(undefined);
  const interactionLockedRef = useRef(false);
  const watchedPairIdsRef = useRef<string[]>([]);
  const snapshotRefreshInFlightRef = useRef(false);
  const snapshotRefreshRequestIdRef = useRef(0);
  const refreshAbortRef = useRef<AbortController | undefined>(undefined);
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
    return t("route.terminalTitle");
  }, [t, view]);

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
    router.replace(`${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`, { scroll: false });
  }, [handleSelectPairById, router]);

  const openTrade = useCallback((pair: BasePair, side: "buy" | "sell") => {
    openPair(pair.id);
    setTradeSide(side);
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1279px)").matches) {
      setMobileTradeOpen(true);
    }
  }, [openPair]);

  useEffect(() => {
    if (!mobileTradeOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileTradeOpen(false); };
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", closeOnEscape); };
  }, [mobileTradeOpen]);

  useEffect(() => {
    snapshotRef.current = snapshotData;
  }, [snapshotData]);

  useEffect(() => {
    const nextView = normalizeTerminalView(initialViewParam);
    setView(nextView);
  }, [initialPairParam, initialViewParam]);

  useEffect(() => {
    watchedPairIdsRef.current = pinnedPairs
      .map((pair) => pair.currentPairId ?? pair.id)
      .filter((id): id is string => Boolean(id));
  }, [pinnedPairs]);

  useEffect(() => {
    interactionLockedRef.current = interactionLocked;
  }, [interactionLocked]);

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
      const signals = mergePulseSignals(nextSnapshot.recentSignals, diffMarketSnapshots(snapshotRef.current, nextSnapshot, {
        watchedPairIds: watchedPairIdsRef.current
      }));
      const candidate = { snapshot: nextSnapshot, signals, changedPairIds };
      if (shouldQueueMarketUpdate(changedPairIds.length, interactionLockedRef.current)) {
        setPendingSnapshot(candidate);
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
    if (!pendingSnapshot || interactionLocked) return;
    const timeoutId = window.setTimeout(() => applySnapshot(pendingSnapshot), AUTO_APPLY_DELAY_MS);
    return () => window.clearTimeout(timeoutId);
  }, [applySnapshot, interactionLocked, pendingSnapshot]);

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
      <main id="terminal-main" tabIndex={-1} className="min-h-[calc(100vh-56px)] scroll-mt-16 bg-base-black p-4 outline-none">
        <section className="pulse-surface mx-auto max-w-3xl rounded-xl p-6">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-base-mint">Mergen Pulse</p>
          <h1 className="mt-2 text-xl font-semibold text-base-text">{t("terminal.unavailableTitle")}</h1>
          <p className="mt-2 text-[12px] leading-6 text-base-muted">{t("terminal.unavailableBody")}</p>
        </section>
      </main>
    );
  }

  return (
    <main id="terminal-main" tabIndex={-1} className="min-h-[calc(100vh-56px)] w-full scroll-mt-16 overflow-x-hidden bg-base-black px-2.5 py-3 outline-none sm:px-4 lg:px-5" data-testid="pulse-terminal">
      <MarketSignalProvider snapshot={snapshotData}>
      <TradeabilityProvider>
      <div className="mx-auto max-w-[1720px] space-y-3">
        {snapshotData.fallbackReason ? <div className="rounded-lg bg-base-amber/10 px-3 py-2 text-[11px] text-base-amber">{t("terminal.unavailableBody")}</div> : null}

        <div className="flex flex-wrap items-center justify-between gap-3 px-1">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-base-mint/10 text-base-mint"><DatabaseZap size={17} aria-hidden="true" /></span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-base-muted">{t("terminal.eyebrow")}</p>
              <h1 className="text-[18px] font-semibold tracking-tight text-base-text">{viewTitle}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden h-9 items-center rounded-full bg-base-mint/10 px-3 font-mono text-[9px] text-base-mint sm:inline-flex">{snapshotData.mode === "mock" ? t("header.mock") : `${t("terminalV3.marketLive")} · ${t("terminalV3.tradingStaging")}`}</span>
            <span className={cx("inline-flex h-9 items-center gap-2 rounded-full bg-base-elevated px-3 font-mono text-[10px]", providerHealth.stale ? "text-base-amber" : "text-base-mint")}><Activity size={12} aria-hidden="true" />{providerHealth.status === "refreshing" ? t("terminal.checkingSource") : providerHealth.stale ? t("terminal.delayedData") : t("terminal.heartbeatHealthy")}</span>
            <button type="button" data-testid="refresh-terminal" disabled={providerHealth.status === "refreshing"} onClick={() => void refreshProviderSnapshot()} className="grid h-9 w-9 place-items-center rounded-full bg-base-elevated text-base-muted hover:text-base-mint disabled:opacity-50" aria-label={t("common.refresh")}><RefreshCw size={14} className={cx(providerHealth.status === "refreshing" && "animate-spin")} aria-hidden="true" /></button>
            <button type="button" onClick={() => setMobileTradeOpen(true)} className="min-h-9 rounded-full bg-base-mint/10 px-3 text-[10px] font-bold text-base-mint xl:hidden" aria-label={t("trade.openDock")}>{t("trade.open")}</button>
            {view === "terminal" ? <button type="button" onClick={() => navigateView("alerts")} className="grid h-9 w-9 place-items-center rounded-full bg-base-elevated text-base-muted hover:text-base-mint" aria-label={t("header.alerts")}><Bell size={14} aria-hidden="true" /></button> : null}
          </div>
        </div>

        {pendingSnapshot ? <div className="flex items-center justify-between rounded-lg border border-base-mint/25 bg-base-mint/5 px-3 py-2 text-[10px] text-base-mint" data-testid="pending-market-updates"><span>{t("market.newUpdates", { count: pendingSnapshot.changedPairIds.length })}</span><button type="button" onClick={() => applySnapshot(pendingSnapshot)} className="min-h-9 rounded-sm bg-base-mint px-3 font-bold text-[#031411]">{t("terminalV3.applyUpdates")}</button></div> : null}

        {view === "terminal" || view === "markets" ? <section className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-base-line/60 sm:grid-cols-3 xl:grid-cols-6" data-testid="universe-counters"><UniverseStat label={t("terminalV3.rawPools")} value={snapshotData.universe.rawPoolCount} testId="raw-pool-count" /><UniverseStat label={t("terminalV3.uniqueTokens")} value={snapshotData.universe.uniqueTokenCount} testId="unique-token-count" /><UniverseStat label={t("terminalV3.activeOpportunities")} value={snapshotData.universe.activeOpportunityCount} testId="active-opportunity-count" /><UniverseStat label={t("terminalV3.freshOpportunities")} value={snapshotData.universe.freshOpportunityCount} testId="fresh-opportunity-count" /><UniverseStat label={t("terminalV3.newPools24h")} value={snapshotData.universe.newPools24h} testId="new-pools-24h" /><UniverseStat label={t("terminalV3.providerCoverage")} value={snapshotData.universe.providerCoverage.length} detail={snapshotData.universe.providerCoverage.map((item) => item.provider).join(" + ")} testId="provider-coverage" /></section> : null}

        {view === "terminal" ? <>
          <LiveMarketTape snapshot={snapshotData} onSelect={openPair} />
          <LivePulseStrip snapshot={snapshotData} signals={pulseSignals} onSelect={openPair} />
          <section className="grid min-w-0 items-start gap-3 xl:grid-cols-[minmax(0,1fr)_320px]" data-testid="terminal-workspace">
            <div className="min-w-0 space-y-3">
              <section className="grid min-w-0 gap-3 2xl:grid-cols-[minmax(0,3fr)_minmax(280px,2fr)]" aria-label={t("workspace.marketWorkspace")}>
                <SelectedPairPanel pair={selectedPairWithLiveChart} marketDataMode={snapshotData.mode} chartRefreshStatus={chartRefreshStatus[getChartCacheKey(selectedPairWithLiveChart)] ?? "idle"} onRefreshChart={refreshPairChart} />
                <MarketActivityPanel pair={selectedPairWithLiveChart} signals={pulseSignals} snapshot={snapshotData} />
              </section>
              <OpportunityLanes snapshot={snapshotData} selectedPair={selectedPairWithLiveChart} onSelect={openPair} onTrade={openTrade} isPairPinned={isPairPinned} onTogglePin={togglePinnedPair} />
              <PinnedMarketGrid pairs={pinnedMarketPairs} onSelect={openPair} onUnpin={togglePinnedPair} />
              <MarketMatrix snapshot={snapshotData} selectedPair={selectedPairWithLiveChart} onSelect={openPair} onTrade={openTrade} isPairPinned={isPairPinned} onTogglePin={togglePinnedPair} onInteractionChange={setInteractionLocked} />
              <PairDetailTabs pair={selectedPairWithLiveChart} activeTab={activeTab} onTabChange={setActiveTab} providerStale={providerHealth.stale} />
            </div>
            <TradeDockPlacement open={mobileTradeOpen} onClose={() => setMobileTradeOpen(false)}><TradeDock pair={selectedPairWithLiveChart} marketDataMode={snapshotData.mode} amount={amount} onAmountChange={setAmount} side={tradeSide} onSideChange={setTradeSide} onInteractionChange={setInteractionLocked} /></TradeDockPlacement>
          </section>
        </> : null}

        {view === "markets" ? <section className="grid min-w-0 items-start gap-3 xl:grid-cols-[minmax(0,1fr)_320px]"><div className="min-w-0 space-y-3"><MarketMatrix snapshot={snapshotData} selectedPair={selectedPairWithLiveChart} onSelect={openPair} onTrade={openTrade} isPairPinned={isPairPinned} onTogglePin={togglePinnedPair} onInteractionChange={setInteractionLocked} /><SelectedPairPanel pair={selectedPairWithLiveChart} marketDataMode={snapshotData.mode} chartRefreshStatus={chartRefreshStatus[getChartCacheKey(selectedPairWithLiveChart)] ?? "idle"} onRefreshChart={refreshPairChart} /></div><TradeDockPlacement open={mobileTradeOpen} onClose={() => setMobileTradeOpen(false)}><TradeDock pair={selectedPairWithLiveChart} marketDataMode={snapshotData.mode} amount={amount} onAmountChange={setAmount} side={tradeSide} onSideChange={setTradeSide} onInteractionChange={setInteractionLocked} /></TradeDockPlacement></section> : null}

        {view === "watchlist" ? <section className="grid min-w-0 items-start gap-3 xl:grid-cols-[minmax(0,1fr)_320px]"><div className="min-w-0 space-y-3"><PinnedMarketGrid pairs={pinnedMarketPairs} onSelect={openPair} onUnpin={togglePinnedPair} /><MarketMatrix snapshot={snapshotData} selectedPair={selectedPairWithLiveChart} onSelect={openPair} onTrade={openTrade} isPairPinned={isPairPinned} onTogglePin={togglePinnedPair} onInteractionChange={setInteractionLocked} watchlistOnly /></div><TradeDockPlacement open={mobileTradeOpen} onClose={() => setMobileTradeOpen(false)}><TradeDock pair={selectedPairWithLiveChart} marketDataMode={snapshotData.mode} amount={amount} onAmountChange={setAmount} side={tradeSide} onSideChange={setTradeSide} onInteractionChange={setInteractionLocked} /></TradeDockPlacement></section> : null}

        {view === "alerts" ? <section className="mx-auto w-full max-w-3xl" data-testid="alerts-workspace"><AlertCenter snapshot={snapshotData} selectedPair={selectedPairWithLiveChart} signals={pulseSignals} embedded /></section> : null}

        {view === "portfolio" ? <section className="grid min-w-0 items-start gap-3 xl:grid-cols-[minmax(0,1fr)_360px]" data-testid="portfolio-workspace"><div className="pulse-surface rounded-xl p-5"><BriefcaseBusiness size={20} className="text-base-mint" /><h2 className="mt-3 text-lg font-semibold">{t("portfolio.title")}</h2><p className="mt-2 max-w-2xl text-[11px] leading-6 text-base-muted">{t("portfolio.scope")}</p><div className="mt-4 rounded-lg bg-base-elevated p-4 text-[11px] text-base-muted">{t("portfolio.empty")}</div></div><TradeDockPlacement open={mobileTradeOpen} onClose={() => setMobileTradeOpen(false)}><TradeDock pair={selectedPairWithLiveChart} marketDataMode={snapshotData.mode} amount={amount} onAmountChange={setAmount} side={tradeSide} onSideChange={setTradeSide} onInteractionChange={setInteractionLocked} /></TradeDockPlacement></section> : null}
      </div>
      </TradeabilityProvider>
      </MarketSignalProvider>
    </main>
  );
}

function TradeDockPlacement({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const { t } = useI18n();
  const sheetRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || !sheetRef.current) return;
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
  }, [open]);
  return <div className={cx("min-w-0 xl:sticky xl:top-[64px] xl:z-[80]", open ? "max-xl:fixed max-xl:inset-0 max-xl:z-[70] max-xl:flex max-xl:items-end max-xl:bg-black/75" : "max-xl:hidden")} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div ref={sheetRef} role={open ? "dialog" : undefined} aria-modal={open ? true : undefined} aria-label={open ? t("trade.dock") : undefined} className="max-xl:max-h-[calc(100dvh-56px)] max-xl:w-full max-xl:overflow-y-auto max-xl:rounded-t-2xl max-xl:bg-base-panel max-xl:px-2 max-xl:pt-2" style={{ paddingBottom: open ? "max(8px, env(safe-area-inset-bottom))" : undefined }}><button type="button" onClick={onClose} className="mb-2 ml-auto hidden h-11 w-11 place-items-center rounded-full bg-base-elevated text-base-muted max-xl:grid" aria-label={t("trade.closeDock")}><X size={16} aria-hidden="true" /></button>{children}</div></div>;
}

function normalizeTerminalView(value: string | undefined): TerminalView {
  if (value === "markets" || value === "watchlist" || value === "alerts" || value === "portfolio") return value;
  if (value === "wallet") return "portfolio";
  return "terminal";
}

function UniverseStat({ label, value, detail, testId }: { label: string; value: number; detail?: string; testId: string }) {
  return <div className="min-w-0 bg-base-panel px-3 py-2"><p className="truncate text-[8px] font-bold uppercase tracking-[0.1em] text-base-muted">{label}</p><p className="mt-1 font-mono text-[14px] font-semibold text-base-text" data-testid={testId}>{value.toLocaleString()}</p>{detail ? <p className="mt-0.5 truncate text-[8px] text-base-muted">{detail}</p> : null}</div>;
}
