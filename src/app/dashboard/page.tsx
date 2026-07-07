import Link from "next/link";
import { ArrowRight, ShieldAlert } from "lucide-react";
import { MetricCard } from "@/components/MetricCard";
import { RiskBadge } from "@/components/RiskBadge";
import { SectionHeader } from "@/components/SectionHeader";
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
    <main className="terminal-grid bg-base-black px-4 py-4 sm:px-6">
      <section className="mb-4 border border-base-line bg-base-panel p-3 shadow-panel">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="flex flex-wrap gap-2">
              <StatusPill label="Market scanner" />
              <StatusPill label="Mock data" tone="blue" />
              <StatusPill label="Execution disabled" tone="amber" />
            </div>
            <h1 className="mt-3 text-2xl font-semibold text-base-text md:text-3xl">
              Base market command center
            </h1>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-base-muted">
              Dense demo token scanner with risk regime, flow alerts, breadth,
              and public-safe market notes.
            </p>
          </div>

          <Link
            href="/swap"
            className="inline-flex min-h-8 w-fit items-center gap-2 border border-base-mint bg-base-mint px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-white"
          >
            Open route ticket
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
      </section>

      <section className="mb-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {marketStats.map((stat) => (
          <MetricCard key={stat.label} stat={stat} />
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_390px]">
        <div className="space-y-4">
          <div>
            <SectionHeader
              eyebrow="Scanner"
              title="Token scanner"
              description="Thin-row table optimized for repeated market review."
            />
            <TokenTable tokens={trendingTokens} label="Primary token scanner" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <TerminalPanel label="New pools" title="Launch monitor">
              <TokenTable tokens={newTokens.slice(0, 4)} label="Newest demo tokens" />
            </TerminalPanel>

            <TerminalPanel label="Top movers" title="Volume acceleration">
              <div className="space-y-2">
                {volumeGainers.map((token) => (
                  <div
                    key={token.id}
                    className="grid grid-cols-[56px_1fr_auto] items-center gap-2 border border-base-line bg-base-elevated px-2 py-2 text-xs"
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
          </div>
        </div>

        <aside className="space-y-4">
          <TerminalPanel label="Risk" title="Risk regime / scam flags">
            <div className="space-y-2">
              {riskWatchTokens.map((token) => (
                <Link
                  key={token.id}
                  href={`/tokens/${token.symbol.toLowerCase()}`}
                  className="block border border-base-line bg-base-elevated p-3 transition hover:border-base-mint"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-base-text">
                        {token.symbol}
                      </p>
                      <p className="mt-1 text-[11px] text-base-muted">
                        {formatCompactCurrency(token.liquidityUsd)} liquidity
                      </p>
                    </div>
                    <RiskBadge level={token.riskLevel} compact />
                  </div>
                  <p className="mt-2 text-xs leading-5 text-base-muted">
                    {token.riskFlags[0]?.label ?? "Demo label"}
                  </p>
                </Link>
              ))}
            </div>
          </TerminalPanel>

          <TerminalPanel label="Alerts" title="Volume alerts">
            <MiniBarList
              items={[
                { label: "Volume acceleration", value: 82, tone: "mint" },
                { label: "Thin liquidity", value: 37, tone: "rose" },
                { label: "New pool activity", value: 64, tone: "blue" },
                { label: "Risk labels", value: 44, tone: "rose" }
              ]}
            />
          </TerminalPanel>

          <TerminalPanel label="Posture" title="Execution policy">
            <div className="flex items-start gap-3 border border-base-amber/40 bg-base-amber/10 p-3">
              <ShieldAlert className="mt-0.5 shrink-0 text-base-amber" size={16} />
              <p className="text-xs leading-5 text-base-muted">
                Mock market intelligence only. No wallet signing, approvals, or
                transaction execution is implemented.
              </p>
            </div>
          </TerminalPanel>
        </aside>
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-4">
        <TerminalPanel label="Breadth" title="Market breadth">
          <GaugeCard value={66} label="Positive breadth" />
        </TerminalPanel>

        <TerminalPanel label="Sectors" title="Mock heatmap">
          <HeatmapGrid
            items={[
              { label: "Infra", value: "+12", tone: "mint" },
              { label: "DeFi", value: "+9", tone: "mint" },
              { label: "Social", value: "+3", tone: "blue" },
              { label: "Gaming", value: "-2", tone: "rose" }
            ]}
          />
        </TerminalPanel>

        <TerminalPanel label="Funding" title="Funding / volume">
          <MiniBarList
            items={[
              { label: "AUSD flow", value: 71, tone: "mint" },
              { label: "Route depth", value: 63, tone: "blue" },
              { label: "Spec risk", value: 28, tone: "rose" }
            ]}
          />
        </TerminalPanel>

        <TerminalPanel label="Notes" title="Demo news tape">
          <EventTape
            items={[
              "Base mock volume remains concentrated in stable and infra rows.",
              "New-pool monitor highlights PIXEL and FLASH as demo watch states.",
              "Route preview remains disabled and uses local quote math only."
            ]}
          />
        </TerminalPanel>
      </section>
    </main>
  );
}
