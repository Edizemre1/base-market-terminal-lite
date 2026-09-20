import { NextRequest, NextResponse } from "next/server";
import { ACCOUNT_SESSION_COOKIE, clearAccountCookies, readAccountIntegrationConfig, readAccountSession } from "@/lib/account/server";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  try {
    const config = readAccountIntegrationConfig();
    if (!config) return accountResponse({ state: "profile_unavailable" }, 503);
    const session = readAccountSession(config, request.cookies.get(ACCOUNT_SESSION_COOKIE)?.value);
    if (!session) {
      const response = accountResponse({ state: "session_expired" }, 401);
      clearAccountCookies(response);
      return response;
    }
    return accountResponse({ state: "profile_ready", profile: session.profile }, 200);
  } catch {
    return accountResponse({ state: "profile_unavailable" }, 503);
  }
}

function accountResponse(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
