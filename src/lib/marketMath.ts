import type { PairChartCandle } from "@/data/providers/chart/types";

const STRICT_PROVIDER_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const STRICT_LOCALE_DECIMAL = /^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/;

export function parseStrictFiniteNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? normalizeSignedZero(value) : undefined;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || !STRICT_PROVIDER_NUMBER.test(normalized)) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? normalizeSignedZero(parsed) : undefined;
}

export function parseLocaleDecimalInput(value: string) {
  const normalized = value.trim();
  if (!normalized || !STRICT_LOCALE_DECIMAL.test(normalized)) return undefined;
  if (normalized.includes(".") && normalized.includes(",")) return undefined;
  const parsed = Number(normalized.replace(",", "."));
  return Number.isFinite(parsed) ? normalizeSignedZero(parsed) : undefined;
}

export function normalizeSignedZero(value: number) {
  return Object.is(value, -0) ? 0 : value;
}

export function calculatePercentChange(previous: number | undefined, current: number | undefined) {
  if (!isFinitePositive(previous) || !isFinitePositive(current)) return undefined;
  return normalizeSignedZero(((current - previous) / previous) * 100);
}

export function invertPositiveValue(value: number | undefined) {
  return isFinitePositive(value) ? 1 / value : undefined;
}

export function calculateReverseChangePercent(directChangePercent: number | undefined) {
  if (typeof directChangePercent !== "number" || !Number.isFinite(directChangePercent)) return undefined;
  const directReturn = directChangePercent / 100;
  if (directReturn <= -1) return undefined;
  return normalizeSignedZero(((1 / (1 + directReturn)) - 1) * 100);
}

export function reverseOhlcvCandle(candle: PairChartCandle) {
  const open = invertPositiveValue(candle.open);
  const high = invertPositiveValue(candle.low);
  const low = invertPositiveValue(candle.high);
  const close = invertPositiveValue(candle.close);
  if (open === undefined || high === undefined || low === undefined || close === undefined) return undefined;
  return { ...candle, open, high, low, close };
}

export function normalizeOhlcvCandles(
  candles: PairChartCandle[],
  nowSeconds = Math.floor(Date.now() / 1000)
) {
  const byTimestamp = new Map<number, PairChartCandle>();
  for (const candle of candles) {
    const normalized = normalizeOhlcvCandle(candle, nowSeconds);
    if (!normalized) continue;
    const current = byTimestamp.get(normalized.timestamp);
    if (!current || compareDuplicateCandles(normalized, current) > 0) {
      byTimestamp.set(normalized.timestamp, normalized);
    }
  }
  return [...byTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp);
}

export function aggregateOhlcvCandles(
  candles: PairChartCandle[],
  bucketSeconds: number,
  nowSeconds = Math.floor(Date.now() / 1000)
) {
  if (!Number.isSafeInteger(bucketSeconds) || bucketSeconds <= 0) return [];
  const normalized = normalizeOhlcvCandles(candles, nowSeconds);
  const buckets = new Map<number, PairChartCandle[]>();
  for (const candle of normalized) {
    const bucket = Math.floor(candle.timestamp / bucketSeconds) * bucketSeconds;
    const rows = buckets.get(bucket) ?? [];
    rows.push(candle);
    buckets.set(bucket, rows);
  }
  return [...buckets.entries()].sort(([left], [right]) => left - right).flatMap(([timestamp, rows]) => {
    const volume = rows.reduce((sum, candle) => sum + candle.volume, 0);
    if (!Number.isFinite(volume)) return [];
    return [{
      timestamp,
      open: rows[0].open,
      high: Math.max(...rows.map((candle) => candle.high)),
      low: Math.min(...rows.map((candle) => candle.low)),
      close: rows[rows.length - 1].close,
      volume
    }];
  });
}

export function canonicalPairKey({
  chainId,
  pairAddress,
  baseTokenAddress,
  quoteTokenAddress,
  fallbackId
}: {
  chainId?: string;
  pairAddress?: string;
  baseTokenAddress?: string;
  quoteTokenAddress?: string;
  fallbackId: string;
}) {
  const chain = chainId?.trim().toLocaleLowerCase("en-US") || "base";
  const pool = normalizeAddressLike(pairAddress);
  if (pool) return `${chain}:pool:${pool}`;
  const tokens = [normalizeAddressLike(baseTokenAddress), normalizeAddressLike(quoteTokenAddress)]
    .filter((value): value is string => Boolean(value))
    .sort();
  return tokens.length === 2
    ? `${chain}:tokens:${tokens.join(":")}`
    : `${chain}:fallback:${fallbackId.trim().toLocaleLowerCase("en-US")}`;
}

function normalizeOhlcvCandle(candle: PairChartCandle, nowSeconds: number) {
  const values = [candle.timestamp, candle.open, candle.high, candle.low, candle.close, candle.volume];
  if (values.some((value) => !Number.isFinite(value))) return undefined;
  if (!Number.isSafeInteger(candle.timestamp) || candle.timestamp <= 0 || candle.timestamp > nowSeconds + 60) return undefined;
  if (![candle.open, candle.high, candle.low, candle.close].every((value) => value > 0) || candle.volume < 0) return undefined;
  if (candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close) || candle.high < candle.low) return undefined;
  return { ...candle, volume: normalizeSignedZero(candle.volume) };
}

function compareDuplicateCandles(left: PairChartCandle, right: PairChartCandle) {
  const leftTuple = [left.volume, left.high, -left.low, left.open, left.close];
  const rightTuple = [right.volume, right.high, -right.low, right.open, right.close];
  for (let index = 0; index < leftTuple.length; index += 1) {
    if (leftTuple[index] !== rightTuple[index]) return leftTuple[index] - rightTuple[index];
  }
  return 0;
}

function normalizeAddressLike(value: string | undefined) {
  const normalized = value?.trim().toLocaleLowerCase("en-US");
  return normalized || undefined;
}

function isFinitePositive(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
