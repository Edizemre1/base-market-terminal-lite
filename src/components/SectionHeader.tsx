import type { ReactNode } from "react";

export function SectionHeader({
  eyebrow,
  title,
  description,
  action
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        {eyebrow ? (
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-base-mint">
            {eyebrow}
          </p>
        ) : null}
        <h2 className="text-2xl font-semibold text-white md:text-3xl">{title}</h2>
        {description ? (
          <p className="mt-2 max-w-3xl text-sm leading-6 text-emerald-50/60">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
