import type { MarketStat, RiskFlag, TokenMarketSnapshot } from "@/types/market";

const clearDemoFlag: RiskFlag = {
  label: "Demo clear",
  level: "clear",
  description: "No demo risk condition is attached to this mock row."
};

export const mockBaseTokens: TokenMarketSnapshot[] = [
  {
    id: "blueprint-base",
    symbol: "BLUE",
    name: "Blueprint Base",
    category: "infra",
    demoAddress: "demo:base:blue-001",
    description:
      "Mock infrastructure token used to model terminal watchlists, liquidity depth, and trend scoring.",
    priceUsd: 1.84,
    priceChange1h: 1.8,
    priceChange24h: 18.6,
    volume24h: 12840000,
    volumeChange24h: 64.4,
    liquidityUsd: 8150000,
    marketCapUsd: 184000000,
    holders: 41820,
    ageHours: 9432,
    transactions24h: 12840,
    trendScore: 96,
    sparkline: [1.41, 1.48, 1.45, 1.52, 1.59, 1.72, 1.84],
    riskLevel: "clear",
    riskFlags: [clearDemoFlag],
    tags: ["L2 infra", "High liquidity", "Momentum"]
  },
  {
    id: "mint-lane",
    symbol: "MINT",
    name: "Mint Lane",
    category: "defi",
    demoAddress: "demo:base:mint-002",
    description:
      "Demo DeFi token for showing volume acceleration, liquidity movement, and pool age metadata.",
    priceUsd: 0.092,
    priceChange1h: 3.1,
    priceChange24h: 31.2,
    volume24h: 6430000,
    volumeChange24h: 118.3,
    liquidityUsd: 2260000,
    marketCapUsd: 39200000,
    holders: 12760,
    ageHours: 284,
    transactions24h: 9570,
    trendScore: 91,
    sparkline: [0.061, 0.066, 0.071, 0.069, 0.079, 0.084, 0.092],
    riskLevel: "watch",
    riskFlags: [
      {
        label: "Fresh pool",
        level: "watch",
        description: "Demo pool age is below the conservative review threshold."
      }
    ],
    tags: ["New liquidity", "Fast volume", "DeFi"]
  },
  {
    id: "orbit-fi",
    symbol: "ORBIT",
    name: "OrbitFi",
    category: "defi",
    demoAddress: "demo:base:orbit-003",
    description:
      "Mock lending and routing token used to demonstrate detail-page liquidity and holder panels.",
    priceUsd: 4.21,
    priceChange1h: -0.7,
    priceChange24h: 7.9,
    volume24h: 9110000,
    volumeChange24h: 42.1,
    liquidityUsd: 13140000,
    marketCapUsd: 266000000,
    holders: 63890,
    ageHours: 11820,
    transactions24h: 15220,
    trendScore: 88,
    sparkline: [3.86, 3.91, 4.04, 4.02, 4.16, 4.09, 4.21],
    riskLevel: "clear",
    riskFlags: [clearDemoFlag],
    tags: ["Deep liquidity", "Routing", "Established"]
  },
  {
    id: "pixel-port",
    symbol: "PIXEL",
    name: "Pixel Port",
    category: "gaming",
    demoAddress: "demo:base:pixel-004",
    description:
      "Demo gaming token for showing cultural category filters and volatile new-token behavior.",
    priceUsd: 0.017,
    priceChange1h: 4.9,
    priceChange24h: 56.7,
    volume24h: 2790000,
    volumeChange24h: 244.8,
    liquidityUsd: 481000,
    marketCapUsd: 8500000,
    holders: 3810,
    ageHours: 37,
    transactions24h: 6180,
    trendScore: 86,
    sparkline: [0.009, 0.011, 0.012, 0.014, 0.013, 0.016, 0.017],
    riskLevel: "elevated",
    riskFlags: [
      {
        label: "Holder concentration",
        level: "elevated",
        description: "Demo holder distribution is intentionally concentrated."
      },
      {
        label: "Low liquidity",
        level: "watch",
        description: "Demo liquidity is thin relative to mock 24h volume."
      }
    ],
    tags: ["Gaming", "New", "Volatile"]
  },
  {
    id: "nova-social",
    symbol: "NOVA",
    name: "Nova Social",
    category: "social",
    demoAddress: "demo:base:nova-005",
    description:
      "Mock social token with steady transactions and neutral market movement for dashboard contrast.",
    priceUsd: 0.38,
    priceChange1h: 0.4,
    priceChange24h: 4.2,
    volume24h: 1840000,
    volumeChange24h: 18.5,
    liquidityUsd: 4020000,
    marketCapUsd: 29100000,
    holders: 24640,
    ageHours: 5210,
    transactions24h: 3420,
    trendScore: 73,
    sparkline: [0.35, 0.36, 0.37, 0.36, 0.38, 0.37, 0.38],
    riskLevel: "clear",
    riskFlags: [clearDemoFlag],
    tags: ["Social", "Steady", "Mid cap"]
  },
  {
    id: "anchor-usd",
    symbol: "AUSD",
    name: "Anchor USD",
    category: "utility",
    demoAddress: "demo:base:ausd-006",
    description:
      "Stable-value demo asset for swap previews, denominator views, and conservative risk states.",
    priceUsd: 1.0,
    priceChange1h: 0.0,
    priceChange24h: 0.1,
    volume24h: 21700000,
    volumeChange24h: 11.2,
    liquidityUsd: 45900000,
    marketCapUsd: 512000000,
    holders: 154300,
    ageHours: 14320,
    transactions24h: 29100,
    trendScore: 71,
    sparkline: [1, 1, 0.999, 1.001, 1, 1, 1],
    riskLevel: "clear",
    riskFlags: [clearDemoFlag],
    tags: ["Stable", "Utility", "Swap pair"]
  },
  {
    id: "crown-culture",
    symbol: "CROWN",
    name: "Crown Culture",
    category: "culture",
    demoAddress: "demo:base:crown-007",
    description:
      "Meme and culture demo token used to model speculative watch labels and sudden liquidity shifts.",
    priceUsd: 0.0064,
    priceChange1h: -2.6,
    priceChange24h: 23.9,
    volume24h: 3890000,
    volumeChange24h: 171.5,
    liquidityUsd: 710000,
    marketCapUsd: 11400000,
    holders: 9020,
    ageHours: 116,
    transactions24h: 8270,
    trendScore: 84,
    sparkline: [0.0048, 0.0052, 0.006, 0.0068, 0.0061, 0.0066, 0.0064],
    riskLevel: "watch",
    riskFlags: [
      {
        label: "Liquidity watch",
        level: "watch",
        description: "Demo liquidity is moving quickly against simulated volume."
      }
    ],
    tags: ["Culture", "Momentum", "Watch"]
  },
  {
    id: "pulse-tools",
    symbol: "PULSE",
    name: "Pulse Tools",
    category: "utility",
    demoAddress: "demo:base:pulse-008",
    description:
      "Mock analytics utility token used to demonstrate low-volume risk and table filtering states.",
    priceUsd: 0.144,
    priceChange1h: -1.4,
    priceChange24h: -8.3,
    volume24h: 420000,
    volumeChange24h: -22.7,
    liquidityUsd: 980000,
    marketCapUsd: 17600000,
    holders: 5940,
    ageHours: 1680,
    transactions24h: 840,
    trendScore: 58,
    sparkline: [0.161, 0.158, 0.154, 0.149, 0.151, 0.147, 0.144],
    riskLevel: "watch",
    riskFlags: [
      {
        label: "Volume fade",
        level: "watch",
        description: "Demo 24h volume is slowing relative to earlier samples."
      }
    ],
    tags: ["Utility", "Analytics", "Cooling"]
  },
  {
    id: "flash-pair",
    symbol: "FLASH",
    name: "Flash Pair",
    category: "defi",
    demoAddress: "demo:base:flash-009",
    description:
      "High-risk demo token included only to show scam-pattern labels and blocked swap preview states.",
    priceUsd: 0.0021,
    priceChange1h: 11.9,
    priceChange24h: 84.4,
    volume24h: 1250000,
    volumeChange24h: 390.2,
    liquidityUsd: 92000,
    marketCapUsd: 2100000,
    holders: 730,
    ageHours: 12,
    transactions24h: 4110,
    trendScore: 69,
    sparkline: [0.0008, 0.001, 0.0016, 0.0013, 0.0019, 0.0022, 0.0021],
    riskLevel: "high",
    riskFlags: [
      {
        label: "Scam pattern demo",
        level: "high",
        description: "Demo-only label for unsafe pattern handling in the UI."
      },
      {
        label: "Trading pause simulation",
        level: "elevated",
        description: "Demo control flag used to test warning states."
      }
    ],
    tags: ["Demo risk", "Very new", "Thin liquidity"]
  },
  {
    id: "build-index",
    symbol: "BUILD",
    name: "Build Index",
    category: "infra",
    demoAddress: "demo:base:build-010",
    description:
      "Mock index-style token representing builder tools and broad ecosystem discovery screens.",
    priceUsd: 2.68,
    priceChange1h: 0.9,
    priceChange24h: 12.1,
    volume24h: 5360000,
    volumeChange24h: 73.8,
    liquidityUsd: 7210000,
    marketCapUsd: 147000000,
    holders: 31220,
    ageHours: 8040,
    transactions24h: 6840,
    trendScore: 82,
    sparkline: [2.29, 2.34, 2.41, 2.52, 2.48, 2.61, 2.68],
    riskLevel: "clear",
    riskFlags: [clearDemoFlag],
    tags: ["Builder", "Index", "Infra"]
  }
];

export const marketStats: MarketStat[] = [
  {
    label: "Demo tokens tracked",
    value: mockBaseTokens.length.toString(),
    detail: "All rows are mock data",
    tone: "mint"
  },
  {
    label: "Mock 24h volume",
    value: "$65.6M",
    detail: "Aggregated from demo rows",
    tone: "cyan"
  },
  {
    label: "Risk labels",
    value: "4 levels",
    detail: "Clear, watch, elevated, high",
    tone: "amber"
  },
  {
    label: "Execution",
    value: "Off",
    detail: "Disabled preview only",
    tone: "rose"
  }
];

export function getTokenBySymbol(symbol: string) {
  return mockBaseTokens.find(
    (token) => token.symbol.toLowerCase() === symbol.toLowerCase()
  );
}

export function getTrendingTokens(limit = 6) {
  return [...mockBaseTokens]
    .sort((left, right) => right.trendScore - left.trendScore)
    .slice(0, limit);
}

export function getNewTokens(limit = 6) {
  return [...mockBaseTokens]
    .sort((left, right) => left.ageHours - right.ageHours)
    .slice(0, limit);
}

export function getVolumeGainers(limit = 6) {
  return [...mockBaseTokens]
    .sort((left, right) => right.volumeChange24h - left.volumeChange24h)
    .slice(0, limit);
}

export function getSwapPreviewTokens() {
  return mockBaseTokens.filter((token) => token.riskLevel !== "high");
}
