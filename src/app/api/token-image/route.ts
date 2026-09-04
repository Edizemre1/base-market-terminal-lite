import { sanitizeTokenLogoUrl } from "@/lib/safeUrl";

const MAX_IMAGE_BYTES = 1_500_000;
const IMAGE_TYPES = new Set(["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"]);

export async function GET(request: Request) {
  const source = sanitizeTokenLogoUrl(new URL(request.url).searchParams.get("src") ?? undefined);
  if (!source || source.startsWith("/")) return new Response("Invalid image source", { status: 400 });

  try {
    const upstream = await fetch(source, {
      headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif" },
      redirect: "follow",
      signal: AbortSignal.timeout(3_500)
    });
    const finalUrl = sanitizeTokenLogoUrl(upstream.url);
    const contentType = upstream.headers.get("content-type")?.split(";", 1)[0]?.trim().toLocaleLowerCase("en-US");
    const declaredLength = Number(upstream.headers.get("content-length"));
    if (!upstream.ok || !finalUrl || !contentType || !IMAGE_TYPES.has(contentType) || (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES)) {
      return new Response("Image unavailable", { status: 502 });
    }
    const bytes = await upstream.arrayBuffer();
    if (bytes.byteLength > MAX_IMAGE_BYTES) return new Response("Image too large", { status: 413 });
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
