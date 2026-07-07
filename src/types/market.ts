export type RiskLevel = "clear" | "watch" | "elevated" | "high";

export type TokenCategory =
  | "infra"
  | "defi"
  | "culture"
  | "gaming"
  | "social"
  | "utility";

export type RiskFlag = {
  label: string;
  level: RiskLevel;
  description: string;
};

export type TokenMarketSnapshot = {
  id: string;
  symbol: string;
  name: string;
  category: TokenCategory;
  demoAddress: string;
  description: string;
  priceUsd: number;
  priceChange1h: number;
  priceChange24h: number;
  volume24h: number;
  volumeChange24h: number;
  liquidityUsd: number;
  marketCapUsd: number;
  holders: number;
  ageHours: number;
  transactions24h: number;
  trendScore: number;
  sparkline: number[];
  riskLevel: RiskLevel;
  riskFlags: RiskFlag[];
  tags: string[];
};

export type MarketStat = {
  label: string;
  value: string;
  detail: string;
  tone: "mint" | "cyan" | "amber" | "rose";
};
