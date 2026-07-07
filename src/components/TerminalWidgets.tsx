import type { ReactNode } from "react";
import { Sparkline } from "@/components/Sparkline";
import { cx, formatCompactCurrency } from "@/lib/format";

export function TerminalPanel({
  label,
  title,
  meta,
  children,
  className,
  bodyClassName
}: {
  label?: string;
  title?: string;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cx("border border-base-line bg-base-panel", className)}>
      {(label || title || meta) ? (
        <div className="flex min-h-8 items-center justify-between gap-3 border-b border-base-line bg-base-raised px-2">
          <div>
            {label ? (
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-base-mint">
                {label}
              </p>
            ) : null}
            {title ? (
              <h2 className="text-[12px] font-semibold text-base-text">{title}</h2>
            ) : null}
          </div>
          {meta ? <div className="shrink-0">{meta}</div> : null}
        </div>
      ) : null}
      <div className={cx("p-2", bodyClassName)}>{children}</div>
    </section>
  );
}

export function StatusPill({
  label,
  tone = "mint"
}: {
  label: string;
  tone?: "mint" | "blue" | "amber" | "rose" | "muted";
}) {
  const tones = {
    mint: "border-base-mint/40 bg-base-mint/10 text-base-mint",
    blue: "border-base-blue/25 bg-base-blue/5 text-base-electric",
    amber: "border-base-amber/40 bg-base-amber/10 text-base-amber",
    rose: "border-base-rose/40 bg-base-rose/10 text-base-rose",
    muted: "border-base-line bg-base-elevated text-base-muted"
  };

  return (
    <span
      className={cx(
        "inline-flex border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
        tones[tone]
      )}
    >
      {label}
    </span>
  );
}

export function MarketMiniCard({
  label,
  value,
  change,
  points,
  positive = true,
  meta
}: {
  label: string;
  value: string;
  change: string;
  points: number[];
  positive?: boolean;
  meta?: string;
}) {
  return (
    <article className="min-h-[92px] border border-base-line bg-base-panel p-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-base-muted">
          {label}
        </p>
        {meta ? <StatusPill label={meta} tone="muted" /> : null}
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div>
          <p className="font-mono text-[18px] font-semibold leading-none text-base-text">
            {value}
          </p>
          <p
            className={cx(
              "mt-1 font-mono text-[11px]",
              positive ? "text-base-mint" : "text-base-rose"
            )}
          >
            {change}
          </p>
        </div>
        <Sparkline points={points} positive={positive} className="h-8 w-20" />
      </div>
    </article>
  );
}

export function CompactList({
  label,
  items,
  tone = "mint"
}: {
  label: string;
  items: Array<{ symbol: string; value: string }>;
  tone?: "mint" | "rose";
}) {
  return (
    <article className="min-h-[92px] border border-base-line bg-base-panel p-2">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-base-muted">
        {label}
      </p>
      <div className="space-y-1">
        {items.map((item) => (
          <div
            key={`${label}-${item.symbol}`}
            className="grid grid-cols-[1fr_auto] gap-2 text-[11px]"
          >
            <span className="font-mono font-semibold text-base-text">
              {item.symbol}
            </span>
            <span
              className={cx(
                "font-mono",
                tone === "mint" ? "text-base-mint" : "text-base-rose"
              )}
            >
              {item.value}
            </span>
          </div>
        ))}
      </div>
    </article>
  );
}

export function RiskGauge({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <div>
      <div className="relative h-2 border border-base-line bg-[linear-gradient(90deg,#c93649_0%,#a77719_42%,#0f9f87_100%)]">
        <span
          className="absolute -top-1 h-4 w-px bg-base-text"
          style={{ left: `${clamped}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-base-muted">
        <span>RISK-OFF</span>
        <span>NEUTRAL</span>
        <span>RISK-ON</span>
      </div>
    </div>
  );
}

export function MiniBarList({
  items
}: {
  items: Array<{ label: string; value: number; tone?: "mint" | "blue" | "rose" | "amber" }>;
}) {
  return (
    <div className="space-y-1.5">
      {items.map((item) => {
        const tone =
          item.tone === "rose"
            ? "bg-base-rose"
            : item.tone === "blue"
              ? "bg-base-blue"
              : item.tone === "amber"
                ? "bg-base-amber"
                : "bg-base-mint";

        return (
          <div key={item.label}>
            <div className="mb-0.5 flex justify-between text-[10px]">
              <span className="uppercase tracking-[0.1em] text-base-muted">
                {item.label}
              </span>
              <span className="font-mono text-base-text">{item.value}%</span>
            </div>
            <div className="h-1.5 border border-base-line bg-base-elevated">
              <div className={cx("h-full", tone)} style={{ width: `${item.value}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function DonutMetric({
  value,
  label
}: {
  value: number;
  label: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <div className="flex items-center gap-3">
      <div
        className="grid h-20 w-20 place-items-center rounded-full border border-base-line"
        style={{
          background: `conic-gradient(#0f9f87 ${clamped * 3.6}deg, #e5eee9 0deg)`
        }}
      >
        <div className="grid h-12 w-12 place-items-center rounded-full border border-base-line bg-base-panel">
          <span className="font-mono text-sm font-semibold text-base-text">{value}</span>
        </div>
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-base-muted">
          {label}
        </p>
        <p className="mt-1 text-xs leading-5 text-base-muted">
          Mock composite indicator.
        </p>
      </div>
    </div>
  );
}

export function HeatmapGrid({
  items
}: {
  items: Array<{ label: string; value: string; tone: "mint" | "blue" | "amber" | "rose" }>;
}) {
  const tones = {
    mint: "border-base-mint/40 bg-base-mint/10 text-base-mint",
    blue: "border-base-blue/25 bg-base-blue/5 text-base-electric",
    amber: "border-base-amber/40 bg-base-amber/10 text-base-amber",
    rose: "border-base-rose/40 bg-base-rose/10 text-base-rose"
  };

  return (
    <div className="grid grid-cols-2 gap-1 md:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className={cx("border p-2", tones[item.tone])}>
          <p className="text-[10px] uppercase tracking-[0.12em]">{item.label}</p>
          <p className="mt-1 font-mono text-sm font-semibold">{item.value}</p>
        </div>
      ))}
    </div>
  );
}

export function EventTape({ items }: { items: string[] }) {
  return (
    <div className="space-y-1">
      {items.map((item) => (
        <div
          key={item}
          className="border-l-2 border-base-mint bg-base-elevated px-2 py-1.5 text-[11px] leading-4 text-base-muted"
        >
          {item}
        </div>
      ))}
    </div>
  );
}

export function MacroStrip({
  items
}: {
  items: Array<{ label: string; value: string; delta: string; points: number[]; positive?: boolean }>;
}) {
  return (
    <div className="grid gap-1 md:grid-cols-3 xl:grid-cols-6">
      {items.map((item) => (
        <div key={item.label} className="border border-base-line bg-base-panel p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-base-muted">
              {item.label}
            </span>
            <span
              className={cx(
                "font-mono text-[10px]",
                item.positive === false ? "text-base-rose" : "text-base-mint"
              )}
            >
              {item.delta}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="font-mono text-sm font-semibold text-base-text">
              {item.value}
            </span>
            <Sparkline
              points={item.points}
              positive={item.positive !== false}
              className="h-5 w-14"
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function RouteMiniTicket() {
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-2 gap-1">
        <div className="border border-base-line bg-base-elevated p-2">
          <p className="text-[10px] uppercase tracking-[0.12em] text-base-muted">Sell</p>
          <p className="font-mono text-sm font-semibold text-base-text">250 BLUE</p>
        </div>
        <div className="border border-base-line bg-base-elevated p-2">
          <p className="text-[10px] uppercase tracking-[0.12em] text-base-muted">Buy</p>
          <p className="font-mono text-sm font-semibold text-base-text">108.4 MINT</p>
        </div>
      </div>
      <div className="border border-base-line bg-base-panel px-2 py-1.5 font-mono text-[11px] text-base-muted">
        BLUE / AUSD / MINT
      </div>
      <div className="border border-base-amber/40 bg-base-amber/10 px-2 py-1.5 text-[11px] text-base-muted">
        UI-only. Execution disabled.
      </div>
    </div>
  );
}

export function Treemap({
  items
}: {
  items: Array<{ label: string; value: string; className: string }>;
}) {
  return (
    <div className="grid h-44 grid-cols-4 grid-rows-4 gap-1">
      {items.map((item) => (
        <div
          key={item.label}
          className={cx("border border-base-line p-2", item.className)}
        >
          <p className="text-[10px] uppercase tracking-[0.12em]">{item.label}</p>
          <p className="mt-1 font-mono text-sm font-semibold">{item.value}</p>
        </div>
      ))}
    </div>
  );
}

export function RecentEventsTable({
  events
}: {
  events: Array<{ time: string; label: string; detail: string; value: string }>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] border-collapse text-left text-[11px]">
        <thead>
          <tr className="border-b border-base-line bg-base-raised text-[10px] uppercase tracking-[0.12em] text-base-muted">
            <th className="px-2 py-1.5 font-semibold">Time</th>
            <th className="px-2 py-1.5 font-semibold">Type</th>
            <th className="px-2 py-1.5 font-semibold">Detail</th>
            <th className="px-2 py-1.5 text-right font-semibold">Value</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={`${event.time}-${event.label}`} className="h-9 border-b border-base-line last:border-0">
              <td className="px-2 py-1.5 font-mono text-base-muted">{event.time}</td>
              <td className="px-2 py-1.5 font-semibold text-base-text">{event.label}</td>
              <td className="px-2 py-1.5 text-base-muted">{event.detail}</td>
              <td className="px-2 py-1.5 text-right font-mono text-base-text">
                {event.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function formatMoneyListValue(value: number) {
  return formatCompactCurrency(value).replace("$", "");
}
