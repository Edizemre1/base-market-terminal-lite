export const BASE_CHAIN_ID = 8453;
export const BASE_CHAIN_ID_HEX = "0x2105";

export type Eip1193Request = {
  method: string;
  params?: unknown[] | Record<string, unknown>;
};

export type Eip1193Provider = {
  request: (request: Eip1193Request) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

export type Eip6963ProviderInfo = {
  uuid: string;
  name: string;
  icon?: string;
  rdns?: string;
};

export type WalletProviderOption = {
  id: string;
  name: string;
  provider: Eip1193Provider;
  source: "eip6963" | "legacy";
  icon?: string;
  rdns?: string;
  compatibility: "verified" | "eip1193" | "unverified";
};

export type WalletErrorCode = "cancelled" | "pending" | "unreachable" | "unsupported-base";

export type ReadOnlyWalletSnapshot = {
  address?: string;
  chainId?: number;
  balanceEth?: string;
};

export type WalletControllerStatus =
  | "checking"
  | "unavailable"
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export type WalletControllerState = ReadOnlyWalletSnapshot & {
  status: WalletControllerStatus;
  error?: string;
  errorCode?: WalletErrorCode;
  providers: WalletProviderOption[];
  selectedProviderId?: string;
};

type WalletDiscoveryTarget = EventTarget & { ethereum?: Eip1193Provider };
type ControllerListener = (state: WalletControllerState) => void;
type Eip6963Announcement = Event & {
  detail?: { info?: Eip6963ProviderInfo; provider?: Eip1193Provider };
};

const INITIAL_CONTROLLER_STATE: WalletControllerState = {
  status: "checking",
  providers: []
};

/**
 * One read-only state machine is shared by every wallet surface. Provider
 * events never make provider requests synchronously. MetaMask can emit
 * accountsChanged while eth_requestAccounts is still on the stack; requesting
 * chain or balance in that handler is re-entrant and can overflow wrapped
 * injected providers. Events update cheap state and enqueue one reconciliation
 * after the current provider call has unwound.
 */
export class ReadOnlyWalletController {
  private state: WalletControllerState = INITIAL_CONTROLLER_STATE;
  private readonly subscribers = new Set<ControllerListener>();
  private discoveryTarget?: WalletDiscoveryTarget;
  private selectedProvider?: Eip1193Provider;
  private selectedProviderId?: string;
  private connectPromise?: Promise<void>;
  private switchPromise?: Promise<void>;
  private reconcilePromise?: Promise<void>;
  private reconcileQueued = false;
  private started = false;
  private preferredProviderId?: string;

  private readonly handleAnnouncement = (event: Event) => {
    const announcement = event as Eip6963Announcement;
    const info = announcement.detail?.info;
    const provider = announcement.detail?.provider;
    if (!info || !provider || typeof provider.request !== "function") return;

    this.addProvider({
      id: `eip6963:${info.uuid}`,
      name: info.name || "Injected wallet",
      provider,
      source: "eip6963",
      icon: readSafeWalletIcon(info.icon),
      rdns: info.rdns,
      compatibility: classifyWalletCompatibility(info.name, info.rdns, "eip6963")
    });
  };

  private readonly handleAccountsChanged = (...args: unknown[]) => {
    const address = readFirstAddress(args[0]);
    this.patchState(
      address
        ? { status: "connected", address, balanceEth: undefined, error: undefined }
        : { status: "disconnected", address: undefined, balanceEth: undefined, error: undefined }
    );
    this.queueReconcile();
  };

  private readonly handleChainChanged = (...args: unknown[]) => {
    this.patchState({ chainId: parseChainId(args[0]), error: undefined });
    this.queueReconcile();
  };

  private readonly handleConnect = (...args: unknown[]) => {
    const payload = args[0];
    const chainId =
      payload && typeof payload === "object" && "chainId" in payload
        ? parseChainId(payload.chainId)
        : undefined;
    if (chainId !== undefined) this.patchState({ chainId, error: undefined });
    this.queueReconcile();
  };

  private readonly handleDisconnect = () => {
    this.patchState({
      status: "disconnected",
      address: undefined,
      balanceEth: undefined,
      error: undefined
    });
  };

  getState() {
    return this.state;
  }

  subscribe(listener: ControllerListener) {
    this.subscribers.add(listener);
    listener(this.state);
    return () => this.subscribers.delete(listener);
  }

  start(
    target: WalletDiscoveryTarget = window as Window & WalletDiscoveryTarget,
    preferredProviderId?: string
  ) {
    if (this.started && this.discoveryTarget === target) return;

    this.stop();
    this.started = true;
    this.preferredProviderId = preferredProviderId;
    this.discoveryTarget = target;
    this.setState({ ...INITIAL_CONTROLLER_STATE });
    target.addEventListener("eip6963:announceProvider", this.handleAnnouncement);
    target.dispatchEvent(new Event("eip6963:requestProvider"));

    const legacyProvider = target.ethereum;
    if (legacyProvider && typeof legacyProvider.request === "function") {
      this.addProvider({
        id: "legacy:injected",
        name: readLegacyProviderName(legacyProvider),
        provider: legacyProvider,
        source: "legacy",
        compatibility: classifyWalletCompatibility(readLegacyProviderName(legacyProvider), undefined, "legacy")
      });
    }

    if (this.state.providers.length === 0) this.patchState({ status: "unavailable" });
    else if (!this.selectedProvider) this.patchState({ status: "disconnected" });
  }

  stop() {
    this.discoveryTarget?.removeEventListener("eip6963:announceProvider", this.handleAnnouncement);
    this.detachProviderListeners();
    this.discoveryTarget = undefined;
    this.started = false;
    this.preferredProviderId = undefined;
    this.reconcileQueued = false;
  }

  selectProvider(providerId: string) {
    const option = this.state.providers.find((provider) => provider.id === providerId);
    if (!option || option.provider === this.selectedProvider) return;

    this.bindProvider(option);
    this.patchState({
      selectedProviderId: option.id,
      status: "disconnected",
      address: undefined,
      chainId: undefined,
      balanceEth: undefined,
      error: undefined,
      errorCode: undefined
    });
  }

  connect() {
    if (this.connectPromise) return this.connectPromise;

    const provider = this.selectedProvider;
    if (!provider) {
      this.patchState({
        status: "unavailable",
        error: "Install or select a compatible wallet to connect.",
        errorCode: "unreachable"
      });
      return Promise.resolve();
    }

    this.patchState({ status: "connecting", error: undefined });
    const operation = (async () => {
      let connected = false;
      try {
        const next = await requestWalletConnection(provider);
        if (provider === this.selectedProvider) {
          this.applySnapshot(next);
          connected = true;
        }
      } catch (requestError) {
        if (provider === this.selectedProvider) {
          this.patchState({ status: "error", error: getWalletErrorMessage(requestError), errorCode: getWalletErrorCode(requestError) });
        }
      } finally {
        this.connectPromise = undefined;
        this.reconcileQueued = false;
        if (connected) this.queueReconcile();
      }
    })();

    this.connectPromise = operation;
    return operation;
  }

  switchToBase() {
    if (this.switchPromise) return this.switchPromise;

    const provider = this.selectedProvider;
    if (!provider) {
      this.patchState({
        status: "unavailable",
        error: "Install or select a compatible wallet to connect.",
        errorCode: "unreachable"
      });
      return Promise.resolve();
    }

    const selectedOption = this.state.providers.find((option) => option.id === this.selectedProviderId);
    if (selectedOption?.compatibility !== "verified") {
      this.patchState({ error: "This wallet does not support Base.", errorCode: "unsupported-base" });
      return Promise.resolve();
    }

    this.patchState({ error: undefined });
    const operation = (async () => {
      let switched = false;
      try {
        await switchWalletToBase(provider);
        const next = await readConnectedWallet(provider);
        if (provider === this.selectedProvider) {
          this.applySnapshot({ ...next, chainId: BASE_CHAIN_ID });
          switched = true;
        }
      } catch (requestError) {
        if (provider === this.selectedProvider) {
          this.patchState({ error: getWalletErrorMessage(requestError), errorCode: getWalletErrorCode(requestError) });
        }
      } finally {
        this.switchPromise = undefined;
        this.reconcileQueued = false;
        if (switched) this.queueReconcile();
      }
    })();

    this.switchPromise = operation;
    return operation;
  }

  disconnect() {
    this.patchState({
      status: this.selectedProvider ? "disconnected" : "unavailable",
      address: undefined,
      balanceEth: undefined,
      error: undefined,
      errorCode: undefined
    });
  }

  private addProvider(option: WalletProviderOption) {
    const duplicate = this.state.providers.find(
      (existing) => existing.id === option.id || existing.provider === option.provider
    );
    if (duplicate) return;

    this.patchState({
      providers: [...this.state.providers, option],
      status: this.selectedProvider ? this.state.status : "disconnected"
    });
    if (!this.selectedProvider && option.id === this.preferredProviderId && option.compatibility !== "unverified") {
      this.bindProvider(option);
      this.patchState({ selectedProviderId: option.id, status: "checking" });
      this.queueReconcile();
    }
  }

  private bindProvider(option: WalletProviderOption) {
    this.detachProviderListeners();
    this.selectedProvider = option.provider;
    this.selectedProviderId = option.id;
    option.provider.on?.("accountsChanged", this.handleAccountsChanged);
    option.provider.on?.("chainChanged", this.handleChainChanged);
    option.provider.on?.("connect", this.handleConnect);
    option.provider.on?.("disconnect", this.handleDisconnect);
  }

  private detachProviderListeners() {
    const provider = this.selectedProvider;
    if (!provider) return;

    provider.removeListener?.("accountsChanged", this.handleAccountsChanged);
    provider.removeListener?.("chainChanged", this.handleChainChanged);
    provider.removeListener?.("connect", this.handleConnect);
    provider.removeListener?.("disconnect", this.handleDisconnect);
    this.selectedProvider = undefined;
    this.selectedProviderId = undefined;
  }

  private queueReconcile() {
    if (!this.started || !this.selectedProvider) return;
    if (this.reconcileQueued || this.connectPromise || this.switchPromise) {
      this.reconcileQueued = true;
      return;
    }

    this.reconcileQueued = true;
    queueMicrotask(() => {
      this.reconcileQueued = false;
      if (this.connectPromise || this.switchPromise) {
        this.reconcileQueued = true;
        return;
      }
      void this.reconcile();
    });
  }

  private reconcile() {
    if (this.reconcilePromise) return this.reconcilePromise;
    const provider = this.selectedProvider;
    if (!provider) return Promise.resolve();

    const operation = (async () => {
      try {
        const next = await readConnectedWallet(provider);
        if (provider === this.selectedProvider) this.applySnapshot(next);
      } catch {
        if (provider === this.selectedProvider) this.patchState({ status: "disconnected" });
      } finally {
        this.reconcilePromise = undefined;
        if (this.reconcileQueued) {
          this.reconcileQueued = false;
          this.queueReconcile();
        }
      }
    })();

    this.reconcilePromise = operation;
    return operation;
  }

  private applySnapshot(next: ReadOnlyWalletSnapshot) {
    this.patchState({
      ...next,
      status: next.address ? "connected" : "disconnected",
      error: undefined,
      errorCode: undefined
    });
  }

  private patchState(patch: Partial<WalletControllerState>) {
    this.setState({ ...this.state, ...patch });
  }

  private setState(next: WalletControllerState) {
    this.state = {
      ...next,
      providers: next.providers ?? this.state.providers,
      selectedProviderId: next.selectedProviderId ?? this.selectedProviderId
    };
    for (const listener of this.subscribers) listener(this.state);
  }
}

export function getInjectedWalletProvider(): Eip1193Provider | undefined {
  if (typeof window === "undefined") return undefined;
  const candidate = (window as Window & { ethereum?: Eip1193Provider }).ethereum;
  return candidate && typeof candidate.request === "function" ? candidate : undefined;
}

export async function readConnectedWallet(provider: Eip1193Provider): Promise<ReadOnlyWalletSnapshot> {
  const [accountsValue, chainValue] = await Promise.all([
    provider.request({ method: "eth_accounts" }),
    provider.request({ method: "eth_chainId" })
  ]);
  const address = readFirstAddress(accountsValue);
  const chainId = parseChainId(chainValue);
  return { address, chainId, balanceEth: address ? await readWalletBalance(provider, address) : undefined };
}

export async function requestWalletConnection(provider: Eip1193Provider): Promise<ReadOnlyWalletSnapshot> {
  const accountsValue = await provider.request({ method: "eth_requestAccounts" });
  const address = readFirstAddress(accountsValue);
  if (!address) throw new Error("Wallet account unavailable");
  const chainId = parseChainId(await provider.request({ method: "eth_chainId" }));
  return { address, chainId, balanceEth: await readWalletBalance(provider, address) };
}

export async function readWalletBalance(provider: Eip1193Provider, address: string) {
  const value = await provider.request({ method: "eth_getBalance", params: [address, "latest"] });
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) return undefined;
  return formatWei(BigInt(value));
}

export async function switchWalletToBase(provider: Eip1193Provider) {
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BASE_CHAIN_ID_HEX }] });
  } catch (error) {
    if (readProviderErrorCode(error) !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId: BASE_CHAIN_ID_HEX, chainName: "Base Mainnet", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://mainnet.base.org"], blockExplorerUrls: ["https://basescan.org"] }]
    });
  }
}

export function parseChainId(value: unknown) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Number.parseInt(value, value.startsWith("0x") ? 16 : 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

export function readFirstAddress(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  return value.find((item): item is string => typeof item === "string" && /^0x[0-9a-f]{40}$/i.test(item));
}

export function shortenWalletAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function getWalletErrorMessage(error: unknown) {
  const code = readProviderErrorCode(error);
  if (code === 4001) return "Connection request was rejected. You can try again when ready.";
  if (code === -32_002) return "A wallet connection request is already open. Complete or close it, then retry.";
  return "The wallet could not complete this request. Try again or choose another wallet.";
}

export function getWalletErrorCode(error: unknown): WalletErrorCode {
  const code = readProviderErrorCode(error);
  if (code === 4001) return "cancelled";
  if (code === -32_002) return "pending";
  return "unreachable";
}

export function getWalletDiagnostic(error: unknown) {
  return {
    category: error instanceof RangeError ? "provider-recursion" : readProviderErrorCode(error) === 4001 ? "user-rejected" : "provider-request-failed",
    code: readProviderErrorCode(error)
  };
}

function formatWei(value: bigint) {
  const weiPerEth = BigInt("1000000000000000000");
  const whole = value / weiPerEth;
  const fraction = (value % weiPerEth).toString().padStart(18, "0").slice(0, 4);
  return `${whole}.${fraction}`.replace(/\.0+$/, "");
}

function readProviderErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  return typeof error.code === "number" ? error.code : Number(error.code);
}

function readLegacyProviderName(provider: Eip1193Provider) {
  const flags = provider as Eip1193Provider & { isMetaMask?: boolean; isCoinbaseWallet?: boolean; isRabby?: boolean; isKeplr?: boolean };
  if (flags.isRabby) return "Rabby";
  if (flags.isCoinbaseWallet) return "Coinbase Wallet";
  if (flags.isMetaMask) return "MetaMask";
  if (flags.isKeplr) return "Keplr";
  return "Injected wallet";
}

export function classifyWalletCompatibility(
  name: string,
  rdns: string | undefined,
  source: WalletProviderOption["source"]
): WalletProviderOption["compatibility"] {
  const identity = `${name} ${rdns ?? ""}`.toLowerCase();
  if (/keplr|cosmos/.test(identity)) return "unverified";
  if (/metamask|coinbase|rabby|io\.metamask|com\.coinbase|io\.rabby/.test(identity)) return "verified";
  return source === "eip6963" ? "eip1193" : "unverified";
}

function readSafeWalletIcon(icon: string | undefined) {
  return icon?.startsWith("data:image/") ? icon : undefined;
}
