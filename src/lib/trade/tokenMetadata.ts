import { NATIVE_TOKEN_ADDRESS } from "./types";
import { isEvmAddress } from "./validation";

const CACHE_TTL_MS = 60 * 60_000;
const MAX_CACHE_ENTRIES = 256;
const cache = new Map<string, { decimals: number; expiresAt: number }>();

export async function resolveBaseTokenDecimals(address: string) {
  if (!isEvmAddress(address)) throw new Error("Invalid Base token address");
  const key = address.toLowerCase();
  if (key === NATIVE_TOKEN_ADDRESS) return 18;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.decimals;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(process.env.BASE_RPC_URL?.trim() || "https://mainnet.base.org", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: key, data: "0x313ce567" }, "latest"] }),
      signal: controller.signal,
      cache: "no-store"
    });
    if (!response.ok) throw new Error("Token metadata request failed");
    const payload = await response.json() as { result?: unknown };
    if (typeof payload.result !== "string" || !/^0x[0-9a-f]+$/i.test(payload.result)) throw new Error("Token decimals are unavailable");
    const decimals = Number(BigInt(payload.result));
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error("Token decimals are invalid");
    cache.set(key, { decimals, expiresAt: Date.now() + CACHE_TTL_MS });
    while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
    return decimals;
  } finally {
    clearTimeout(timeout);
  }
}
