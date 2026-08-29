"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import {
  BASE_CHAIN_ID,
  ReadOnlyWalletController,
  type WalletControllerState,
  type WalletControllerStatus,
  type WalletProviderOption
} from "@/lib/wallet";

export type WalletStatus = WalletControllerStatus;

type WalletContextValue = {
  status: WalletStatus;
  address?: string;
  chainId?: number;
  balanceEth?: string;
  error?: string;
  providers: WalletProviderOption[];
  selectedProviderId?: string;
  providerAvailable: boolean;
  wrongNetwork: boolean;
  selectProvider: (providerId: string) => void;
  connect: () => Promise<void>;
  switchToBase: () => Promise<void>;
  disconnect: () => void;
};

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
  const controllerRef = useRef<ReadOnlyWalletController | null>(null);
  if (!controllerRef.current) controllerRef.current = new ReadOnlyWalletController();
  const controller = controllerRef.current;
  const [state, setState] = useState<WalletControllerState>(() => controller.getState());

  useEffect(() => {
    const unsubscribe = controller.subscribe(setState);
    controller.start();
    return () => {
      unsubscribe();
      controller.stop();
    };
  }, [controller]);

  const selectProvider = useCallback((providerId: string) => controller.selectProvider(providerId), [controller]);
  const connect = useCallback(() => controller.connect(), [controller]);
  const switchToBase = useCallback(() => controller.switchToBase(), [controller]);
  const disconnect = useCallback(() => controller.disconnect(), [controller]);

  const value = useMemo<WalletContextValue>(
    () => ({
      ...state,
      providerAvailable: state.providers.length > 0,
      wrongNetwork: Boolean(state.address && state.chainId !== BASE_CHAIN_ID),
      selectProvider,
      connect,
      switchToBase,
      disconnect
    }),
    [connect, disconnect, selectProvider, state, switchToBase]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) throw new Error("useWallet must be used inside WalletProvider");
  return context;
}
