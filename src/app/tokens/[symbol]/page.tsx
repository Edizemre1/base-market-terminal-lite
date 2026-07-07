import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PriceChange } from "@/components/PriceChange";
import { RiskBadge, RiskFlagList } from "@/components/RiskBadge";
import { Sparkline } from "@/components/Sparkline";
import {
  DonutMetric,
  MiniBarList,
  RecentEventsTable,
  StatusPill,
  TerminalPanel,
  Treemap
} from "@/components/TerminalWidgets";
import { getTokenBySymbol, mockBaseTokens } from "@/data/mockTokens";
import {
  formatAge,
  formatCompactCurrency,
  formatCurrency,
  formatNumber,
  formatPercent
} from "@/lib/format";
import type { RiskLevel, TokenMarketSnapshot } from "@/types/market";

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

  const headerMetrics = [
    {
      label: "Price",
      value: formatCurrency(token.priceUsd, token.priceUsd < 0.1 ? 4 : 2),
      meta: "mark"
    },
    { label: "Mock PnL", value: formatPercent(token.priceChange24h), meta: "24h" },
    { label: "Volume", value: formatCompactCurrency(token.volume24h), meta: "24h" },
    { label: "Liquidity", value: formatCompactCurrency(token.liquidityUsd), meta: "pool" },
    { label: "Risk", value: riskLabel(token.riskLevel), meta: token.riskLevel }
  ];

  const events = buildRecentEvents(token);

  return (
    <main className="terminal-grid min-h-[calc(100vh-40px)] bg-base-black p-2">
      <section className="mb-2 border border-base-line bg-base-panel">
        <div className="flex min-h-8 items-center justify-between border-b border-base-line bg-base-raised px-2">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-base-muted hover:text-base-mint"
          >
            <ArrowLeft size={13} aria-hidden="true" />
            Markets
          </Link>
          <div className="flex items-center gap-1">
            <StatusPill label="Asset detail" />
            <StatusPill label="Mock feed" tone="blue" />
          </div>
        </div>

        <div className="grid gap-2 p-2 lg:grid-cols-[minmax(240px,1fr)_2fr]">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-12 items-center justify-center border border-base-line bg-base-elevated font-mono text-[12px] font-semibold text-base-text">
              {token.symbol.slice(0, 2)}
            </span>
            <div>
              <h1 className="text-lg font-semibold text-base-text">{token.name}</h1>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-base-muted">
                {token.symbol} / {token.category} / demo asset
              </p>
            </div>
          </div>
          <p className="text-[11px] leading-4 text-base-muted">{token.description}</p>
        </div>
      </section>

      <section className="mb-2 grid gap-1 md:grid-cols-5">
        {headerMetrics.map((metric) => (
          <article key={metric.label} className="border border-base-line bg-base-panel p-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-base-muted">
                {metric.label}
              </p>
              <span className="font-mono text-[10px] uppercase text-base-muted">
                {metric.meta}
              </span>
            </div>
            <p className="mt-2 font-mono text-lg font-semibold leading-none text-base-text">
              {metric.value}
            </p>
          </article>
        ))}
      </section>

      <section className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-2">
          <TerminalPanel
            label="PERFORMANCE"
            title={`${token.symbol} mock line chart`}
            meta={<PriceChange value={token.priceChange24h} compact />}
          >
            <div className="market-scanline flex min-h-[320px] flex-col justify-between border border-base-line bg-base-elevated p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-base-muted">
                    Local sample
                  </p>
                  <p className="mt-1 text-[11px] leading-4 text-base-muted">
                    Generated from bundled mock token data only.
                  </p>
                </div>
                <RiskBadge level={token.riskLevel} compact />
              </div>
              <Sparkline
                points={token.sparkline}
                positive={token.priceChange24h >= 0}
                className="my-8 h-40 w-full"
              />
              <div className="grid gap-1 md:grid-cols-4">
                <ChartStat label="Market cap" value={formatCompactCurrency(token.marketCapUsd)} />
                <ChartStat label="Holders" value={formatNumber(token.holders)} />
                <ChartStat label="Age" value={formatAge(token.ageHours)} />
                <ChartStat label="Tx 24h" value={formatNumber(token.transactions24h)} />
              </div>
            </div>
          </TerminalPanel>

          <TerminalPanel label="HOLDINGS / EVENTS" title="Mock recent events">
            <RecentEventsTable events={events} />
          </TerminalPanel>
        </div>

        <aside className="space-y-2">
          <TerminalPanel label="ALLOCATION" title="Mock allocation map">
            <Treemap
              items={[
                {
                  label: "Liquidity",
                  value: formatCompactCurrency(token.liquidityUsd),
                  className: "col-span-2 row-span-2 bg-base-mint/10 text-base-mint"
                },
                {
                  label: "Volume",
                  value: formatCompactCurrency(token.volume24h),
                  className: "col-span-2 bg-base-blue/5 text-base-electric"
                },
                {
                  label: "Mcap",
                  value: formatCompactCurrency(token.marketCapUsd),
                  className: "col-span-2 bg-base-elevated text-base-text"
                },
                {
                  label: "Holders",
                  value: formatNumber(token.holders),
                  className: "col-span-2 bg-base-elevated text-base-text"
                },
                {
                  label: "Age",
                  value: formatAge(token.ageHours),
                  className: "col-span-2 bg-base-amber/10 text-base-amber"
                }
              ]}
            />
          </TerminalPanel>

          <TerminalPanel label="RISK SCORE" title="Asset risk circle">
            <DonutMetric value={riskScore(token.riskLevel)} label="Risk score" />
          </TerminalPanel>

          <TerminalPanel label="RISK BARS" title="Risk structure">
            <MiniBarList
              items={[
                { label: "Liquidity depth", value: liquidityDepth(token), tone: "mint" },
                { label: "Holder conc", value: holderConcentration(token.riskLevel), tone: "amber" },
                { label: "Volume stress", value: volumeStress(token), tone: "rose" }
              ]}
            />
          </TerminalPanel>

          <TerminalPanel label="FLAGS" title="Demo risk flags">
            <RiskFlagList flags={token.riskFlags} />
          </TerminalPanel>
        </aside>
      </section>
    </main>
  );
}

function ChartStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-base-line bg-base-panel px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-[0.12em] text-base-muted">{label}</p>
      <p className="mt-1 font-mono text-[12px] font-semibold text-base-text">{value}</p>
    </div>
  );
}

function riskLabel(level: RiskLevel) {
  const labels = {
    clear: "Clear",
    watch: "Watch",
    elevated: "Elevated",
    high: "High"
  };

  return labels[level];
}

function riskScore(level: RiskLevel) {
  const scores = {
    clear: 24,
    watch: 46,
    elevated: 68,
    high: 88
  };

  return scores[level];
}

function holderConcentration(level: RiskLevel) {
  const values = {
    clear: 28,
    watch: 43,
    elevated: 67,
    high: 82
  };

  return values[level];
}

function liquidityDepth(token: TokenMarketSnapshot) {
  return Math.max(18, Math.min(94, Math.round((token.liquidityUsd / 15000000) * 100)));
}

function volumeStress(token: TokenMarketSnapshot) {
  return Math.max(
    12,
    Math.min(96, Math.round((token.volume24h / Math.max(token.liquidityUsd, 1)) * 32))
  );
}

function buildRecentEvents(token: TokenMarketSnapshot) {
  return [
    {
      time: "09:42",
      label: "Volume",
      detail: `${token.symbol} mock volume update`,
      value: formatPercent(token.volumeChange24h)
    },
    {
      time: "09:14",
      label: "Liquidity",
      detail: "Pool depth sample recorded",
      value: formatCompactCurrency(token.liquidityUsd)
    },
    {
      time: "08:58",
      label: "Risk",
      detail: token.riskFlags[0]?.label ?? "Demo clear",
      value: riskLabel(token.riskLevel)
    },
    {
      time: "08:22",
      label: "Position",
      detail: "Mock holdings row refreshed",
      value: formatNumber(token.holders)
    }
  ];
}
