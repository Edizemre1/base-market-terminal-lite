"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { useChartData } from "@/components/base-terminal/hooks/useChartData";
import { useRadarFilters } from "@/components/base-terminal/hooks/useRadarFilters";
import { useSelectedPairState } from "@/components/base-terminal/hooks/useSelectedPairState";
import { PairDetailTabs } from "@/components/base-terminal/PairDetailTabs";
import { OpportunityFeed, PinnedPairsPanel } from "@/components/base-terminal/RadarFeedColumn";
import { RadarFilterPanel } from "@/components/base-terminal/RadarFilters";
import { SelectedPairPanel } from "@/components/base-terminal/SelectedPairPanel";
import { SwapTicket } from "@/components/base-terminal/SwapPreviewPanel";
import type { DetailTab } from "@/components/base-terminal/types";
import {
  useTerminalSearch,
  type ProviderHealthState
} from "@/components/TerminalSearchContext";
import type { MarketTerminalSnapshot } from "@/data/providers";
import {
  DEFAULT_RADAR_STATE,
  pairMatchesRadarState,
  pinnedPairMatchesRadarState,
  sortPinnedPairs,
  sortRadarPairs
} from "@/lib/base-terminal/radar";
import { getChartCacheKey } from "@/lib/base-terminal/pairs";
import {
  buildProviderHealth,
  preserveSelectedPair,
  shouldKeepCurrentSnapshotOnRefresh
} from "@/lib/base-terminal/providerHealth";
import type { BasePair } from "@/types/baseTerminal";

const SNAPSHOT_REFRESH_MS = 60_000;

export function BaseTerminal({
  data,
  initialPairParam
}: {
  data: MarketTerminalSnapshot;
  initialPairParam?: string;
}) {
  const {
    registerPairs,
    registerProviderHealth,
    registerSelectedPair,
    registerSelectPairHandler,
    pinnedPairs,
    isPairPinned,
    togglePinnedPair,
    unpinPinnedPair
  } = useTerminalSearch();
  const [snapshotData, setSnapshotData] = useState(data);
  const [activeTab, setActiveTab] = useState<DetailTab>("risk");
  const [amount, setAmount] = useState("0.10");
  const [providerHealth, setProviderHealth] = useState<ProviderHealthState>(() =>
    buildProviderHealth(data, "idle")
  );
  const { radarState, setRadarState, radarFiltersActive } = useRadarFilters();
  const snapshotRef = useRef(snapshotData);
  const { selectedPair, handleSelectPairById } = useSelectedPairState({
    initialSnapshot: data,
    snapshotData,
    snapshotRef,
    initialPairParam
  });
  const selectedPairRef = useRef<BasePair | undefined>(undefined);
  const snapshotRefreshInFlightRef = useRef(false);
  const snapshotRefreshRequestIdRef = useRef(0);
  const { chartOverrides, chartRefreshStatus, refreshPairChart } = useChartData(snapshotRef);

  useEffect(() => {
    setSnapshotData(data);
    setProviderHealth(buildProviderHealth(data, "idle"));
  }, [data]);

  useEffect(() => {
    snapshotRef.current = snapshotData;
  }, [snapshotData]);

  const selectedPairWithChart = useMemo(
    () =>
      selectedPair
        ? {
            ...selectedPair,
            ...chartOverrides[getChartCacheKey(selectedPair)]
          }
        : undefined,
    [chartOverrides, selectedPair]
  );
  const amountNumber = Number.parseFloat(amount);
  const cleanAmount = Number.isFinite(amountNumber) && amountNumber > 0 ? amountNumber : 0;
  const filteredNewPairs = useMemo(
    () =>
      sortRadarPairs(
        snapshotData.newPairs.filter((pair) => pairMatchesRadarState(pair, radarState, isPairPinned)),
        radarState.sort
      ),
    [isPairPinned, radarState, snapshotData.newPairs]
  );
  const filteredVolumeInflows = useMemo(
    () =>
      sortRadarPairs(
        snapshotData.volumeInflows.filter((pair) =>
          pairMatchesRadarState(pair, radarState, isPairPinned)
        ),
        radarState.sort
      ),
    [isPairPinned, radarState, snapshotData.volumeInflows]
  );
  const filteredMomentumPairs = useMemo(
    () =>
      sortRadarPairs(
        snapshotData.momentumPairs.filter((pair) =>
          pairMatchesRadarState(pair, radarState, isPairPinned)
        ),
        radarState.sort
      ),
    [isPairPinned, radarState, snapshotData.momentumPairs]
  );
  const filteredPinnedPairs = useMemo(
    () =>
      sortPinnedPairs(
        pinnedPairs.filter((pair) => pinnedPairMatchesRadarState(pair, radarState)),
        radarState.sort
      ),
    [pinnedPairs, radarState]
  );
  const selectedPairOutsideFilter = selectedPairWithChart
    ? !pairMatchesRadarState(selectedPairWithChart, radarState, isPairPinned)
    : false;

  const refreshProviderSnapshot = useCallback(async () => {
    if (snapshotRefreshInFlightRef.current) {
      return;
    }

    const requestId = snapshotRefreshRequestIdRef.current + 1;
    snapshotRefreshRequestIdRef.current = requestId;
    snapshotRefreshInFlightRef.current = true;
    setProviderHealth((current) =>
      current
        ? { ...current, status: "refreshing", failureReason: undefined }
        : buildProviderHealth(snapshotRef.current, "refreshing")
    );

    try {
      const mode = snapshotRef.current.mode === "dexscreener" ? "dexscreener" : "mock";
      const response = await fetch(`/api/market-snapshot?data=${mode}`, {
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error("Snapshot refresh failed");
      }

      const nextSnapshot = (await response.json()) as MarketTerminalSnapshot;

      if (snapshotRefreshRequestIdRef.current !== requestId) {
        return;
      }

      if (shouldKeepCurrentSnapshotOnRefresh(snapshotRef.current, nextSnapshot)) {
        throw new Error("Provider returned fallback-only refresh");
      }

      const snapshotWithSelection = preserveSelectedPair(nextSnapshot, selectedPairRef.current);
      setSnapshotData(snapshotWithSelection);
      setProviderHealth(buildProviderHealth(snapshotWithSelection, "idle"));
    } catch {
      if (snapshotRefreshRequestIdRef.current === requestId) {
        setProviderHealth((current) =>
          current
            ? {
                ...current,
                status: "failed",
                stale: true,
                failureReason: "Refresh failed; using last good data."
              }
            : buildProviderHealth(
                snapshotRef.current,
                "failed",
                "Refresh failed; using last good data."
              )
        );
      }
    } finally {
      if (snapshotRefreshRequestIdRef.current === requestId) {
        snapshotRefreshInFlightRef.current = false;
      }
    }
  }, []);

  useEffect(() => {
    registerPairs(snapshotData.allPairs);

    return () => registerPairs([]);
  }, [snapshotData.allPairs, registerPairs]);

  useEffect(() => {
    registerProviderHealth(providerHealth);

    return () => registerProviderHealth(undefined);
  }, [providerHealth, registerProviderHealth]);

  useEffect(() => {
    registerSelectedPair(selectedPairWithChart?.id);

    return () => registerSelectedPair(undefined);
  }, [registerSelectedPair, selectedPairWithChart?.id]);

  useEffect(() => {
    selectedPairRef.current = selectedPairWithChart;
  }, [selectedPairWithChart]);

  useEffect(() => {
    registerSelectPairHandler(handleSelectPairById);

    return () => registerSelectPairHandler(undefined);
  }, [handleSelectPairById, registerSelectPairHandler]);

  useEffect(() => {
    if (!selectedPair) {
      return;
    }

    void refreshPairChart(selectedPair);
  }, [refreshPairChart, selectedPair]);

  useEffect(() => {
    if (snapshotData.mode !== "dexscreener") {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshProviderSnapshot();
    }, SNAPSHOT_REFRESH_MS);

    return () => window.clearInterval(intervalId);
  }, [refreshProviderSnapshot, snapshotData.mode]);

  const estimatedOutput = useMemo(() => {
    if (!selectedPairWithChart) {
      return 0;
    }

    const base = selectedPairWithChart.liquidity / Math.max(selectedPairWithChart.riskScore, 1);
    return cleanAmount * base * selectedPairWithChart.volumeMultiple;
  }, [cleanAmount, selectedPairWithChart]);

  if (!selectedPairWithChart) {
    return (
      <main className="min-h-[calc(100vh-40px)] w-full overflow-x-hidden bg-base-black p-2 xl:h-[calc(100vh-40px)] xl:min-h-0 xl:overflow-hidden">
        <section className="border border-base-line bg-base-panel p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-base-muted">
            Mergen.finance
          </p>
          <p className="mt-2 font-mono text-sm text-base-text">
            No demo pairs are available from the active read-only provider.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="flex min-h-[calc(100vh-40px)] w-full flex-col overflow-x-hidden bg-base-black p-2 xl:h-[calc(100vh-40px)] xl:min-h-0 xl:overflow-hidden">
      {snapshotData.fallbackReason ? (
        <div className="mb-2 shrink-0 border border-base-amber/45 bg-base-amber/10 px-2 py-1.5 font-mono text-[10px] tracking-[0.12em] text-base-amber">
          {snapshotData.fallbackReason}
        </div>
      ) : null}
      <section className="grid min-w-0 grid-cols-1 gap-2.5 xl:min-h-0 xl:flex-1 xl:grid-cols-[280px_minmax(0,1fr)_400px] xl:overflow-hidden 2xl:grid-cols-[300px_minmax(0,1fr)_410px]">
        <aside className="min-w-0 space-y-2 xl:grid xl:min-h-0 xl:grid-rows-[auto_minmax(76px,0.55fr)_repeat(3,minmax(0,1fr))] xl:gap-2 xl:space-y-0 xl:overflow-hidden">
          <RadarFilterPanel
            state={radarState}
            onChange={setRadarState}
            onReset={() => setRadarState(DEFAULT_RADAR_STATE)}
          />
          <PinnedPairsPanel
            pairs={filteredPinnedPairs}
            selectedPairId={selectedPairWithChart.id}
            onSelect={handleSelectPairById}
            onUnpin={unpinPinnedPair}
            filtersActive={radarFiltersActive}
          />
          <OpportunityFeed
            id="new-pairs"
            title="New Pairs"
            marker="A"
            kind="new"
            pairs={filteredNewPairs}
            showFallbackLabels={snapshotData.mode === "dexscreener"}
            selectedPairId={selectedPairWithChart.id}
            onSelect={handleSelectPairById}
            isPairPinned={isPairPinned}
            onTogglePin={togglePinnedPair}
          />
          <OpportunityFeed
            title="Volume Inflow"
            marker="B"
            kind="inflow"
            pairs={filteredVolumeInflows}
            showFallbackLabels={snapshotData.mode === "dexscreener"}
            selectedPairId={selectedPairWithChart.id}
            onSelect={handleSelectPairById}
            isPairPinned={isPairPinned}
            onTogglePin={togglePinnedPair}
          />
          <OpportunityFeed
            title="Momentum"
            marker="C"
            kind="momentum"
            pairs={filteredMomentumPairs}
            showFallbackLabels={snapshotData.mode === "dexscreener"}
            selectedPairId={selectedPairWithChart.id}
            onSelect={handleSelectPairById}
            isPairPinned={isPairPinned}
            onTogglePin={togglePinnedPair}
          />
        </aside>

        <section className="min-w-0 space-y-2 xl:grid xl:min-h-0 xl:grid-rows-[minmax(0,1fr)_minmax(132px,0.28fr)] xl:gap-2 xl:space-y-0 xl:overflow-hidden">
          <SelectedPairPanel
            pair={selectedPairWithChart}
            marketDataMode={snapshotData.mode}
            outsideCurrentFilter={selectedPairOutsideFilter}
            chartRefreshStatus={
              chartRefreshStatus[getChartCacheKey(selectedPairWithChart)] ?? "idle"
            }
            onRefreshChart={refreshPairChart}
          />
          <PairDetailTabs
            pair={selectedPairWithChart}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            providerStale={providerHealth.stale}
          />
        </section>

        <SwapTicket
          pair={selectedPairWithChart}
          marketDataMode={snapshotData.mode}
          amount={amount}
          onAmountChange={setAmount}
          estimatedOutput={estimatedOutput}
        />
      </section>
    </main>
  );
}
