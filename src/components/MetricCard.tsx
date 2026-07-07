import type { MarketStat } from "@/types/market";
import { cx } from "@/lib/format";

const toneClassName: Record<MarketStat["tone"], string> = {
  mint: "border-base-blue/35 text-base-electric",
  cyan: "border-base-cyan/25 text-base-cyan",
  amber: "border-base-amber/30 text-base-amber",
  rose: "border-base-rose/30 text-base-rose"
};

export function MetricCard({ stat }: { stat: MarketStat }) {
  return (
    <article className="rounded-lg border border-base-line bg-base-panel p-5 shadow-panel">
      <div
        className={cx(
          "mb-6 inline-flex rounded border bg-white/[0.035] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.2em]",
          toneClassName[stat.tone]
        )}
      >
        {stat.label}
      </div>
      <p className="text-3xl font-semibold text-base-text">{stat.value}</p>
      <p className="mt-2 text-sm leading-6 text-base-muted">{stat.detail}</p>
    </article>
  );
}
