import { NextResponse } from "next/server";
import { APP_NAME, APP_VERSION } from "@/lib/appInfo";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    ok: true,
    app: APP_NAME,
    version: APP_VERSION,
    timestamp: new Date().toISOString(),
    readOnly: true,
    publicReadOnlyReady: true,
    marketDataReady: true,
    tokenSearchReady: true,
    advancedChartsAssetsAvailable: false,
    walletConnectionEnabled: true,
    walletAccountReadEnabled: true,
    walletBalanceReadEnabled: true,
    walletTargetChainId: 8453,
    approvalRequestEnabled: false,
    swapRequestEnabled: false,
    transactionExecutionEnabled: false,
    authenticationRequiredForPrivateData: true
  });
}
