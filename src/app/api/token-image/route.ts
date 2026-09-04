import { sanitizeTokenLogoUrl } from "@/lib/safeUrl";

const MAX_IMAGE_BYTES = 1_500_000;
const MAX_REDIRECTS = 3;
const IMAGE_TYPES = new Set(["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export const runtime = "nodejs";

export async function GET(request: Request) {
  const source = sanitizeTokenLogoUrl(new URL(request.url).searchParams.get("src") ?? undefined);
  if (!source || source.startsWith("/")) return new Response("Invalid image source", { status: 400 });

  try {
    const upstream = await fetchAllowedImage(source);
    if (!upstream) return new Response("Image unavailable", { status: 502 });
    const contentType = upstream.headers.get("content-type")?.split(";", 1)[0]?.trim().toLocaleLowerCase("en-US");
    const declaredLength = readDeclaredLength(upstream.headers.get("content-length"));
    if (!upstream.ok || !contentType || !IMAGE_TYPES.has(contentType)) {
      await upstream.body?.cancel();
      return new Response("Image unavailable", { status: 502 });
    }
    if (declaredLength !== undefined && declaredLength > MAX_IMAGE_BYTES) {
      await upstream.body?.cancel();
      return new Response("Image too large", { status: 413 });
    }
    const bytes = await readBoundedBytes(upstream, MAX_IMAGE_BYTES);
    if (!bytes) return new Response("Image too large", { status: 413 });
    return new Response(bytes, {
      headers: {
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
        "Content-Type": contentType,
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch {
    return new Response("Image unavailable", { status: 504 });
  }
}

async function fetchAllowedImage(initialUrl: string) {
  let currentUrl = initialUrl;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetch(currentUrl, {
      headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif" },
      redirect: "manual",
      signal: AbortSignal.timeout(3_500)
    });
    if (!REDIRECT_STATUSES.has(response.status)) return response;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location || redirectCount === MAX_REDIRECTS) return undefined;
    const nextUrl = sanitizeTokenLogoUrl(new URL(location, currentUrl).toString());
    if (!nextUrl || nextUrl.startsWith("/")) return undefined;
    currentUrl = nextUrl;
  }
  return undefined;
}

async function readBoundedBytes(response: Response, maximumBytes: number) {
  if (!response.body) return undefined;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function readDeclaredLength(value: string | null) {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}
