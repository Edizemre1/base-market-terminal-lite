import { parseStrictFiniteNumber } from "@/lib/marketMath";

type FetchInit = RequestInit & {
  next?: {
    revalidate: number;
  };
};

export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function readRecord(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined;
}

export function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function readNumber(value: unknown): number | undefined {
  return parseStrictFiniteNumber(value);
}

export function readHttpUrl(value: unknown): string | undefined {
  const url = readString(value);

  if (!url) {
    return undefined;
  }

  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

export function readAllowedHttpsUrl(value: unknown, allowedHosts: string[]) {
  const url = readString(value);
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLocaleLowerCase("en-US");
    const allowed = allowedHosts.some((host) => {
      const normalizedHost = host.toLocaleLowerCase("en-US");
      return hostname === normalizedHost || hostname.endsWith(`.${normalizedHost}`);
    });
    return parsed.protocol === "https:" && allowed ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

export async function fetchJsonWithTimeout(
  url: string,
  init: FetchInit,
  timeoutMs: number
): Promise<unknown | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal
    });

    if (!response.ok) {
      return undefined;
    }

    return await response.json();
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}
