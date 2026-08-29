import { useState } from "react";
import { AlertTriangle, Copy, ExternalLink } from "lucide-react";
import { cx, formatCompactCurrency, formatPercent } from "@/lib/format";
import type { BasePair } from "@/types/baseTerminal";
import type { DetailTab } from "@/components/base-terminal/types";

const tabs: Array<{ id: DetailTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "risk", label: "Risk" },
  { id: "liquidity", label: "Liquidity" },
  { id: "activity", label: "Activity" }
];

export function PairDetailTabs({
  pair,
  activeTab,
  onTabChange,
  providerStale
}: {
  pair: BasePair;
  activeTab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
  providerStale: boolean;
}) {
  return (
    <section id="risk" className="flex min-h-0 flex-col overflow-hidden border border-base-line bg-base-panel">
      <div className="grid h-10 shrink-0 grid-cols-4 border-b border-base-line bg-base-raised" role="tablist" aria-label="Selected market details">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cx(
              "h-full min-w-0 border-r border-base-line px-2 text-[11px] font-semibold uppercase tracking-[0.14em] last:border-r-0",
              activeTab === tab.id
                ? "bg-base-panel text-base-mint"
                : "text-base-muted hover:text-base-text"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {renderTab(pair, activeTab, providerStale)}
      </div>
    </section>
  );
}

function renderTab(pair: BasePair, activeTab: DetailTab, providerStale: boolean) {
  if (activeTab === "overview") {
    return (
      <div className="space-y-2">
        <div className="grid gap-2 md:grid-cols-4">
          <OverviewCell label="Pair" value={pair.pair} />
          <OverviewCell label="DEX" value={pair.dexName ?? pair.dex} />
          <OverviewCell label="Chain" value={pair.chainId ?? "Base"} />
          <OverviewCell label="Pair age" value={pair.age} />
          <OverviewCell label="Price USD" value={pair.priceUsd} />
          <OverviewCell label="Price native" value={pair.priceNative ?? pair.price} />
          <OverviewCell label="FDV" value={formatOptionalCurrency(pair.fdv)} />
          <OverviewCell label="Market cap" value={formatOptionalCurrency(pair.marketCap)} />
        </div>

        <div className="grid gap-2 lg:grid-cols-3">
          <AddressCell
            label="Pair address"
            value={pair.pairAddress}
            links={[
              getExternalLink("DexScreener", pair.sourceUrl),
              getExternalLink("BaseScan", getBaseScanAddressUrl(pair.pairAddress))
            ]}
          />
          <AddressCell
            label="Base token address"
            value={pair.baseTokenAddress}
            links={[getExternalLink("BaseScan", getBaseScanAddressUrl(pair.baseTokenAddress))]}
          />
          <AddressCell
            label="Quote token address"
            value={pair.quoteTokenAddress}
            links={[getExternalLink("BaseScan", getBaseScanAddressUrl(pair.quoteTokenAddress))]}
          />
        </div>

        <div className="grid gap-2 md:grid-cols-4">
          <OverviewCell
            label="5m change"
            value={formatOptionalPercent(pair.priceChanges?.m5)}
            tone={getChangeTone(pair.priceChanges?.m5)}
          />
          <OverviewCell
            label="1h change"
            value={formatOptionalPercent(pair.priceChanges?.h1)}
            tone={getChangeTone(pair.priceChanges?.h1)}
          />
          <OverviewCell
            label="6h change"
            value={formatOptionalPercent(pair.priceChanges?.h6)}
            tone={getChangeTone(pair.priceChanges?.h6)}
          />
          <OverviewCell
            label="24h change"
            value={formatOptionalPercent(pair.priceChanges?.h24 ?? pair.change24h)}
            tone={getChangeTone(pair.priceChanges?.h24 ?? pair.change24h)}
          />
        </div>

        <div className="grid gap-2 md:grid-cols-4">
          <OverviewCell label="5m volume" value={formatOptionalCompactCurrency(pair.volumes?.m5)} />
          <OverviewCell label="1h volume" value={formatOptionalCompactCurrency(pair.volumes?.h1)} />
          <OverviewCell label="6h volume" value={formatOptionalCompactCurrency(pair.volumes?.h6)} />
          <OverviewCell
            label="24h volume"
            value={formatOptionalCompactCurrency(pair.volumes?.h24 ?? pair.volume24h)}
          />
        </div>

        <div className="grid gap-2 md:grid-cols-4">
          <OverviewCell label="5m buys/sells" value={formatTxnWindow(pair.txns?.m5)} />
          <OverviewCell label="1h buys/sells" value={formatTxnWindow(pair.txns?.h1)} />
          <OverviewCell label="6h buys/sells" value={formatTxnWindow(pair.txns?.h6)} />
          <OverviewCell label="24h buys/sells" value={formatTxnWindow(pair.txns?.h24)} />
        </div>

        <PublicSignalsPanel pair={pair} providerStale={providerStale} />
      </div>
    );
  }

  if (activeTab === "liquidity") {
    return (
      <div className="grid gap-2 md:grid-cols-4">
        <OverviewCell label="Pool liquidity" value={pair.liquidityDetail.poolLiquidity} />
        <OverviewCell label="LP change" value={pair.liquidityDetail.lpChange} />
        <OverviewCell label="Depth" value={pair.liquidityDetail.depth} />
        <OverviewCell label="Route source" value={pair.liquidityDetail.routeSource} />
      </div>
    );
  }

  if (activeTab === "activity") {
    return (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left text-[11px]">
          <thead>
            <tr className="border-b border-base-line bg-base-elevated text-[10px] uppercase tracking-[0.12em] text-base-muted">
              <th className="px-2 py-1.5">Window</th>
              <th className="px-2 py-1.5">Transactions</th>
              <th className="px-2 py-1.5">Volume</th>
              <th className="px-2 py-1.5">Source</th>
            </tr>
          </thead>
          <tbody>
            {pair.activity.map((event) => (
              <tr key={`${event.time}-${event.wallet}`} className="h-8 border-b border-base-line last:border-b-0">
                <td className="px-2 py-1.5 font-mono text-base-muted">{event.time}</td>
                <td className="px-2 py-1.5 font-mono text-base-text">{event.amount}</td>
                <td className="px-2 py-1.5 font-mono text-base-text">{event.value}</td>
                <td className="px-2 py-1.5 font-mono text-base-muted">{event.wallet}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <PublicSignalsPanel pair={pair} providerStale={providerStale} />
      <div className="rounded-sm border border-base-amber/35 bg-base-amber/10 p-3 text-[11px] leading-5 text-base-amber">
        <p className="font-semibold text-base-text">
          {pair.dataSource === "mock" ? "Demo-only safety fields" : "Safety verification not available"}
        </p>
        <p>
          {pair.dataSource === "mock"
            ? "These fields belong to the explicitly selected sample dataset and are not real checks."
            : "Contract, holder and LP-lock checks were not performed. Unknown does not mean safe."}
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <RiskGroup title="Contract checks" rows={pair.riskChecks.slice(0, 4).map((check) => [check.label, check.value])} />
        <RiskGroup title="Holder data" rows={[["Top 10 holders", pair.holders.top10], ["Top 50 holders", pair.holders.top50], ["Top 100 holders", pair.holders.top100], ["Active holders (24h)", pair.holders.active24h]]} />
        <RiskGroup title="LP & token settings" rows={[["DEX", pair.dexName ?? pair.dex], ["LP lock", pair.lpLock.status], ["Lock provider", pair.lpLock.provider], ["Buy / sell tax", `${pair.taxes.buy} / ${pair.taxes.sell}`]]} />
      </div>
    </div>
  );
}

function OverviewCell({
  label,
  value,
  tone = "default"
}: {
  label: string;
  value: string;
  tone?: "default" | "mint" | "rose";
}) {
  return (
    <div className="border border-base-line bg-base-elevated p-2">
      <p className="text-[10px] uppercase tracking-[0.12em] text-base-muted">{label}</p>
      <p
        className={cx(
          "mt-1 font-mono text-[13px] font-semibold",
          tone === "mint"
            ? "text-base-mint"
            : tone === "rose"
              ? "text-base-rose"
              : "text-base-text"
        )}
      >
        {value}
      </p>
    </div>
  );
}

function AddressCell({
  label,
  value,
  links
}: {
  label: string;
  value: string | undefined;
  links: Array<{ label: string; href: string } | undefined>;
}) {
  const usableLinks = links.filter((link): link is { label: string; href: string } =>
    Boolean(link?.href)
  );

  return (
    <div className="min-w-0 border border-base-line bg-base-elevated p-2">
      <p className="text-[10px] uppercase tracking-[0.12em] text-base-muted">{label}</p>
      <p
        className="mt-1 break-all font-mono text-[11px] font-semibold text-base-text"
        title={value}
      >
        {value ?? "N/A"}
      </p>
      {value || usableLinks.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {value ? <CopyValueButton value={value} label={label} /> : null}
          {usableLinks.map((link) => (
            <ExternalDataLink key={`${label}-${link.label}`} href={link.href} label={link.label} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CopyValueButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copyValue() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={copyValue}
      className="inline-flex h-5 items-center gap-1 border border-base-line bg-base-panel px-1.5 font-mono text-[10px] text-base-muted hover:border-base-mint hover:text-base-mint"
      aria-label={`Copy ${label}`}
    >
      <Copy size={10} aria-hidden="true" />
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function ExternalDataLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex h-5 items-center gap-1 border border-base-line bg-base-panel px-1.5 font-mono text-[10px] text-base-muted hover:border-base-mint hover:text-base-mint"
    >
      <ExternalLink size={10} aria-hidden="true" />
      {label}
    </a>
  );
}

function PublicSignalsPanel({
  pair,
  providerStale
}: {
  pair: BasePair;
  providerStale: boolean;
}) {
  const signals = getPublicMarketSignals(pair, providerStale);

  return (
    <div className="border border-base-line bg-base-elevated p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-base-muted">
          Public data signals
        </p>
        <span className="font-mono text-[10px] text-base-muted">Read-only heuristics</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {signals.map((signal) => (
          <span
            key={signal}
            className="border border-base-amber/40 bg-base-amber/10 px-1.5 py-0.5 font-mono text-[10px] text-base-amber"
          >
            {signal}
          </span>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-base-muted">
        These signals use displayed public market data only. They are not financial advice.
      </p>
    </div>
  );
}

function getPublicMarketSignals(pair: BasePair, providerStale: boolean) {
  const signals: string[] = [];
  const volumeLiquidityRatio = pair.liquidity > 0 ? pair.volume24h / pair.liquidity : 0;
  const shortTermMove = Math.max(
    Math.abs(pair.priceChanges?.m5 ?? 0),
    Math.abs(pair.priceChanges?.h1 ?? 0),
    Math.abs(pair.priceChanges?.h6 ?? 0)
  );

  if (pair.stale || providerStale) {
    signals.push("Stale provider data");
  }

  if (pair.liquidity > 0 && pair.liquidity < 50_000) {
    signals.push("Low liquidity");
  }

  if (volumeLiquidityRatio >= 2) {
    signals.push("High volume versus liquidity");
  }

  if (pair.ageMinutes > 0 && pair.ageMinutes <= 24 * 60) {
    signals.push("Very new pair");
  }

  if (!pair.pairCreatedAt) {
    signals.push("Missing age data");
  }

  if (shortTermMove >= 15) {
    signals.push("Large short-term move");
  }

  return signals.length > 0 ? signals : ["No notable public signal"];
}

function getExternalLink(label: string, href: string | undefined) {
  return href ? { label, href } : undefined;
}

function getBaseScanAddressUrl(address: string | undefined) {
  return address ? `https://basescan.org/address/${address}` : undefined;
}

function formatOptionalCurrency(value: number | undefined) {
  return value && value > 0 ? formatCompactCurrency(value) : "N/A";
}

function formatOptionalCompactCurrency(value: number | undefined) {
  return typeof value === "number" && value > 0 ? formatCompactCurrency(value) : "N/A";
}

function formatOptionalPercent(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? formatPercent(value) : "N/A";
}

function getChangeTone(value: number | undefined) {
  if (typeof value !== "number" || value === 0) {
    return "default";
  }

  return value > 0 ? "mint" : "rose";
}

function formatTxnWindow(window: { buys: number; sells: number } | undefined) {
  return window ? `${window.buys} / ${window.sells}` : "N/A";
}

function RiskGroup({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <div className="rounded-sm bg-base-elevated p-3">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-base-muted">{title}</h3>
      {rows.map(([label, value]) => <RiskRow key={label} label={label} value={value} />)}
    </div>
  );
}

function RiskRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[1fr_auto_18px] items-center gap-2 border-b border-base-line py-1 text-[11px] last:border-b-0">
      <span className="text-base-text">{label}</span>
      <span className="font-mono text-base-text">{value}</span>
      <AlertTriangle
        size={13}
        className="text-base-amber"
        aria-hidden="true"
      />
    </div>
  );
}
