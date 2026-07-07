import type { RiskFlag, RiskLevel } from "@/types/market";
import { cx } from "@/lib/format";

const riskClassName: Record<RiskLevel, string> = {
  clear: "border-base-mint/40 bg-base-mint/10 text-base-mint",
  watch: "border-base-amber/40 bg-base-amber/10 text-base-amber",
  elevated: "border-orange-300/40 bg-orange-100 text-orange-700",
  high: "border-base-rose/40 bg-base-rose/10 text-base-rose"
};

const riskLabel: Record<RiskLevel, string> = {
  clear: "Clear demo",
  watch: "Watch",
  elevated: "Elevated",
  high: "High risk demo"
};

export function RiskBadge({
  level,
  label,
  compact = false
}: {
  level: RiskLevel;
  label?: string;
  compact?: boolean;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center border font-semibold uppercase tracking-[0.14em]",
        compact ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-1 text-[10px]",
        riskClassName[level]
      )}
    >
      {label ?? riskLabel[level]}
    </span>
  );
}

export function RiskFlagList({ flags }: { flags: RiskFlag[] }) {
  return (
    <div className="space-y-2">
      {flags.map((flag) => (
        <div
          key={`${flag.level}-${flag.label}`}
          className="border border-base-line bg-base-elevated p-3"
        >
          <RiskBadge level={flag.level} label={flag.label} compact />
          <p className="mt-2 text-xs leading-5 text-base-muted">
            {flag.description}
          </p>
        </div>
      ))}
    </div>
  );
}
