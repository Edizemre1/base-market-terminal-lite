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
import dynamic from "next/dynamic";
import {
  BASE_CHAIN_ID,
  ReadOnlyWalletController,
  type WalletControllerState,
  type WalletControllerStatus,
  type WalletBalanceStatus,
  type WalletConnectionOrigin,
  type WalletProviderOption,
  type WalletSimulationResult
} from "@/lib/wallet";
import type { TransactionDraft } from "@/lib/trade/types";
import { safeGetStorageItem, safeRemoveStorageItem, safeSetStorageItem } from "@/lib/safeStorage";
import { useOverlayManager } from "@/components/OverlayManager";

const WalletPicker = dynamic(() => import("@/components/WalletPicker").then((module) => module.WalletPicker), { ssr: false });

export type WalletStatus = WalletControllerStatus;

type WalletContextValue = {
  ready: boolean;
  status: WalletStatus;
  address?: string;
  chainId?: number;
  balanceEth?: string;
  balanceStatus: WalletBalanceStatus;
  balanceUpdatedAt?: string;
  connectionOrigin?: WalletConnectionOrigin;
  error?: string;
  errorCode?: WalletControllerState["errorCode"];
  providers: WalletProviderOption[];
  selectedProviderId?: string;
  selectedProvider?: WalletProviderOption;
  providerAvailable: boolean;
  accountConnected: boolean;
  wrongNetwork: boolean;
  selectProvider: (providerId: string) => void;
  connectProvider: (providerId: string) => Promise<void>;
  connect: () => Promise<void>;
  switchToBase: () => Promise<void>;
  refreshBalance: () => Promise<void>;
  disconnect: () => void;
  readContract: (to: string, data: string) => Promise<string>;
  simulateTransaction: (draft: TransactionDraft) => Promise<WalletSimulationResult>;
  sendTransaction: (draft: TransactionDraft) => Promise<string>;
  readTransactionReceipt: (hash: string) => Promise<Record<string, unknown> | undefined>;
  pickerOpen: boolean;
  openPicker: () => void;
  closePicker: () => void;
  spendToken: WalletBalanceToken;
  setSpendToken: (token: WalletBalanceToken) => void;
};

export type WalletBalanceToken = { address: string; symbol: string; decimals: number };
export const BASE_USDC_BALANCE_TOKEN: WalletBalanceToken = { address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC", decimals: 6 };

export const WALLET_PROVIDER_STORAGE_KEY = "mergen-pulse:wallet-provider:v2";
const LEGACY_WALLET_PROVIDER_STORAGE_KEYS = ["mergen-pulse:wallet-provider:v1", "base-terminal-lite:wallet-provider"];
const LEGACY_WALLET_SESSION_STORAGE_KEYS = [
  "mergen-pulse:wallet-address",
  "mergen-pulse:wallet-connected",
  "mergen-pulse:wallet-session:v1",
  "base-terminal-lite:wallet-address",
  "base-terminal-lite:wallet-connected"
];

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
  const overlay = useOverlayManager();
  const controllerRef = useRef<ReadOnlyWalletController | null>(null);
  if (!controllerRef.current) controllerRef.current = new ReadOnlyWalletController();
  const controller = controllerRef.current;
  const [state, setState] = useState<WalletControllerState>(() => controller.getState());
  const [ready, setReady] = useState(false);
  const [spendToken, setSpendToken] = useState<WalletBalanceToken>(BASE_USDC_BALANCE_TOKEN);

  useEffect(() => {
    const unsubscribe = controller.subscribe(setState);
    const preferredProviderId = readPreferredProviderId();
    controller.start(undefined, preferredProviderId);
    setReady(true);
    const migrationTimer = window.setTimeout(() => {
      const current = controller.getState();
      if (preferredProviderId && !current.providers.some((provider) => provider.id === preferredProviderId)) {
        const canonicalProvider = current.providers.find((provider) => provider.id === current.selectedProviderId && provider.compatibility === "verified");
        if (canonicalProvider) safeSetStorageItem(WALLET_PROVIDER_STORAGE_KEY, serializeProviderPreference(canonicalProvider));
        else safeRemoveStorageItem(WALLET_PROVIDER_STORAGE_KEY);
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
    if (["connected", "wrong_network"].includes(controller.getState().status)) overlay.close();
  }, [controller, overlay]);
  const switchToBase = useCallback(() => controller.switchToBase(), [controller]);
  const refreshBalance = useCallback(() => controller.refreshBalance(), [controller]);
  const disconnect = useCallback(() => {
    controller.disconnect();
    overlay.close();
  }, [controller, overlay]);
  const readContract = useCallback((to: string, data: string) => controller.readContract(to, data), [controller]);
  const simulateTransaction = useCallback((draft: TransactionDraft) => controller.simulateTransaction(draft), [controller]);
  const sendTransaction = useCallback((draft: TransactionDraft) => controller.sendTransaction(draft), [controller]);
  const readTransactionReceipt = useCallback((hash: string) => controller.readTransactionReceipt(hash), [controller]);
  const pickerOpen = overlay.active.type === "wallet_picker";
  const openPicker = useCallback(() => overlay.open("wallet_picker"), [overlay]);
  const closePicker = useCallback(() => overlay.close(), [overlay]);

  useEffect(() => {
    if ((state.status !== "connected" && state.status !== "wrong_network") || !state.selectedProviderId) return;
    const selected = state.providers.find((provider) => provider.id === state.selectedProviderId);
    if (!selected || selected.compatibility !== "verified") return;
    safeSetStorageItem(WALLET_PROVIDER_STORAGE_KEY, serializeProviderPreference(selected));
  }, [state.providers, state.selectedProviderId, state.status]);

  const value = useMemo<WalletContextValue>(
    () => {
      const accountConnected = Boolean(state.address && (state.status === "connected" || state.status === "wrong_network"));
      return {
        ready,
        ...state,
        providerAvailable: state.providers.length > 0,
        selectedProvider: state.providers.find((provider) => provider.id === state.selectedProviderId),
        accountConnected,
        wrongNetwork: accountConnected && state.chainId !== BASE_CHAIN_ID,
        selectProvider,
        connectProvider,
        connect,
        switchToBase,
        refreshBalance,
        disconnect,
        readContract,
        simulateTransaction,
        sendTransaction,
        readTransactionReceipt,
        pickerOpen,
        openPicker,
        closePicker,
        spendToken,
        setSpendToken
      };
    },
    [closePicker, connect, connectProvider, disconnect, openPicker, pickerOpen, readContract, readTransactionReceipt, ready, refreshBalance, selectProvider, sendTransaction, simulateTransaction, spendToken, state, switchToBase]
  );

  return <WalletContext.Provider value={value}>{children}<WalletPicker /></WalletContext.Provider>;
}

function readPreferredProviderId() {
  if (typeof window === "undefined") return undefined;
  for (const key of LEGACY_WALLET_PROVIDER_STORAGE_KEYS) {
    const legacyValue = safeGetStorageItem(key);
    if (legacyValue !== null) safeRemoveStorageItem(key);
  }
  for (const key of LEGACY_WALLET_SESSION_STORAGE_KEYS) {
    if (safeGetStorageItem(key) !== null) safeRemoveStorageItem(key);
    try { window.sessionStorage.removeItem(key); } catch { /* storage can be unavailable */ }
  }
  try {
    const raw = safeGetStorageItem(WALLET_PROVIDER_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { id?: unknown; name?: unknown; rdns?: unknown; compatibility?: unknown };
    const identity = `${String(parsed.id ?? "")} ${String(parsed.name ?? "")} ${String(parsed.rdns ?? "")}`.toLowerCase();
    if (identity.includes("keplr") || parsed.compatibility !== "verified" || typeof parsed.id !== "string" || !/^[\w:.-]{1,160}$/.test(parsed.id)) {
      safeRemoveStorageItem(WALLET_PROVIDER_STORAGE_KEY);
      return undefined;
    }
    return parsed.id;
  } catch {
    safeRemoveStorageItem(WALLET_PROVIDER_STORAGE_KEY);
    return undefined;
  }
}

function serializeProviderPreference(provider: WalletProviderOption) {
  return JSON.stringify({
    id: provider.id,
    name: provider.name,
    rdns: provider.rdns,
    compatibility: provider.compatibility
  });
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) throw new Error("useWallet must be used inside WalletProvider");
  return context;
}
