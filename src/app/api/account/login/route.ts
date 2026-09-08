import { NextRequest, NextResponse } from "next/server";
import { createLoginTransition, readAccountIntegrationConfig, setTransitionCookie } from "@/lib/account/server";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  try {
    const config = readAccountIntegrationConfig();
    if (!config) return unavailable(request);
    const locale = request.nextUrl.searchParams.get("locale") === "tr" ? "tr" : "en";
    const login = createLoginTransition(config, locale);
    const response = NextResponse.redirect(login.target, 303);
    response.headers.set("Cache-Control", "no-store");
    setTransitionCookie(response, login.cookie);
    return response;
  } catch {
    return unavailable(request);
  }
}

function unavailable(request: NextRequest) {
  const target = new URL("/terminal", request.url);
  target.searchParams.set("account", "unavailable");
  return NextResponse.redirect(target, 303);
}
