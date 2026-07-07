import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Database,
  ShieldAlert
} from "lucide-react";
import { PriceChange } from "@/components/PriceChange";
import { RiskBadge, RiskFlagList } from "@/components/RiskBadge";
import { Sparkline } from "@/components/Sparkline";
import {
  MiniBarList,
  StatusPill,
  TerminalPanel
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

type EventTone = "mint" | "blue" | "amber" | "rose";

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

  const headerStats = [
    ["Price", formatCurrency(token.priceUsd, token.priceUsd < 0.1 ? 4 : 2)],
    ["24h", formatPercent(token.priceChange24h)],
    ["Liquidity", formatCompactCurrency(token.liquidityUsd)],
    ["Volume", formatCompactCurrency(token.volume24h)],
    ["Age", formatAge(token.ageHours)],
    ["Risk", riskLabel(token.riskLevel)]
  ];

  const detailStats = [
    ["Market cap", formatCompactCurrency(token.marketCapUsd)],
    ["Holders", formatNumber(token.holders)],
    ["24h transactions", formatNumber(token.transactions24h)],
    ["Trend score", token.trendScore.toString()],
    ["1h change", formatPercent(token.priceChange1h)],
    ["Volume delta", formatPercent(token.volumeChange24h)]
  ];

  const holderConcentration = getHolderConcentration(token.riskLevel);
  const recentEvents = buildRecentEvents(token);

  return (
    <main className="terminal-grid bg-base-black px-4 py-4 sm:px-6">
      <section className="mb-4 border border-base-line bg-base-panel shadow-panel">
        <div className="border-b border-base-line bg-base-raised px-3 py-2">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-base-muted transition hover:text-base-mint"
          >
            <ArrowLeft size={14} aria-hidden="true" />
            Command center
          </Link>
        </div>

        <div className="grid gap-4 p-3 xl:grid-cols-[minmax(0,1fr)_420px] xl:items-end">
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <StatusPill label="Asset terminal" />
              <StatusPill label={token.category} tone="muted" />
              <StatusPill label="Mock feed" tone="blue" />
            </div>

            <div className="flex flex-wrap items-end gap-4">
              <div className="flex h-12 w-12 items-center justify-center border border-base-mint/40 bg-base-mint/10 font-mono text-sm font-semibold text-base-mint">
                {token.symbol.slice(0, 2)}
              </div>
              <div>
                <h1 className="text-2xl font-semibold text-base-text md:text-3xl">
                  {token.name}
                </h1>
                <p className="mt-1 font-mono text-xs uppercase tracking-[0.16em] text-base-muted">
                  {token.symbol} / BASE DEMO ASSET
                </p>
              </div>
            </div>

            <p className="mt-3 max-w-3xl text-xs leading-5 text-base-muted">
              {token.description}
            </p>
          </div>

          <div className="border border-base-line bg-base-elevated p-3">
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-base-muted">
                  Mock mark price
                </p>
                <p className="mt-1 font-mono text-3xl font-semibold text-base-text">
                  {formatCurrency(token.priceUsd, token.priceUsd < 0.1 ? 4 : 2)}
                </p>
              </div>
              <PriceChange value={token.priceChange24h} />
            </div>
            <RiskBadge level={token.riskLevel} compact />
          </div>
        </div>
      </section>

      <section className="mb-4 grid gap-2 md:grid-cols-3 xl:grid-cols-6">
        {headerStats.map(([label, value]) => (
          <div key={label} className="border border-base-line bg-base-panel p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-base-muted">
              {label}
            </p>
            <p className="mt-2 font-mono text-lg font-semibold text-base-text">
              {value}
            </p>
          </div>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_370px]">
        <div className="space-y-4">
          <TerminalPanel label="Chart" title={`${token.symbol} mock market structure`}>
            <div className="relative min-h-[320px] overflow-hidden border border-base-line bg-base-elevated">
              <div className="absolute inset-0 opacity-70 terminal-grid" />
              <div className="relative flex h-full min-h-[320px] flex-col justify-between p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-base-muted">
                      Local sparkline sample
                    </p>
                    <p className="mt-1 text-sm text-base-muted">
                      Demo area view from bundled mock data.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <StatusPill label="1D" />
                    <StatusPill label="Demo" tone="muted" />
                  </div>
                </div>

                <Sparkline
                  points={token.sparkline}
                  positive={token.priceChange24h >= 0}
                  className="my-8 h-40 w-full"
                />

                <div className="grid gap-2 sm:grid-cols-3">
                  {detailStats.slice(0, 3).map(([label, value]) => (
                    <MetricLine key={label} label={label} value={value} />
                  ))}
                </div>
              </div>
            </div>
          </TerminalPanel>

          <TerminalPanel label="Events" title="Recent mock events">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-base-line bg-base-raised text-[10px] uppercase tracking-[0.16em] text-base-muted">
                    <th className="px-2 py-2 font-semibold">Time</th>
                    <th className="px-2 py-2 font-semibold">Signal</th>
                    <th className="px-2 py-2 font-semibold">Detail</th>
                    <th className="px-2 py-2 text-right font-semibold">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {recentEvents.map((event) => (
                    <tr
                      key={`${event.time}-${event.signal}`}
                      className="border-b border-base-line last:border-0"
                    >
                      <td className="px-2 py-2 font-mono text-base-muted">
                        {event.time}
                      </td>
                      <td className="px-2 py-2">
                        <span className={eventToneClass(event.tone)}>
                          {event.signal}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-base-text">{event.detail}</td>
                      <td className="px-2 py-2 text-right font-mono text-base-text">
                        {event.value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TerminalPanel>
        </div>

        <aside className="space-y-4">
          <TerminalPanel label="Risk" title="Risk flags">
            <RiskFlagList flags={token.riskFlags} />
            <div className="mt-3 border border-base-amber/40 bg-base-amber/10 p-3">
              <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-base-amber">
                <ShieldAlert size={14} aria-hidden="true" />
                Demo-only labels
              </div>
              <p className="text-xs leading-5 text-base-muted">
                These checks are interface examples, not live contract analysis.
              </p>
            </div>
          </TerminalPanel>

          <TerminalPanel label="Liquidity" title="Liquidity structure">
            <MiniBarList
              items={[
                {
                  label: "Pool depth",
                  value: liquidityScore(token.liquidityUsd),
                  tone: token.liquidityUsd > 1000000 ? "mint" : "rose"
                },
                {
                  label: "Volume pressure",
                  value: volumePressure(token),
                  tone: token.volume24h > token.liquidityUsd ? "rose" : "blue"
                },
                {
                  label: "Route confidence",
                  value: routeConfidence(token.riskLevel),
                  tone: token.riskLevel === "high" ? "rose" : "mint"
                }
              ]}
            />
          </TerminalPanel>

          <TerminalPanel label="Route" title="Preview ticket">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <MetricLine label="Input" value={token.symbol} />
                <MetricLine label="Pair" value="AUSD" />
              </div>
              <p className="text-xs leading-5 text-base-muted">
                Opens the UI-only execution ticket. No wallet connection,
                approvals, signing, or live routing is included.
              </p>
              <Link
                href="/swap"
                className="inline-flex min-h-8 w-full items-center justify-center gap-2 border border-base-mint bg-base-mint px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-white transition hover:bg-base-cyan"
              >
                Open preview
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </div>
          </TerminalPanel>

          <TerminalPanel label="Holders" title="Mock holder concentration">
            <MiniBarList
              items={[
                { label: "Top 10 holders", value: holderConcentration.topTen, tone: "rose" },
                { label: "Active wallets", value: holderConcentration.active, tone: "mint" },
                { label: "Retail dispersion", value: holderConcentration.dispersion, tone: "blue" }
              ]}
            />
          </TerminalPanel>

          <TerminalPanel label="Source" title="Data boundary">
            <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-base-mint">
              <Database size={14} aria-hidden="true" />
              Local mock dataset
            </div>
            <code className="block overflow-x-auto border border-base-line bg-base-elevated px-2 py-2 font-mono text-[11px] text-base-muted">
              {token.demoAddress}
            </code>
          </TerminalPanel>
        </aside>
      </section>
    </main>
  );
}

function MetricLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-base-line bg-base-panel px-2 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-base-muted">
        {label}
      </p>
      <p className="mt-1 font-mono text-sm font-semibold text-base-text">
        {value}
      </p>
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

function liquidityScore(value: number) {
  return Math.max(18, Math.min(94, Math.round((value / 15000000) * 100)));
}

function volumePressure(token: TokenMarketSnapshot) {
  return Math.max(
    10,
    Math.min(96, Math.round((token.volume24h / Math.max(token.liquidityUsd, 1)) * 32))
  );
}

function routeConfidence(level: RiskLevel) {
  const values = {
    clear: 86,
    watch: 62,
    elevated: 41,
    high: 18
  };

  return values[level];
}

function getHolderConcentration(level: RiskLevel) {
  const values = {
    clear: { topTen: 28, active: 76, dispersion: 72 },
    watch: { topTen: 43, active: 62, dispersion: 54 },
    elevated: { topTen: 67, active: 44, dispersion: 31 },
    high: { topTen: 82, active: 26, dispersion: 18 }
  };

  return values[level];
}

function buildRecentEvents(token: TokenMarketSnapshot) {
  return [
    {
      time: "09:42",
      signal: "Volume",
      detail: `${token.symbol} volume acceleration from demo feed`,
      value: formatPercent(token.volumeChange24h),
      tone: token.volumeChange24h >= 0 ? "mint" : "rose"
    },
    {
      time: "09:18",
      signal: "Liquidity",
      detail: "Mock pool depth snapshot",
      value: formatCompactCurrency(token.liquidityUsd),
      tone: token.liquidityUsd > 1000000 ? "mint" : "amber"
    },
    {
      time: "08:55",
      signal: "Risk",
      detail: token.riskFlags[0]?.label ?? "Demo clear",
      value: riskLabel(token.riskLevel),
      tone:
        token.riskLevel === "clear"
          ? "mint"
          : token.riskLevel === "high"
            ? "rose"
            : "amber"
    },
    {
      time: "08:20",
      signal: "Route",
      detail: "AUSD route preview remains UI-only",
      value: "Disabled",
      tone: "blue"
    }
  ] satisfies Array<{
    time: string;
    signal: string;
    detail: string;
    value: string;
    tone: EventTone;
  }>;
}

function eventToneClass(tone: EventTone) {
  const tones = {
    mint: "border-base-mint/40 bg-base-mint/10 text-base-mint",
    blue: "border-base-blue/30 bg-base-blue/10 text-base-blue",
    amber: "border-base-amber/40 bg-base-amber/10 text-base-amber",
    rose: "border-base-rose/40 bg-base-rose/10 text-base-rose"
  };

  return `inline-flex border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${tones[tone]}`;
}
