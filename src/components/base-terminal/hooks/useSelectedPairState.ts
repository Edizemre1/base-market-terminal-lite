import { useCallback, useEffect, useState } from "react";
import type { MarketTerminalSnapshot } from "@/data/providers";
import { getPairFromParam } from "@/lib/base-terminal/pairs";

export function useSelectedPairState({
  initialSnapshot,
  snapshotData,
  snapshotRef,
  initialPairParam
}: {
  initialSnapshot: MarketTerminalSnapshot;
  snapshotData: MarketTerminalSnapshot;
  snapshotRef: { current: MarketTerminalSnapshot };
  initialPairParam?: string;
}) {
  const [selectedPairId, setSelectedPairId] = useState(
    () => getPairFromParam(initialSnapshot.allPairs, initialPairParam)?.id ?? initialSnapshot.defaultPairId
  );

  useEffect(() => {
    const nextPair =
      getPairFromParam(snapshotData.allPairs, initialPairParam) ??
      snapshotData.allPairs.find((pair) => pair.id === selectedPairId) ??
      snapshotData.allPairs.find((pair) => pair.id === snapshotData.defaultPairId) ??
      snapshotData.allPairs[0];

    if (nextPair && nextPair.id !== selectedPairId) {
      setSelectedPairId(nextPair.id);
    }
  }, [snapshotData.allPairs, snapshotData.defaultPairId, initialPairParam, selectedPairId]);

  const handleSelectPairById = useCallback(
    (pairId: string) => {
      const nextPair = snapshotRef.current.allPairs.find((pair) => pair.id === pairId);

      if (!nextPair) {
        return;
      }

      setSelectedPairId(nextPair.id);
    },
    [snapshotRef]
  );

  const selectedPair =
    snapshotData.allPairs.find((pair) => pair.id === selectedPairId) ?? snapshotData.allPairs[0];

  return {
    selectedPairId,
    selectedPair,
    handleSelectPairById
  };
}
