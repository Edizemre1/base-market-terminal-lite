import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { PriceChange } from "@/components/PriceChange";
import { RiskBadge } from "@/components/RiskBadge";
import { Sparkline } from "@/components/Sparkline";
import {
  formatAge,
  formatCompactCurrency,
  formatCurrency,
  formatNumber
} from "@/lib/format";
import type { TokenMarketSnapshot } from "@/types/market";

export function TokenTable({
  tokens,
  label
}: {
  tokens: TokenMarketSnapshot[];
  label: string;
}) {
  return (
    <div className="overflow-hidden border border-base-line bg-base-panel shadow-panel">
      <div className="flex items-center justify-between border-b border-base-line bg-base-raised px-3 py-2">
        <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-base-mint">
          {label}
        </div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-base-muted">
          Mock feed
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] border-collapse text-xs">
          <thead>
            <tr className="border-b border-base-line bg-base-elevated text-left text-[10px] uppercase tracking-[0.14em] text-base-muted">
              <th className="px-3 py-2 font-medium">Asset</th>
              <th className="px-3 py-2 font-medium">Price</th>
              <th className="px-3 py-2 font-medium">24h</th>
              <th className="px-3 py-2 font-medium">Volume</th>
              <th className="px-3 py-2 font-medium">Liquidity</th>
              <th className="px-3 py-2 font-medium">Age</th>
              <th className="px-3 py-2 font-medium">Signal</th>
              <th className="px-3 py-2 font-medium">Risk</th>
              <th className="px-3 py-2 font-medium">Open</th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((token) => (
              <tr
                key={token.id}
                className="border-b border-base-line/80 transition hover:bg-base-mint/5"
              >
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center border border-base-line bg-base-elevated text-[10px] font-bold text-base-mint">
                      {token.symbol.slice(0, 2)}
                    </div>
                    <div>
                      <Link
                        href={`/tokens/${token.symbol.toLowerCase()}`}
                        className="font-semibold text-base-text hover:text-base-mint"
                      >
                        {token.name}
                      </Link>
                      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-base-muted">
                        {token.symbol} / {token.category}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2 font-mono font-medium tabular-nums text-base-text">
                  {formatCurrency(token.priceUsd, token.priceUsd < 0.1 ? 4 : 2)}
                </td>
                <td className="px-3 py-2">
                  <PriceChange value={token.priceChange24h} compact />
                </td>
                <td className="px-3 py-2 font-mono tabular-nums text-base-text">
                  {formatCompactCurrency(token.volume24h)}
                  <span className="ml-2 text-[10px] text-base-muted">
                    {formatNumber(token.transactions24h)} tx
                  </span>
                </td>
                <td className="px-3 py-2 font-mono tabular-nums text-base-text">
                  {formatCompactCurrency(token.liquidityUsd)}
                </td>
                <td className="px-3 py-2 font-mono text-base-muted">
                  {formatAge(token.ageHours)}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Sparkline
                      points={token.sparkline}
                      positive={token.priceChange24h >= 0}
                    />
                    <span className="font-mono text-[10px] font-semibold text-base-muted">
                      {token.trendScore}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <RiskBadge level={token.riskLevel} compact />
                </td>
                <td className="px-3 py-2">
                  <Link
                    href={`/tokens/${token.symbol.toLowerCase()}`}
                    aria-label={`Open ${token.name}`}
                    className="inline-flex h-7 w-7 items-center justify-center border border-base-line bg-base-elevated text-base-muted transition hover:border-base-mint hover:text-base-mint"
                  >
                    <ExternalLink size={13} aria-hidden="true" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
