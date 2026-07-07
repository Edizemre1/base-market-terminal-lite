import type { MarketStat } from "@/types/market";
import { cx } from "@/lib/format";

const toneClassName: Record<MarketStat["tone"], string> = {
  mint: "border-base-mint/25 text-base-mint",
  cyan: "border-base-cyan/25 text-base-cyan",
  amber: "border-base-amber/30 text-base-amber",
  rose: "border-base-rose/30 text-base-rose"
};

export function MetricCard({ stat }: { stat: MarketStat }) {
  return (
    <article className="rounded-lg border border-white/10 bg-white/[0.045] p-5">
      <div
        className={cx(
          "mb-6 inline-flex rounded border bg-white/[0.03] px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.18em]",
          toneClassName[stat.tone]
        )}
      >
        {stat.label}
      </div>
      <p className="text-3xl font-semibold text-white">{stat.value}</p>
      <p className="mt-2 text-sm leading-6 text-emerald-50/60">{stat.detail}</p>
    </article>
  );
}
