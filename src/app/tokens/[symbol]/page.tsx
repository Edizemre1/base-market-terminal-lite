import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Database, Layers, WalletCards } from "lucide-react";
import { PriceChange } from "@/components/PriceChange";
import { RiskBadge, RiskFlagList } from "@/components/RiskBadge";
import { SectionHeader } from "@/components/SectionHeader";
import { Sparkline } from "@/components/Sparkline";
import { getTokenBySymbol, mockBaseTokens } from "@/data/mockTokens";
import {
  formatAge,
  formatCompactCurrency,
  formatCurrency,
  formatNumber
} from "@/lib/format";

type TokenPageProps = {
  params: Promise<{
    symbol: string;
  }>;
};

export function generateStaticParams() {
  return mockBaseTokens.map((token) => ({
    symbol: token.symbol.toLowerCase()
  }));
}

export async function generateMetadata({
  params
}: TokenPageProps): Promise<Metadata> {
  const { symbol } = await params;
  const token = getTokenBySymbol(symbol);

  return {
    title: token
      ? `${token.symbol} · Base Market Terminal Lite`
      : "Token · Base Market Terminal Lite",
    description: token?.description ?? "Demo token detail page."
  };
}

export default async function TokenDetailPage({ params }: TokenPageProps) {
  const { symbol } = await params;
  const token = getTokenBySymbol(symbol);

  if (!token) {
    notFound();
  }

  const stats = [
    ["Price", formatCurrency(token.priceUsd, token.priceUsd < 0.1 ? 4 : 2)],
    ["24h volume", formatCompactCurrency(token.volume24h)],
    ["Liquidity", formatCompactCurrency(token.liquidityUsd)],
    ["Market cap", formatCompactCurrency(token.marketCapUsd)],
    ["Holders", formatNumber(token.holders)],
    ["Age", formatAge(token.ageHours)],
    ["24h transactions", formatNumber(token.transactions24h)],
    ["Trend score", token.trendScore.toString()]
  ];

  return (
    <main className="bg-base-black">
      <section className="border-b border-white/10 bg-base-raised">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <Link
            href="/dashboard"
            className="mb-8 inline-flex items-center gap-2 text-sm font-semibold text-emerald-50/60 transition hover:text-base-mint"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Back to dashboard
          </Link>

          <div className="grid gap-8 lg:grid-cols-[1fr_380px] lg:items-end">
            <div>
              <div className="mb-5 flex flex-wrap items-center gap-3">
                <span className="flex h-14 w-14 items-center justify-center rounded border border-base-mint/30 bg-base-mint/10 text-sm font-bold text-base-mint">
                  {token.symbol.slice(0, 2)}
                </span>
                <RiskBadge level={token.riskLevel} />
                <span className="rounded border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-50/60">
                  {token.category}
                </span>
              </div>

              <h1 className="text-4xl font-semibold text-white md:text-6xl">
                {token.name}
              </h1>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-emerald-50/60">
                {token.description}
              </p>

              <div className="mt-6 flex flex-wrap gap-2">
                {token.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-emerald-50/70"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-base-panel p-5">
              <div className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm text-emerald-50/50">Mock price</p>
                  <p className="mt-1 text-3xl font-semibold text-white">
                    {formatCurrency(token.priceUsd, token.priceUsd < 0.1 ? 4 : 2)}
                  </p>
                </div>
                <PriceChange value={token.priceChange24h} />
              </div>
              <Sparkline
                points={token.sparkline}
                positive={token.priceChange24h >= 0}
                className="h-24 w-full"
              />
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_360px] lg:px-8">
        <div className="space-y-8">
          <div>
            <SectionHeader
              eyebrow="Snapshot"
              title={`${token.symbol} market metrics`}
              description="All figures are generated from local mock data for interface development."
            />
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {stats.map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-lg border border-white/10 bg-white/[0.04] p-4"
                >
                  <p className="text-xs uppercase tracking-[0.16em] text-emerald-50/50">
                    {label}
                  </p>
                  <p className="mt-3 text-xl font-semibold text-white">{value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="rounded-lg border border-white/10 bg-base-panel p-5">
              <div className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-base-cyan">
                <Database size={16} aria-hidden="true" />
                Data provenance
              </div>
              <p className="text-sm leading-7 text-emerald-50/60">
                This page reads from a bundled TypeScript mock dataset. The demo
                address below is not a contract address and must not be used for
                on-chain lookups.
              </p>
              <code className="mt-4 block overflow-x-auto rounded border border-white/10 bg-black/30 px-3 py-2 text-xs text-base-mint">
                {token.demoAddress}
              </code>
            </div>

            <div className="rounded-lg border border-white/10 bg-base-panel p-5">
              <div className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-base-mint">
                <WalletCards size={16} aria-hidden="true" />
                Swap preview
              </div>
              <p className="text-sm leading-7 text-emerald-50/60">
                Preview a UI-only quote with wallet connection and routing left
                as future integration points.
              </p>
              <Link
                href="/swap"
                className="mt-5 inline-flex min-h-10 items-center gap-2 rounded border border-base-mint/40 bg-base-mint px-3 py-2 text-sm font-semibold text-base-black transition hover:bg-emerald-200"
              >
                Open preview
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </div>
          </div>
        </div>

        <aside className="space-y-6">
          <div className="rounded-lg border border-white/10 bg-base-panel p-5">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-base-amber">
              <Layers size={16} aria-hidden="true" />
              Demo risk flags
            </div>
            <RiskFlagList flags={token.riskFlags} />
            <p className="mt-4 text-xs leading-5 text-emerald-50/50">
              Labels are interface examples only and are not live contract
              analysis.
            </p>
          </div>
        </aside>
      </section>
    </main>
  );
}
