import { expect, test } from "@playwright/test";
import {
  normalizeDexScreenerPair,
  parseDexPairList,
  parseDexSearchResponse,
  parseDexTokenProfiles
} from "../../src/data/providers/dexScreenerProvider";
import { parseGeckoTerminalOhlcvResponse } from "../../src/data/providers/chart/geckoTerminalChartProvider";
import {
  getMarketTerminalSnapshot,
  resolveUrlMarketDataMode
} from "../../src/data/providers";
import {
  DEFAULT_DISCOVERY_FILTERS,
  buildDiscoveryRows,
  calculateActivityScore
} from "../../src/lib/base-terminal/discovery";
import {
  ReadOnlyWalletController,
  classifyWalletCompatibility,
  getWalletErrorMessage,
  requestWalletConnection,
  switchWalletToBase,
  type Eip1193Provider
} from "../../src/lib/wallet";

const validDexPair = {
  chainId: "base",
  dexId: "uniswap",
  pairAddress: "0x1111111111111111111111111111111111111111",
  url: "https://dexscreener.com/base/0x1111111111111111111111111111111111111111",
  info: {
    imageUrl: "https://example.com/token.png"
  },
  baseToken: {
    address: "0x2222222222222222222222222222222222222222",
    name: "Fixture Token",
    symbol: "FIX"
  },
  quoteToken: {
    address: "0x3333333333333333333333333333333333333333",
    name: "Wrapped Ether",
    symbol: "WETH"
  },
  priceNative: "0.00042",
  priceUsd: "0.88",
  fdv: 1200000,
  marketCap: 890000,
  txns: {
    m5: { buys: 4, sells: 2 },
    h1: { buys: 40, sells: 21 },
    h6: { buys: 180, sells: 155 },
    h24: { buys: 510, sells: 433 }
  },
  volume: {
    m5: 1200,
    h1: 12000,
    h6: 54000,
    h24: 190000
  },
  priceChange: {
    m5: 0.4,
    h1: 2.1,
    h6: 8.2,
    h24: 14.6
  },
  liquidity: {
    usd: 250000,
    base: 120000,
    quote: 44
  },
  pairCreatedAt: Date.now() - 45 * 60 * 1000
};

test.describe("market data safety defaults", () => {
  test("defaults to read-only data and requires explicit sample selection", async () => {
    expect(resolveUrlMarketDataMode(undefined)).toBe("dexscreener");
    expect(resolveUrlMarketDataMode("mock")).toBe("mock");

    const sampleSnapshot = await getMarketTerminalSnapshot("mock");
    expect(sampleSnapshot.mode).toBe("mock");
    expect(sampleSnapshot.allPairs.length).toBeGreaterThan(0);
    expect(sampleSnapshot.allPairs.every((pair) => pair.dataSource === "mock")).toBeTruthy();
  });
});

test.describe("provider response fixture hardening", () => {
  test("normalizes valid DexScreener pairs into the internal pair model", () => {
    const pairs = parseDexSearchResponse({ pairs: [validDexPair] });
    const normalized = normalizeDexScreenerPair(pairs[0]);

    expect(pairs).toHaveLength(1);
    expect(normalized).toMatchObject({
      dataSource: "dexscreener",
      id: "0x1111111111111111111111111111111111111111",
      pair: "FIX / WETH",
      baseToken: "FIX",
      quoteToken: "WETH",
      dexName: "Uniswap",
      sourceUrl: "https://dexscreener.com/base/0x1111111111111111111111111111111111111111",
      tokenLogoUrl: undefined,
      volume24h: 190000,
      liquidity: 250000,
      change24h: 14.6,
      fdv: 1200000,
      marketCap: 890000
    });
    expect(normalized?.txns?.h24).toEqual({ buys: 510, sells: 433 });
    expect(normalized?.riskLabel).toBeUndefined();
    expect(normalized?.riskScore).toBeUndefined();
    expect(normalized?.pressure).toBeUndefined();
    expect(normalized?.flags).not.toContain("Derived/demo risk UI");
  });

  test("handles partial or missing DexScreener fields without throwing", () => {
    const partialPair = {
      chainId: "base",
      pairAddress: "0x4444444444444444444444444444444444444444",
      baseToken: { symbol: "PART" },
      priceUsd: "1.00",
      liquidity: {},
      volume: {}
    };

    expect(() => parseDexPairList([partialPair])).not.toThrow();
    expect(normalizeDexScreenerPair(partialPair)).toBeUndefined();
    expect(parseDexTokenProfiles([{ chainId: "base" }, null, "bad"])).toEqual([
      { chainId: "base", tokenAddress: undefined }
    ]);
  });

  test("handles empty and malformed DexScreener responses as empty data", () => {
    expect(parseDexSearchResponse({ pairs: [] })).toEqual([]);
    expect(parseDexSearchResponse({})).toEqual([]);
    expect(parseDexSearchResponse("not-json-object")).toEqual([]);
    expect(parseDexPairList([{ bad: "shape" }, null, "bad"])).toEqual([]);
    expect(normalizeDexScreenerPair("bad")).toBeUndefined();
  });

  test("sanitizes malformed provider URLs while keeping safe fallback links", () => {
    const normalized = normalizeDexScreenerPair({
      ...validDexPair,
      url: "javascript:alert(1)",
      pairAddress: "0x5555555555555555555555555555555555555555"
    });

    expect(normalized?.sourceUrl).toBe(
      "https://dexscreener.com/base/0x5555555555555555555555555555555555555555"
    );
  });

  test("normalizes partial GeckoTerminal OHLCV responses without live calls", () => {
    const candles = parseGeckoTerminalOhlcvResponse({
      data: {
        attributes: {
          ohlcv_list: [
            [1710000000, "1", "1.2", "0.8", "1.1", "1000"],
            ["bad"],
            [1710003600, 1.1, 0.9, 1.2, 1.0, 2000],
            [1710007200, 1.1, 1.3, 1, 1.2, -20]
          ]
        }
      }
    });

    expect(candles).toEqual([
      {
        timestamp: 1710000000,
        open: 1,
        high: 1.2,
        low: 0.8,
        close: 1.1,
        volume: 1000
      }
    ]);
    expect(parseGeckoTerminalOhlcvResponse({ data: {} })).toEqual([]);
    expect(parseGeckoTerminalOhlcvResponse("bad")).toEqual([]);
  });

  test("never substitutes FDV for a missing market cap", () => {
    const normalized = normalizeDexScreenerPair({ ...validDexPair, fdv: "1200000", marketCap: null });
    expect(normalized?.fdv).toBe(1_200_000);
    expect(normalized?.marketCap).toBeUndefined();
  });
});

test.describe("market discovery definitions", () => {
  test("sorts verified categories and excludes incomplete activity scores", () => {
    const first = normalizeDexScreenerPair(validDexPair)!;
    const second = normalizeDexScreenerPair({
      ...validDexPair,
      pairAddress: "0x6666666666666666666666666666666666666666",
      baseToken: { ...validDexPair.baseToken, address: "0x7777777777777777777777777777777777777777", symbol: "FAST" },
      priceChange: { ...validDexPair.priceChange, h24: 32 },
      volume: { ...validDexPair.volume, h24: 450000 },
      liquidity: { ...validDexPair.liquidity, usd: 500000 }
    })!;
    const incomplete = { ...first, id: "incomplete", priceChanges: { ...first.priceChanges, h24: undefined } };

    const gainers = buildDiscoveryRows({
      pairs: [first, second],
      category: "gainers",
      filters: DEFAULT_DISCOVERY_FILTERS,
      isPairPinned: () => false,
      recentPairIds: []
    });

    expect(gainers.map(({ pair }) => pair.baseToken)).toEqual(["FAST", "FIX"]);
    expect(calculateActivityScore(second)).toBeGreaterThan(0);
    expect(calculateActivityScore(incomplete)).toBeUndefined();
  });

  test("enforces explicit liquidity and volume filters without treating missing fields as zero", () => {
    const pair = normalizeDexScreenerPair(validDexPair)!;
    const rows = buildDiscoveryRows({
      pairs: [pair],
      category: "volume",
      filters: { ...DEFAULT_DISCOVERY_FILTERS, minLiquidity: 300000 },
      isPairPinned: () => false,
      recentPairIds: []
    });

    expect(rows).toEqual([]);
    expect(
      buildDiscoveryRows({
        pairs: [{ ...pair, id: "missing-volume", volumes: {} }],
        category: "volume",
        filters: DEFAULT_DISCOVERY_FILTERS,
        isPairPinned: () => false,
        recentPairIds: []
      })
    ).toEqual([]);
  });
});

test.describe("read-only wallet request boundary", () => {
  test("never exposes a raw provider recursion message", () => {
    const message = getWalletErrorMessage(new RangeError("Maximum call stack size exceeded SUPER_RAW_PROVIDER_DETAIL"));
    expect(message).toBe("The wallet could not complete this request. Try again or choose another wallet.");
    expect(message).not.toMatch(/stack|SUPER_RAW/i);
  });

  test("connects, reads chain and balance without requesting a transaction", async () => {
    const methods: string[] = [];
    const provider: Eip1193Provider = {
      request: async ({ method }) => {
        methods.push(method);
        if (method === "eth_requestAccounts") return ["0x1111111111111111111111111111111111111111"];
        if (method === "eth_chainId") return "0x2105";
        if (method === "eth_getBalance") return "0xde0b6b3a7640000";
        return null;
      }
    };

    await expect(requestWalletConnection(provider)).resolves.toMatchObject({
      address: "0x1111111111111111111111111111111111111111",
      chainId: 8453,
      balanceEth: "1"
    });
    expect(methods).toEqual(["eth_requestAccounts", "eth_chainId", "eth_getBalance"]);
    expect(methods).not.toContain("eth_sendTransaction");
  });

  test("switches manually to Base without constructing an approval or swap", async () => {
    const methods: string[] = [];
    const provider: Eip1193Provider = {
      request: async ({ method }) => {
        methods.push(method);
        return null;
      }
    };

    await switchWalletToBase(provider);
    expect(methods).toEqual(["wallet_switchEthereumChain"]);
    expect(methods.some((method) => /sendtransaction|approval|swap/i.test(method))).toBeFalsy();
  });

  test("serializes MetaMask-like re-entrant events and rapid double clicks", async () => {
    const harness = createWalletProviderHarness();
    const target = createLegacyDiscoveryTarget(harness.provider);
    const controller = new ReadOnlyWalletController();

    controller.start(target);
    await settleController();
    expect(harness.methods).toEqual([]);
    expect(controller.getState().selectedProviderId).toBeUndefined();
    expect(harness.listenerCount()).toBe(0);
    controller.selectProvider("legacy:injected");
    expect(harness.listenerCount()).toBe(4);
    harness.resetMetrics();

    await Promise.all([controller.connect(), controller.connect()]);
    await settleController();

    expect(harness.methods.filter((method) => method === "eth_requestAccounts")).toHaveLength(1);
    expect(harness.reentrantRequests()).toBe(0);
    expect(controller.getState()).toMatchObject({
      status: "connected",
      address: "0x1111111111111111111111111111111111111111",
      chainId: 8453,
      balanceEth: "1"
    });
    expect(harness.methods).not.toContain("eth_sendTransaction");
    expect(harness.methods.some((method) => /approval|swap/i.test(method))).toBeFalsy();
    controller.stop();
    expect(harness.listenerCount()).toBe(0);
  });

  test("supports rejection retry, idempotent Strict Mode lifecycle and EIP-6963 selection", async () => {
    const first = createWalletProviderHarness({ rejectOnce: true });
    const second = createWalletProviderHarness({
      account: "0x2222222222222222222222222222222222222222"
    });
    const target = createEip6963DiscoveryTarget([
      { uuid: "first", name: "MetaMask", provider: first.provider },
      { uuid: "second", name: "Rabby", provider: second.provider }
    ]);
    const controller = new ReadOnlyWalletController();

    controller.start(target);
    controller.start(target);
    await settleController();
    expect(controller.getState().providers).toHaveLength(2);
    expect(first.listenerCount()).toBe(0);
    expect(first.methods).toEqual([]);
    expect(second.methods).toEqual([]);

    controller.selectProvider("eip6963:first");
    expect(first.listenerCount()).toBe(4);

    await controller.connect();
    expect(controller.getState().error).toContain("rejected");
    expect(controller.getState().error).not.toContain("stack");
    await controller.connect();
    await settleController();
    expect(controller.getState().status).toBe("connected");

    controller.selectProvider("eip6963:second");
    await settleController();
    await controller.connect();
    await settleController();
    expect(controller.getState()).toMatchObject({
      address: "0x2222222222222222222222222222222222222222",
      selectedProviderId: "eip6963:second"
    });
    expect(second.methods.filter((method) => method === "eth_requestAccounts")).toHaveLength(1);
    expect(first.listenerCount()).toBe(0);
    expect(second.listenerCount()).toBe(4);

    controller.stop();
    controller.start(target);
    await settleController();
    expect(first.listenerCount()).toBe(0);
    controller.selectProvider("eip6963:first");
    expect(first.listenerCount()).toBe(4);
    controller.stop();
    expect(first.listenerCount()).toBe(0);
  });

  test("classifies Keplr as unverified and never treats discovery order as Base compatibility", () => {
    expect(classifyWalletCompatibility("Keplr", "app.keplr", "eip6963")).toBe("unverified");
    expect(classifyWalletCompatibility("MetaMask", "io.metamask", "eip6963")).toBe("verified");
    expect(classifyWalletCompatibility("Rabby", "io.rabby", "eip6963")).toBe("verified");
    expect(classifyWalletCompatibility("Other EVM", "dev.other", "eip6963")).toBe("eip1193");
    expect(classifyWalletCompatibility("Injected wallet", undefined, "legacy")).toBe("unverified");
  });

  test("never switches an unknown EIP-1193 wallet before Base support is verified", async () => {
    const harness = createWalletProviderHarness();
    const target = createEip6963DiscoveryTarget([
      { uuid: "unknown", name: "Other EVM", provider: harness.provider }
    ]);
    const controller = new ReadOnlyWalletController();

    controller.start(target);
    controller.selectProvider("eip6963:unknown");
    await controller.switchToBase();

    expect(harness.methods).toEqual([]);
    expect(controller.getState().errorCode).toBe("unsupported-base");
    controller.stop();
  });
});

function createWalletProviderHarness({
  account = "0x1111111111111111111111111111111111111111",
  rejectOnce = false
}: {
  account?: string;
  rejectOnce?: boolean;
} = {}) {
  const methods: string[] = [];
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  let accounts: string[] = [];
  let activeRequests = 0;
  let reentrantRequestCount = 0;
  let shouldReject = rejectOnce;

  const emit = (event: string, ...args: unknown[]) => {
    for (const listener of listeners.get(event) ?? []) listener(...args);
  };
  const provider: Eip1193Provider = {
    request: async ({ method }) => {
      methods.push(method);
      if (activeRequests > 0 && method !== "eth_requestAccounts") reentrantRequestCount += 1;
      activeRequests += 1;
      try {
        if (method === "eth_accounts") return accounts;
        if (method === "eth_chainId") return "0x2105";
        if (method === "eth_getBalance") return "0xde0b6b3a7640000";
        if (method === "wallet_switchEthereumChain") {
          emit("chainChanged", "0x2105");
          return null;
        }
        if (method === "eth_requestAccounts") {
          if (shouldReject) {
            shouldReject = false;
            throw Object.assign(new Error("Internal provider details"), { code: 4001 });
          }
          accounts = [account];
          emit("accountsChanged", accounts);
          emit("connect", { chainId: "0x2105" });
          await Promise.resolve();
          return accounts;
        }
        throw new Error(`Unexpected wallet method: ${method}`);
      } finally {
        activeRequests -= 1;
      }
    },
    on: (event, listener) => {
      const eventListeners = listeners.get(event) ?? new Set();
      eventListeners.add(listener);
      listeners.set(event, eventListeners);
    },
    removeListener: (event, listener) => listeners.get(event)?.delete(listener)
  };

  return {
    provider,
    methods,
    listenerCount: () => [...listeners.values()].reduce((total, values) => total + values.size, 0),
    reentrantRequests: () => reentrantRequestCount,
    resetMetrics: () => {
      methods.length = 0;
      reentrantRequestCount = 0;
    }
  };
}

function createLegacyDiscoveryTarget(provider: Eip1193Provider) {
  return Object.assign(new EventTarget(), { ethereum: provider });
}

function createEip6963DiscoveryTarget(
  announcements: Array<{ uuid: string; name: string; provider: Eip1193Provider }>
) {
  const target = new EventTarget();
  target.addEventListener("eip6963:requestProvider", () => {
    for (const announcement of announcements) {
      const event = new Event("eip6963:announceProvider") as Event & { detail?: unknown };
      event.detail = { info: { uuid: announcement.uuid, name: announcement.name }, provider: announcement.provider };
      target.dispatchEvent(event);
    }
  });
  return target;
}

async function settleController() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}
