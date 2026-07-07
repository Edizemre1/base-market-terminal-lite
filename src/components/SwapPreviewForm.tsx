"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowDownUp, Ban, Route, WalletCards } from "lucide-react";
import { PriceChange } from "@/components/PriceChange";
import { RiskBadge } from "@/components/RiskBadge";
import {
  formatCompactCurrency,
  formatCurrency,
  formatNumber
} from "@/lib/format";
import type { TokenMarketSnapshot } from "@/types/market";

const slippageOptions = [0.3, 0.5, 1.0];

export function SwapPreviewForm({
  tokens
}: {
  tokens: TokenMarketSnapshot[];
}) {
  const [fromSymbol, setFromSymbol] = useState(tokens[0]?.symbol ?? "");
  const [toSymbol, setToSymbol] = useState(tokens[1]?.symbol ?? "");
  const [amount, setAmount] = useState("250");
  const [slippage, setSlippage] = useState(0.5);

  const fromToken = useMemo(
    () => tokens.find((token) => token.symbol === fromSymbol) ?? tokens[0],
    [fromSymbol, tokens]
  );
  const toToken = useMemo(
    () => tokens.find((token) => token.symbol === toSymbol) ?? tokens[1] ?? tokens[0],
    [toSymbol, tokens]
  );

  const parsedAmount = Number.parseFloat(amount);
  const cleanAmount = Number.isFinite(parsedAmount) && parsedAmount > 0 ? parsedAmount : 0;
  const sameToken = fromToken?.symbol === toToken?.symbol;
  const amountUsd = cleanAmount * (fromToken?.priceUsd ?? 0);
  const estimatedOutput =
    fromToken && toToken && !sameToken
      ? (amountUsd / toToken.priceUsd) * (1 - slippage / 100)
      : 0;
  const demoPriceImpact =
    fromToken && amountUsd > 0
      ? Math.min(7.5, (amountUsd / fromToken.liquidityUsd) * 100 * 0.8)
      : 0;
  const routeLabel = fromToken && toToken ? `${fromToken.symbol} → AUSD → ${toToken.symbol}` : "-";
  const canPreview = cleanAmount > 0 && !sameToken;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="rounded-lg border border-white/10 bg-base-panel p-5">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-base-mint">
              UI only
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-white">
              Swap preview
            </h2>
          </div>
          <div className="inline-flex items-center gap-2 rounded border border-base-amber/30 bg-base-amber/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-base-amber">
            <Ban size={14} aria-hidden="true" />
            Disabled
          </div>
        </div>

        <div className="space-y-4">
          <TokenAmountPanel
            label="From"
            value={amount}
            onValueChange={setAmount}
            selectedSymbol={fromSymbol}
            onSymbolChange={setFromSymbol}
            tokens={tokens}
          />

          <button
            type="button"
            onClick={() => {
              setFromSymbol(toSymbol);
              setToSymbol(fromSymbol);
            }}
            className="mx-auto flex h-11 w-11 items-center justify-center rounded border border-white/10 bg-white/[0.05] text-emerald-50/70 transition hover:border-base-mint/40 hover:text-base-mint"
            aria-label="Flip preview direction"
          >
            <ArrowDownUp size={17} aria-hidden="true" />
          </button>

          <TokenAmountPanel
            label="To"
            value={estimatedOutput > 0 ? estimatedOutput.toFixed(4) : "0"}
            readOnly
            selectedSymbol={toSymbol}
            onSymbolChange={setToSymbol}
            tokens={tokens}
          />
        </div>

        <div className="mt-5">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-50/50">
            Demo slippage
          </p>
          <div className="grid grid-cols-3 gap-2">
            {slippageOptions.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setSlippage(option)}
                className={`min-h-10 rounded border px-3 py-2 text-sm font-semibold transition ${
                  slippage === option
                    ? "border-base-mint/40 bg-base-mint/20 text-base-mint"
                    : "border-white/10 bg-white/[0.04] text-emerald-50/70 hover:border-base-mint/30"
                }`}
              >
                {option.toFixed(1)}%
              </button>
            ))}
          </div>
        </div>

        {!canPreview ? (
          <div className="mt-5 rounded-lg border border-base-amber/30 bg-base-amber/10 p-4 text-sm leading-6 text-base-amber">
            Select two different demo tokens and enter an amount to preview a mock
            quote.
          </div>
        ) : null}

        <button
          type="button"
          disabled
          className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-emerald-50/50"
        >
          <WalletCards size={17} aria-hidden="true" />
          Wallet connection not implemented
        </button>
      </div>

      <aside className="space-y-4">
        <div className="rounded-lg border border-white/10 bg-base-panel p-5">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-base-cyan">
            <Route size={16} aria-hidden="true" />
            Mock route
          </div>
          <dl className="space-y-4 text-sm">
            <QuoteRow label="Input value" value={formatCurrency(amountUsd)} />
            <QuoteRow
              label="Estimated output"
              value={`${formatNumber(estimatedOutput)} ${toToken?.symbol ?? ""}`}
            />
            <QuoteRow label="Route" value={routeLabel} />
            <QuoteRow label="Price impact" value={`${demoPriceImpact.toFixed(2)}%`} />
            <QuoteRow label="Liquidity source" value="Local demo data" />
          </dl>
        </div>

        {fromToken && toToken ? (
          <div className="rounded-lg border border-white/10 bg-base-panel p-5">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-base-amber">
              <AlertTriangle size={16} aria-hidden="true" />
              Preview checks
            </div>
            <div className="space-y-3">
              {[fromToken, toToken].map((token) => (
                <div
                  key={token.id}
                  className="rounded-lg border border-white/10 bg-white/[0.04] p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-white">{token.symbol}</p>
                      <p className="mt-1 text-xs text-emerald-50/50">
                        {formatCompactCurrency(token.liquidityUsd)} liquidity
                      </p>
                    </div>
                    <RiskBadge level={token.riskLevel} compact />
                  </div>
                  <div className="mt-3">
                    <PriceChange value={token.priceChange24h} compact />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function TokenAmountPanel({
  label,
  value,
  onValueChange,
  selectedSymbol,
  onSymbolChange,
  tokens,
  readOnly = false
}: {
  label: string;
  value: string;
  onValueChange?: (value: string) => void;
  selectedSymbol: string;
  onSymbolChange: (value: string) => void;
  tokens: TokenMarketSnapshot[];
  readOnly?: boolean;
}) {
  return (
    <label className="block rounded-lg border border-white/10 bg-white/[0.04] p-4">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-50/50">
        {label}
      </span>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_180px]">
        <input
          value={value}
          readOnly={readOnly}
          inputMode="decimal"
          onChange={(event) => onValueChange?.(event.target.value)}
          className="min-h-12 w-full rounded border border-white/10 bg-black/30 px-3 py-2 text-2xl font-semibold text-white outline-none transition placeholder:text-emerald-50/30 focus:border-base-mint/50"
          placeholder="0.00"
        />
        <select
          value={selectedSymbol}
          onChange={(event) => onSymbolChange(event.target.value)}
          className="min-h-12 w-full rounded border border-white/10 bg-base-raised px-3 py-2 text-sm font-semibold text-white outline-none transition focus:border-base-mint/50"
        >
          {tokens.map((token) => (
            <option key={token.id} value={token.symbol}>
              {token.symbol} · {token.name}
            </option>
          ))}
        </select>
      </div>
    </label>
  );
}

function QuoteRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/[0.06] pb-3 last:border-0 last:pb-0">
      <dt className="text-emerald-50/50">{label}</dt>
      <dd className="max-w-[13rem] text-right font-semibold text-white">{value}</dd>
    </div>
  );
}
