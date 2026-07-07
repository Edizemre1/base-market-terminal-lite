import Link from "next/link";
import type { Route } from "next";
import { AlertTriangle, ArrowRight, Database } from "lucide-react";
import { MetricCard } from "@/components/MetricCard";
import { RiskBadge } from "@/components/RiskBadge";
import { SectionHeader } from "@/components/SectionHeader";
import { TokenTable } from "@/components/TokenTable";
import {
  getNewTokens,
  getTrendingTokens,
  getVolumeGainers,
  marketStats,
  mockBaseTokens
} from "@/data/mockTokens";
import { formatCompactCurrency } from "@/lib/format";

export default function DashboardPage() {
  const trendingTokens = getTrendingTokens();
  const newTokens = getNewTokens();
  const volumeGainers = getVolumeGainers();
  const riskWatchTokens = mockBaseTokens.filter(
    (token) => token.riskLevel !== "clear"
  );

  return (
    <main className="bg-base-black">
      <section className="border-b border-white/10 bg-base-raised">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="mb-4 inline-flex items-center gap-2 rounded border border-base-cyan/30 bg-base-cyan/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-base-cyan">
                <Database size={14} aria-hidden="true" />
                Local mock data
              </div>
              <h1 className="text-4xl font-semibold text-white md:text-5xl">
                Market dashboard
              </h1>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-emerald-50/60">
                Scan trending tokens, newly listed demo assets, and 24h volume
                gainers from the bundled mock Base dataset.
              </p>
            </div>

            <Link
              href="/swap"
              className="inline-flex min-h-11 w-fit items-center gap-2 rounded border border-base-mint/40 bg-base-mint px-4 py-3 text-sm font-semibold text-base-black transition hover:bg-emerald-200"
            >
              Open swap preview
              <ArrowRight size={17} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {marketStats.map((stat) => (
            <MetricCard key={stat.label} stat={stat} />
          ))}
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-4 pb-10 sm:px-6 lg:grid-cols-[1fr_340px] lg:px-8">
        <div className="space-y-8">
          <div>
            <SectionHeader
              eyebrow="Momentum"
              title="Trending tokens"
              description="Highest demo trend scores from local token rows."
            />
            <TokenTable tokens={trendingTokens} label="Trending demo tokens" />
          </div>

          <div>
            <SectionHeader
              eyebrow="New listings"
              title="New tokens"
              description="Youngest mock pools by demo age metadata."
            />
            <TokenTable tokens={newTokens} label="Newest demo tokens" />
          </div>

          <div>
            <SectionHeader
              eyebrow="Volume"
              title="Volume gainers"
              description="Largest simulated 24h volume-change leaders."
            />
            <TokenTable tokens={volumeGainers} label="Demo volume gainers" />
          </div>
        </div>

        <aside className="h-fit rounded-lg border border-white/10 bg-base-panel p-5">
          <div className="mb-5 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-base-amber">
            <AlertTriangle size={16} aria-hidden="true" />
            Demo risk watch
          </div>
          <div className="space-y-4">
            {riskWatchTokens.map((token) => (
              <Link
                key={token.id}
                href={`/tokens/${token.symbol.toLowerCase()}` as Route}
                className="block rounded-lg border border-white/10 bg-white/[0.04] p-4 transition hover:border-base-amber/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-white">{token.symbol}</p>
                    <p className="mt-1 text-xs text-emerald-50/50">
                      {formatCompactCurrency(token.liquidityUsd)} liquidity
                    </p>
                  </div>
                  <RiskBadge level={token.riskLevel} compact />
                </div>
                <p className="mt-3 text-sm leading-6 text-emerald-50/60">
                  {token.riskFlags[0]?.label ?? "Demo label"}
                </p>
              </Link>
            ))}
          </div>
          <p className="mt-5 text-xs leading-5 text-emerald-50/50">
            These labels are hard-coded demo states and are not token safety
            assessments.
          </p>
        </aside>
      </section>
    </main>
  );
}
