import { ArrowRight, Eye, RotateCcw } from "lucide-react";
import Link from "next/link";
import { MetricCard } from "@/components/MetricCard";
import { TokenTable } from "@/components/TokenTable";
import {
  EventTape,
  GaugeCard,
  HeatmapGrid,
  MiniBarList,
  StatusPill,
  TerminalPanel
} from "@/components/TerminalWidgets";
import {
  getTrendingTokens,
  getVolumeGainers,
  marketStats,
  mockBaseTokens
} from "@/data/mockTokens";
import { formatCompactCurrency } from "@/lib/format";

const macroMetrics = [
  ["BTC.D", "52.4", "+0.2"],
  ["ETH/BTC", "0.053", "-0.1"],
  ["BASE IDX", "72", "+2.1"],
  ["STABLE FLOW", "$18.4M", "+4.8"]
];

export default function HomePage() {
  const trendingTokens = getTrendingTokens(6);
  const volumeGainers = getVolumeGainers(4);
  const highestRisk = mockBaseTokens.filter((token) => token.riskLevel !== "clear");

  return (
    <main className="terminal-grid bg-base-black px-4 py-4 sm:px-6">
      <section className="mb-4 border border-base-line bg-base-panel p-3 shadow-panel">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="flex flex-wrap gap-2">
              <StatusPill label="Base Market Terminal Lite" />
              <StatusPill label="Public safe" tone="muted" />
              <StatusPill label="Mock feed" tone="blue" />
            </div>
            <h1 className="mt-3 text-2xl font-semibold text-base-text md:text-3xl">
              Institutional-style Base market overview
            </h1>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-base-muted">
              A dense public terminal for demo token discovery, risk regime
              monitoring, and UI-only route preview workflows.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/dashboard"
              className="inline-flex min-h-8 items-center gap-2 border border-base-mint bg-base-mint px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-white"
            >
              <Eye size={14} aria-hidden="true" />
              Open scanner
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
            <Link
              href="/swap"
              className="inline-flex min-h-8 items-center gap-2 border border-base-line bg-base-elevated px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-base-text"
            >
              <RotateCcw size={14} aria-hidden="true" />
              Route ticket
            </Link>
          </div>
        </div>
      </section>

      <section className="mb-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {marketStats.map((stat) => (
          <MetricCard key={stat.label} stat={stat} />
        ))}
      </section>

      <section className="mb-4 grid gap-2 xl:grid-cols-4">
        {macroMetrics.map(([label, value, change]) => (
          <div
            key={label}
            className="grid grid-cols-[1fr_auto] items-center border border-base-line bg-base-panel px-3 py-2"
          >
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-base-muted">
              {label}
            </span>
            <span className="font-mono text-sm font-semibold text-base-text">
              {value}
              <span
                className={
                  change.startsWith("+")
                    ? "ml-2 text-base-mint"
                    : "ml-2 text-base-rose"
                }
              >
                {change}%
              </span>
            </span>
          </div>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_420px]">
        <div className="space-y-4">
          <TokenTable tokens={trendingTokens} label="Base market scanner" />

          <div className="grid gap-4 lg:grid-cols-3">
            <TerminalPanel label="Macro" title="Demo indicators strip">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="border border-base-line bg-base-elevated p-3">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-base-muted">
                    Liquidity pulse
                  </p>
                  <p className="mt-2 font-mono text-lg font-semibold text-base-mint">
                    68
                  </p>
                </div>
                <div className="border border-base-line bg-base-elevated p-3">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-base-muted">
                    Volatility
                  </p>
                  <p className="mt-2 font-mono text-lg font-semibold text-base-amber">
                    42
                  </p>
                </div>
              </div>
            </TerminalPanel>

            <TerminalPanel label="Sentiment" title="Fear / greed gauge">
              <GaugeCard value={62} label="Constructive" />
            </TerminalPanel>

            <TerminalPanel label="Breadth" title="Market breadth">
              <HeatmapGrid
                items={[
                  { label: "Infra", value: "+12", tone: "mint" },
                  { label: "DeFi", value: "+8", tone: "mint" },
                  { label: "Social", value: "+3", tone: "blue" },
                  { label: "Games", value: "-2", tone: "rose" }
                ]}
              />
            </TerminalPanel>
          </div>
        </div>

        <aside className="space-y-4">
          <TerminalPanel label="Risk" title="Regime monitor">
            <div className="space-y-3">
              <div className="flex items-center justify-between border border-base-mint/30 bg-base-mint/10 px-3 py-2">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-base-mint">
                  Composite score
                </span>
                <span className="font-mono text-xl font-semibold text-base-text">
                  74
                </span>
              </div>
              <EventTape
                items={highestRisk.slice(0, 3).map(
                  (token) =>
                    `${token.symbol}: ${token.riskFlags[0]?.label ?? "Demo risk label"}`
                )}
              />
            </div>
          </TerminalPanel>

          <TerminalPanel label="Flow" title="Funding / volume bars">
            <MiniBarList
              items={[
                { label: "Spot volume", value: 76, tone: "mint" },
                { label: "New pool flow", value: 58, tone: "blue" },
                { label: "Risk alerts", value: 31, tone: "rose" },
                { label: "Stable routing", value: 69, tone: "mint" }
              ]}
            />
          </TerminalPanel>

          <TerminalPanel label="Movers" title="Top volume acceleration">
            <div className="space-y-2">
              {volumeGainers.map((token) => (
                <div
                  key={token.id}
                  className="grid grid-cols-[52px_1fr_auto] items-center gap-2 border border-base-line bg-base-elevated px-2 py-2 text-xs"
                >
                  <span className="font-semibold text-base-text">{token.symbol}</span>
                  <span className="font-mono text-base-muted">
                    {formatCompactCurrency(token.volume24h)}
                  </span>
                  <span className="font-mono text-base-mint">
                    +{token.volumeChange24h.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </TerminalPanel>
        </aside>
      </section>
    </main>
  );
}
