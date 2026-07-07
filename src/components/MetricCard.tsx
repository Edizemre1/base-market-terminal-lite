import type { MarketStat } from "@/types/market";
import { cx } from "@/lib/format";

const toneClassName: Record<MarketStat["tone"], string> = {
  mint: "border-base-mint/30 bg-base-mint/10 text-base-mint",
  cyan: "border-base-cyan/30 bg-base-cyan/10 text-base-cyan",
  amber: "border-base-amber/30 bg-base-amber/10 text-base-amber",
  rose: "border-base-rose/30 bg-base-rose/10 text-base-rose"
};

export function MetricCard({ stat }: { stat: MarketStat }) {
  return (
    <article className="border border-base-line bg-base-panel px-3 py-3 shadow-panel">
      <div
        className={cx(
          "mb-3 inline-flex border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em]",
          toneClassName[stat.tone]
        )}
      >
        {stat.label}
      </div>
      <p className="font-mono text-2xl font-semibold tabular-nums text-base-text">
        {stat.value}
      </p>
      <p className="mt-1 text-[11px] leading-5 text-base-muted">{stat.detail}</p>
    </article>
  );
}
