import { NextRequest, NextResponse } from "next/server";
import { canonicalProfileUrl, readAccountIntegrationConfig } from "@/lib/account/server";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  try {
    const config = readAccountIntegrationConfig();
    if (!config) throw new Error("Account integration unavailable");
    const locale = request.nextUrl.searchParams.get("locale") === "tr" ? "tr" : "en";
    return NextResponse.redirect(canonicalProfileUrl(config, locale), 303);
  } catch {
    return NextResponse.redirect(new URL("/terminal?account=unavailable", request.url), 303);
  }
}
