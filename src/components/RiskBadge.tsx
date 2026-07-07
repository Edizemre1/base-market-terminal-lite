import type { RiskFlag, RiskLevel } from "@/types/market";
import { cx } from "@/lib/format";

const riskClassName: Record<RiskLevel, string> = {
  clear: "border-base-mint/28 bg-base-mint/10 text-base-mint",
  watch: "border-base-amber/30 bg-base-amber/10 text-base-amber",
  elevated: "border-orange-300/30 bg-orange-400/10 text-orange-200",
  high: "border-base-rose/35 bg-base-rose/12 text-base-rose"
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
        "inline-flex items-center rounded border font-semibold uppercase tracking-[0.16em]",
        compact ? "px-2 py-1 text-[10px]" : "px-2.5 py-1.5 text-xs",
        riskClassName[level]
      )}
    >
      {label ?? riskLabel[level]}
    </span>
  );
}

export function RiskFlagList({ flags }: { flags: RiskFlag[] }) {
  return (
    <div className="space-y-3">
      {flags.map((flag) => (
        <div
          key={`${flag.level}-${flag.label}`}
          className="rounded-lg border border-white/10 bg-white/[0.04] p-4"
        >
          <RiskBadge level={flag.level} label={flag.label} compact />
          <p className="mt-3 text-sm leading-6 text-emerald-50/66">
            {flag.description}
          </p>
        </div>
      ))}
    </div>
  );
}
