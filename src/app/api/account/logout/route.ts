import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { canonicalLogoutUrl, clearAccountCookies, isSameOriginFormPost, logoutTransferDocument, readAccountIntegrationConfig } from "@/lib/account/server";

export const dynamic = "force-dynamic";

export function POST(request: NextRequest) {
  if (!isSameOriginFormPost(request)) return new NextResponse(null, { status: 403 });
  try {
    const config = readAccountIntegrationConfig();
    if (!config) throw new Error("Account integration unavailable");
    const target = canonicalLogoutUrl(config);
    const nonce = randomBytes(18).toString("base64url");
    const locale = request.nextUrl.searchParams.get("locale") === "tr" ? "tr" : "en";
    const response = new NextResponse(logoutTransferDocument(target, locale, nonce), {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; form-action ${new URL(target).origin}; base-uri 'none'; frame-ancestors 'none'`,
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff"
      }
    });
    clearAccountCookies(response);
    return response;
  } catch {
    const response = NextResponse.redirect(new URL("/terminal?account=unavailable", request.url), 303);
    clearAccountCookies(response);
    return response;
  }
}

export function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
