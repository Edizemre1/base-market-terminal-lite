export const BASE_TRADE_CHAIN_ID = 8453;
export const NATIVE_TOKEN_ADDRESS = "0x0000000000000000000000000000000000000000";

export type TradeSide = "buy" | "sell";

export type TradeToken = {
  address: string;
  symbol: string;
  decimals: number;
};

export type QuoteRequest = {
  walletAddress: string;
  pairKey: string;
  side: TradeSide;
  fromToken: TradeToken;
  toToken: TradeToken;
  amount: string;
  fromAmountRaw: string;
  slippageBps: number;
  chainId: typeof BASE_TRADE_CHAIN_ID;
};

export type TradeFee = {
  name: string;
  amountRaw?: string;
  amountUsd?: string;
  tokenSymbol?: string;
};

export type TransactionDraft = {
  from: string;
  to: string;
  data: string;
  value: string;
  chainId: typeof BASE_TRADE_CHAIN_ID;
  gasLimit?: string;
};

// Server-provided calldata is a transaction quote, not yet an executable
// transaction. It becomes eligible for submission only after a fresh wallet
// simulation and all bound fields are revalidated on the client.
export type TransactionQuote = {
  kind: "transaction-quote";
  id: string;
  fingerprint: string;
  provider: "LI.FI" | "OpenOcean";
  route: string;
  walletAddress: string;
  pairKey: string;
  side: TradeSide;
  chainId: typeof BASE_TRADE_CHAIN_ID;
  fromToken: TradeToken;
  toToken: TradeToken;
  amount: string;
  fromAmountRaw: string;
  expectedAmountRaw: string;
  minimumAmountRaw: string;
  approvalAddress?: string;
  slippageBps: number;
  priceImpactPercent?: number;
  gasEstimate?: string;
  networkFeeUsd?: string;
  fees: TradeFee[];
  createdAt: string;
  expiresAt: string;
  transaction: TransactionDraft;
  simulation: "required";
};

export type TradeCapabilities = {
  quoteRequestEnabled: boolean;
  transactionExecutionEnabled: boolean;
  approvalRequestEnabled: boolean;
  swapRequestEnabled: boolean;
  providers: Array<{ name: "LI.FI" | "OpenOcean" | "Odos"; status: "enabled" | "disabled" | "circuit-open" }>;
};

export type QuoteProviderAdapter = {
  id: "LI.FI" | "OpenOcean";
  enabled: () => boolean;
  quote: (request: QuoteRequest, signal: AbortSignal) => Promise<Omit<TransactionQuote, "id" | "fingerprint" | "createdAt" | "expiresAt">>;
};

export type QuoteInvalidationInput = Pick<
  TransactionQuote,
  "walletAddress" | "pairKey" | "side" | "chainId" | "fromToken" | "toToken" | "amount" | "slippageBps"
>;
