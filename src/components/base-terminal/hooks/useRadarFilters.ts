import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_RADAR_STATE,
  getInitialRadarState,
  hasActiveRadarFilters,
  RADAR_FILTER_STORAGE_KEY,
  writeRadarStateToUrl,
  type RadarState
} from "@/lib/base-terminal/radar";
import { safeSetStorageItem } from "@/lib/safeStorage";

export function useRadarFilters() {
  const [radarState, setRadarState] = useState<RadarState>(DEFAULT_RADAR_STATE);
  const [radarStateLoaded, setRadarStateLoaded] = useState(false);

  useEffect(() => {
    setRadarState(getInitialRadarState());
    setRadarStateLoaded(true);
  }, []);

  useEffect(() => {
    if (!radarStateLoaded || typeof window === "undefined") {
      return;
    }

    safeSetStorageItem(RADAR_FILTER_STORAGE_KEY, JSON.stringify(radarState));
    writeRadarStateToUrl(radarState);
  }, [radarState, radarStateLoaded]);

  const radarFiltersActive = useMemo(() => hasActiveRadarFilters(radarState), [radarState]);

  return {
    radarState,
    setRadarState,
    radarFiltersActive
  };
}
