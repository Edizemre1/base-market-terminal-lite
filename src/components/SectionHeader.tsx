export function SectionHeader({
  eyebrow,
  title,
  description
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-2 flex items-end justify-between gap-3">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-base-mint">
          {eyebrow}
        </p>
        <h2 className="mt-0.5 text-sm font-semibold text-base-text">{title}</h2>
      </div>
      {description ? (
        <p className="hidden max-w-md text-right text-[11px] leading-4 text-base-muted lg:block">
          {description}
        </p>
      ) : null}
    </div>
  );
}
