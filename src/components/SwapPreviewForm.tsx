"use client";

import { useMemo, useState } from "react";
import {
  ArrowDownUp,
  Ban,
  LockKeyhole,
  Route,
  ShieldAlert,
  WalletCards
} from "lucide-react";
import { PriceChange } from "@/components/PriceChange";
import { RiskBadge } from "@/components/RiskBadge";
import {
  MiniBarList,
  StatusPill,
  TerminalPanel
} from "@/components/TerminalWidgets";
import { cx } from "@/lib/format";
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
  const canPreview = cleanAmount > 0 && !sameToken;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <section className="border border-base-mint/40 bg-base-panel shadow-panel">
        <div className="border-b border-base-line bg-base-raised px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-base-mint">
                Execution ticket
              </p>
              <h2 className="mt-0.5 text-sm font-semibold text-base-text">
                UI-only route preview
              </h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusPill label="Mock quote" tone="blue" />
              <StatusPill label="Execution off" tone="amber" />
            </div>
          </div>
        </div>

        <div className="p-3">
          <div className="grid gap-3 lg:grid-cols-[1fr_44px_1fr] lg:items-center">
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
              className="mx-auto flex h-10 w-10 items-center justify-center border border-base-line bg-base-elevated text-base-muted transition hover:border-base-mint hover:text-base-mint"
              aria-label="Flip preview direction"
            >
              <ArrowDownUp size={16} aria-hidden="true" />
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

          <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_260px]">
            <div className="border border-base-line bg-base-elevated p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-base-muted">
                Demo slippage
              </p>
              <div className="grid grid-cols-3 gap-2">
                {slippageOptions.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setSlippage(option)}
                    className={cx(
                      "min-h-8 border px-2 py-1.5 font-mono text-xs font-semibold transition",
                      slippage === option
                        ? "border-base-mint bg-base-mint/10 text-base-mint"
                        : "border-base-line bg-base-panel text-base-muted hover:border-base-mint hover:text-base-text"
                    )}
                  >
                    {option.toFixed(1)}%
                  </button>
                ))}
              </div>
            </div>

            <div className="border border-base-line bg-base-elevated p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-base-muted">
                Ticket state
              </p>
              <div className="flex items-start gap-2">
                <Ban className="mt-0.5 shrink-0 text-base-amber" size={15} />
                <p className="text-xs leading-5 text-base-muted">
                  Preview mode only. No live transaction can be created from
                  this interface.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-3 grid gap-2 md:grid-cols-4">
            <QuoteMetric label="Input value" value={formatCurrency(amountUsd)} />
            <QuoteMetric
              label="Estimated output"
              value={`${formatNumber(estimatedOutput)} ${toToken?.symbol ?? ""}`}
            />
            <QuoteMetric label="Route" value={routeLabel} />
            <QuoteMetric
              label="Price impact"
              value={`${demoPriceImpact.toFixed(2)}%`}
            />
          </div>

          {!canPreview ? (
            <div className="mt-3 border border-base-amber/40 bg-base-amber/10 p-3 text-xs leading-5 text-base-amber">
              Select two different demo tokens and enter an amount to preview a
              mock route.
            </div>
          ) : null}

          <button
            type="button"
            disabled
            className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 border border-base-line bg-base-raised px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-base-muted"
          >
            <WalletCards size={15} aria-hidden="true" />
            Wallet connection not implemented
          </button>
        </div>
      </section>

      <aside className="space-y-4">
        <TerminalPanel label="Route" title="Mock path">
          <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-base-mint">
            <Route size={14} aria-hidden="true" />
            {routeLabel}
          </div>
          <MiniBarList
            items={[
              { label: "Depth confidence", value: routeDepth(fromToken, toToken), tone: "mint" },
              { label: "Impact control", value: impactScore(demoPriceImpact), tone: "blue" },
              { label: "Risk review", value: riskReviewScore(fromToken, toToken), tone: "rose" }
            ]}
          />
        </TerminalPanel>

        <TerminalPanel label="Checks" title="Risk checks">
          {fromToken && toToken ? (
            <div className="space-y-2">
              {[fromToken, toToken].map((token) => (
                <div
                  key={token.id}
                  className="border border-base-line bg-base-elevated p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-sm font-semibold text-base-text">
                        {token.symbol}
                      </p>
                      <p className="mt-1 text-[11px] text-base-muted">
                        {formatCompactCurrency(token.liquidityUsd)} liquidity
                      </p>
                    </div>
                    <RiskBadge level={token.riskLevel} compact />
                  </div>
                  <div className="mt-2">
                    <PriceChange value={token.priceChange24h} compact />
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </TerminalPanel>

        <TerminalPanel label="Fees" title="Execution disabled">
          <div className="space-y-2">
            <DisabledRow label="Platform fee" value="Not configured" />
            <DisabledRow label="Routing adapter" value="Not connected" />
            <DisabledRow label="Approval flow" value="Not implemented" />
            <DisabledRow label="Signing" value="Not implemented" />
          </div>
          <div className="mt-3 border border-base-rose/40 bg-base-rose/10 p-3">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-base-rose">
              <ShieldAlert size={14} aria-hidden="true" />
              UI-only boundary
            </div>
            <p className="text-xs leading-5 text-base-muted">
              No wallet signing, approvals, contract calls, or blockchain
              transactions are present in this MVP.
            </p>
          </div>
        </TerminalPanel>

        <TerminalPanel label="Lock" title="Public demo status">
          <div className="flex items-start gap-2">
            <LockKeyhole className="mt-0.5 shrink-0 text-base-mint" size={15} />
            <p className="text-xs leading-5 text-base-muted">
              Quote math uses only local mock token rows and cannot submit an
              order.
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
    <label className="block border border-base-line bg-base-elevated p-3">
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-base-muted">
        {label}
      </span>
      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_170px]">
        <input
          value={value}
          readOnly={readOnly}
          inputMode="decimal"
          onChange={(event) => onValueChange?.(event.target.value)}
          className="min-h-11 w-full border border-base-line bg-base-panel px-3 py-2 font-mono text-2xl font-semibold text-base-text outline-none transition placeholder:text-base-muted focus:border-base-mint"
          placeholder="0.00"
        />
        <select
          value={selectedSymbol}
          onChange={(event) => onSymbolChange(event.target.value)}
          className="min-h-11 w-full border border-base-line bg-base-panel px-3 py-2 font-mono text-sm font-semibold text-base-text outline-none transition focus:border-base-mint"
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

function QuoteMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-base-line bg-base-panel px-2 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-base-muted">
        {label}
      </p>
      <p className="mt-1 truncate font-mono text-sm font-semibold text-base-text">
        {value}
      </p>
    </div>
  );
}

function DisabledRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border border-base-line bg-base-elevated px-2 py-2 text-xs">
      <span className="text-base-muted">{label}</span>
      <span className="font-mono font-semibold text-base-text">{value}</span>
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
