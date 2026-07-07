import { ArrowRight, Eye, RotateCcw, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { LandingTerminalPreview } from "@/components/LandingTerminalPreview";
import { MetricCard } from "@/components/MetricCard";
import { TokenTable } from "@/components/TokenTable";
import { getTrendingTokens, marketStats } from "@/data/mockTokens";

export default function HomePage() {
  const trendingTokens = getTrendingTokens(4);

  return (
    <main className="bg-base-black">
      <section className="terminal-grid relative min-h-[78vh] overflow-hidden border-b border-white/10">
        <div className="absolute inset-0 bg-gradient-to-b from-base-mint/10 via-base-black/20 to-base-black" />
        <LandingTerminalPreview tokens={trendingTokens} />

        <div className="relative mx-auto max-w-7xl px-4 pb-48 pt-20 sm:px-6 sm:pt-24 lg:px-8 lg:pb-72">
          <div className="inline-flex items-center gap-2 rounded border border-base-mint/30 bg-base-mint/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-base-mint">
            <ShieldCheck size={14} aria-hidden="true" />
            Public demo terminal
          </div>

          <h1 className="mt-8 max-w-4xl text-5xl font-semibold leading-[1.02] text-white md:text-7xl">
            Base Market Terminal Lite
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-emerald-50/70">
            Standalone market discovery for mock Base tokens, demo-only risk
            labels, and UI-only swap previews. No real API keys, backend secrets,
            private logic, or live trading.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/dashboard"
              className="inline-flex min-h-11 items-center gap-2 rounded border border-base-mint/40 bg-base-mint px-4 py-3 text-sm font-semibold text-base-black transition hover:bg-emerald-200"
            >
              <Eye size={17} aria-hidden="true" />
              Open dashboard
              <ArrowRight size={17} aria-hidden="true" />
            </Link>
            <Link
              href="/swap"
              className="inline-flex min-h-11 items-center gap-2 rounded border border-white/10 bg-white/[0.05] px-4 py-3 text-sm font-semibold text-white transition hover:border-base-cyan/40 hover:text-base-cyan"
            >
              <RotateCcw size={17} aria-hidden="true" />
              Preview swap
            </Link>
          </div>

          <div className="mt-10 grid max-w-3xl gap-3 text-sm text-emerald-50/60 sm:grid-cols-3">
            <div className="border-l border-base-mint/40 pl-4">
              Demo token data
            </div>
            <div className="border-l border-base-cyan/40 pl-4">
              Local mock risk flags
            </div>
            <div className="border-l border-base-amber/40 pl-4">
              Transactions disabled
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {marketStats.map((stat) => (
            <MetricCard key={stat.label} stat={stat} />
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 lg:px-8">
        <TokenTable tokens={trendingTokens} label="Trending demo tokens" />
      </section>
    </main>
  );
}
