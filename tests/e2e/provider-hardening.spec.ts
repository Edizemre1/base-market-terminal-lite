import { expect, test } from "@playwright/test";
import {
  normalizeDexScreenerPair,
  parseDexPairList,
  parseDexSearchResponse,
  parseDexTokenProfiles
} from "../../src/data/providers/dexScreenerProvider";
import { parseGeckoTerminalOhlcvResponse } from "../../src/data/providers/chart/geckoTerminalChartProvider";

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
      tokenLogoUrl: "https://example.com/token.png",
      volume24h: 190000,
      liquidity: 250000,
      change24h: 14.6,
      fdv: 1200000,
      marketCap: 890000
    });
    expect(normalized?.txns?.h24).toEqual({ buys: 510, sells: 433 });
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
      },
      {
        timestamp: 1710007200,
        open: 1.1,
        high: 1.3,
        low: 1,
        close: 1.2,
        volume: 0
      }
    ]);
    expect(parseGeckoTerminalOhlcvResponse({ data: {} })).toEqual([]);
    expect(parseGeckoTerminalOhlcvResponse("bad")).toEqual([]);
  });
});
