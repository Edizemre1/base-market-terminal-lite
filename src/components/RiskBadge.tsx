import type { RiskFlag, RiskLevel } from "@/types/market";
import { cx } from "@/lib/format";

const riskClassName: Record<RiskLevel, string> = {
  clear: "border-base-mint/35 bg-base-mint/10 text-base-mint",
  watch: "border-base-amber/40 bg-base-amber/10 text-base-amber",
  elevated: "border-base-amber/50 bg-base-amber/15 text-base-amber",
  high: "border-base-rose/40 bg-base-rose/10 text-base-rose"
};

const riskLabel: Record<RiskLevel, string> = {
  clear: "Clear",
  watch: "Watch",
  elevated: "Elevated",
  high: "High"
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
        "inline-flex items-center border font-semibold uppercase tracking-[0.12em]",
        compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-[11px]",
        riskClassName[level]
      )}
    >
      {label ?? riskLabel[level]}
    </span>
  );
}

export function RiskFlagList({ flags }: { flags: RiskFlag[] }) {
  return (
    <div className="space-y-1.5">
      {flags.map((flag) => (
        <div
          key={`${flag.level}-${flag.label}`}
          className="border border-base-line bg-base-elevated p-2"
        >
          <RiskBadge level={flag.level} label={flag.label} compact />
          <p className="mt-1.5 text-[11px] leading-4 text-base-muted">
            {flag.description}
          </p>
        </div>
      ))}
    </div>
  );
}
