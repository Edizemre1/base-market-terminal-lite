import { NextRequest, NextResponse } from "next/server";
import {
  ACCOUNT_TRANSITION_COOKIE,
  clearAccountCookies,
  exchangeAuthorizationCode,
  readAccountIntegrationConfig,
  readLoginTransition,
  storeAccountSession
} from "@/lib/account/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const fallback = new URL("/terminal?account=unavailable", request.url);
  try {
    const config = readAccountIntegrationConfig();
    if (!config) return NextResponse.redirect(fallback, 303);
    const transition = readLoginTransition(config, request.cookies.get(ACCOUNT_TRANSITION_COOKIE)?.value);
    const state = request.nextUrl.searchParams.get("state");
    const code = request.nextUrl.searchParams.get("code");
    if (!transition || !state || state !== transition.state || !code || request.nextUrl.searchParams.has("error")) {
      const response = NextResponse.redirect(new URL("/terminal?account=expired", request.url), 303);
      clearAccountCookies(response);
      return response;
    }
    const session = await exchangeAuthorizationCode(config, code, transition);
    const response = NextResponse.redirect(new URL("/terminal?account=ready", request.url), 303);
    response.headers.set("Cache-Control", "no-store");
    clearAccountCookies(response);
    storeAccountSession(response, config, session);
    return response;
  } catch {
    const response = NextResponse.redirect(fallback, 303);
    clearAccountCookies(response);
    return response;
  }
}
