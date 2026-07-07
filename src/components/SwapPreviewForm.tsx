"use client";

import { useMemo, useState } from "react";
import { ArrowDownUp, LockKeyhole, WalletCards } from "lucide-react";
import { PriceChange } from "@/components/PriceChange";
import { RiskBadge } from "@/components/RiskBadge";
import { MiniBarList, StatusPill, TerminalPanel } from "@/components/TerminalWidgets";
import {
  cx,
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
  const cleanAmount =
    Number.isFinite(parsedAmount) && parsedAmount > 0 ? parsedAmount : 0;
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
  const routeLabel =
    fromToken && toToken ? `${fromToken.symbol} / AUSD / ${toToken.symbol}` : "-";

  return (
    <div className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_320px]">
      <TerminalPanel
        label="EXECUTION TICKET"
        title="UI-only route preview"
        meta={<StatusPill label="Execution disabled" tone="amber" />}
      >
        <div className="grid gap-2 lg:grid-cols-[1fr_34px_1fr] lg:items-center">
          <TokenAmountPanel
            label="Sell"
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
            className="mx-auto flex h-8 w-8 items-center justify-center border border-base-line bg-base-elevated text-base-muted hover:border-base-mint hover:text-base-mint"
            aria-label="Flip preview direction"
          >
            <ArrowDownUp size={14} aria-hidden="true" />
          </button>

          <TokenAmountPanel
            label="Buy"
            value={estimatedOutput > 0 ? estimatedOutput.toFixed(4) : "0"}
            readOnly
            selectedSymbol={toSymbol}
            onSymbolChange={setToSymbol}
            tokens={tokens}
          />
        </div>

        <div className="mt-2 grid gap-1 md:grid-cols-4">
          <TicketMetric label="Route" value={routeLabel} />
          <TicketMetric label="Input value" value={formatCurrency(amountUsd)} />
          <TicketMetric
            label="Output"
            value={`${formatNumber(estimatedOutput)} ${toToken?.symbol ?? ""}`}
          />
          <TicketMetric label="Impact" value={`${demoPriceImpact.toFixed(2)}%`} />
        </div>

        <div className="mt-2 grid gap-2 lg:grid-cols-[1fr_260px]">
          <div className="border border-base-line bg-base-elevated p-2">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-base-muted">
              Slippage
            </p>
            <div className="grid grid-cols-3 gap-1">
              {slippageOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setSlippage(option)}
                  className={cx(
                    "h-8 border px-2 font-mono text-[11px] font-semibold",
                    slippage === option
                      ? "border-base-mint bg-base-mint/10 text-base-mint"
                      : "border-base-line bg-base-panel text-base-muted hover:border-base-mint"
                  )}
                >
                  {option.toFixed(1)}%
                </button>
              ))}
            </div>
          </div>

          <div className="border border-base-line bg-base-elevated p-2">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-base-muted">
              Fee placeholder
            </p>
            <DisabledRow label="Platform fee" value="Not configured" />
            <DisabledRow label="Route fee" value="Disabled" />
          </div>
        </div>

        <button
          type="button"
          disabled
          className="mt-2 inline-flex h-9 w-full items-center justify-center gap-2 border border-base-line bg-base-raised px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-base-muted"
        >
          <WalletCards size={14} aria-hidden="true" />
          Disabled execution button
        </button>
      </TerminalPanel>

      <aside className="space-y-2">
        <TerminalPanel label="RISK CHECKS" title="Token checks">
          {fromToken && toToken ? (
            <div className="space-y-1">
              {[fromToken, toToken].map((token) => (
                <div
                  key={token.id}
                  className="border border-base-line bg-base-elevated p-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="font-mono text-[12px] font-semibold text-base-text">
                        {token.symbol}
                      </p>
                      <p className="text-[10px] text-base-muted">
                        {formatCompactCurrency(token.liquidityUsd)} liq
                      </p>
                    </div>
                    <RiskBadge level={token.riskLevel} compact />
                  </div>
                  <div className="mt-1">
                    <PriceChange value={token.priceChange24h} compact />
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </TerminalPanel>

        <TerminalPanel label="ROUTE HEALTH" title="Preview bars">
          <MiniBarList
            items={[
              { label: "Depth", value: routeDepth(fromToken, toToken), tone: "mint" },
              { label: "Impact", value: impactScore(demoPriceImpact), tone: "blue" },
              { label: "Risk", value: riskReviewScore(fromToken, toToken), tone: "rose" }
            ]}
          />
        </TerminalPanel>

        <TerminalPanel label="EXECUTION" title="Disabled boundary">
          <div className="flex items-start gap-2 border border-base-rose/40 bg-base-rose/10 p-2">
            <LockKeyhole className="mt-0.5 shrink-0 text-base-rose" size={14} />
            <p className="text-[11px] leading-4 text-base-muted">
              UI only. No wallet signing, approvals, contract calls, live swaps,
              or blockchain transactions are implemented.
            </p>
          </div>
        </TerminalPanel>
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
    <label className="block border border-base-line bg-base-elevated p-2">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-base-muted">
        {label}
      </span>
      <div className="mt-2 grid gap-1 sm:grid-cols-[1fr_155px]">
        <input
          value={value}
          readOnly={readOnly}
          inputMode="decimal"
          onChange={(event) => onValueChange?.(event.target.value)}
          className="h-9 w-full border border-base-line bg-base-panel px-2 font-mono text-lg font-semibold text-base-text outline-none placeholder:text-base-muted focus:border-base-mint"
          placeholder="0.00"
        />
        <select
          value={selectedSymbol}
          onChange={(event) => onSymbolChange(event.target.value)}
          className="h-9 w-full border border-base-line bg-base-panel px-2 font-mono text-[12px] font-semibold text-base-text outline-none focus:border-base-mint"
        >
          {tokens.map((token) => (
            <option key={token.id} value={token.symbol}>
              {token.symbol} / {token.name}
            </option>
          ))}
        </select>
      </div>
    </label>
  );
}

function TicketMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-base-line bg-base-panel px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-[0.12em] text-base-muted">{label}</p>
      <p className="mt-1 truncate font-mono text-[12px] font-semibold text-base-text">
        {value}
      </p>
    </div>
  );
}

function DisabledRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-1 flex items-center justify-between gap-2 text-[11px]">
      <span className="text-base-muted">{label}</span>
      <span className="font-mono text-base-text">{value}</span>
    </div>
  );
}

function routeDepth(
  fromToken: TokenMarketSnapshot | undefined,
  toToken: TokenMarketSnapshot | undefined
) {
  const liquidity = Math.min(
    fromToken?.liquidityUsd ?? 0,
    toToken?.liquidityUsd ?? 0
  );

  return Math.max(18, Math.min(92, Math.round((liquidity / 12000000) * 100)));
}

function impactScore(priceImpact: number) {
  return Math.max(12, Math.min(96, Math.round(96 - priceImpact * 10)));
}

function riskReviewScore(
  fromToken: TokenMarketSnapshot | undefined,
  toToken: TokenMarketSnapshot | undefined
) {
  const levels = [fromToken?.riskLevel, toToken?.riskLevel];
  if (levels.includes("high")) {
    return 20;
  }
  if (levels.includes("elevated")) {
    return 42;
  }
  if (levels.includes("watch")) {
    return 66;
  }

  return 88;
}
