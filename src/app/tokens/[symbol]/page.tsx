import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Database,
  Layers,
  ShieldAlert,
  WalletCards
} from "lucide-react";
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
      ? `${token.symbol} - Base Market Terminal Lite`
      : "Token - Base Market Terminal Lite",
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
      <section className="border-b border-base-line bg-base-raised">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <Link
            href="/dashboard"
            className="mb-8 inline-flex items-center gap-2 text-sm font-semibold text-base-muted transition hover:text-base-electric"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Back to command center
          </Link>

          <div className="grid gap-8 lg:grid-cols-[1fr_400px] lg:items-end">
            <div>
              <div className="mb-5 flex flex-wrap items-center gap-3">
                <span className="flex h-14 w-14 items-center justify-center rounded-lg border border-base-blue/40 bg-base-blue/10 text-sm font-bold text-base-electric">
                  {token.symbol.slice(0, 2)}
                </span>
                <RiskBadge level={token.riskLevel} />
                <span className="rounded border border-base-line bg-base-elevated/70 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-base-muted">
                  {token.category}
                </span>
              </div>

              <h1 className="text-4xl font-semibold text-base-text md:text-6xl">
                {token.name}
              </h1>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-base-muted">
                {token.description}
              </p>

              <div className="mt-6 flex flex-wrap gap-2">
                {token.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded border border-base-line bg-base-panel px-3 py-1.5 text-xs text-base-muted"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-base-line bg-base-panel p-5 shadow-panel">
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-base-muted">
                    Mock mark price
                  </p>
                  <p className="mt-2 text-4xl font-semibold tabular-nums text-base-text">
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
              eyebrow="Instrument snapshot"
              title={`${token.symbol} market metrics`}
              description="All figures are generated from local mock data for public interface review."
            />
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {stats.map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-lg border border-base-line bg-base-panel p-4"
                >
                  <p className="text-[11px] uppercase tracking-[0.18em] text-base-muted">
                    {label}
                  </p>
                  <p className="mt-3 text-xl font-semibold tabular-nums text-base-text">
                    {value}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="rounded-lg border border-base-line bg-base-panel p-5 shadow-panel">
              <div className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-base-electric">
                <Database size={16} aria-hidden="true" />
                Data provenance
              </div>
              <p className="text-sm leading-7 text-base-muted">
                This page reads from the bundled TypeScript mock dataset. The
                demo address below is not a contract address and must not be
                used for onchain lookups.
              </p>
              <code className="mt-4 block overflow-x-auto rounded border border-base-line bg-base-black/50 px-3 py-2 text-xs text-base-electric">
                {token.demoAddress}
              </code>
            </div>

            <div className="rounded-lg border border-base-line bg-base-panel p-5 shadow-panel">
              <div className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-base-cyan">
                <WalletCards size={16} aria-hidden="true" />
                Route preview
              </div>
              <p className="text-sm leading-7 text-base-muted">
                Preview a UI-only quote with wallet connection, signing, and
                routing left as future integration boundaries.
              </p>
              <Link
                href="/swap"
                className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-lg border border-base-blue/50 bg-base-blue px-3 py-2 text-sm font-semibold text-white transition hover:bg-base-electric"
              >
                Open preview
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </div>
          </div>
        </div>

        <aside className="space-y-6">
          <div className="rounded-lg border border-base-line bg-base-panel p-5 shadow-panel">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-base-amber">
              <Layers size={16} aria-hidden="true" />
              Demo risk flags
            </div>
            <RiskFlagList flags={token.riskFlags} />
            <p className="mt-4 text-xs leading-5 text-base-muted">
              Labels are interface examples only and are not live contract
              analysis.
            </p>
          </div>

          <div className="rounded-lg border border-base-amber/30 bg-base-amber/10 p-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-base-amber">
              <ShieldAlert size={16} aria-hidden="true" />
              Public-safe detail view
            </div>
            <p className="text-sm leading-6 text-base-muted">
              No private scoring, transaction calls, or backend secrets are used
              by this detail page.
            </p>
          </div>
        </aside>
      </section>
    </main>
  );
}
