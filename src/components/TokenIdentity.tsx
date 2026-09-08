"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { cx } from "@/lib/format";
import { getTokenImageProxyUrl, sanitizeTokenLogoUrl } from "@/lib/safeUrl";
import { resolveAssetIdentity } from "@/lib/base-terminal/assetTradeability";

type TokenAvatarProps = {
  symbol: string;
  logoUrl?: string;
  address?: string;
  name?: string;
  chainId?: string | number;
  observedAt?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
};

const sizeClassNames = {
  sm: "h-5 w-5 text-meta",
  md: "h-7 w-7 text-meta",
  lg: "h-9 w-9 text-label"
};

export function MergenMark({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex h-7 w-5 shrink-0 items-center justify-center",
        className
      )}
      aria-label="Mergen.finance"
    >
      <Image
        src="/brand/mergen-mark.svg"
        alt=""
        width={409}
        height={538}
        className="h-7 w-auto object-contain"
        priority
      />
    </span>
  );
}

export function BaseNetworkIcon({ className }: { className?: string }) {
  return (
    <span
      className={cx("inline-flex h-5 w-5 shrink-0 items-center justify-center", className)}
      aria-label="Base network"
    >
      <Image
        src="/brand/base-logo.png"
        alt=""
        width={20}
        height={20}
        className="h-full w-full object-contain"
      />
    </span>
  );
}

export function TokenAvatar({
  symbol,
  logoUrl,
  address,
  name,
  chainId,
  observedAt,
  size = "md",
  className
}: TokenAvatarProps) {
  const [failed, setFailed] = useState(false);
  const initial = symbol.trim().slice(0, 2).toUpperCase() || "?";
  const { identity, safeLogoUrl, logoKind } = getTokenAvatarPresentation({ symbol, logoUrl, address, name, chainId, observedAt });
  useEffect(() => setFailed(false), [safeLogoUrl]);

  return (
    <span
      className={cx(
        "relative grid shrink-0 place-items-center overflow-hidden rounded-pill border border-border-subtle bg-surface-interactive font-mono font-semibold text-content-primary",
        sizeClassNames[size],
        className
      )}
      title={symbol}
      data-avatar-kind={safeLogoUrl && !failed ? logoKind : "generic"}
      data-identity-status={identity.status}
    >
      {safeLogoUrl && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={safeLogoUrl}
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

export function getTokenAvatarPresentation(input: Pick<TokenAvatarProps, "symbol" | "logoUrl" | "address" | "name" | "chainId" | "observedAt">) {
  const identity = resolveAssetIdentity({ chainId: input.chainId, tokenAddress: input.address, displayName: input.name, displaySymbol: input.symbol, observedAt: input.observedAt });
  const officialLogo = identity.status === "verified" ? sanitizeTokenLogoUrl(identity.officialLogoUrl) : undefined;
  // A provider image is decoration, never identity evidence. It is allowed only
  // beside an exact Base contract and never for an unverified brand-like claim.
  const exactBaseContract = (input.chainId === 8453 || input.chainId === "8453" || input.chainId === "base") && /^0x[0-9a-f]{40}$/i.test(input.address ?? "");
  const providerLogo = exactBaseContract && !identity.resemblesKnownBrand ? sanitizeTokenLogoUrl(input.logoUrl) : undefined;
  const selectedLogo = officialLogo ?? providerLogo;
  return { identity, safeLogoUrl: getTokenImageProxyUrl(selectedLogo), logoKind: officialLogo ? "verified-official" : providerLogo ? "provider-reported" : "generic" };
}

export function PairAvatarStack({
  baseSymbol,
  quoteSymbol,
  baseLogoUrl,
  quoteLogoUrl,
  baseAddress,
  quoteAddress,
  baseName,
  quoteName,
  chainId,
  observedAt,
  size = "md"
}: {
  baseSymbol: string;
  quoteSymbol: string;
  baseLogoUrl?: string;
  quoteLogoUrl?: string;
  baseAddress?: string;
  quoteAddress?: string;
  baseName?: string;
  quoteName?: string;
  chainId?: string | number;
  observedAt?: string;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <span className="flex shrink-0 items-center">
      <TokenAvatar symbol={baseSymbol} logoUrl={baseLogoUrl} address={baseAddress} name={baseName} chainId={chainId} observedAt={observedAt} size={size} />
      <TokenAvatar
        symbol={quoteSymbol}
        logoUrl={quoteLogoUrl}
        address={quoteAddress}
        name={quoteName}
        chainId={chainId}
        observedAt={observedAt}
        size={size}
        className="-ml-2 border-surface-panel"
      />
    </span>
  );
}
