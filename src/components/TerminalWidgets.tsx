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
    <section className={cx("border border-border-subtle bg-surface-panel", className)}>
      {(label || title || meta) ? (
        <div className="flex min-h-8 items-center justify-between gap-3 border-b border-border-subtle bg-surface-raised px-2">
          <div>
            {label ? (
              <p className="text-meta font-semibold uppercase tracking-eyebrow text-content-secondary">
                {label}
              </p>
            ) : null}
            {title ? (
              <h2 className="text-label font-semibold text-content-primary">{title}</h2>
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
    mint: "border-brand-accent/45 bg-brand-accent/10 text-brand-accent",
    blue: "border-network-base/25 bg-network-base/5 text-network-base",
    amber: "border-freshness-delayed/45 bg-freshness-delayed/10 text-freshness-delayed",
    rose: "border-market-negative/45 bg-market-negative/10 text-market-negative",
    muted: "border-border-subtle bg-surface-interactive text-content-secondary"
  };

  return (
    <span
      className={cx(
        "inline-flex border px-2 py-1 text-meta font-semibold uppercase tracking-eyebrow",
        tones[tone]
      )}
    >
      {label}
    </span>
  );
}
