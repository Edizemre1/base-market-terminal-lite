import { TokenTable } from "@/components/TokenTable";
import {
  CompactList,
  DonutMetric,
  EventTape,
  MacroStrip,
  MarketMiniCard,
  MiniBarList,
  RiskGauge,
  StatusPill,
  TerminalPanel
} from "@/components/TerminalWidgets";
import {
  getTrendingTokens,
  getVolumeGainers,
  mockBaseTokens
} from "@/data/mockTokens";
import { formatCompactCurrency, formatPercent } from "@/lib/format";

const macroItems = [
  { label: "FED RATE", value: "3.63%", delta: "-0.04", points: [3.7, 3.66, 3.62, 3.64, 3.63], positive: false },
  { label: "US10Y", value: "4.49%", delta: "+0.02", points: [4.41, 4.44, 4.47, 4.45, 4.49] },
  { label: "DXY", value: "100.73", delta: "+0.21", points: [99.9, 100.0, 100.2, 100.5, 100.73] },
  { label: "BTC.D", value: "54.8", delta: "+0.6", points: [53.7, 54.1, 54.0, 54.4, 54.8] },
  { label: "ETH/BTC", value: "0.035", delta: "-0.3", points: [0.037, 0.036, 0.036, 0.035, 0.035], positive: false },
  { label: "BASE TVL", value: "$2.6B", delta: "+2.4", points: [2.1, 2.2, 2.4, 2.5, 2.6] }
];

export default function HomePage() {
  const scannerTokens = getTrendingTokens(8);
  const gainers = getVolumeGainers(4);
  const losers = [...mockBaseTokens]
    .sort((left, right) => left.priceChange24h - right.priceChange24h)
    .slice(0, 4);

  return (
    <main className="terminal-grid min-h-[calc(100vh-40px)] bg-base-black p-2">
      <section className="grid gap-1 lg:grid-cols-6">
        <MarketMiniCard
          label="BTC / USD"
          value="63,740.80"
          change="+0.62%"
          points={[63200, 63540, 63320, 63720, 63740]}
          meta="spot"
        />
        <MarketMiniCard
          label="ETH / USD"
          value="1,788.25"
          change="+0.78%"
          points={[1762, 1774, 1768, 1782, 1788]}
          meta="spot"
        />
        <MarketMiniCard
          label="Base risk score"
          value="27"
          change="Risk-off"
          points={[34, 31, 29, 28, 27]}
          positive={false}
          meta="demo"
        />
        <MarketMiniCard
          label="Total mkt / Base dom"
          value="$65.6M"
          change="2.8% dom"
          points={[51, 53, 55, 58, 65]}
          meta="mock"
        />
        <CompactList
          label="Top gainers"
          items={gainers.map((token) => ({
            symbol: token.symbol,
            value: formatPercent(token.priceChange24h)
          }))}
        />
        <CompactList
          label="Top losers"
          tone="rose"
          items={losers.map((token) => ({
            symbol: token.symbol,
            value: formatPercent(token.priceChange24h)
          }))}
        />
      </section>

      <section className="mt-2 grid gap-2 xl:grid-cols-[minmax(0,1fr)_34%]">
        <TokenTable tokens={scannerTokens} label="BASE TOKEN SCANNER · LIVE DEMO" />

        <TerminalPanel
          label="MARKET REGIME"
          title="Base composite state"
          meta={<StatusPill label="Generated" tone="muted" />}
        >
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-base-muted">
                Current regime
              </p>
              <p className="mt-1 font-mono text-3xl font-semibold text-base-rose">
                RISK-OFF
              </p>
            </div>
            <StatusPill label="Risk gauge" tone="amber" />
          </div>
          <RiskGauge value={27} />
          <dl className="mt-3 space-y-1.5 text-[11px]">
            <RegimeMetric label="Sensitivity" value="HIGH / 72" />
            <RegimeMetric label="Volume tilt" value="DEFENSIVE +9%" />
            <RegimeMetric label="Breadth" value="116 UP / 179 DOWN" />
          </dl>
          <p className="mt-3 border-t border-base-line pt-2 text-[11px] leading-4 text-base-muted">
            Demo regime output from local mock rows. No live market or contract
            scoring is included.
          </p>
        </TerminalPanel>
      </section>

      <TerminalPanel
        className="mt-2"
        label="MACRO INDICATORS"
        title="Compact demo strip"
      >
        <MacroStrip items={macroItems} />
      </TerminalPanel>

      <section className="mt-2 grid gap-2 xl:grid-cols-[1.05fr_1fr_1fr_1fr_1.25fr]">
        <TerminalPanel label="SENTIMENT" title="Fear / greed gauge">
          <DonutMetric value={27} label="Risk sentiment" />
        </TerminalPanel>

        <TerminalPanel label="BREADTH" title="Market breadth">
          <DonutMetric value={65} label="Up / down ratio" />
        </TerminalPanel>

        <TerminalPanel label="FUNDING" title="Funding / volume bars">
          <MiniBarList
            items={[
              { label: "Stable flow", value: 72, tone: "mint" },
              { label: "New pools", value: 48, tone: "blue" },
              { label: "Thin liq", value: 31, tone: "rose" }
            ]}
          />
        </TerminalPanel>

        <TerminalPanel label="MOVERS" title="Top movers">
          <div className="space-y-1">
            {gainers.slice(0, 4).map((token) => (
              <div
                key={token.id}
                className="grid grid-cols-[54px_1fr_auto] gap-2 border border-base-line bg-base-elevated px-2 py-1.5 text-[11px]"
              >
                <span className="font-mono font-semibold text-base-text">{token.symbol}</span>
                <span className="font-mono text-base-muted">
                  {formatCompactCurrency(token.volume24h)}
                </span>
                <span className="font-mono text-base-mint">
                  {formatPercent(token.priceChange24h)}
                </span>
              </div>
            ))}
          </div>
        </TerminalPanel>

        <TerminalPanel label="NEWS" title="Demo notes">
          <EventTape
            items={[
              "Base demo risk regime remains defensive with breadth narrowing.",
              "Mock stable flow is concentrated around AUSD and infra rows.",
              "Execution surfaces remain disabled and UI-only."
            ]}
          />
        </TerminalPanel>
      </section>
    </main>
  );
}

function RegimeMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border border-base-line bg-base-elevated px-2 py-1.5">
      <dt className="uppercase tracking-[0.12em] text-base-muted">{label}</dt>
      <dd className="font-mono font-semibold text-base-text">{value}</dd>
    </div>
  );
}
