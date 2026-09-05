"use client";

import type { MarketTerminalSnapshot } from "@/data/providers/types";

type SnapshotCacheEntry = { etag?: string; snapshot: MarketTerminalSnapshot };

const snapshotCache = new Map<string, SnapshotCacheEntry>();
const inFlightSnapshots = new Map<string, Promise<MarketTerminalSnapshot>>();

export function fetchTerminalSnapshot(url: string, signal?: AbortSignal) {
  const cacheKey = getSnapshotCacheKey(url);
  let request = inFlightSnapshots.get(url);
  if (!request) {
    const cached = snapshotCache.get(cacheKey);
    request = fetch(url, {
      cache: "no-cache",
      headers: cached?.etag ? { "If-None-Match": cached.etag } : undefined
    }).then(async (response) => {
      if (response.status === 304 && cached) return cached.snapshot;
      if (!response.ok) throw new Error("Snapshot refresh failed");
      const snapshot = await response.json() as MarketTerminalSnapshot;
      snapshotCache.set(cacheKey, { snapshot, etag: response.headers.get("etag") ?? undefined });
      return snapshot;
    }).finally(() => {
      inFlightSnapshots.delete(url);
    });
    inFlightSnapshots.set(url, request);
  }
  return withSubscriberAbort(request, signal);
}

export function resetTerminalSnapshotClientForTests() {
  snapshotCache.clear();
  inFlightSnapshots.clear();
}

function getSnapshotCacheKey(url: string) {
  const parsed = new URL(url, "http://terminal.local");
  return `${parsed.pathname}?data=${parsed.searchParams.get("data") ?? "dexscreener"}`;
}

function withSubscriberAbort<T>(request: Promise<T>, signal?: AbortSignal) {
  if (!signal) return request;
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    request.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
