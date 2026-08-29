import { useEffect, useState } from "react";

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
      window.localStorage.setItem(RECENT_PAIRS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, [loaded, selectedPairId]);

  return recentPairIds;
}

function readRecentPairs() {
  if (typeof window === "undefined") return [];

  try {
    const value = JSON.parse(window.localStorage.getItem(RECENT_PAIRS_STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string").slice(0, 20)
      : [];
  } catch {
    return [];
  }
}
