import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const dynamic = "force-static";

export async function GET() {
  const icon = await readFile(join(process.cwd(), "public", "brand", "mergen-mark.svg"));

  return new Response(icon, {
    status: 200,
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=86400, immutable"
    }
  });
}
