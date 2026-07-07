import { formatPercent, cx } from "@/lib/format";

export function PriceChange({
  value,
  compact = false
}: {
  value: number;
  compact?: boolean;
}) {
  const isPositive = value >= 0;

  return (
    <span
      className={cx(
        "inline-flex items-center border font-mono text-xs font-semibold tabular-nums",
        isPositive
          ? "border-base-mint/40 bg-base-mint/10 text-base-mint"
          : "border-base-rose/30 bg-base-rose/10 text-base-rose",
        compact ? "px-1.5 py-0.5" : "px-2 py-1"
      )}
    >
      {formatPercent(value)}
    </span>
  );
}
