export type CanonicalPrice = {
  value?: number;
  rawValue?: string;
  tier: "A" | "B" | "C" | "UNPRICED";
  kind: "direct" | "converted" | "unpriced";
  sourcePoolKeys: string[];
  anchor?: string;
  observedAt?: string;
  blockNumber?: number;
  freshness: "fresh" | "unavailable";
  reasonCode: string;
  qualityStatus?: "consensus" | "single_path";
  selectionReason?: string;
  maximumDeviation?: number;
};

export function calculateCanonicalUsdcPrice(tokenAddress: string, pools: Array<Record<string, unknown>>, now?: Date, options?: { maxAgeMs?: number; minimumLiquidityUsd?: number }): CanonicalPrice;
export function eventsAfterId<T extends { id: string }>(ring: T[], lastEventId?: string): T[];
