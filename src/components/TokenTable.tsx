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
    <div className="overflow-hidden rounded-lg border border-base-line bg-base-panel shadow-panel">
      <div className="flex items-center justify-between border-b border-base-line bg-base-raised/52 px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-base-electric">
          {label}
        </div>
        <div className="text-[11px] uppercase tracking-[0.18em] text-base-muted">
          Mock feed
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-base-line bg-base-black/35 text-left text-[11px] uppercase tracking-[0.16em] text-base-muted">
              <th className="px-4 py-3 font-medium">Token</th>
              <th className="px-4 py-3 font-medium">Price</th>
              <th className="px-4 py-3 font-medium">24h</th>
              <th className="px-4 py-3 font-medium">Volume</th>
              <th className="px-4 py-3 font-medium">Liquidity</th>
              <th className="px-4 py-3 font-medium">Age</th>
              <th className="px-4 py-3 font-medium">Trend</th>
              <th className="px-4 py-3 font-medium">Risk</th>
              <th className="px-4 py-3 font-medium">Open</th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((token) => (
              <tr
                key={token.id}
                className="border-b border-base-line/70 transition hover:bg-base-blue/[0.055]"
              >
                <td className="px-4 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-base-blue/35 bg-base-blue/12 text-xs font-bold text-base-electric">
                      {token.symbol.slice(0, 2)}
                    </div>
                    <div>
                      <Link
                        href={`/tokens/${token.symbol.toLowerCase()}`}
                        className="font-semibold text-base-text hover:text-base-electric"
                      >
                        {token.name}
                      </Link>
                      <p className="text-xs uppercase tracking-[0.14em] text-base-muted">
                        {token.symbol} / {token.category}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-4 font-medium tabular-nums text-base-text">
                  {formatCurrency(token.priceUsd, token.priceUsd < 0.1 ? 4 : 2)}
                </td>
                <td className="px-4 py-4">
                  <PriceChange value={token.priceChange24h} compact />
                </td>
                <td className="px-4 py-4 tabular-nums text-base-text/78">
                  {formatCompactCurrency(token.volume24h)}
                  <span className="ml-2 text-xs text-base-muted">
                    {formatNumber(token.transactions24h)} tx
                  </span>
                </td>
                <td className="px-4 py-4 tabular-nums text-base-text/78">
                  {formatCompactCurrency(token.liquidityUsd)}
                </td>
                <td className="px-4 py-4 text-base-muted">
                  {formatAge(token.ageHours)}
                </td>
                <td className="px-4 py-4">
                  <div className="flex items-center gap-3">
                    <Sparkline
                      points={token.sparkline}
                      positive={token.priceChange24h >= 0}
                    />
                    <span className="text-xs font-semibold text-base-muted">
                      {token.trendScore}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-4">
                  <RiskBadge level={token.riskLevel} compact />
                </td>
                <td className="px-4 py-4">
                  <Link
                    href={`/tokens/${token.symbol.toLowerCase()}`}
                    aria-label={`Open ${token.name}`}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-base-line bg-base-elevated/70 text-base-muted transition hover:border-base-blue/60 hover:text-base-electric"
                  >
                    <ExternalLink size={15} aria-hidden="true" />
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
