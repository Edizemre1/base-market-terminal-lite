import Link from "next/link";
import { AlertTriangle, ArrowRight, Database, Gauge, ShieldAlert } from "lucide-react";
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
      <section className="border-b border-base-line bg-base-raised">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="grid gap-8 lg:grid-cols-[1fr_360px] lg:items-end">
            <div>
              <div className="mb-4 inline-flex items-center gap-2 rounded border border-base-blue/40 bg-base-blue/12 px-3 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-base-electric">
                <Database size={14} aria-hidden="true" />
                Local mock market feed
              </div>
              <h1 className="text-4xl font-semibold text-base-text md:text-5xl">
                Market command center
              </h1>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-base-muted">
                Monitor demo Base token momentum, new-pool activity, liquidity,
                and risk flags from one dense public dashboard.
              </p>
            </div>

            <div className="rounded-lg border border-base-line bg-base-panel p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-base-amber">
                <ShieldAlert size={15} aria-hidden="true" />
                Execution disabled
              </div>
              <p className="mt-3 text-sm leading-6 text-base-muted">
                Dashboard rows are mock snapshots. There are no API keys,
                wallet actions, approvals, or live transactions.
              </p>
              <Link
                href="/swap"
                className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg border border-base-blue/55 bg-base-blue px-3 py-2 text-sm font-semibold text-white transition hover:bg-base-electric"
              >
                Open route preview
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </div>
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
              description="Highest demo trend scores with compact institutional table density."
            />
            <TokenTable tokens={trendingTokens} label="Trending demo tokens" />
          </div>

          <div>
            <SectionHeader
              eyebrow="Launch monitor"
              title="New tokens"
              description="Youngest mock pools by local age metadata."
            />
            <TokenTable tokens={newTokens} label="New demo pools" />
          </div>

          <div>
            <SectionHeader
              eyebrow="Flow"
              title="Volume gainers"
              description="Largest simulated 24h volume-change leaders."
            />
            <TokenTable tokens={volumeGainers} label="Volume acceleration" />
          </div>
        </div>

        <aside className="h-fit space-y-4">
          <div className="rounded-lg border border-base-line bg-base-panel p-5 shadow-panel">
            <div className="mb-5 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-base-amber">
              <AlertTriangle size={16} aria-hidden="true" />
              Demo risk watch
            </div>
            <div className="space-y-3">
              {riskWatchTokens.map((token) => (
                <Link
                  key={token.id}
                  href={`/tokens/${token.symbol.toLowerCase()}`}
                  className="block rounded-lg border border-base-line bg-base-elevated/58 p-4 transition hover:border-base-amber/45"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-base-text">{token.symbol}</p>
                      <p className="mt-1 text-xs text-base-muted">
                        {formatCompactCurrency(token.liquidityUsd)} liquidity
                      </p>
                    </div>
                    <RiskBadge level={token.riskLevel} compact />
                  </div>
                  <p className="mt-3 text-sm leading-6 text-base-muted">
                    {token.riskFlags[0]?.label ?? "Demo label"}
                  </p>
                </Link>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-base-blue/30 bg-base-blue/10 p-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-base-electric">
              <Gauge size={16} aria-hidden="true" />
              Terminal posture
            </div>
            <p className="text-sm leading-6 text-base-muted">
              Risk labels are hard-coded examples for public UI review and are
              not token safety assessments.
            </p>
          </div>
        </aside>
      </section>
    </main>
  );
}
