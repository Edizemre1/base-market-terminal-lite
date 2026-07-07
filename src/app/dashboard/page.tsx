import Link from "next/link";
import { TokenTable } from "@/components/TokenTable";
import {
  DonutMetric,
  EventTape,
  HeatmapGrid,
  MarketMiniCard,
  MiniBarList,
  RouteMiniTicket,
  StatusPill,
  TerminalPanel
} from "@/components/TerminalWidgets";
import {
  getNewTokens,
  getTrendingTokens,
  getVolumeGainers,
  mockBaseTokens
} from "@/data/mockTokens";
import { formatCompactCurrency, formatPercent } from "@/lib/format";

const tabs = [
  "Overview",
  "Crypto",
  "Equities",
  "Funding",
  "FX",
  "Macro",
  "Commodities",
  "Compare"
];

export default function DashboardPage() {
  const trendingTokens = getTrendingTokens(10);
  const newTokens = getNewTokens(4);
  const volumeGainers = getVolumeGainers(4);
  const riskWatchTokens = mockBaseTokens.filter(
    (token) => token.riskLevel !== "clear"
  );

  return (
    <main className="terminal-grid min-h-[calc(100vh-40px)] bg-base-black p-2">
      <nav className="mb-2 flex gap-3 border-b border-base-line px-1 pb-2 text-[11px] text-base-muted">
        {tabs.map((tab, index) => (
          <span
            key={tab}
            className={
              index === 0
                ? "border-b border-base-mint pb-1 font-semibold text-base-text"
                : "pb-1"
            }
          >
            {tab}
          </span>
        ))}
      </nav>

      <section className="grid gap-1 lg:grid-cols-6">
        <MarketMiniCard
          label="BTC / USD"
          value="63,740.00"
          change="+0.62%"
          points={[63200, 63540, 63320, 63720, 63740]}
          meta="spot"
        />
        <MarketMiniCard
          label="ETH / USD"
          value="1,788.36"
          change="+0.78%"
          points={[1762, 1774, 1768, 1782, 1788]}
          meta="spot"
        />
        <MarketMiniCard
          label="Mock 24h vol"
          value="$65.6M"
          change="+14.8%"
          points={[42, 45, 51, 58, 65]}
        />
        <MarketMiniCard
          label="New pools"
          value={newTokens.length.toString()}
          change="+3"
          points={[1, 2, 2, 3, 4]}
          meta="age"
        />
        <MarketMiniCard
          label="Risk radar"
          value="41"
          change="watch"
          points={[34, 38, 42, 39, 41]}
          positive={false}
          meta="risk"
        />
        <MarketMiniCard
          label="Execution"
          value="OFF"
          change="UI-only"
          points={[1, 1, 1, 1, 1]}
          meta="safe"
        />
      </section>

      <section className="mt-2 grid gap-2 xl:grid-cols-[minmax(0,1fr)_330px]">
        <TokenTable
          tokens={trendingTokens}
          label="BASE TOKEN SCANNER · OPERATOR VIEW"
          dense
        />

        <aside className="space-y-2">
          <TerminalPanel
            label="RISK RADAR"
            title="Composite risk view"
            meta={<StatusPill label="Demo" tone="muted" />}
          >
            <DonutMetric value={41} label="Risk radar" />
            <div className="mt-2">
              <MiniBarList
                items={[
                  { label: "Fresh pools", value: 52, tone: "amber" },
                  { label: "Thin liquidity", value: 34, tone: "rose" },
                  { label: "Holder conc", value: 46, tone: "amber" }
                ]}
              />
            </div>
          </TerminalPanel>

          <TerminalPanel label="SCAM FLAG WATCH" title="Demo labels">
            <div className="space-y-1">
              {riskWatchTokens.slice(0, 4).map((token) => (
                <Link
                  key={token.id}
                  href={`/tokens/${token.symbol.toLowerCase()}`}
                  className="grid grid-cols-[54px_1fr_auto] gap-2 border border-base-line bg-base-elevated px-2 py-1.5 text-[11px] hover:border-base-mint"
                >
                  <span className="font-mono font-semibold text-base-text">
                    {token.symbol}
                  </span>
                  <span className="truncate text-base-muted">
                    {token.riskFlags[0]?.label ?? "Demo label"}
                  </span>
                  <span className="font-mono text-base-muted">
                    {formatCompactCurrency(token.liquidityUsd)}
                  </span>
                </Link>
              ))}
            </div>
          </TerminalPanel>

          <TerminalPanel label="VOLUME ALERTS" title="Flow monitor">
            <MiniBarList
              items={volumeGainers.slice(0, 4).map((token) => ({
                label: token.symbol,
                value: Math.min(96, Math.round(token.volumeChange24h / 4)),
                tone: token.volumeChange24h > 150 ? "mint" : "blue"
              }))}
            />
          </TerminalPanel>

          <TerminalPanel label="ROUTE PREVIEW" title="Mini ticket">
            <RouteMiniTicket />
          </TerminalPanel>
        </aside>
      </section>

      <section className="mt-2 grid gap-2 xl:grid-cols-[1.25fr_1fr_1.35fr]">
        <TerminalPanel label="SECTORS" title="Mock sector heatmap">
          <HeatmapGrid
            items={[
              { label: "Infra", value: "+12.1", tone: "mint" },
              { label: "DeFi", value: "+9.4", tone: "mint" },
              { label: "Social", value: "+4.2", tone: "blue" },
              { label: "Gaming", value: "+2.6", tone: "blue" },
              { label: "Culture", value: "-1.8", tone: "rose" },
              { label: "Utility", value: "-0.4", tone: "amber" },
              { label: "Stable", value: "+0.1", tone: "blue" },
              { label: "New", value: "+18.7", tone: "mint" }
            ]}
          />
        </TerminalPanel>

        <TerminalPanel label="FUNDING" title="Funding bars">
          <MiniBarList
            items={[
              { label: "Stable inflow", value: 74, tone: "mint" },
              { label: "Spec pressure", value: 38, tone: "rose" },
              { label: "Route depth", value: 63, tone: "blue" },
              { label: "Breadth", value: 66, tone: "mint" }
            ]}
          />
        </TerminalPanel>

        <TerminalPanel label="EVENT TAPE" title="Demo market events">
          <EventTape
            items={[
              `MINT volume delta ${formatPercent(118.3)} with fresh-pool watch label.`,
              "FLASH remains excluded from preview tokens because demo risk is high.",
              "AUSD route depth is the largest mock liquidity anchor.",
              "All rows are local mock data; no live feed is connected."
            ]}
          />
        </TerminalPanel>
      </section>
    </main>
  );
}
