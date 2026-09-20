import type { MarketTerminalSnapshot } from "@/data/providers";
import { getChange24h, getLiquidityUsd, getVolume24h } from "@/lib/base-terminal/discovery";
import type { PulseSignal } from "@/lib/base-terminal/pulse";
import type { BasePair } from "@/types/baseTerminal";
import { shouldAcceptMarketSnapshot } from "@/lib/base-terminal/providerHealth";
import { normalizeCompactNumberText } from "@/lib/format";

export type AlertMetric =
  | "price_above"
  | "price_below"
  | "change_5m"
  | "change_1h"
  | "change_24h"
  | "volume_24h"
  | "liquidity"
  | "enters_trending"
  | "new_pair"
  | "watchlist_move";

export type LocalAlertRule = {
  id: string;
  pairId?: string;
  pairLabel?: string;
  metric: AlertMetric;
  threshold?: number;
  createdAt: string;
  cooldownMs: number;
  lastTriggeredAt?: string;
  enabled: boolean;
};

export type AlertTrigger = {
  key: string;
  ruleId: string;
  pairId?: string;
  title: string;
  detail: string;
  source: string;
  timeframe: string;
  triggeredAt: string;
};

export function createAlertRule(
  input: Omit<LocalAlertRule, "id" | "createdAt" | "cooldownMs" | "enabled">,
  now = new Date()
): LocalAlertRule {
  return {
    ...input,
    id: `alert-${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: now.toISOString(),
    cooldownMs: 10 * 60_000,
    enabled: true
  };
}

export function evaluateAlertRules({
  rules,
  previous,
  current,
  signals,
  now = new Date()
}: {
  rules: LocalAlertRule[];
  previous?: MarketTerminalSnapshot;
  current: MarketTerminalSnapshot;
  signals: PulseSignal[];
  now?: Date;
}) {
  if (!previous || !shouldAcceptMarketSnapshot(previous, current)) return { rules, triggers: [] as AlertTrigger[] };
  const previousPairs = new Map(previous.allPairs.map((pair) => [pair.id, pair]));
  const currentPairs = new Map(current.allPairs.map((pair) => [pair.id, pair]));
  const triggers: AlertTrigger[] = [];
  const nextRules = rules.map((rule) => {
    if (!rule.enabled || isCoolingDown(rule, now)) return rule;
    const pair = rule.pairId ? currentPairs.get(rule.pairId) : undefined;
    const before = rule.pairId ? previousPairs.get(rule.pairId) : undefined;
    const result = evaluateRule(rule, before, pair, signals);
    if (!result) return rule;

    const triggeredAt = now.toISOString();
    triggers.push({
      key: `${rule.id}:${triggeredAt}`,
      ruleId: rule.id,
      pairId: pair?.id ?? rule.pairId,
      title: result.title,
      detail: result.detail,
      source: current.providerName,
      timeframe: result.timeframe,
      triggeredAt
    });
    return { ...rule, lastTriggeredAt: triggeredAt };
  });

  return { rules: nextRules, triggers };
}

function evaluateRule(
  rule: LocalAlertRule,
  before: BasePair | undefined,
  pair: BasePair | undefined,
  signals: PulseSignal[]
) {
  const threshold = rule.threshold;
  const pairLabel = pair?.pair ?? rule.pairLabel ?? "Selected market";
  const signal = rule.metric === "new_pair"
    ? signals.find((event) => event.type === "new_pool")
    : signals.find((event) => event.pairId === rule.pairId);

  if (rule.metric === "enters_trending" && signal?.type === "entered_trending") {
    return { title: `${pairLabel} entered Trending`, detail: signal.detail, timeframe: "snapshot" };
  }
  if (rule.metric === "new_pair" && signal?.type === "new_pool") {
    return { title: `${pairLabel} is a new qualified pool`, detail: signal.detail, timeframe: "snapshot" };
  }
  if (rule.metric === "watchlist_move" && signal?.type === "watchlist_move") {
    return { title: `${pairLabel} watchlist movement`, detail: signal.detail, timeframe: signal.timeframe ?? "snapshot" };
  }
  if (!pair || !before || threshold === undefined || pair.stale) return undefined;

  if (rule.metric === "price_above") {
    return crossedAbove(before.priceUsdValue, pair.priceUsdValue, threshold)
      ? { title: `${pairLabel} crossed above`, detail: `Verified price crossed above $${threshold}.`, timeframe: "snapshot" }
      : undefined;
  }
  if (rule.metric === "price_below") {
    return crossedBelow(before.priceUsdValue, pair.priceUsdValue, threshold)
      ? { title: `${pairLabel} crossed below`, detail: `Verified price crossed below $${threshold}.`, timeframe: "snapshot" }
      : undefined;
  }

  const currentValue = readMetric(rule.metric, pair);
  const previousValue = readMetric(rule.metric, before);
  return currentValue !== undefined && previousValue !== undefined && previousValue < threshold && currentValue >= threshold
    ? {
        title: `${pairLabel} alert triggered`,
        detail: `${alertMetricLabel(rule.metric)} reached ${formatThreshold(rule.metric, currentValue)} (rule ${formatThreshold(rule.metric, threshold)}).`,
        timeframe: alertTimeframe(rule.metric)
      }
    : undefined;
}

function readMetric(metric: AlertMetric, pair: BasePair) {
  if (metric === "change_5m") return pair.priceChanges?.m5;
  if (metric === "change_1h") return pair.priceChanges?.h1;
  if (metric === "change_24h") return getChange24h(pair);
  if (metric === "volume_24h") return getVolume24h(pair);
  if (metric === "liquidity") return getLiquidityUsd(pair);
  return undefined;
}

function crossedAbove(previous: number | undefined, current: number | undefined, threshold: number) {
  return isFiniteNumber(previous) && isFiniteNumber(current) && previous < threshold && current >= threshold;
}

function crossedBelow(previous: number | undefined, current: number | undefined, threshold: number) {
  return isFiniteNumber(previous) && isFiniteNumber(current) && previous > threshold && current <= threshold;
}

function isCoolingDown(rule: LocalAlertRule, now: Date) {
  if (!rule.lastTriggeredAt) return false;
  const lastTriggered = Date.parse(rule.lastTriggeredAt);
  const elapsed = now.getTime() - lastTriggered;
  return Number.isFinite(lastTriggered) && elapsed >= 0 && elapsed < rule.cooldownMs;
}

function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function alertMetricLabel(metric: AlertMetric) {
  return ({
    change_5m: "5m change",
    change_1h: "1h change",
    change_24h: "24h change",
    volume_24h: "24h volume",
    liquidity: "Liquidity"
  } as Partial<Record<AlertMetric, string>>)[metric] ?? metric;
}

function alertTimeframe(metric: AlertMetric) {
  if (metric === "change_5m") return "5m";
  if (metric === "change_1h") return "1h";
  if (metric === "change_24h" || metric === "volume_24h") return "24h";
  return "snapshot";
}

function formatThreshold(metric: AlertMetric, value: number) {
  if (metric.startsWith("change")) return `${value.toFixed(2)}%`;
  if (metric === "price_above" || metric === "price_below") return `$${value}`;
  return normalizeCompactNumberText(new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(value));
}
