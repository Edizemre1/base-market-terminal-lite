import { Activity, Database, ShieldAlert } from "lucide-react";
import { PriceChange } from "@/components/PriceChange";
import { RiskBadge } from "@/components/RiskBadge";
import { Sparkline } from "@/components/Sparkline";
import { formatCompactCurrency, formatCurrency } from "@/lib/format";
import type { TokenMarketSnapshot } from "@/types/market";

export function LandingTerminalPreview({
  tokens
}: {
  tokens: TokenMarketSnapshot[];
}) {
  return (
    <div className="pointer-events-none absolute inset-x-4 bottom-0 mx-auto hidden max-w-6xl translate-y-[42%] lg:block">
      <div className="market-scanline rounded-lg border border-base-line bg-base-panel/95 p-4 shadow-panel backdrop-blur">
        <div className="mb-4 flex items-center justify-between border-b border-base-line pb-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-base-electric">
            <Activity size={14} aria-hidden="true" />
            Base demo market pulse
          </div>
          <div className="flex items-center gap-2 text-xs text-base-amber">
            <ShieldAlert size={14} aria-hidden="true" />
            No live execution
          </div>
        </div>

        <div className="grid grid-cols-[1.2fr_0.7fr_0.7fr_1fr_0.7fr] gap-3 px-3 pb-2 text-[11px] uppercase tracking-[0.18em] text-base-muted">
          <span>Token</span>
          <span>Price</span>
          <span>24h</span>
          <span>Signal</span>
          <span>Risk</span>
        </div>

        <div className="space-y-2">
          {tokens.map((token) => (
            <div
              key={token.id}
              className="grid grid-cols-[1.2fr_0.7fr_0.7fr_1fr_0.7fr] items-center gap-3 rounded-lg border border-base-line bg-base-raised/60 px-3 py-3"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-base-blue/40 bg-base-blue/10 text-xs font-bold text-base-electric">
                  {token.symbol.slice(0, 2)}
                </span>
                <span>
                  <span className="block text-sm font-semibold text-base-text">
                    {token.symbol}
                  </span>
                  <span className="block text-xs text-base-muted">
                    {formatCompactCurrency(token.volume24h)} vol
                  </span>
                </span>
              </div>
              <span className="text-sm font-semibold tabular-nums text-base-text">
                {formatCurrency(token.priceUsd, token.priceUsd < 0.1 ? 4 : 2)}
              </span>
              <PriceChange value={token.priceChange24h} compact />
              <Sparkline
                points={token.sparkline}
                positive={token.priceChange24h >= 0}
              />
              <RiskBadge level={token.riskLevel} compact />
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center gap-2 text-xs text-base-muted">
          <Database size={14} aria-hidden="true" />
          Demo rows are loaded from local mock data only.
        </div>
      </div>
    </div>
  );
}
