import { normalizeSignedZero } from "@/lib/marketMath";

export function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function formatCurrency(value: number, maximumFractionDigits = 2) {
  if (!Number.isFinite(value)) return "N/A";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits
  }).format(normalizeSignedZero(value));
}

export function formatCompactCurrency(value: number) {
  if (!Number.isFinite(value)) return "N/A";
  return normalizeCompactNumberText(new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1
  }).format(normalizeSignedZero(value)));
}

export function formatNumber(value: number) {
  if (!Number.isFinite(value)) return "N/A";
  const compact = value > 9999;
  const formatted = new Intl.NumberFormat("en-US", {
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: 1
  }).format(normalizeSignedZero(value));
  return compact ? normalizeCompactNumberText(formatted) : formatted;
}

// Node and Chromium can ship different ICU compact-number data. For example,
// the same options may produce "$713.0K" during SSR and "$713K" in the
// browser. Removing only an optional terminal zero keeps hydration stable
// without hiding meaningful fractional precision.
export function normalizeCompactNumberText(value: string) {
  return value.replace(/([.,])0(?=\D*$)/u, "");
}

export function formatPercent(value: number) {
  if (!Number.isFinite(value)) return "N/A";
  const normalized = normalizeSignedZero(value);
  const sign = normalized > 0 ? "+" : "";
  return `${sign}${normalized.toFixed(1)}%`;
}

export function formatAge(hours: number) {
  if (!Number.isFinite(hours) || hours < 0) return "N/A";
  if (hours < 24) {
    return `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  if (days < 365) {
    return `${days}d`;
  }

  return `${Math.floor(days / 365)}y`;
}
