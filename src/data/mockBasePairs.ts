import type { BasePair } from "@/types/baseTerminal";

export const mockBasePairs: BasePair[] = [
  {
    id: "pepe-weth",
    pair: "PEPE / WETH",
    baseToken: "PEPE",
    quoteToken: "WETH",
    project: "Pepe on Base",
    address: "0xPepe...B4se",
    route: "WETH / PEPE",
    dex: "Uniswap V3",
    age: "12m",
    ageMinutes: 12,
    price: "0.000001248",
    priceUsd: "$0.00014",
    change24h: 18.64,
    volume24h: 432128,
    liquidity: 184231,
    inflow24h: 312400,
    momentumScore: 96,
    volumeMultiple: 3.2,
    riskScore: 27,
    riskLabel: "Low Risk",
    chart: [0.92, 0.88, 0.94, 0.98, 0.96, 1.02, 1.08, 1.04, 1.12, 1.18, 1.16, 1.24],
    pressure: { buy: 62, sell: 38 },
    holders: {
      top10: "18.6%",
      top50: "39.2%",
      top100: "55.1%",
      total: "2,341",
      active24h: "612"
    },
    poolAge: "12m",
    flags: ["No flags detected", "Source verified"],
    taxes: { buy: "0%", sell: "0%" },
    lpLock: { status: "100% Locked", provider: "Unicrypt", expires: "30d 23h" },
    riskChecks: [
      { label: "Contract verified", value: "Yes", ok: true },
      { label: "Mint function", value: "No", ok: true },
      { label: "Blacklist", value: "No", ok: true },
      { label: "Honeypot", value: "No", ok: true },
      { label: "LP lock", value: "100%", ok: true },
      { label: "Holder concentration", value: "18.6%", ok: true },
      { label: "Deployer activity", value: "Low", ok: true },
      { label: "Demo score", value: "27 / 100", ok: true }
    ],
    liquidityDetail: {
      poolLiquidity: "$184.2K",
      lpChange: "+6.33%",
      depth: "$41.8K within 2%",
      routeSource: "Uniswap V3"
    },
    activity: [
      { time: "19:06", side: "buy", amount: "4.8 WETH", value: "$15.2K", wallet: "0x3aF0...9B21" },
      { time: "19:03", side: "buy", amount: "1.2 WETH", value: "$3.8K", wallet: "0x91c4...A022" },
      { time: "18:58", side: "sell", amount: "900M PEPE", value: "$2.6K", wallet: "0x71e2...FF18" }
    ]
  },
  {
    id: "blob-usdc",
    pair: "BLOB / USDC",
    baseToken: "BLOB",
    quoteToken: "USDC",
    project: "Blob Market",
    address: "0xBlob...0420",
    route: "USDC / BLOB",
    dex: "Aerodrome",
    age: "28m",
    ageMinutes: 28,
    price: "0.2137",
    priceUsd: "$0.2137",
    change24h: 12.87,
    volume24h: 214600,
    liquidity: 92700,
    inflow24h: 176300,
    momentumScore: 82,
    volumeMultiple: 2.1,
    riskScore: 36,
    riskLabel: "Watch",
    chart: [0.76, 0.79, 0.78, 0.84, 0.89, 0.9, 0.96, 0.94, 1.02, 1.04, 1.08, 1.1],
    pressure: { buy: 58, sell: 42 },
    holders: {
      top10: "24.4%",
      top50: "44.9%",
      top100: "61.5%",
      total: "1,904",
      active24h: "488"
    },
    poolAge: "28m",
    flags: ["Fresh pool", "Source verified"],
    taxes: { buy: "0%", sell: "0%" },
    lpLock: { status: "84% Locked", provider: "Team locker", expires: "14d 08h" },
    riskChecks: [
      { label: "Contract verified", value: "Yes", ok: true },
      { label: "Mint function", value: "No", ok: true },
      { label: "Blacklist", value: "No", ok: true },
      { label: "Honeypot", value: "No", ok: true },
      { label: "LP lock", value: "84%", ok: true },
      { label: "Holder concentration", value: "24.4%", ok: true },
      { label: "Deployer activity", value: "Medium", ok: false },
      { label: "Demo score", value: "36 / 100", ok: true }
    ],
    liquidityDetail: {
      poolLiquidity: "$92.7K",
      lpChange: "+4.10%",
      depth: "$18.3K within 2%",
      routeSource: "Aerodrome"
    },
    activity: [
      { time: "19:01", side: "buy", amount: "9,200 USDC", value: "$9.2K", wallet: "0xA621...19dE" },
      { time: "18:55", side: "buy", amount: "3,100 USDC", value: "$3.1K", wallet: "0x8Ab1...5F20" },
      { time: "18:49", side: "sell", amount: "11,400 BLOB", value: "$2.4K", wallet: "0x4b11...7C99" }
    ]
  },
  {
    id: "toshi-weth",
    pair: "TOSHI / WETH",
    baseToken: "TOSHI",
    quoteToken: "WETH",
    project: "Toshi Relay",
    address: "0xTosh...C017",
    route: "WETH / TOSHI",
    dex: "Uniswap V2",
    age: "35m",
    ageMinutes: 35,
    price: "0.0004521",
    priceUsd: "$0.00045",
    change24h: 16.21,
    volume24h: 182400,
    liquidity: 76300,
    inflow24h: 121900,
    momentumScore: 88,
    volumeMultiple: 2.6,
    riskScore: 31,
    riskLabel: "Low Risk",
    chart: [0.81, 0.84, 0.82, 0.87, 0.91, 0.96, 0.93, 1.01, 1.03, 1.05, 1.02, 1.08],
    pressure: { buy: 64, sell: 36 },
    holders: {
      top10: "21.1%",
      top50: "36.4%",
      top100: "51.8%",
      total: "3,182",
      active24h: "734"
    },
    poolAge: "35m",
    flags: ["No flags detected", "LP lock visible"],
    taxes: { buy: "0%", sell: "0%" },
    lpLock: { status: "92% Locked", provider: "Unicrypt", expires: "22d 11h" },
    riskChecks: [
      { label: "Contract verified", value: "Yes", ok: true },
      { label: "Mint function", value: "No", ok: true },
      { label: "Blacklist", value: "No", ok: true },
      { label: "Honeypot", value: "No", ok: true },
      { label: "LP lock", value: "92%", ok: true },
      { label: "Holder concentration", value: "21.1%", ok: true },
      { label: "Deployer activity", value: "Low", ok: true },
      { label: "Demo score", value: "31 / 100", ok: true }
    ],
    liquidityDetail: {
      poolLiquidity: "$76.3K",
      lpChange: "+3.02%",
      depth: "$15.4K within 2%",
      routeSource: "Uniswap V2"
    },
    activity: [
      { time: "19:04", side: "buy", amount: "2.1 WETH", value: "$6.7K", wallet: "0x5A0e...22AF" },
      { time: "18:52", side: "sell", amount: "6.8M TOSHI", value: "$3.0K", wallet: "0xB34c...9710" },
      { time: "18:44", side: "buy", amount: "0.8 WETH", value: "$2.5K", wallet: "0xC821...D101" }
    ]
  },
  {
    id: "degen-weth",
    pair: "DEGEN / WETH",
    baseToken: "DEGEN",
    quoteToken: "WETH",
    project: "Degen Base Pool",
    address: "0xDegn...B00B",
    route: "WETH / DEGEN",
    dex: "BaseSwap",
    age: "48m",
    ageMinutes: 48,
    price: "0.00093",
    priceUsd: "$0.00093",
    change24h: 10.11,
    volume24h: 144800,
    liquidity: 61900,
    inflow24h: 94200,
    momentumScore: 76,
    volumeMultiple: 1.9,
    riskScore: 54,
    riskLabel: "Medium",
    chart: [0.92, 0.9, 0.95, 0.98, 0.94, 1.0, 1.06, 1.02, 1.09, 1.08, 1.11, 1.07],
    pressure: { buy: 53, sell: 47 },
    holders: {
      top10: "33.8%",
      top50: "58.7%",
      top100: "71.2%",
      total: "1,126",
      active24h: "281"
    },
    poolAge: "48m",
    flags: ["Holder concentration", "Fresh pool"],
    taxes: { buy: "0%", sell: "0%" },
    lpLock: { status: "71% Locked", provider: "Demo lock", expires: "7d 02h" },
    riskChecks: [
      { label: "Contract verified", value: "Yes", ok: true },
      { label: "Mint function", value: "No", ok: true },
      { label: "Blacklist", value: "No", ok: true },
      { label: "Honeypot", value: "No", ok: true },
      { label: "LP lock", value: "71%", ok: false },
      { label: "Holder concentration", value: "33.8%", ok: false },
      { label: "Deployer activity", value: "Medium", ok: false },
      { label: "Demo score", value: "54 / 100", ok: false }
    ],
    liquidityDetail: {
      poolLiquidity: "$61.9K",
      lpChange: "+1.22%",
      depth: "$9.7K within 2%",
      routeSource: "BaseSwap"
    },
    activity: [
      { time: "19:05", side: "sell", amount: "1.7M DEGEN", value: "$4.1K", wallet: "0x7100...2F8B" },
      { time: "18:59", side: "buy", amount: "1.3 WETH", value: "$4.0K", wallet: "0xE712...11A0" },
      { time: "18:47", side: "buy", amount: "0.5 WETH", value: "$1.6K", wallet: "0x91F0...3D77" }
    ]
  },
  {
    id: "mochi-usdc",
    pair: "MOCHI / USDC",
    baseToken: "MOCHI",
    quoteToken: "USDC",
    project: "Mochi Pool",
    address: "0xMoch...F00D",
    route: "USDC / MOCHI",
    dex: "Aerodrome",
    age: "1h 02m",
    ageMinutes: 62,
    price: "0.0001782",
    priceUsd: "$0.00018",
    change24h: 8.74,
    volume24h: 118700,
    liquidity: 88100,
    inflow24h: 71800,
    momentumScore: 70,
    volumeMultiple: 1.6,
    riskScore: 42,
    riskLabel: "Watch",
    chart: [1.0, 0.96, 0.98, 1.03, 1.01, 1.04, 1.08, 1.05, 1.1, 1.09, 1.13, 1.12],
    pressure: { buy: 55, sell: 45 },
    holders: {
      top10: "26.9%",
      top50: "49.1%",
      top100: "63.0%",
      total: "1,544",
      active24h: "356"
    },
    poolAge: "1h 02m",
    flags: ["Source verified", "LP lock visible"],
    taxes: { buy: "0%", sell: "1%" },
    lpLock: { status: "80% Locked", provider: "Team locker", expires: "18d 03h" },
    riskChecks: [
      { label: "Contract verified", value: "Yes", ok: true },
      { label: "Mint function", value: "No", ok: true },
      { label: "Blacklist", value: "No", ok: true },
      { label: "Honeypot", value: "No", ok: true },
      { label: "LP lock", value: "80%", ok: true },
      { label: "Holder concentration", value: "26.9%", ok: true },
      { label: "Deployer activity", value: "Medium", ok: false },
      { label: "Demo score", value: "42 / 100", ok: true }
    ],
    liquidityDetail: {
      poolLiquidity: "$88.1K",
      lpChange: "+2.40%",
      depth: "$13.1K within 2%",
      routeSource: "Aerodrome"
    },
    activity: [
      { time: "18:57", side: "buy", amount: "7,500 USDC", value: "$7.5K", wallet: "0xA120...7330" },
      { time: "18:50", side: "sell", amount: "9.2M MOCHI", value: "$1.6K", wallet: "0x2CB4...E890" },
      { time: "18:39", side: "buy", amount: "2,100 USDC", value: "$2.1K", wallet: "0x9221...7652" }
    ]
  },
  {
    id: "wif-weth",
    pair: "WIF / WETH",
    baseToken: "WIF",
    quoteToken: "WETH",
    project: "Wif on Base",
    address: "0xWif0...B45E",
    route: "WETH / WIF",
    dex: "Uniswap V3",
    age: "1h 11m",
    ageMinutes: 71,
    price: "0.0000731",
    priceUsd: "$0.00007",
    change24h: 7.32,
    volume24h: 276300,
    liquidity: 141600,
    inflow24h: 32700,
    momentumScore: 64,
    volumeMultiple: 1.5,
    riskScore: 47,
    riskLabel: "Watch",
    chart: [0.94, 0.96, 0.92, 0.95, 0.99, 0.97, 1.01, 1.03, 1.0, 1.05, 1.07, 1.08],
    pressure: { buy: 51, sell: 49 },
    holders: {
      top10: "29.2%",
      top50: "52.8%",
      top100: "67.4%",
      total: "2,005",
      active24h: "401"
    },
    poolAge: "1h 11m",
    flags: ["Fresh pool", "LP lock visible"],
    taxes: { buy: "0%", sell: "0%" },
    lpLock: { status: "76% Locked", provider: "Demo lock", expires: "12d 06h" },
    riskChecks: [
      { label: "Contract verified", value: "Yes", ok: true },
      { label: "Mint function", value: "No", ok: true },
      { label: "Blacklist", value: "No", ok: true },
      { label: "Honeypot", value: "No", ok: true },
      { label: "LP lock", value: "76%", ok: false },
      { label: "Holder concentration", value: "29.2%", ok: true },
      { label: "Deployer activity", value: "Medium", ok: false },
      { label: "Demo score", value: "47 / 100", ok: true }
    ],
    liquidityDetail: {
      poolLiquidity: "$141.6K",
      lpChange: "+0.88%",
      depth: "$24.2K within 2%",
      routeSource: "Uniswap V3"
    },
    activity: [
      { time: "18:53", side: "buy", amount: "1.5 WETH", value: "$4.7K", wallet: "0x0A88...F119" },
      { time: "18:35", side: "sell", amount: "18.4M WIF", value: "$1.3K", wallet: "0x18CF...0D62" },
      { time: "18:18", side: "buy", amount: "0.9 WETH", value: "$2.8K", wallet: "0x44F9...1818" }
    ]
  }
];

export function getDefaultPair() {
  return mockBasePairs[0];
}

export function getNewPairs() {
  return [...mockBasePairs].sort((left, right) => left.ageMinutes - right.ageMinutes);
}

export function getVolumeInflowPairs() {
  return [...mockBasePairs].sort((left, right) => right.inflow24h - left.inflow24h);
}

export function getMomentumPairs() {
  return [...mockBasePairs].sort(
    (left, right) => right.momentumScore - left.momentumScore
  );
}
