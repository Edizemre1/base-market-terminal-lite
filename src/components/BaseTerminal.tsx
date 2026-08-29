"use client";

import { Activity, DatabaseZap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCenter } from "@/components/base-terminal/AlertCenter";
import { useChartData } from "@/components/base-terminal/hooks/useChartData";
import { useRecentPairs } from "@/components/base-terminal/hooks/useRecentPairs";
import { useSelectedPairState } from "@/components/base-terminal/hooks/useSelectedPairState";
import { MarketDiscovery } from "@/components/base-terminal/MarketDiscovery";
import { PairDetailTabs } from "@/components/base-terminal/PairDetailTabs";
import {
  LivePulseStrip,
  MarketActivityPanel,
  OpportunityStream
} from "@/components/base-terminal/PulseTerminalPanels";
import { SelectedPairPanel } from "@/components/base-terminal/SelectedPairPanel";
import { SwapTicket } from "@/components/base-terminal/SwapPreviewPanel";
import type { DetailTab } from "@/components/base-terminal/types";
import {
  useTerminalSearch,
  type ProviderHealthState
} from "@/components/TerminalSearchContext";
import type { MarketTerminalSnapshot } from "@/data/providers";
import { getChartCacheKey } from "@/lib/base-terminal/pairs";
import { getSnapshotRefreshCadence, shouldQueueMarketUpdate } from "@/lib/base-terminal/liveUpdates";
import {
  createVisitSnapshot,
  diffMarketSnapshots,
  diffSinceLastVisit,
  getChangedPairIds,
  mergePulseSignals,
  type PulseSignal,
  type VisitSnapshot
} from "@/lib/base-terminal/pulse";
import {
  buildProviderHealth,
  preserveSelectedPair,
  shouldKeepCurrentSnapshotOnRefresh
} from "@/lib/base-terminal/providerHealth";
import { cx } from "@/lib/format";
import type { BasePair } from "@/types/baseTerminal";

const AUTO_APPLY_DELAY_MS = 4_000;
const VISIT_STORAGE_KEY = "mergen-pulse:last-visit:v1";

type PendingSnapshot = {
  snapshot: MarketTerminalSnapshot;
  signals: PulseSignal[];
  changedPairIds: string[];
};

export function BaseTerminal({
  data,
  initialPairParam
}: {
  data: MarketTerminalSnapshot;
  initialPairParam?: string;
}) {
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
  const [providerHealth, setProviderHealth] = useState<ProviderHealthState>(() => buildProviderHealth(data, "idle"));
  const [pulseSignals, setPulseSignals] = useState<PulseSignal[]>([]);
  const [sinceLastSignals, setSinceLastSignals] = useState<PulseSignal[]>([]);
  const [pendingSnapshot, setPendingSnapshot] = useState<PendingSnapshot>();
  const [lastAppliedChangedPairIds, setLastAppliedChangedPairIds] = useState<string[]>([]);
  const [interactionLocked, setInteractionLocked] = useState(false);
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
  const selectedPairWithLiveChart = useMemo(
    () => selectedPair ? { ...selectedPair, ...chartOverrides[getChartCacheKey(selectedPair)] } : undefined,
    [chartOverrides, selectedPair]
  );
  const recentPairIds = useRecentPairs(selectedPairWithLiveChart?.id);

  useEffect(() => {
    snapshotRef.current = snapshotData;
  }, [snapshotData]);

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
    setLastAppliedChangedPairIds(candidate.changedPairIds);
    setPendingSnapshot(undefined);
    setProviderHealth(buildProviderHealth(next, "idle"));
    window.setTimeout(() => setLastAppliedChangedPairIds([]), 1_200);
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
      if (shouldKeepCurrentSnapshotOnRefresh(snapshotRef.current, nextSnapshot)) {
        throw new Error("Provider returned fallback-only refresh");
      }

      const changedPairIds = getChangedPairIds(snapshotRef.current, nextSnapshot);
      const signals = diffMarketSnapshots(snapshotRef.current, nextSnapshot, {
        watchedPairIds: watchedPairIdsRef.current
      });
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
    registerSelectPairHandler(handleSelectPairById);
    return () => registerSelectPairHandler(undefined);
  }, [handleSelectPairById, registerSelectPairHandler]);

  useEffect(() => {
    if (selectedPair) void refreshPairChart(selectedPair);
  }, [refreshPairChart, selectedPair]);

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
    let previousVisit: VisitSnapshot | undefined;
    try {
      const stored = window.localStorage.getItem(VISIT_STORAGE_KEY);
      previousVisit = stored ? JSON.parse(stored) as VisitSnapshot : undefined;
    } catch {
      previousVisit = undefined;
    }
    setSinceLastSignals(diffSinceLastVisit(previousVisit, data, watchedPairIdsRef.current));
    const timeoutId = window.setTimeout(() => {
      window.localStorage.setItem(VISIT_STORAGE_KEY, JSON.stringify(createVisitSnapshot(snapshotRef.current)));
    }, 2_000);
    return () => window.clearTimeout(timeoutId);
  }, [data]);

  if (!selectedPairWithLiveChart) {
    return (
      <main className="min-h-[calc(100vh-56px)] bg-base-black p-4">
        <section className="pulse-surface mx-auto max-w-3xl rounded-xl p-6">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-base-mint">Mergen Pulse</p>
          <h1 className="mt-2 text-xl font-semibold text-base-text">Live market data is temporarily unavailable</h1>
          <p className="mt-2 text-[12px] leading-6 text-base-muted">No sample prices were substituted. The terminal is preserving the source boundary while it waits for a healthy read-only snapshot.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100vh-56px)] w-full overflow-x-hidden bg-base-black px-2.5 py-3 sm:px-4 lg:px-5" data-testid="pulse-terminal">
      <div className="mx-auto max-w-[1720px] space-y-3">
        {snapshotData.fallbackReason ? <div className="rounded-lg bg-base-amber/10 px-3 py-2 text-[11px] text-base-amber">{snapshotData.fallbackReason}</div> : null}

        <div className="flex flex-wrap items-center justify-between gap-3 px-1">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-base-mint/10 text-base-mint"><DatabaseZap size={17} /></span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-base-muted">Base market control center</p>
              <h1 className="text-[18px] font-semibold tracking-tight text-base-text">Mergen Pulse Terminal</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={cx("inline-flex h-9 items-center gap-2 rounded-full bg-base-elevated px-3 font-mono text-[10px]", providerHealth.stale ? "text-base-amber" : "text-base-mint")}><Activity size={12} />{providerHealth.status === "refreshing" ? "Checking source" : providerHealth.stale ? "Delayed data" : "Heartbeat healthy"}</span>
            <AlertCenter snapshot={snapshotData} selectedPair={selectedPairWithLiveChart} signals={pulseSignals} />
          </div>
        </div>

        <LivePulseStrip snapshot={snapshotData} signals={pulseSignals} onSelect={handleSelectPairById} />
        <OpportunityStream snapshot={snapshotData} signals={pulseSignals} sinceLastSignals={sinceLastSignals} onSelect={handleSelectPairById} isPairPinned={isPairPinned} onTogglePin={togglePinnedPair} />

        <section className="grid min-w-0 grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1fr)_300px] 2xl:grid-cols-[minmax(0,1fr)_320px]">
          <section className="min-w-0 space-y-3">
            <MarketDiscovery
              snapshot={snapshotData}
              selectedPair={selectedPairWithLiveChart}
              recentPairIds={recentPairIds}
              onSelect={handleSelectPairById}
              isPairPinned={isPairPinned}
              onTogglePin={togglePinnedPair}
              pendingUpdateCount={pendingSnapshot?.changedPairIds.length ?? 0}
              onApplyPendingUpdates={() => pendingSnapshot && applySnapshot(pendingSnapshot)}
              onRefresh={() => void refreshProviderSnapshot()}
              refreshStatus={providerHealth.status}
              onInteractionChange={setInteractionLocked}
              updatedPairIds={lastAppliedChangedPairIds}
            />

            <section className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(270px,2fr)]" aria-label="Market workspace">
              <SelectedPairPanel pair={selectedPairWithLiveChart} marketDataMode={snapshotData.mode} chartRefreshStatus={chartRefreshStatus[getChartCacheKey(selectedPairWithLiveChart)] ?? "idle"} onRefreshChart={refreshPairChart} />
              <MarketActivityPanel pair={selectedPairWithLiveChart} signals={pulseSignals} snapshot={snapshotData} />
            </section>

            <PairDetailTabs pair={selectedPairWithLiveChart} activeTab={activeTab} onTabChange={setActiveTab} providerStale={providerHealth.stale} />
          </section>

          <div className="min-w-0 xl:sticky xl:top-[64px]">
            <SwapTicket pair={selectedPairWithLiveChart} marketDataMode={snapshotData.mode} amount={amount} onAmountChange={setAmount} />
          </div>
        </section>
      </div>
    </main>
  );
}
