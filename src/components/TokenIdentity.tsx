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
        "inline-flex h-5 min-w-9 shrink-0 items-center justify-center border border-base-blue/25 bg-base-blue/5 px-1 font-mono text-[9px] font-semibold uppercase tracking-[0.08em] text-base-electric",
        className
      )}
      aria-label="Base network"
    >
      BASE
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
