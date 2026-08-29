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
  getInjectedWalletProvider,
  getWalletErrorMessage,
  parseChainId,
  readConnectedWallet,
  readFirstAddress,
  readWalletBalance,
  requestWalletConnection,
  switchWalletToBase,
  type Eip1193Provider,
  type ReadOnlyWalletSnapshot
} from "@/lib/wallet";

export type WalletStatus =
  | "checking"
  | "unavailable"
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

type WalletContextValue = {
  status: WalletStatus;
  address?: string;
  chainId?: number;
  balanceEth?: string;
  error?: string;
  providerAvailable: boolean;
  wrongNetwork: boolean;
  connect: () => Promise<void>;
  switchToBase: () => Promise<void>;
  disconnect: () => void;
};

const WalletContext = createContext<WalletContextValue | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
  const providerRef = useRef<Eip1193Provider | undefined>(undefined);
  const [status, setStatus] = useState<WalletStatus>("checking");
  const [snapshot, setSnapshot] = useState<ReadOnlyWalletSnapshot>({});
  const [error, setError] = useState<string>();

  const applySnapshot = useCallback((next: ReadOnlyWalletSnapshot) => {
    setSnapshot(next);
    setStatus(next.address ? "connected" : "disconnected");
    setError(undefined);
  }, []);

  useEffect(() => {
    const provider = getInjectedWalletProvider();

    if (!provider) {
      setStatus("unavailable");
      return;
    }

    providerRef.current = provider;
    let active = true;

    const hydrate = async () => {
      try {
        const next = await readConnectedWallet(provider);
        if (active) applySnapshot(next);
      } catch {
        if (active) setStatus("disconnected");
      }
    };

    const handleAccountsChanged = async (...args: unknown[]) => {
      const address = readFirstAddress(args[0]);

      if (!address) {
        const chainId = parseChainId(await provider.request({ method: "eth_chainId" }).catch(() => undefined));
        applySnapshot({ chainId });
        return;
      }

      const [balanceEth, chainValue] = await Promise.all([
        readWalletBalance(provider, address).catch(() => undefined),
        provider.request({ method: "eth_chainId" }).catch(() => undefined)
      ]);
      applySnapshot({ address, chainId: parseChainId(chainValue), balanceEth });
    };
    const handleChainChanged = (...args: unknown[]) => {
      const chainId = parseChainId(args[0]);
      setSnapshot((current) => ({ ...current, chainId }));
      setError(undefined);
    };
    const handleDisconnect = () => applySnapshot({});

    provider.on?.("accountsChanged", handleAccountsChanged);
    provider.on?.("chainChanged", handleChainChanged);
    provider.on?.("disconnect", handleDisconnect);
    void hydrate();

    return () => {
      active = false;
      provider.removeListener?.("accountsChanged", handleAccountsChanged);
      provider.removeListener?.("chainChanged", handleChainChanged);
      provider.removeListener?.("disconnect", handleDisconnect);
    };
  }, [applySnapshot]);

  const connect = useCallback(async () => {
    const provider = providerRef.current ?? getInjectedWalletProvider();

    if (!provider) {
      setStatus("unavailable");
      setError("Install a compatible wallet to connect.");
      return;
    }

    providerRef.current = provider;
    setStatus("connecting");
    setError(undefined);

    try {
      applySnapshot(await requestWalletConnection(provider));
    } catch (requestError) {
      setStatus("error");
      setError(getWalletErrorMessage(requestError));
    }
  }, [applySnapshot]);

  const switchToBase = useCallback(async () => {
    const provider = providerRef.current;

    if (!provider) {
      setStatus("unavailable");
      setError("Install a compatible wallet to connect.");
      return;
    }

    setError(undefined);
    try {
      await switchWalletToBase(provider);
      const next = await readConnectedWallet(provider);
      applySnapshot({ ...next, chainId: BASE_CHAIN_ID });
    } catch (requestError) {
      setError(getWalletErrorMessage(requestError));
    }
  }, [applySnapshot]);

  const disconnect = useCallback(() => {
    setSnapshot({});
    setStatus(providerRef.current ? "disconnected" : "unavailable");
    setError(undefined);
  }, []);

  const value = useMemo<WalletContextValue>(
    () => ({
      status,
      address: snapshot.address,
      chainId: snapshot.chainId,
      balanceEth: snapshot.balanceEth,
      error,
      providerAvailable: status !== "unavailable",
      wrongNetwork: Boolean(snapshot.address && snapshot.chainId !== BASE_CHAIN_ID),
      connect,
      switchToBase,
      disconnect
    }),
    [connect, disconnect, error, snapshot, status, switchToBase]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const context = useContext(WalletContext);

  if (!context) {
    throw new Error("useWallet must be used inside WalletProvider");
  }

  return context;
}
