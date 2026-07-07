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
    <div className="overflow-hidden rounded-lg border border-white/10 bg-base-panel/90">
      <div className="border-b border-white/10 px-4 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-50/50">
        {label}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-xs uppercase tracking-[0.16em] text-emerald-50/40">
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
                className="border-b border-white/[0.06] transition hover:bg-white/[0.035]"
              >
                <td className="px-4 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-base-mint/25 bg-base-mint/10 text-xs font-bold text-base-mint">
                      {token.symbol.slice(0, 2)}
                    </div>
                    <div>
                      <Link
                        href={`/tokens/${token.symbol.toLowerCase()}`}
                        className="font-semibold text-white hover:text-base-mint"
                      >
                        {token.name}
                      </Link>
                      <p className="text-xs uppercase tracking-[0.14em] text-emerald-50/50">
                        {token.symbol} · {token.category}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-4 font-medium text-white">
                  {formatCurrency(token.priceUsd, token.priceUsd < 0.1 ? 4 : 2)}
                </td>
                <td className="px-4 py-4">
                  <PriceChange value={token.priceChange24h} compact />
                </td>
                <td className="px-4 py-4 text-emerald-50/75">
                  {formatCompactCurrency(token.volume24h)}
                  <span className="ml-2 text-xs text-emerald-50/40">
                    {formatNumber(token.transactions24h)} tx
                  </span>
                </td>
                <td className="px-4 py-4 text-emerald-50/75">
                  {formatCompactCurrency(token.liquidityUsd)}
                </td>
                <td className="px-4 py-4 text-emerald-50/70">
                  {formatAge(token.ageHours)}
                </td>
                <td className="px-4 py-4">
                  <div className="flex items-center gap-3">
                    <Sparkline
                      points={token.sparkline}
                      positive={token.priceChange24h >= 0}
                    />
                    <span className="text-xs font-semibold text-emerald-50/60">
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
                    className="inline-flex h-9 w-9 items-center justify-center rounded border border-white/10 bg-white/[0.04] text-emerald-50/70 transition hover:border-base-mint/40 hover:text-base-mint"
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
