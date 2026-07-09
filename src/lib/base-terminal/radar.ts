import type { PinnedPair } from "@/components/TerminalSearchContext";
import { formatCompactCurrency } from "@/lib/format";
import type { BasePair } from "@/types/baseTerminal";

export type RadarSort =
  | "feed"
  | "liquidity-desc"
  | "volume-desc"
  | "change-desc"
  | "change-asc"
  | "newest"
  | "oldest";

export type RadarPreset = "fresh" | "liquid" | "momentum" | "volatile" | "watched";

export type RadarState = {
  minLiquidityUsd: number;
  minVolume24hUsd: number;
  maxAgeMinutes: number | undefined;
  minChange24h: number | undefined;
  maxChange24h: number | undefined;
  onlyPinned: boolean;
  hideStale: boolean;
  sort: RadarSort;
};

export const RADAR_FILTER_STORAGE_KEY = "base-terminal-lite:radar-filters";

export const DEFAULT_RADAR_STATE: RadarState = {
  minLiquidityUsd: 0,
  minVolume24hUsd: 0,
  maxAgeMinutes: undefined,
  minChange24h: undefined,
  maxChange24h: undefined,
  onlyPinned: false,
  hideStale: false,
  sort: "feed"
};

export const RADAR_SORT_OPTIONS: Array<{ value: RadarSort; label: string }> = [
  { value: "feed", label: "Default" },
  { value: "liquidity-desc", label: "Liquidity" },
  { value: "volume-desc", label: "Volume" },
  { value: "change-desc", label: "24h Up" },
  { value: "change-asc", label: "24h Down" },
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" }
];

export const RADAR_LIQUIDITY_OPTIONS = [0, 10_000, 50_000, 100_000, 500_000];
export const RADAR_VOLUME_OPTIONS = [0, 5_000, 10_000, 50_000, 100_000];
export const RADAR_AGE_OPTIONS: Array<{ value: number | undefined; label: string }> = [
  { value: undefined, label: "Any" },
  { value: 60, label: "1h" },
  { value: 24 * 60, label: "24h" },
  { value: 7 * 24 * 60, label: "7d" },
  { value: 30 * 24 * 60, label: "30d" }
];

export function getInitialRadarState() {
  const urlState = readRadarStateFromUrl();

  if (urlState) {
    return urlState;
  }

  if (isReadOnlyDemoUrl()) {
    return DEFAULT_RADAR_STATE;
  }

  return readRadarStateFromStorage() ?? DEFAULT_RADAR_STATE;
}

export function readRadarStateFromUrl() {
  if (typeof window === "undefined") {
    return undefined;
  }

  const params = new URLSearchParams(window.location.search);
  const hasRadarParam = hasRadarUrlParam(params);

  if (!hasRadarParam) {
    return undefined;
  }

  return normalizeRadarState({
    minLiquidityUsd: toOptionalNumber(params.get("rliq")) ?? 0,
    minVolume24hUsd: toOptionalNumber(params.get("rvol")) ?? 0,
    maxAgeMinutes: toOptionalNumber(params.get("rage")),
    minChange24h: toOptionalNumber(params.get("rmin")),
    maxChange24h: toOptionalNumber(params.get("rmax")),
    onlyPinned: params.get("rpin") === "1",
    hideStale: params.get("rhide") === "1",
    sort: parseRadarSort(params.get("rsort") ?? "feed")
  });
}

function hasRadarUrlParam(params: URLSearchParams) {
  return ["rliq", "rvol", "rage", "rmin", "rmax", "rpin", "rhide", "rsort"].some((key) =>
    params.has(key)
  );
}

function isReadOnlyDemoUrl() {
  if (typeof window === "undefined") {
    return false;
  }

  const params = new URLSearchParams(window.location.search);

  return params.get("data") === "dexscreener" && !hasRadarUrlParam(params);
}

export function readRadarStateFromStorage() {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    const rawValue = window.localStorage.getItem(RADAR_FILTER_STORAGE_KEY);
    const parsedValue = rawValue ? (JSON.parse(rawValue) as unknown) : undefined;

    return normalizeRadarState(parsedValue);
  } catch {
    return undefined;
  }
}

export function writeRadarStateToUrl(state: RadarState) {
  if (typeof window === "undefined") {
    return;
  }

  const nextUrl = new URL(window.location.href);

  for (const key of ["rliq", "rvol", "rage", "rmin", "rmax", "rpin", "rhide", "rsort"]) {
    nextUrl.searchParams.delete(key);
  }

  if (state.minLiquidityUsd > 0) {
    nextUrl.searchParams.set("rliq", String(state.minLiquidityUsd));
  }

  if (state.minVolume24hUsd > 0) {
    nextUrl.searchParams.set("rvol", String(state.minVolume24hUsd));
  }

  if (state.maxAgeMinutes !== undefined) {
    nextUrl.searchParams.set("rage", String(state.maxAgeMinutes));
  }

  if (state.minChange24h !== undefined) {
    nextUrl.searchParams.set("rmin", String(state.minChange24h));
  }

  if (state.maxChange24h !== undefined) {
    nextUrl.searchParams.set("rmax", String(state.maxChange24h));
  }

  if (state.onlyPinned) {
    nextUrl.searchParams.set("rpin", "1");
  }

  if (state.hideStale) {
    nextUrl.searchParams.set("rhide", "1");
  }

  if (state.sort !== "feed") {
    nextUrl.searchParams.set("rsort", state.sort);
  }

  const nextPath = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;

  if (nextPath !== currentPath) {
    window.history.replaceState(window.history.state, "", nextPath);
  }
}

export function normalizeRadarState(value: unknown): RadarState | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as Partial<RadarState>;

  return {
    minLiquidityUsd: getNonNegativeNumber(candidate.minLiquidityUsd),
    minVolume24hUsd: getNonNegativeNumber(candidate.minVolume24hUsd),
    maxAgeMinutes: getPositiveNumber(candidate.maxAgeMinutes),
    minChange24h: getFiniteOptionalNumber(candidate.minChange24h),
    maxChange24h: getFiniteOptionalNumber(candidate.maxChange24h),
    onlyPinned: Boolean(candidate.onlyPinned),
    hideStale: Boolean(candidate.hideStale),
    sort: parseRadarSort(candidate.sort)
  };
}

export function getRadarPresetState(preset: RadarPreset): RadarState {
  if (preset === "fresh") {
    return { ...DEFAULT_RADAR_STATE, maxAgeMinutes: 24 * 60, sort: "newest" };
  }

  if (preset === "liquid") {
    return {
      ...DEFAULT_RADAR_STATE,
      minLiquidityUsd: 100_000,
      minVolume24hUsd: 10_000,
      sort: "liquidity-desc"
    };
  }

  if (preset === "momentum") {
    return {
      ...DEFAULT_RADAR_STATE,
      minVolume24hUsd: 10_000,
      minChange24h: 5,
      sort: "change-desc"
    };
  }

  if (preset === "volatile") {
    return {
      ...DEFAULT_RADAR_STATE,
      minVolume24hUsd: 5_000,
      maxChange24h: -5,
      sort: "change-asc"
    };
  }

  return { ...DEFAULT_RADAR_STATE, onlyPinned: true, sort: "volume-desc" };
}

export function pairMatchesRadarState(
  pair: BasePair,
  state: RadarState,
  isPairPinned: (pair: BasePair) => boolean
) {
  if (state.hideStale && pair.stale) {
    return false;
  }

  if (state.onlyPinned && !isPairPinned(pair)) {
    return false;
  }

  if (pair.liquidity < state.minLiquidityUsd || pair.volume24h < state.minVolume24hUsd) {
    return false;
  }

  if (state.maxAgeMinutes !== undefined && !pairHasMaxAge(pair, state.maxAgeMinutes)) {
    return false;
  }

  if (state.minChange24h !== undefined && pair.change24h < state.minChange24h) {
    return false;
  }

  if (state.maxChange24h !== undefined && pair.change24h > state.maxChange24h) {
    return false;
  }

  return true;
}

export function pinnedPairMatchesRadarState(pair: PinnedPair, state: RadarState) {
  if (state.hideStale && pair.stale) {
    return false;
  }

  if (pair.liquidity < state.minLiquidityUsd || pair.volume24h < state.minVolume24hUsd) {
    return false;
  }

  if (state.minChange24h !== undefined && pair.change24h < state.minChange24h) {
    return false;
  }

  if (state.maxChange24h !== undefined && pair.change24h > state.maxChange24h) {
    return false;
  }

  return true;
}

export function sortRadarPairs(pairs: BasePair[], sort: RadarSort) {
  if (sort === "feed") {
    return pairs;
  }

  return [...pairs].sort((left, right) => compareRadarPairs(left, right, sort));
}

export function sortPinnedPairs(pairs: PinnedPair[], sort: RadarSort) {
  if (sort === "feed" || sort === "newest" || sort === "oldest") {
    return pairs;
  }

  return [...pairs].sort((left, right) => comparePinnedPairs(left, right, sort));
}

export function hasActiveRadarFilters(state: RadarState) {
  return (
    state.minLiquidityUsd > 0 ||
    state.minVolume24hUsd > 0 ||
    state.maxAgeMinutes !== undefined ||
    state.minChange24h !== undefined ||
    state.maxChange24h !== undefined ||
    state.onlyPinned ||
    state.hideStale
  );
}

export function parseRadarSort(value: unknown): RadarSort {
  return RADAR_SORT_OPTIONS.some((option) => option.value === value)
    ? (value as RadarSort)
    : "feed";
}

export function toOptionalNumber(value: unknown) {
  if (value === "" || value === undefined || value === null) {
    return undefined;
  }

  const parsed =
    typeof value === "number" ? value : Number.parseFloat(String(value).replace(/,/g, ""));

  return Number.isFinite(parsed) ? parsed : undefined;
}

export function getRadarOptionLabel(value: number) {
  return value === 0 ? "Any" : formatCompactCurrency(value);
}

function compareRadarPairs(left: BasePair, right: BasePair, sort: RadarSort) {
  if (sort === "liquidity-desc") {
    return right.liquidity - left.liquidity;
  }

  if (sort === "volume-desc") {
    return right.volume24h - left.volume24h;
  }

  if (sort === "change-desc") {
    return right.change24h - left.change24h;
  }

  if (sort === "change-asc") {
    return left.change24h - right.change24h;
  }

  if (sort === "newest") {
    return getSortableAge(left) - getSortableAge(right);
  }

  if (sort === "oldest") {
    return getSortableAge(right) - getSortableAge(left);
  }

  return 0;
}

function comparePinnedPairs(left: PinnedPair, right: PinnedPair, sort: RadarSort) {
  if (sort === "liquidity-desc") {
    return right.liquidity - left.liquidity;
  }

  if (sort === "volume-desc") {
    return right.volume24h - left.volume24h;
  }

  if (sort === "change-desc") {
    return right.change24h - left.change24h;
  }

  if (sort === "change-asc") {
    return left.change24h - right.change24h;
  }

  return 0;
}

function pairHasMaxAge(pair: BasePair, maxAgeMinutes: number) {
  const age = getSortableAge(pair);
  return Number.isFinite(age) && age <= maxAgeMinutes;
}

function getSortableAge(pair: BasePair) {
  if (pair.ageMinutes > 0 && pair.ageMinutes < 999_999) {
    return pair.ageMinutes;
  }

  if (pair.pairCreatedAtMs && pair.pairCreatedAtMs > 0) {
    return Math.max(1, Math.floor((Date.now() - pair.pairCreatedAtMs) / 60_000));
  }

  return Number.POSITIVE_INFINITY;
}

function getNonNegativeNumber(value: unknown) {
  const parsed = toOptionalNumber(value);
  return parsed !== undefined && parsed > 0 ? parsed : 0;
}

function getPositiveNumber(value: unknown) {
  const parsed = toOptionalNumber(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
}

function getFiniteOptionalNumber(value: unknown) {
  const parsed = toOptionalNumber(value);
  return parsed !== undefined ? parsed : undefined;
}
