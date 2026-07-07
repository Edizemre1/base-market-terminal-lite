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
        "inline-flex items-center border font-mono font-semibold tabular-nums",
        compact ? "px-1 py-0.5 text-[10px]" : "px-1.5 py-0.5 text-[11px]",
        isPositive
          ? "border-base-mint/35 bg-base-mint/10 text-base-mint"
          : "border-base-rose/35 bg-base-rose/10 text-base-rose"
      )}
    >
      {formatPercent(value)}
    </span>
  );
}
