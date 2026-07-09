"use client";

import { useState } from "react";
import { cx } from "@/lib/format";

type TokenAvatarProps = {
  symbol: string;
  logoUrl?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
};

const sizeClassNames = {
  sm: "h-5 w-5 text-[8px]",
  md: "h-7 w-7 text-[10px]",
  lg: "h-9 w-9 text-[12px]"
};

export function BaseNetworkIcon({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        "inline-grid place-items-center overflow-hidden rounded-full bg-base-blue",
        className ?? "h-5 w-5"
      )}
      aria-label="Base network"
    >
      <svg viewBox="0 0 32 32" className="h-full w-full" aria-hidden="true">
        <circle cx="16" cy="16" r="16" fill="#0052FF" />
        <path
          d="M16.08 25.6c5.1 0 9.3-4.02 9.58-9.05h-6.2a3.55 3.55 0 1 1-.06-1.28h6.26c-.38-4.93-4.54-8.87-9.58-8.87a9.6 9.6 0 0 0 0 19.2Z"
          fill="white"
        />
      </svg>
    </span>
  );
}

export function TokenAvatar({
  symbol,
  logoUrl,
  size = "md",
  className
}: TokenAvatarProps) {
  const [failed, setFailed] = useState(false);
  const initial = symbol.trim().slice(0, 2).toUpperCase() || "?";

  return (
    <span
      className={cx(
        "relative grid shrink-0 place-items-center overflow-hidden rounded-full border border-base-line bg-base-mint/10 font-mono font-semibold text-base-mint",
        sizeClassNames[size],
        className
      )}
      title={symbol}
    >
      {logoUrl && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span>{initial}</span>
      )}
    </span>
  );
}

export function PairAvatarStack({
  baseSymbol,
  quoteSymbol,
  baseLogoUrl,
  quoteLogoUrl,
  size = "md"
}: {
  baseSymbol: string;
  quoteSymbol: string;
  baseLogoUrl?: string;
  quoteLogoUrl?: string;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <span className="flex shrink-0 items-center">
      <TokenAvatar symbol={baseSymbol} logoUrl={baseLogoUrl} size={size} />
      <TokenAvatar
        symbol={quoteSymbol}
        logoUrl={quoteLogoUrl}
        size={size}
        className="-ml-2 border-base-panel"
      />
    </span>
  );
}
