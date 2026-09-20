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
import { NATIVE_TOKEN_ADDRESS } from "@/lib/trade/types";
import { buildBalanceOfData, formatRawTokenAmount, isEvmAddress } from "@/lib/trade/validation";
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
  balanceWei?: string;
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
  refreshBalances: () => Promise<void>;
  readGasPrice: () => Promise<string>;
  readNativeBalance: () => Promise<string>;
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
  selectedToken?: WalletBalanceToken;
  setSelectedToken: (token: WalletBalanceToken | undefined) => void;
  trackedBalanceTokens: WalletBalanceToken[];
  tokenBalances: Record<string, WalletTokenBalanceState>;
};

export type WalletBalanceToken = { address: string; symbol: string; decimals?: number; decimalsVerified: boolean };
export type WalletTokenBalanceState = {
  status: "idle" | "loading" | "ready" | "stale" | "unavailable" | "metadata_unavailable";
  raw?: string;
  value?: string;
  updatedAt?: string;
};
export const BASE_ETH_BALANCE_TOKEN: WalletBalanceToken = { address: NATIVE_TOKEN_ADDRESS, symbol: "ETH", decimals: 18, decimalsVerified: true };
export const BASE_WETH_BALANCE_TOKEN: WalletBalanceToken = { address: "0x4200000000000000000000000000000000000006", symbol: "WETH", decimals: 18, decimalsVerified: true };
export const BASE_USDC_BALANCE_TOKEN: WalletBalanceToken = { address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC", decimals: 6, decimalsVerified: true };

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
  const [selectedToken, setSelectedTokenState] = useState<WalletBalanceToken>();
  const [tokenBalances, setTokenBalances] = useState<Record<string, WalletTokenBalanceState>>({});
  const tokenBalanceRequestRef = useRef(0);
  const trackedBalanceTokens = useMemo(() => dedupeBalanceTokens([BASE_WETH_BALANCE_TOKEN, BASE_USDC_BALANCE_TOKEN, selectedToken]), [selectedToken]);

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
  const readGasPrice = useCallback(() => controller.readGasPrice(), [controller]);
  const readNativeBalance = useCallback(() => controller.readNativeBalance(), [controller]);
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
  const setSelectedToken = useCallback((token: WalletBalanceToken | undefined) => {
    if (!token || !isEvmAddress(token.address)) {
      setSelectedTokenState(undefined);
      return;
    }
    setSelectedTokenState({ ...token, address: token.address.toLowerCase(), symbol: token.symbol.slice(0, 24) });
  }, []);

  useEffect(() => {
    tokenBalanceRequestRef.current += 1;
    setTokenBalances({});
  }, [state.address, state.chainId, state.selectedProviderId]);

  const refreshBalances = useCallback(async () => {
    const address = state.address;
    const providerId = state.selectedProviderId;
    const requestId = tokenBalanceRequestRef.current + 1;
    tokenBalanceRequestRef.current = requestId;
    if (!address || state.chainId !== BASE_CHAIN_ID || (state.status !== "connected" && state.status !== "wrong_network")) {
      setTokenBalances({});
      await controller.refreshBalance();
      return;
    }

    setTokenBalances(Object.fromEntries(trackedBalanceTokens.map((token) => [token.address, {
      status: token.decimals === undefined || !token.decimalsVerified ? "metadata_unavailable" : "loading"
    } satisfies WalletTokenBalanceState])));

    const [tokenResults] = await Promise.all([
      Promise.all(trackedBalanceTokens.map(async (token): Promise<readonly [string, WalletTokenBalanceState]> => {
        if (token.decimals === undefined || !token.decimalsVerified) return [token.address, { status: "metadata_unavailable" } satisfies WalletTokenBalanceState] as const;
        const data = buildBalanceOfData(address);
        if (!data) return [token.address, { status: "unavailable" } satisfies WalletTokenBalanceState] as const;
        try {
          const result = await controller.readContract(token.address, data);
          const raw = BigInt(result === "0x" ? "0x0" : result).toString();
          const value = formatRawTokenAmount(raw, token.decimals, Math.min(token.decimals, 8));
          return [token.address, value === undefined ? { status: "unavailable" } : { status: "ready", raw, value, updatedAt: new Date().toISOString() } satisfies WalletTokenBalanceState] as const;
        } catch {
          return [token.address, { status: "unavailable" } satisfies WalletTokenBalanceState] as const;
        }
      })),
      controller.refreshBalance()
    ]);

    const current = controller.getState();
    if (requestId !== tokenBalanceRequestRef.current || current.address?.toLowerCase() !== address.toLowerCase() || current.chainId !== BASE_CHAIN_ID || current.selectedProviderId !== providerId) return;
    setTokenBalances(Object.fromEntries(tokenResults) as Record<string, WalletTokenBalanceState>);
  }, [controller, state.address, state.chainId, state.selectedProviderId, state.status, trackedBalanceTokens]);

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
        refreshBalances,
        readGasPrice,
        readNativeBalance,
        disconnect,
        readContract,
        simulateTransaction,
        sendTransaction,
        readTransactionReceipt,
        pickerOpen,
        openPicker,
        closePicker,
        spendToken,
        setSpendToken,
        selectedToken,
        setSelectedToken,
        trackedBalanceTokens,
        tokenBalances
      };
    },
    [closePicker, connect, connectProvider, disconnect, openPicker, pickerOpen, readContract, readGasPrice, readNativeBalance, readTransactionReceipt, ready, refreshBalance, refreshBalances, selectProvider, selectedToken, sendTransaction, setSelectedToken, simulateTransaction, spendToken, state, switchToBase, tokenBalances, trackedBalanceTokens]
  );

  return <WalletContext.Provider value={value}>{children}<WalletPicker /></WalletContext.Provider>;
}

function dedupeBalanceTokens(tokens: Array<WalletBalanceToken | undefined>) {
  const seen = new Set<string>();
  return tokens.filter((token): token is WalletBalanceToken => {
    if (!token || token.address === NATIVE_TOKEN_ADDRESS) return false;
    const key = token.address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
