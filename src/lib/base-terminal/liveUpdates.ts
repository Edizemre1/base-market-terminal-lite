export const FOREGROUND_REFRESH_MS = 12_000;
export const BACKGROUND_REFRESH_MS = 60_000;

export function getSnapshotRefreshCadence(visibility: "visible" | "hidden") {
  return visibility === "visible" ? FOREGROUND_REFRESH_MS : BACKGROUND_REFRESH_MS;
}

export function shouldQueueMarketUpdate(changedPairCount: number, interactionLocked: boolean) {
  return changedPairCount > 0 || interactionLocked;
}
