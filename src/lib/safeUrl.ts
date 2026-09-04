const TOKEN_IMAGE_HOSTS = ["dexscreener.com", "coingecko.com"];

export function sanitizeTokenLogoUrl(value: string | undefined) {
  if (!value) return undefined;
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) return value;
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLocaleLowerCase("en-US");
    const allowed = TOKEN_IMAGE_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
    return parsed.protocol === "https:" && allowed && !parsed.username && !parsed.password && (!parsed.port || parsed.port === "443") ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function getTokenImageProxyUrl(value: string | undefined) {
  const safe = sanitizeTokenLogoUrl(value);
  if (!safe || safe.startsWith("/")) return safe;
  return `/api/token-image?src=${encodeURIComponent(safe)}`;
}

export function getBaseScanAddressUrl(address: string | undefined) {
  return address && /^0x[0-9a-f]{40}$/i.test(address)
    ? `https://basescan.org/address/${address.toLocaleLowerCase("en-US")}`
    : undefined;
}
