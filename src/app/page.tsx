import { ArrowRight, BarChart3, Eye, LockKeyhole, RotateCcw } from "lucide-react";
import Link from "next/link";
import { LandingTerminalPreview } from "@/components/LandingTerminalPreview";
import { MetricCard } from "@/components/MetricCard";
import { TokenTable } from "@/components/TokenTable";
import { getTrendingTokens, marketStats } from "@/data/mockTokens";

export default function HomePage() {
  const trendingTokens = getTrendingTokens(4);

  return (
    <main className="bg-base-black">
      <section className="terminal-grid relative min-h-[82vh] overflow-hidden border-b border-base-line">
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,82,255,0.22),rgba(3,5,10,0.32)_36%,#03050a_100%)]" />
        <LandingTerminalPreview tokens={trendingTokens} />

        <div className="relative mx-auto max-w-7xl px-4 pb-48 pt-16 sm:px-6 sm:pt-20 lg:px-8 lg:pb-72">
          <div className="flex max-w-5xl flex-wrap gap-3 text-[11px] font-semibold uppercase tracking-[0.2em]">
            <span className="rounded border border-base-blue/40 bg-base-blue/10 px-3 py-2 text-base-electric">
              Base ecosystem
            </span>
            <span className="rounded border border-base-line bg-base-raised/70 px-3 py-2 text-base-muted">
              Public intelligence terminal
            </span>
            <span className="rounded border border-base-amber/30 bg-base-amber/10 px-3 py-2 text-base-amber">
              Mock data only
            </span>
          </div>

          <h1 className="mt-8 max-w-4xl text-5xl font-semibold leading-[1.02] text-base-text md:text-7xl">
            Base Market Terminal Lite
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-base-muted">
            A premium public terminal for scanning mock Base markets, monitoring
            demo risk states, and previewing routing UI without touching wallets
            or live execution.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/dashboard"
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-base-blue/60 bg-base-blue px-4 py-3 text-sm font-semibold text-white transition hover:bg-base-electric"
            >
              <Eye size={17} aria-hidden="true" />
              Open terminal
              <ArrowRight size={17} aria-hidden="true" />
            </Link>
            <Link
              href="/swap"
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-base-line bg-base-elevated/70 px-4 py-3 text-sm font-semibold text-base-text transition hover:border-base-blue/60 hover:text-base-electric"
            >
              <RotateCcw size={17} aria-hidden="true" />
              Preview route UI
            </Link>
          </div>

          <div className="mt-10 grid max-w-4xl gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-base-line bg-base-panel/70 p-4">
              <BarChart3 size={18} className="text-base-electric" aria-hidden="true" />
              <p className="mt-3 text-sm font-semibold text-base-text">
                Market scan
              </p>
              <p className="mt-1 text-xs leading-5 text-base-muted">
                Trending, new, and volume-gainer views.
              </p>
            </div>
            <div className="rounded-lg border border-base-line bg-base-panel/70 p-4">
              <LockKeyhole size={18} className="text-base-amber" aria-hidden="true" />
              <p className="mt-3 text-sm font-semibold text-base-text">
                Demo safety layer
              </p>
              <p className="mt-1 text-xs leading-5 text-base-muted">
                Labels are local UI examples only.
              </p>
            </div>
            <div className="rounded-lg border border-base-line bg-base-panel/70 p-4">
              <RotateCcw size={18} className="text-base-cyan" aria-hidden="true" />
              <p className="mt-3 text-sm font-semibold text-base-text">
                Routing preview
              </p>
              <p className="mt-1 text-xs leading-5 text-base-muted">
                No swaps, approvals, or signing.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {marketStats.map((stat) => (
            <MetricCard key={stat.label} stat={stat} />
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 lg:px-8">
        <TokenTable tokens={trendingTokens} label="Institutional-style watchlist" />
      </section>
    </main>
  );
}
