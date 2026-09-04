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
  type WalletProviderOption,
  type WalletSimulationResult
} from "@/lib/wallet";
import type { TransactionDraft } from "@/lib/trade/types";
import { WalletPicker } from "@/components/WalletPicker";
import { safeGetStorageItem, safeRemoveStorageItem, safeSetStorageItem } from "@/lib/safeStorage";
import { useOverlayManager } from "@/components/OverlayManager";

export type WalletStatus = WalletControllerStatus;

type WalletContextValue = {
  ready: boolean;
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
  readContract: (to: string, data: string) => Promise<string>;
  simulateTransaction: (draft: TransactionDraft) => Promise<WalletSimulationResult>;
  sendTransaction: (draft: TransactionDraft) => Promise<string>;
  readTransactionReceipt: (hash: string) => Promise<Record<string, unknown> | undefined>;
  pickerOpen: boolean;
  openPicker: () => void;
  closePicker: () => void;
};

export const WALLET_PROVIDER_STORAGE_KEY = "mergen-pulse:wallet-provider:v2";
const LEGACY_WALLET_PROVIDER_STORAGE_KEYS = ["mergen-pulse:wallet-provider:v1", "base-terminal-lite:wallet-provider"];

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
  const overlay = useOverlayManager();
  const controllerRef = useRef<ReadOnlyWalletController | null>(null);
  if (!controllerRef.current) controllerRef.current = new ReadOnlyWalletController();
  const controller = controllerRef.current;
  const [state, setState] = useState<WalletControllerState>(() => controller.getState());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const unsubscribe = controller.subscribe(setState);
    const preferredProviderId = readPreferredProviderId();
    controller.start(undefined, preferredProviderId);
    setReady(true);
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
    if (controller.getState().status === "connected") overlay.close();
  }, [controller, overlay]);
  const switchToBase = useCallback(() => controller.switchToBase(), [controller]);
  const disconnect = useCallback(() => controller.disconnect(), [controller]);
  const readContract = useCallback((to: string, data: string) => controller.readContract(to, data), [controller]);
  const simulateTransaction = useCallback((draft: TransactionDraft) => controller.simulateTransaction(draft), [controller]);
  const sendTransaction = useCallback((draft: TransactionDraft) => controller.sendTransaction(draft), [controller]);
  const readTransactionReceipt = useCallback((hash: string) => controller.readTransactionReceipt(hash), [controller]);
  const pickerOpen = overlay.active.type === "wallet_picker";
  const openPicker = useCallback(() => overlay.open("wallet_picker"), [overlay]);
  const closePicker = useCallback(() => overlay.close(), [overlay]);

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
      ready,
      ...state,
      providerAvailable: state.providers.length > 0,
      wrongNetwork: Boolean(state.address && state.chainId !== BASE_CHAIN_ID),
      selectProvider,
      connectProvider,
      connect,
      switchToBase,
      disconnect,
      readContract,
      simulateTransaction,
      sendTransaction,
      readTransactionReceipt,
      pickerOpen,
      openPicker,
      closePicker
    }),
    [closePicker, connect, connectProvider, disconnect, openPicker, pickerOpen, readContract, readTransactionReceipt, ready, selectProvider, sendTransaction, simulateTransaction, state, switchToBase]
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
