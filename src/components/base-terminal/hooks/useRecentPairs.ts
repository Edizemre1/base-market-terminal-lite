import { useEffect, useState } from "react";
import { safeGetStorageItem, safeSetStorageItem } from "@/lib/safeStorage";

const RECENT_PAIRS_STORAGE_KEY = "base-terminal-lite:recent-pairs";

export function useRecentPairs(selectedPairId: string | undefined) {
  const [recentPairIds, setRecentPairIds] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setRecentPairIds(readRecentPairs());
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded || !selectedPairId || typeof window === "undefined") {
      return;
    }

    setRecentPairIds((current) => {
      const next = [selectedPairId, ...current.filter((id) => id !== selectedPairId)].slice(0, 20);
      safeSetStorageItem(RECENT_PAIRS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, [loaded, selectedPairId]);

  return recentPairIds;
}

function readRecentPairs() {
  if (typeof window === "undefined") return [];

  try {
    const value = JSON.parse(safeGetStorageItem(RECENT_PAIRS_STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= 128 && !/[\u0000-\u001f\u007f]/.test(item)).slice(0, 20)
      : [];
  } catch {
    return [];
  }
}
