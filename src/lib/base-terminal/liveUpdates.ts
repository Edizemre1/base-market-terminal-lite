export const FOREGROUND_REFRESH_MS = 12_000;
export const BACKGROUND_REFRESH_MS = 60_000;
export const MAX_PENDING_OPPORTUNITY_UPDATES = 48;
export const UPDATE_AUTO_APPLY_QUIET_MS = 2_000;

export function getSnapshotRefreshCadence(visibility: "visible" | "hidden") {
  return visibility === "visible" ? FOREGROUND_REFRESH_MS : BACKGROUND_REFRESH_MS;
}

export function shouldQueueMarketUpdate(changedPairCount: number, interactionLocked: boolean) {
  return changedPairCount > 0 || interactionLocked;
}

export function coalescePendingOpportunityIds(existing: string[], incoming: string[], maximum = MAX_PENDING_OPPORTUNITY_UPDATES) {
  const next = new Map<string, string>();
  for (const id of [...existing, ...incoming]) {
    const normalized = id.trim();
    if (!normalized) continue;
    next.delete(normalized);
    next.set(normalized, normalized);
  }
  return [...next.values()].slice(-Math.max(1, maximum));
}

export function shouldAutoApplyPendingUpdate({ interactionLocked, overlayOpen, quietForMs }: { interactionLocked: boolean; overlayOpen: boolean; quietForMs: number }) {
  return !interactionLocked && !overlayOpen && quietForMs >= UPDATE_AUTO_APPLY_QUIET_MS;
}
