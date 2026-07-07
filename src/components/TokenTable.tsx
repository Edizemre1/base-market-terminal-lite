import Link from "next/link";
import { PriceChange } from "@/components/PriceChange";
import { RiskBadge } from "@/components/RiskBadge";
import { Sparkline } from "@/components/Sparkline";
import {
  formatAge,
  formatCompactCurrency,
  formatCurrency
} from "@/lib/format";
import type { TokenMarketSnapshot } from "@/types/market";

export function TokenTable({
  tokens,
  label = "BASE TOKEN SCANNER · LIVE DEMO",
  dense = false
}: {
  tokens: TokenMarketSnapshot[];
  label?: string;
  dense?: boolean;
}) {
  return (
    <div className="border border-base-line bg-base-panel">
      <div className="flex min-h-8 items-center justify-between gap-3 border-b border-base-line bg-base-raised px-2">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-base-mint">
          {label}
        </div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-base-muted">
          Mock feed
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-left text-[11px]">
          <thead>
            <tr className="border-b border-base-line bg-base-elevated text-[10px] uppercase tracking-[0.12em] text-base-muted">
              <th className="px-2 py-1.5 font-semibold">Token</th>
              <th className="px-2 py-1.5 text-right font-semibold">Price</th>
              <th className="px-2 py-1.5 text-right font-semibold">24h</th>
              <th className="px-2 py-1.5 text-right font-semibold">Volume</th>
              <th className="px-2 py-1.5 text-right font-semibold">Liquidity</th>
              <th className="px-2 py-1.5 text-right font-semibold">Age</th>
              <th className="px-2 py-1.5 font-semibold">Risk</th>
              <th className="px-2 py-1.5 font-semibold">Signal</th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((token) => (
              <tr
                key={token.id}
                className="h-11 border-b border-base-line transition last:border-0 hover:bg-base-mint/5"
              >
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-8 shrink-0 items-center justify-center border border-base-line bg-base-elevated font-mono text-[10px] font-semibold text-base-text">
                      {token.symbol.slice(0, 2)}
                    </span>
                    <div className="min-w-0">
                      <Link
                        href={`/tokens/${token.symbol.toLowerCase()}`}
                        className="block truncate font-semibold text-base-text hover:text-base-mint"
                      >
                        {token.symbol}
                        <span className="ml-1 font-normal text-base-muted">
                          {token.name}
                        </span>
                      </Link>
                      {!dense ? (
                        <p className="text-[10px] uppercase tracking-[0.12em] text-base-muted">
                          {token.category}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </td>
                <td className="px-2 py-1.5 text-right font-mono font-semibold text-base-text">
                  {formatCurrency(token.priceUsd, token.priceUsd < 0.1 ? 4 : 2)}
                </td>
                <td className="px-2 py-1.5 text-right">
                  <PriceChange value={token.priceChange24h} compact />
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-base-text">
                  {formatCompactCurrency(token.volume24h)}
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-base-text">
                  {formatCompactCurrency(token.liquidityUsd)}
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-base-muted">
                  {formatAge(token.ageHours)}
                </td>
                <td className="px-2 py-1.5">
                  <RiskBadge level={token.riskLevel} compact />
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <Sparkline
                      points={token.sparkline}
                      positive={token.priceChange24h >= 0}
                      className="h-6 w-16"
                    />
                    <span className="font-mono text-[10px] text-base-muted">
                      {token.trendScore}
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
