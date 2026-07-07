import { cx } from "@/lib/format";

export function Sparkline({
  points,
  className,
  positive = true
}: {
  points: number[];
  className?: string;
  positive?: boolean;
}) {
  const width = 120;
  const height = 32;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const spread = max - min || 1;
  const step = width / Math.max(points.length - 1, 1);
  const path = points
    .map((point, index) => {
      const x = index * step;
      const y = height - ((point - min) / spread) * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${width} ${height}`}
      className={cx("h-8 w-28 overflow-visible", className)}
    >
      <path
        d={path}
        fill="none"
        stroke={positive ? "#10a878" : "#c23b55"}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d={`${path} L ${width} ${height} L 0 ${height} Z`}
        fill={positive ? "rgba(16, 168, 120, 0.12)" : "rgba(194, 59, 85, 0.1)"}
      />
    </svg>
  );
}
