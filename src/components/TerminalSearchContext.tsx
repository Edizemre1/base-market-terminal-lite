"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode
} from "react";
import type { BasePair } from "@/types/baseTerminal";

type SelectPairHandler = (pairId: string) => void;

type TerminalSearchContextValue = {
  pairs: BasePair[];
  selectedPairId: string | undefined;
  registerPairs: (pairs: BasePair[]) => void;
  registerSelectedPair: (pairId: string | undefined) => void;
  registerSelectPairHandler: (handler: SelectPairHandler | undefined) => void;
  selectPair: (pairId: string) => void;
};

const TerminalSearchContext = createContext<TerminalSearchContextValue | undefined>(undefined);

export function TerminalSearchProvider({ children }: { children: ReactNode }) {
  const [pairs, setPairs] = useState<BasePair[]>([]);
  const [selectedPairId, setSelectedPairId] = useState<string>();
  const [selectPairHandler, setSelectPairHandler] = useState<SelectPairHandler>();

  const registerPairs = useCallback((nextPairs: BasePair[]) => {
    setPairs(nextPairs);
  }, []);

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

  const value = useMemo(
    () => ({
      pairs,
      selectedPairId,
      registerPairs,
      registerSelectedPair,
      registerSelectPairHandler,
      selectPair
    }),
    [
      pairs,
      selectedPairId,
      registerPairs,
      registerSelectedPair,
      registerSelectPairHandler,
      selectPair
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
