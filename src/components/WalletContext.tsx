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
import { WalletPicker } from "@/components/WalletPicker";
import { safeGetStorageItem, safeRemoveStorageItem, safeSetStorageItem } from "@/lib/safeStorage";

export type WalletStatus = WalletControllerStatus;

type WalletContextValue = {
  status: WalletStatus;
  address?: string;
  chainId?: number;
  balanceEth?: string;
  error?: string;
  errorCode?: WalletControllerState["errorCode"];
  providers: WalletProviderOption[];
  selectedProviderId?: string;
  providerAvailable: boolean;
  wrongNetwork: boolean;
  selectProvider: (providerId: string) => void;
  connectProvider: (providerId: string) => Promise<void>;
  connect: () => Promise<void>;
  switchToBase: () => Promise<void>;
  disconnect: () => void;
  pickerOpen: boolean;
  openPicker: () => void;
  closePicker: () => void;
};

export const WALLET_PROVIDER_STORAGE_KEY = "mergen-pulse:wallet-provider:v2";
const LEGACY_WALLET_PROVIDER_STORAGE_KEYS = ["mergen-pulse:wallet-provider:v1", "base-terminal-lite:wallet-provider"];

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
  const controllerRef = useRef<ReadOnlyWalletController | null>(null);
  if (!controllerRef.current) controllerRef.current = new ReadOnlyWalletController();
  const controller = controllerRef.current;
  const [state, setState] = useState<WalletControllerState>(() => controller.getState());
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    const unsubscribe = controller.subscribe(setState);
    const preferredProviderId = readPreferredProviderId();
    controller.start(undefined, preferredProviderId);
    const migrationTimer = window.setTimeout(() => {
      if (preferredProviderId && !controller.getState().providers.some((provider) => provider.id === preferredProviderId)) {
        safeRemoveStorageItem(WALLET_PROVIDER_STORAGE_KEY);
      }
    }, 500);
    return () => {
      window.clearTimeout(migrationTimer);
      unsubscribe();
      controller.stop();
    };
  }, [controller]);

  const selectProvider = useCallback((providerId: string) => controller.selectProvider(providerId), [controller]);
  const connect = useCallback(() => controller.connect(), [controller]);
  const connectProvider = useCallback(async (providerId: string) => {
    controller.selectProvider(providerId);
    await controller.connect();
    if (controller.getState().status === "connected") setPickerOpen(false);
  }, [controller]);
  const switchToBase = useCallback(() => controller.switchToBase(), [controller]);
  const disconnect = useCallback(() => controller.disconnect(), [controller]);
  const openPicker = useCallback(() => setPickerOpen(true), []);
  const closePicker = useCallback(() => setPickerOpen(false), []);

  useEffect(() => {
    if (state.status !== "connected" || !state.selectedProviderId) return;
    const selected = state.providers.find((provider) => provider.id === state.selectedProviderId);
    if (!selected || selected.compatibility === "unverified") return;
    safeSetStorageItem(WALLET_PROVIDER_STORAGE_KEY, JSON.stringify({
      id: selected.id,
      name: selected.name,
      rdns: selected.rdns,
      compatibility: selected.compatibility
    }));
  }, [state.providers, state.selectedProviderId, state.status]);

  const value = useMemo<WalletContextValue>(
    () => ({
      ...state,
      providerAvailable: state.providers.length > 0,
      wrongNetwork: Boolean(state.address && state.chainId !== BASE_CHAIN_ID),
      selectProvider,
      connectProvider,
      connect,
      switchToBase,
      disconnect,
      pickerOpen,
      openPicker,
      closePicker
    }),
    [closePicker, connect, connectProvider, disconnect, openPicker, pickerOpen, selectProvider, state, switchToBase]
  );

  return <WalletContext.Provider value={value}>{children}<WalletPicker /></WalletContext.Provider>;
}

function readPreferredProviderId() {
  if (typeof window === "undefined") return undefined;
  for (const key of LEGACY_WALLET_PROVIDER_STORAGE_KEYS) {
    const legacyValue = safeGetStorageItem(key);
    if (legacyValue !== null) safeRemoveStorageItem(key);
  }
  try {
    const raw = safeGetStorageItem(WALLET_PROVIDER_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { id?: unknown; name?: unknown; rdns?: unknown; compatibility?: unknown };
    const identity = `${String(parsed.id ?? "")} ${String(parsed.name ?? "")} ${String(parsed.rdns ?? "")}`.toLowerCase();
    if (identity.includes("keplr") || parsed.compatibility === "unverified" || typeof parsed.id !== "string" || !/^[\w:.-]{1,160}$/.test(parsed.id)) {
      safeRemoveStorageItem(WALLET_PROVIDER_STORAGE_KEY);
      return undefined;
    }
    return parsed.id;
  } catch {
    safeRemoveStorageItem(WALLET_PROVIDER_STORAGE_KEY);
    return undefined;
  }
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) throw new Error("useWallet must be used inside WalletProvider");
  return context;
}
