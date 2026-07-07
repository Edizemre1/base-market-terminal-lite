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
      <div className="rounded-lg border border-white/10 bg-base-panel/90 p-4 shadow-2xl shadow-black/40 backdrop-blur">
        <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-50/50">
            <Activity size={14} aria-hidden="true" />
            Demo market pulse
          </div>
          <div className="flex items-center gap-2 text-xs text-base-amber">
            <ShieldAlert size={14} aria-hidden="true" />
            No live execution
          </div>
        </div>

        <div className="grid grid-cols-[1.2fr_0.7fr_0.7fr_1fr_0.7fr] gap-3 px-3 pb-2 text-xs uppercase tracking-[0.16em] text-emerald-50/40">
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
              className="grid grid-cols-[1.2fr_0.7fr_0.7fr_1fr_0.7fr] items-center gap-3 rounded border border-white/[0.06] bg-white/[0.035] px-3 py-3"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded border border-base-mint/25 bg-base-mint/10 text-xs font-bold text-base-mint">
                  {token.symbol.slice(0, 2)}
                </span>
                <span>
                  <span className="block text-sm font-semibold text-white">
                    {token.symbol}
                  </span>
                  <span className="block text-xs text-emerald-50/50">
                    {formatCompactCurrency(token.volume24h)} vol
                  </span>
                </span>
              </div>
              <span className="text-sm font-semibold text-white">
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

        <div className="mt-4 flex items-center gap-2 text-xs text-emerald-50/50">
          <Database size={14} aria-hidden="true" />
          Demo rows are loaded from local mock data only.
        </div>
      </div>
    </div>
  );
}
