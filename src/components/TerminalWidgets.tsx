import type { ReactNode } from "react";
import { cx } from "@/lib/format";

export function TerminalPanel({
  label,
  title,
  children,
  className
}: {
  label?: string;
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("border border-base-line bg-base-panel shadow-panel", className)}>
      {(label || title) ? (
        <div className="border-b border-base-line bg-base-raised px-3 py-2">
          {label ? (
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-base-mint">
              {label}
            </p>
          ) : null}
          {title ? (
            <h2 className="mt-0.5 text-sm font-semibold text-base-text">{title}</h2>
          ) : null}
        </div>
      ) : null}
      <div className="p-3">{children}</div>
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
    blue: "border-base-blue/30 bg-base-blue/10 text-base-blue",
    amber: "border-base-amber/40 bg-base-amber/10 text-base-amber",
    rose: "border-base-rose/40 bg-base-rose/10 text-base-rose",
    muted: "border-base-line bg-base-elevated text-base-muted"
  };

  return (
    <span
      className={cx(
        "inline-flex border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em]",
        tones[tone]
      )}
    >
      {label}
    </span>
  );
}

export function MiniBarList({
  items
}: {
  items: Array<{ label: string; value: number; tone?: "mint" | "blue" | "rose" }>;
}) {
  return (
    <div className="space-y-2">
      {items.map((item) => {
        const barClass =
          item.tone === "rose"
            ? "bg-base-rose"
            : item.tone === "blue"
              ? "bg-base-blue"
              : "bg-base-mint";

        return (
          <div key={item.label}>
            <div className="mb-1 flex justify-between text-[11px]">
              <span className="text-base-muted">{item.label}</span>
              <span className="font-mono text-base-text">{item.value}%</span>
            </div>
            <div className="h-1.5 bg-base-raised">
              <div className={cx("h-full", barClass)} style={{ width: `${item.value}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function GaugeCard({ value, label }: { value: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <div className="flex items-center gap-4">
      <div
        className="grid h-24 w-24 place-items-center rounded-full border border-base-line"
        style={{
          background: `conic-gradient(#10a878 ${clamped * 3.6}deg, #eee9dc 0deg)`
        }}
      >
        <div className="grid h-16 w-16 place-items-center rounded-full border border-base-line bg-base-panel">
          <span className="font-mono text-xl font-semibold text-base-text">{value}</span>
        </div>
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-base-muted">
          Gauge
        </p>
        <p className="mt-1 text-sm font-semibold text-base-text">{label}</p>
        <p className="mt-1 text-xs leading-5 text-base-muted">
          Mock sentiment indicator.
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
    blue: "border-base-blue/30 bg-base-blue/10 text-base-blue",
    amber: "border-base-amber/40 bg-base-amber/10 text-base-amber",
    rose: "border-base-rose/40 bg-base-rose/10 text-base-rose"
  };

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className={cx("border p-3", tones[item.tone])}>
          <p className="text-[10px] uppercase tracking-[0.16em]">{item.label}</p>
          <p className="mt-2 font-mono text-lg font-semibold">{item.value}</p>
        </div>
      ))}
    </div>
  );
}

export function EventTape({ items }: { items: string[] }) {
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div
          key={item}
          className="border-l-2 border-base-mint bg-base-elevated px-3 py-2 text-xs leading-5 text-base-muted"
        >
          {item}
        </div>
      ))}
    </div>
  );
}
