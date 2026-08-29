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

export type ReadOnlyWalletSnapshot = {
  address?: string;
  chainId?: number;
  balanceEth?: string;
};

export function getInjectedWalletProvider(): Eip1193Provider | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  const candidate = (window as Window & { ethereum?: Eip1193Provider }).ethereum;
  return candidate && typeof candidate.request === "function" ? candidate : undefined;
}

export async function readConnectedWallet(
  provider: Eip1193Provider
): Promise<ReadOnlyWalletSnapshot> {
  const [accountsValue, chainValue] = await Promise.all([
    provider.request({ method: "eth_accounts" }),
    provider.request({ method: "eth_chainId" })
  ]);
  const address = readFirstAddress(accountsValue);
  const chainId = parseChainId(chainValue);

  return {
    address,
    chainId,
    balanceEth: address ? await readWalletBalance(provider, address) : undefined
  };
}

export async function requestWalletConnection(
  provider: Eip1193Provider
): Promise<ReadOnlyWalletSnapshot> {
  const accountsValue = await provider.request({ method: "eth_requestAccounts" });
  const address = readFirstAddress(accountsValue);

  if (!address) {
    throw new Error("Wallet did not return an account.");
  }

  const chainId = parseChainId(await provider.request({ method: "eth_chainId" }));
  return {
    address,
    chainId,
    balanceEth: await readWalletBalance(provider, address)
  };
}

export async function readWalletBalance(provider: Eip1193Provider, address: string) {
  const value = await provider.request({
    method: "eth_getBalance",
    params: [address, "latest"]
  });

  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) {
    return undefined;
  }

  return formatWei(BigInt(value));
}

export async function switchWalletToBase(provider: Eip1193Provider) {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BASE_CHAIN_ID_HEX }]
    });
  } catch (error) {
    if (readProviderErrorCode(error) !== 4902) {
      throw error;
    }

    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: BASE_CHAIN_ID_HEX,
          chainName: "Base Mainnet",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://mainnet.base.org"],
          blockExplorerUrls: ["https://basescan.org"]
        }
      ]
    });
  }
}

export function parseChainId(value: unknown) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const parsed = Number.parseInt(value, value.startsWith("0x") ? 16 : 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

export function readFirstAddress(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const address = value.find(
    (item): item is string => typeof item === "string" && /^0x[0-9a-f]{40}$/i.test(item)
  );
  return address;
}

export function shortenWalletAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function getWalletErrorMessage(error: unknown) {
  if (readProviderErrorCode(error) === 4001) {
    return "Connection request was rejected in the wallet.";
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Wallet request failed. Please try again.";
}

function formatWei(value: bigint) {
  const weiPerEth = BigInt("1000000000000000000");
  const whole = value / weiPerEth;
  const fraction = (value % weiPerEth).toString().padStart(18, "0").slice(0, 4);
  return `${whole}.${fraction}`.replace(/\.0+$/, "");
}

function readProviderErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return undefined;
  }

  return typeof error.code === "number" ? error.code : Number(error.code);
}
