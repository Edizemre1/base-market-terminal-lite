"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { useChartData } from "@/components/base-terminal/hooks/useChartData";
import { useRecentPairs } from "@/components/base-terminal/hooks/useRecentPairs";
import { useSelectedPairState } from "@/components/base-terminal/hooks/useSelectedPairState";
import { MarketDiscovery } from "@/components/base-terminal/MarketDiscovery";
import { PairDetailTabs } from "@/components/base-terminal/PairDetailTabs";
import { SelectedPairPanel } from "@/components/base-terminal/SelectedPairPanel";
import { SwapTicket } from "@/components/base-terminal/SwapPreviewPanel";
import type { DetailTab } from "@/components/base-terminal/types";
import {
  useTerminalSearch,
  type ProviderHealthState
} from "@/components/TerminalSearchContext";
import type { MarketTerminalSnapshot } from "@/data/providers";
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
    isPairPinned,
    togglePinnedPair
  } = useTerminalSearch();
  const [snapshotData, setSnapshotData] = useState(data);
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const [amount, setAmount] = useState("0.10");
  const [providerHealth, setProviderHealth] = useState<ProviderHealthState>(() =>
    buildProviderHealth(data, "idle")
  );
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
  const recentPairIds = useRecentPairs(selectedPairWithChart?.id);

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

  if (!selectedPairWithChart) {
    return (
      <main className="min-h-[calc(100vh-48px)] w-full overflow-x-hidden bg-base-black p-3">
        <section className="rounded-sm border border-base-line bg-base-panel p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-base-muted">
            Mergen.finance
          </p>
          <p className="mt-2 font-mono text-sm text-base-text">
            Live market data is temporarily unavailable.
          </p>
          <p className="mt-2 max-w-xl text-[11px] leading-5 text-base-muted">
            No sample prices were substituted. Retry the read-only feed, or choose Mock only
            when you explicitly want to explore the interface with labeled sample data.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100vh-48px)] w-full overflow-x-hidden bg-base-black p-2.5 sm:p-3">
      {snapshotData.fallbackReason ? (
        <div className="mb-2 shrink-0 border border-base-amber/45 bg-base-amber/10 px-2 py-1.5 font-mono text-[10px] tracking-[0.12em] text-base-amber">
          {snapshotData.fallbackReason}
        </div>
      ) : null}
      <section className="grid min-w-0 grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="min-w-0 space-y-3">
          <MarketDiscovery
            snapshot={snapshotData}
            selectedPair={selectedPairWithChart}
            recentPairIds={recentPairIds}
            onSelect={handleSelectPairById}
            isPairPinned={isPairPinned}
            onTogglePin={togglePinnedPair}
          />
          <SelectedPairPanel
            pair={selectedPairWithChart}
            marketDataMode={snapshotData.mode}
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

        <div className="min-w-0 xl:sticky xl:top-[60px]">
          <SwapTicket
            pair={selectedPairWithChart}
            marketDataMode={snapshotData.mode}
            amount={amount}
            onAmountChange={setAmount}
          />
        </div>
      </section>
    </main>
  );
}
