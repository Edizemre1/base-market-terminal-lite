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
  const width = 148;
  const height = 44;
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
      className={cx("h-11 w-36 overflow-visible", className)}
    >
      <path
        d={path}
        fill="none"
        stroke={positive ? "#00a3ff" : "#ff5c7a"}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.5"
      />
      <path
        d={`${path} L ${width} ${height} L 0 ${height} Z`}
        fill={positive ? "rgba(0, 82, 255, 0.14)" : "rgba(255, 92, 122, 0.1)"}
      />
    </svg>
  );
}
