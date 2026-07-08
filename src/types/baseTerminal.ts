export type PairRiskCheck = {
  label: string;
  value: string;
  ok: boolean;
};

export type PairActivity = {
  time: string;
  side: "buy" | "sell";
  amount: string;
  value: string;
  wallet: string;
};

export type BasePair = {
  id: string;
  pair: string;
  baseToken: string;
  quoteToken: string;
  project: string;
  address: string;
  route: string;
  dex: string;
  age: string;
  ageMinutes: number;
  price: string;
  priceUsd: string;
  change24h: number;
  volume24h: number;
  liquidity: number;
  inflow24h: number;
  momentumScore: number;
  volumeMultiple: number;
  riskScore: number;
  riskLabel: string;
  chart: number[];
  pressure: {
    buy: number;
    sell: number;
  };
  holders: {
    top10: string;
    top50: string;
    top100: string;
    total: string;
    active24h: string;
  };
  poolAge: string;
  flags: string[];
  taxes: {
    buy: string;
    sell: string;
  };
  lpLock: {
    status: string;
    provider: string;
    expires: string;
  };
  riskChecks: PairRiskCheck[];
  liquidityDetail: {
    poolLiquidity: string;
    lpChange: string;
    depth: string;
    routeSource: string;
  };
  activity: PairActivity[];
};
