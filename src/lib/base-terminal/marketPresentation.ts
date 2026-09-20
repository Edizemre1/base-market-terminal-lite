import type { TokenOpportunity } from "@/lib/base-terminal/opportunityModel";
import { isEvmAddress } from "@/lib/trade/validation";
import type { BasePair } from "@/types/baseTerminal";

export type MarketRoutePresentation =
  | { kind: "direct_usdc" }
  | { kind: "via_quote"; quote: string }
  | { kind: "unpriced" };

export function getMarketPresentation(pair: BasePair, opportunity?: TokenOpportunity) {
  const symbol = opportunity?.focusTokenSymbol ?? pair.focusTokenSymbol ?? pair.baseToken;
  let route: MarketRoutePresentation;
  if (opportunity?.canonicalPrice.tier === "UNPRICED") route = { kind: "unpriced" };
  else if (opportunity?.canonicalPrice.reasonCode === "direct_usdc_pool") route = { kind: "direct_usdc" };
  else route = { kind: "via_quote", quote: pair.quoteToken };
  return { symbol, route };
}

export function hasExactTradeTarget(pair: BasePair, opportunity?: TokenOpportunity) {
  return isEvmAddress(opportunity?.focusTokenAddress ?? pair.focusTokenAddress ?? pair.baseTokenAddress);
}
