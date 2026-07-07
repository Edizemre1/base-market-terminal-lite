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
    <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div>
        {eyebrow ? (
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-base-mint">
            {eyebrow}
          </p>
        ) : null}
        <h2 className="text-lg font-semibold text-base-text md:text-xl">{title}</h2>
        {description ? (
          <p className="mt-1 max-w-3xl text-xs leading-5 text-base-muted">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
