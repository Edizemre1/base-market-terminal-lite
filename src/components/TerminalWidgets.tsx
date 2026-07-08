import type { ReactNode } from "react";
import { cx } from "@/lib/format";

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
    mint: "border-base-mint/45 bg-base-mint/10 text-base-mint",
    blue: "border-base-blue/25 bg-base-blue/5 text-base-electric",
    amber: "border-base-amber/45 bg-base-amber/10 text-base-amber",
    rose: "border-base-rose/45 bg-base-rose/10 text-base-rose",
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
