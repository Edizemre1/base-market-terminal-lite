"use client";

import {
  AlertTriangle,
  BookOpenText,
  Droplets,
  Radar,
  Search,
  Star,
  Shuffle,
  WalletCards
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import type { MarketDataMode } from "@/data/providers";
import { formatCompactCurrency, cx } from "@/lib/format";
import { TerminalSearchProvider, useTerminalSearch } from "@/components/TerminalSearchContext";
import { BaseNetworkIcon, PairAvatarStack } from "@/components/TokenIdentity";
import type { BasePair } from "@/types/baseTerminal";
import { APP_VERSION } from "@/lib/appInfo";

const navItems = [
  { href: "/", label: "Radar", icon: Radar, active: "/" },
  { href: "/#new-pairs", label: "New Pools", icon: Droplets, active: "/new-pools" },
  { href: "/#risk", label: "Risk Flags", icon: AlertTriangle, active: "/risk" },
  { href: "/swap", label: "Swap Preview", icon: Shuffle, active: "/swap" },
  { href: "/docs", label: "Docs", icon: BookOpenText, active: "/docs" }
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <TerminalSearchProvider>
      <div className="min-h-screen overflow-x-hidden bg-base-black text-base-text xl:h-screen xl:overflow-hidden">
        <header
          className="fixed left-0 right-0 top-0 z-50 h-10 border-b border-base-line bg-base-panel"
          data-testid="terminal-topbar"
        >
          <div className="grid h-full grid-cols-[minmax(196px,232px)_minmax(220px,520px)_minmax(0,1fr)] items-center gap-2 px-2">
            <Link href="/" className="flex min-w-0 items-center gap-2">
              <span className="grid h-6 w-6 shrink-0 place-items-center border border-base-mint/45 bg-base-mint/10 font-mono text-[11px] font-semibold text-base-mint">
                M
              </span>
              <span className="min-w-0">
                <span
                  className="block truncate text-[13px] font-semibold leading-4 text-base-text"
                  data-testid="product-brand"
                >
                  Mergen<span className="text-base-mint">.finance</span>
                </span>
                <span className="block truncate font-mono text-[9px] uppercase tracking-[0.14em] text-base-muted">
                  Base Swap Terminal
                </span>
              </span>
            </Link>

            <TerminalSearchBox />

            <div className="flex min-w-0 items-center justify-end gap-1 overflow-hidden text-[10px] font-semibold uppercase tracking-[0.12em]">
              <TopChip
                label="Base Mainnet"
                tone="mint"
                icon={<BaseNetworkIcon className="h-4 min-w-8 text-[8px]" />}
              />
              <Suspense fallback={<DataSourceFallback />}>
                <DataSourceSwitcher />
              </Suspense>
              <ProviderHealthChip />
              <TopChip label="UTC 19:06" />
              <TopChip label="EN / TR" />
              <TopChip label="0xDemo...9A1" icon={<WalletCards size={12} />} />
            </div>
          </div>
        </header>

        <aside className="fixed bottom-0 left-0 top-10 z-40 hidden w-[160px] border-r border-base-line bg-base-panel md:flex md:flex-col">
          <nav className="space-y-1 p-1.5" aria-label="Base terminal">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = item.active === "/" ? pathname === "/" : pathname === item.active;

              return (
                <Link
                  key={item.label}
                  href={item.href}
                  className={cx(
                    "flex h-8 items-center gap-2 border-l-2 px-2 text-[11px] font-medium",
                    active
                      ? "border-base-mint bg-base-mint/10 text-base-mint"
                      : "border-transparent text-base-muted hover:border-base-line hover:bg-base-elevated hover:text-base-text"
                  )}
                >
                  <span className="grid h-5 w-5 shrink-0 place-items-center bg-base-elevated text-base-muted">
                    <Icon size={13} aria-hidden="true" />
                  </span>
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="mt-auto p-1.5">
            <div className="border border-base-line bg-base-elevated p-2">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-base-text">
                  Built on Base
                </p>
                <BaseNetworkIcon className="h-4 min-w-8 text-[8px]" />
              </div>
              <p className="text-[11px] leading-4 text-base-muted">
                Public read-only swap terminal using Base ecosystem market data.
              </p>
              <div className="mt-2 grid grid-cols-2 gap-1 font-mono text-[10px]">
                <span className="border border-base-line bg-base-panel px-1.5 py-1 text-base-muted">
                  Chain
                  <span className="block text-base-text">8453</span>
                </span>
                <span className="border border-base-line bg-base-panel px-1.5 py-1 text-base-muted">
                  Mode
                  <span className="block text-base-mint">Read-only</span>
                </span>
              </div>
              <Suspense fallback={<SidebarNetworkCopy mode="mock" />}>
                <SidebarNetworkCard />
              </Suspense>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-base-muted">
              <span>Public demo.</span>
              <Link
                href="/status"
                className="font-mono uppercase tracking-[0.1em] hover:text-base-mint"
                data-testid="app-version-label"
              >
                Status v{APP_VERSION}
              </Link>
            </div>
          </div>
        </aside>

        <div className="min-w-0 pt-10 md:pl-[160px] xl:h-screen xl:overflow-hidden">{children}</div>
      </div>
    </TerminalSearchProvider>
  );
}

function TerminalSearchBox() {
  const { pairs, selectedPairId, selectPair, isPairPinned, togglePinnedPair } = useTerminalSearch();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const results = useMemo(() => getSearchResults(pairs, query), [pairs, query]);
  const shouldShowResults = open && query.trim().length > 0;

  function selectResult(pairId: string) {
    selectPair(pairId);
    setQuery("");
    setOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }

    if (event.key === "Enter" && results[0]) {
      event.preventDefault();
      selectResult(results[0].id);
    }
  }

  return (
    <label className="relative">
      <Search
        size={14}
        aria-hidden="true"
        className="absolute left-2 top-1/2 -translate-y-1/2 text-base-muted"
      />
      <span className="sr-only">Search token, pair, or contract</span>
      <input
        aria-label="Search token, pair, or contract"
        type="search"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
        placeholder="Search token / pair / contract"
        className="h-7 w-full border border-base-line bg-base-black pl-7 pr-2 font-mono text-[12px] text-base-text outline-none placeholder:text-base-muted focus:border-base-mint"
      />
      {shouldShowResults ? (
        <div className="absolute left-0 right-0 top-[32px] z-[60] max-h-[300px] overflow-y-auto border border-base-line bg-base-panel shadow-none">
          {results.length > 0 ? (
            results.map((pair) => (
              <div
                key={pair.id}
                className={cx(
                  "grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 border-b border-base-line px-2 py-1.5 text-left text-[11px] last:border-b-0 hover:bg-base-mint/5",
                  pair.id === selectedPairId && "bg-base-mint/10"
                )}
              >
                <button
                  data-testid={`search-result-${pair.id}`}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectResult(pair.id)}
                  className="flex min-w-0 items-center gap-2 text-left"
                >
                  <PairAvatarStack
                    baseSymbol={pair.baseToken}
                    quoteSymbol={pair.quoteToken}
                    baseLogoUrl={pair.tokenLogoUrl}
                    quoteLogoUrl={pair.quoteTokenLogoUrl}
                    size="sm"
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-mono font-semibold text-base-text">
                      {pair.pair}
                    </span>
                    <span className="block truncate text-[10px] text-base-muted">
                      {pair.dataSource === "mock" ? "Demo fallback" : "Market data"} - {pair.dex}
                    </span>
                  </span>
                </button>
                <span className="text-right font-mono text-[10px] text-base-muted">
                  <span className="block text-base-text">
                    {formatCompactCurrency(pair.liquidity)}
                  </span>
                  <span>{formatCompactCurrency(pair.volume24h)}</span>
                </span>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => togglePinnedPair(pair)}
                  className={cx(
                    "grid h-6 w-6 place-items-center border border-base-line bg-base-elevated text-base-muted hover:border-base-mint hover:text-base-mint",
                    isPairPinned(pair) && "border-base-mint/45 bg-base-mint/10 text-base-mint"
                  )}
                  aria-label={isPairPinned(pair) ? `Unpin ${pair.pair}` : `Pin ${pair.pair}`}
                >
                  <Star
                    size={12}
                    fill={isPairPinned(pair) ? "currentColor" : "none"}
                    aria-hidden="true"
                  />
                </button>
              </div>
            ))
          ) : (
            <div className="px-2 py-2 font-mono text-[11px] text-base-muted">
              No loaded pair matches.
            </div>
          )}
        </div>
      ) : null}
    </label>
  );
}

function getSearchResults(pairs: BasePair[], query: string) {
  const normalizedQuery = normalizeSearch(query);

  if (!normalizedQuery) {
    return [];
  }

  return pairs
    .filter((pair) => getSearchPairShape(pair).haystack.includes(normalizedQuery))
    .slice(0, 8);
}

function getSearchPairShape(pair: {
  id: string;
  pairAddress?: string;
  baseTokenAddress?: string;
  quoteTokenAddress?: string;
  address: string;
  pair: string;
  baseToken: string;
  quoteToken: string;
  project: string;
  dex: string;
}) {
  return {
    haystack: [
      pair.id,
      pair.pairAddress,
      pair.baseTokenAddress,
      pair.quoteTokenAddress,
      pair.address,
      pair.pair,
      pair.baseToken,
      pair.quoteToken,
      pair.project,
      pair.dex
    ]
      .filter(Boolean)
      .map((value) => normalizeSearch(String(value)))
      .join(" ")
  };
}

function normalizeSearch(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function ProviderHealthChip() {
  const { providerHealth } = useTerminalSearch();

  if (!providerHealth) {
    return <TopChip label="Provider - idle - static" />;
  }

  const statusLabel = getProviderHealthStatusLabel(providerHealth);
  const sourceLabel = providerHealth.mode === "dexscreener" ? "Market data" : "Mock feed";
  const updateLabel = formatProviderHealthTime(providerHealth.lastSuccessAt);
  const tone =
    providerHealth.status === "failed" || providerHealth.stale
      ? "amber"
      : providerHealth.status === "refreshing"
        ? "blue"
        : "mint";

  return (
    <TopChip
      dataTestId="provider-health-status"
      label={`${sourceLabel} - ${statusLabel} - ${updateLabel}`}
      tone={tone}
      title={[
        providerHealth.providerName,
        providerHealth.feedStatusLabel,
        providerHealth.failureReason,
        providerHealth.fallbackReason
      ]
        .filter(Boolean)
        .join(" - ")}
    />
  );
}

function getProviderHealthStatusLabel({
  status,
  stale
}: {
  status: "idle" | "refreshing" | "failed";
  stale: boolean;
}) {
  if (status === "refreshing") {
    return "refreshing";
  }

  if (status === "failed") {
    return "failed";
  }

  return stale ? "stale" : "idle";
}

function formatProviderHealthTime(value: string | undefined) {
  if (!value) {
    return "static";
  }

  const timestamp = new Date(value);

  if (Number.isNaN(timestamp.getTime())) {
    return "cached";
  }

  return timestamp.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function DataSourceSwitcher() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeMode: MarketDataMode =
    searchParams.get("data") === "dexscreener" ? "dexscreener" : "mock";

  function selectMode(mode: MarketDataMode) {
    const nextParams = new URLSearchParams(searchParams.toString());

    if (mode === "dexscreener") {
      nextParams.set("data", "dexscreener");
    } else {
      nextParams.delete("data");
    }

    const queryString = nextParams.toString();
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, {
      scroll: false
    });
  }

  return (
    <div className="hidden h-6 items-center border border-base-line bg-base-elevated lg:inline-flex">
      <DataSourceButton
        label="Mock"
        active={activeMode === "mock"}
        onClick={() => selectMode("mock")}
      />
      <DataSourceButton
        label="Read-Only Data"
        active={activeMode === "dexscreener"}
        onClick={() => selectMode("dexscreener")}
      />
    </div>
  );
}

function DataSourceButton({
  label,
  active,
  onClick
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "h-full border-r border-base-line px-1.5 text-[9px] font-semibold uppercase tracking-[0.1em] last:border-r-0",
        active
          ? "bg-base-blue/5 text-base-electric"
          : "text-base-muted hover:bg-base-panel hover:text-base-text"
      )}
    >
      {label}
    </button>
  );
}

function DataSourceFallback() {
  return (
    <span className="hidden h-6 items-center border border-base-line bg-base-elevated px-1.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-base-muted lg:inline-flex">
      Mock
    </span>
  );
}

function SidebarNetworkCard() {
  const searchParams = useSearchParams();
  const activeMode: MarketDataMode =
    searchParams.get("data") === "dexscreener" ? "dexscreener" : "mock";

  return <SidebarNetworkCopy mode={activeMode} />;
}

function SidebarNetworkCopy({ mode }: { mode: MarketDataMode }) {
  const copy =
    mode === "dexscreener"
      ? "Read-only provider mode. No wallet, signing, or execution paths are enabled."
      : "Mock provider mode. Demo rows only; no transactions are sent.";

  return <p className="mt-2 text-[10px] leading-4 text-base-muted">{copy}</p>;
}

function TopChip({
  label,
  tone = "muted",
  icon,
  title,
  dataTestId
}: {
  label: string;
  tone?: "mint" | "blue" | "amber" | "muted";
  icon?: ReactNode;
  title?: string;
  dataTestId?: string;
}) {
  const toneClassName = {
    mint: "border-base-mint/45 bg-base-mint/10 text-base-mint",
    blue: "border-base-blue/25 bg-base-blue/5 text-base-electric",
    amber: "border-base-amber/45 bg-base-amber/10 text-base-amber",
    muted: "border-base-line bg-base-elevated text-base-muted"
  };

  return (
    <span
      data-testid={dataTestId}
      title={title}
      className={cx(
        "hidden h-6 min-w-0 max-w-[170px] items-center gap-1 whitespace-nowrap border px-1.5 lg:inline-flex",
        toneClassName[tone]
      )}
    >
      {icon}
      {label}
    </span>
  );
}
