import type { ProviderHealthState } from "@/components/TerminalSearchContext";
import type { MarketTerminalSnapshot } from "@/data/providers";
import { pairsRepresentSamePair } from "@/lib/base-terminal/pairs";
import type { BasePair } from "@/types/baseTerminal";

const SNAPSHOT_STALE_MS = 3 * 60_000;

export function buildProviderHealth(
  snapshot: MarketTerminalSnapshot,
  status: ProviderHealthState["status"],
  failureReason?: string
): ProviderHealthState {
  const lastSuccessAt = getSnapshotLastSuccessAt(snapshot);

  return {
    mode: snapshot.mode,
    providerName: snapshot.providerName,
    feedStatusLabel: snapshot.feedStatusLabel,
    status,
    lastSuccessAt,
    stale: status === "failed" || isSnapshotStale(lastSuccessAt),
    fallbackReason: snapshot.fallbackReason,
    failureReason
  };
}

export function preserveSelectedPair(
  snapshot: MarketTerminalSnapshot,
  selectedPair: BasePair | undefined
): MarketTerminalSnapshot {
  if (
    !selectedPair ||
    snapshot.allPairs.some((pair) => pairsRepresentSamePair(pair, selectedPair))
  ) {
    return snapshot;
  }

  return {
    ...snapshot,
    allPairs: [
      {
        ...selectedPair,
        stale: true,
        staleReason: "Not in latest provider snapshot"
      },
      ...snapshot.allPairs
    ]
  };
}

export function shouldKeepCurrentSnapshotOnRefresh(
  currentSnapshot: MarketTerminalSnapshot,
  nextSnapshot: MarketTerminalSnapshot
) {
  return (
    currentSnapshot.mode === "dexscreener" &&
    nextSnapshot.mode === "dexscreener" &&
    hasLiveProviderPairs(currentSnapshot) &&
    !hasLiveProviderPairs(nextSnapshot) &&
    Boolean(nextSnapshot.fallbackReason)
  );
}

function getSnapshotLastSuccessAt(snapshot: MarketTerminalSnapshot) {
  return snapshot.generatedAt === "mock-static" ? undefined : snapshot.generatedAt;
}

function isSnapshotStale(lastSuccessAt: string | undefined) {
  if (!lastSuccessAt) {
    return false;
  }

  const timestamp = new Date(lastSuccessAt);

  if (Number.isNaN(timestamp.getTime())) {
    return false;
  }

  return Date.now() - timestamp.getTime() > SNAPSHOT_STALE_MS;
}

function hasLiveProviderPairs(snapshot: MarketTerminalSnapshot) {
  return snapshot.allPairs.some((pair) => pair.dataSource === "dexscreener");
}
