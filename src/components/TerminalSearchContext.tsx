"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import type { FeedStatusLabel, MarketDataMode } from "@/data/providers/types";
import type { BasePair } from "@/types/baseTerminal";
import { safeGetStorageItem, safeSetStorageItem } from "@/lib/safeStorage";
import { sanitizeTokenLogoUrl } from "@/lib/safeUrl";

type SelectPairHandler = (pairId: string) => void;
const PINNED_PAIRS_STORAGE_KEY = "base-terminal-lite:pinned-pairs";

export type ProviderRefreshStatus = "idle" | "refreshing" | "failed";

export type ProviderHealthState = {
  mode: MarketDataMode;
  providerName: string;
  feedStatusLabel: FeedStatusLabel;
  status: ProviderRefreshStatus;
  lastSuccessAt?: string;
  stale: boolean;
  fallbackReason?: string;
  failureReason?: string;
};

export type PinnedPair = {
  key: string;
  pairIdentity: string;
  id?: string;
  pairAddress?: string;
  currentPairId?: string;
  tokenLogoUrl?: string;
  quoteTokenLogoUrl?: string;
  pair: string;
  baseToken: string;
  quoteToken: string;
  dex: string;
  price: string;
  priceUsd: string;
  change24h: number;
  volume24h: number;
  liquidity: number;
  dataSource?: "mock" | "dexscreener";
  stale: boolean;
};

type TerminalSearchContextValue = {
  pairs: BasePair[];
  pinnedPairs: PinnedPair[];
  providerHealth: ProviderHealthState | undefined;
  selectedPairId: string | undefined;
  registerPairs: (pairs: BasePair[]) => void;
  registerProviderHealth: (health: ProviderHealthState | undefined) => void;
  registerSelectedPair: (pairId: string | undefined) => void;
  registerSelectPairHandler: (handler: SelectPairHandler | undefined) => void;
  selectPair: (pairId: string) => void;
  isPairPinned: (pair: BasePair) => boolean;
  togglePinnedPair: (pair: BasePair) => void;
  unpinPinnedPair: (key: string) => void;
};

const TerminalSearchContext = createContext<TerminalSearchContextValue | undefined>(undefined);

export function TerminalSearchProvider({ children }: { children: ReactNode }) {
  const [pairs, setPairs] = useState<BasePair[]>([]);
  const [selectedPairId, setSelectedPairId] = useState<string>();
  const [selectPairHandler, setSelectPairHandler] = useState<SelectPairHandler>();
  const [providerHealth, setProviderHealth] = useState<ProviderHealthState>();
  const [pinnedSnapshots, setPinnedSnapshots] = useState<PinnedPair[]>([]);
  const [pinsLoaded, setPinsLoaded] = useState(false);

  useEffect(() => {
    setPinnedSnapshots(readPinnedPairs());
    setPinsLoaded(true);
  }, []);

  useEffect(() => {
    if (!pinsLoaded || typeof window === "undefined") {
      return;
    }

    safeSetStorageItem(
      PINNED_PAIRS_STORAGE_KEY,
      JSON.stringify(pinnedSnapshots.map(toStoredPinnedPair))
    );
  }, [pinnedSnapshots, pinsLoaded]);

  const registerPairs = useCallback((nextPairs: BasePair[]) => {
    setPairs(nextPairs);
  }, []);

  const registerProviderHealth = useCallback((health: ProviderHealthState | undefined) => {
    setProviderHealth(health);
  }, []);

  const pinnedPairs = useMemo(
    () =>
      pinnedSnapshots.map((savedPair) => {
        const currentPair = findCurrentPair(pairs, savedPair);

        if (!currentPair) {
          return { ...savedPair, currentPairId: undefined, stale: true };
        }

        return {
          ...toPinnedPair(currentPair),
          key: savedPair.key,
          stale: false
        };
      }),
    [pairs, pinnedSnapshots]
  );

  const registerSelectedPair = useCallback((pairId: string | undefined) => {
    setSelectedPairId(pairId);
  }, []);

  const registerSelectPairHandler = useCallback((handler: SelectPairHandler | undefined) => {
    setSelectPairHandler(() => handler);
  }, []);

  const selectPair = useCallback(
    (pairId: string) => {
      selectPairHandler?.(pairId);
    },
    [selectPairHandler]
  );

  const isPairPinned = useCallback(
    (pair: BasePair) => pinnedSnapshots.some((pinnedPair) => pairsMatchPinnedPair(pair, pinnedPair)),
    [pinnedSnapshots]
  );

  const togglePinnedPair = useCallback((pair: BasePair) => {
    setPinnedSnapshots((current) => {
      const existingIndex = current.findIndex((pinnedPair) =>
        pairsMatchPinnedPair(pair, pinnedPair)
      );

      if (existingIndex >= 0) {
        return current.filter((_, index) => index !== existingIndex);
      }

      return [toPinnedPair(pair), ...current].slice(0, 4);
    });
  }, []);

  const unpinPinnedPair = useCallback((key: string) => {
    setPinnedSnapshots((current) => current.filter((pair) => pair.key !== key));
  }, []);

  const value = useMemo(
    () => ({
      pairs,
      pinnedPairs,
      providerHealth,
      selectedPairId,
      registerPairs,
      registerProviderHealth,
      registerSelectedPair,
      registerSelectPairHandler,
      selectPair,
      isPairPinned,
      togglePinnedPair,
      unpinPinnedPair
    }),
    [
      pairs,
      pinnedPairs,
      providerHealth,
      selectedPairId,
      registerPairs,
      registerProviderHealth,
      registerSelectedPair,
      registerSelectPairHandler,
      selectPair,
      isPairPinned,
      togglePinnedPair,
      unpinPinnedPair
    ]
  );

  return (
    <TerminalSearchContext.Provider value={value}>
      {children}
    </TerminalSearchContext.Provider>
  );
}

export function useTerminalSearch() {
  const context = useContext(TerminalSearchContext);

  if (!context) {
    throw new Error("useTerminalSearch must be used inside TerminalSearchProvider");
  }

  return context;
}

function readPinnedPairs() {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const rawValue = safeGetStorageItem(PINNED_PAIRS_STORAGE_KEY);
    const parsedValue = rawValue ? (JSON.parse(rawValue) as unknown) : [];

    if (!Array.isArray(parsedValue)) {
      return [];
    }

    return parsedValue.slice(0, 4).map(normalizePinnedPair).filter((pair): pair is PinnedPair => Boolean(pair));
  } catch {
    return [];
  }
}

function normalizePinnedPair(value: unknown): PinnedPair | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as Partial<PinnedPair>;

  const key = readStoredText(candidate.key, 128);
  const pair = readStoredText(candidate.pair, 80);
  const baseToken = readStoredText(candidate.baseToken, 32);
  const quoteToken = readStoredText(candidate.quoteToken, 32);
  if (!key || !pair || !baseToken || !quoteToken || !isFiniteNumber(candidate.change24h) || !isFiniteNumber(candidate.volume24h) || !isFiniteNumber(candidate.liquidity)) {
    return undefined;
  }

  const pairAddress = readStoredText(candidate.pairAddress, 42);
  if (pairAddress && !/^0x[0-9a-f]{40}$/i.test(pairAddress)) return undefined;

  return {
    key,
    pairIdentity: normalizePairIdentity(readStoredText(candidate.pairIdentity, 128) ?? pair),
    id: readStoredText(candidate.id, 128),
    pairAddress,
    tokenLogoUrl: sanitizeTokenLogoUrl(candidate.tokenLogoUrl),
    quoteTokenLogoUrl: sanitizeTokenLogoUrl(candidate.quoteTokenLogoUrl),
    pair,
    baseToken,
    quoteToken,
    dex: readStoredText(candidate.dex, 64) ?? "Unknown",
    price: readStoredText(candidate.price, 64) ?? "N/A",
    priceUsd: readStoredText(candidate.priceUsd, 64) ?? "N/A",
    change24h: candidate.change24h,
    volume24h: candidate.volume24h,
    liquidity: candidate.liquidity,
    dataSource: candidate.dataSource === "mock" || candidate.dataSource === "dexscreener" ? candidate.dataSource : undefined,
    stale: true
  };
}

function toPinnedPair(pair: BasePair): PinnedPair {
  return {
    key: getPinnedPairKey(pair),
    pairIdentity: normalizePairIdentity(pair.pair),
    id: pair.id,
    pairAddress: pair.pairAddress,
    currentPairId: pair.id,
    tokenLogoUrl: pair.tokenLogoUrl,
    quoteTokenLogoUrl: pair.quoteTokenLogoUrl,
    pair: pair.pair,
    baseToken: pair.baseToken,
    quoteToken: pair.quoteToken,
    dex: pair.dexName ?? pair.dex,
    price: pair.price,
    priceUsd: pair.priceUsd,
    change24h: pair.change24h,
    volume24h: pair.volume24h,
    liquidity: pair.liquidity,
    dataSource: pair.dataSource,
    stale: false
  };
}

function toStoredPinnedPair(pair: PinnedPair) {
  return {
    key: pair.key,
    pairIdentity: pair.pairIdentity,
    id: pair.id,
    pairAddress: pair.pairAddress,
    tokenLogoUrl: pair.tokenLogoUrl,
    quoteTokenLogoUrl: pair.quoteTokenLogoUrl,
    pair: pair.pair,
    baseToken: pair.baseToken,
    quoteToken: pair.quoteToken,
    dex: pair.dex,
    price: pair.price,
    priceUsd: pair.priceUsd,
    change24h: pair.change24h,
    volume24h: pair.volume24h,
    liquidity: pair.liquidity,
    dataSource: pair.dataSource
  };
}

function findCurrentPair(pairs: BasePair[], pinnedPair: PinnedPair) {
  return pairs.find((pair) => !pair.stale && pairsMatchPinnedPair(pair, pinnedPair));
}

function pairsMatchPinnedPair(pair: BasePair, pinnedPair: PinnedPair) {
  const pairKey = getPinnedPairKey(pair);
  const pinnedKey = pinnedPair.key.toLowerCase();
  const pairAddressMatches =
    Boolean(pair.pairAddress && pinnedPair.pairAddress) &&
    pair.pairAddress?.toLowerCase() === pinnedPair.pairAddress?.toLowerCase();
  const idMatches = Boolean(pinnedPair.id) && pair.id === pinnedPair.id;

  if (pairAddressMatches || pairKey === pinnedKey) return true;
  if (pair.pairAddress && pinnedPair.pairAddress) return false;
  return idMatches || normalizePairIdentity(pair.pair) === pinnedPair.pairIdentity;
}

function getPinnedPairKey(pair: BasePair) {
  return pair.pairAddress?.toLowerCase() ?? pair.id;
}

function normalizePairIdentity(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readStoredText(value: unknown, maximumLength: number) {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return normalized ? normalized.slice(0, maximumLength) : undefined;
}
