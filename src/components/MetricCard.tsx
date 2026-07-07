import type { MarketStat } from "@/types/market";
import { cx } from "@/lib/format";

const toneClassName: Record<MarketStat["tone"], string> = {
  mint: "border-base-mint/35 text-base-mint",
  cyan: "border-base-cyan/35 text-base-cyan",
  amber: "border-base-amber/40 text-base-amber",
  rose: "border-base-rose/40 text-base-rose"
};

export function MetricCard({ stat }: { stat: MarketStat }) {
  return (
    <article className="min-h-[78px] border border-base-line bg-base-panel p-2">
      <div
        className={cx(
          "inline-flex border bg-base-elevated px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]",
          toneClassName[stat.tone]
        )}
      >
        {stat.label}
      </div>
      <p className="mt-2 font-mono text-xl font-semibold leading-none text-base-text">
        {stat.value}
      </p>
      <p className="mt-1 text-[11px] leading-4 text-base-muted">{stat.detail}</p>
    </article>
  );
}
