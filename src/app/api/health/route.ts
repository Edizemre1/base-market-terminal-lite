import { NextResponse } from "next/server";
import { APP_NAME, APP_VERSION } from "@/lib/appInfo";
import { getTradeCapabilities } from "@/lib/trade/quoteProviders";
import { getOnchainCollectorHealth } from "@/lib/base-terminal/onchainDiscovery";
import { getOnchainRelayClientCount } from "@/lib/base-terminal/onchainRelay";

export const dynamic = "force-dynamic";

export function GET() {
  const trade = getTradeCapabilities();
  const collector = getOnchainCollectorHealth(getOnchainRelayClientCount());
  return NextResponse.json({
    ok: true,
    app: APP_NAME,
    version: APP_VERSION,
    timestamp: new Date().toISOString(),
    readOnly: !trade.transactionExecutionEnabled,
    publicReadOnlyReady: true,
    marketDataReady: true,
    livePulseEnabled: true,
    opportunityStreamEnabled: true,
    onchainDiscoveryReady: collector.ready,
    onchainCollector: collector,
    stableMarketUpdatesEnabled: true,
    localAlertsEnabled: true,
    marketSnapshotRefreshSeconds: 12,
    marketSnapshotBackgroundRefreshSeconds: 60,
    tokenSearchReady: true,
    advancedChartsAssetsAvailable: false,
    walletConnectionEnabled: true,
    walletAccountReadEnabled: true,
    walletBalanceReadEnabled: true,
    walletTargetChainId: 8453,
    quoteRequestEnabled: trade.quoteRequestEnabled,
    quoteProviders: trade.providers,
    approvalRequestEnabled: trade.approvalRequestEnabled,
    swapRequestEnabled: trade.swapRequestEnabled,
    transactionExecutionEnabled: trade.transactionExecutionEnabled,
    authenticationRequiredForPrivateData: true
  });
}
