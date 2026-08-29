"use client";

import {
  Bell,
  Droplets,
  Radar,
  Search,
  Star,
  WalletCards
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import type { MarketDataMode } from "@/data/providers";
import { cx } from "@/lib/format";
import { TerminalSearchProvider, useTerminalSearch } from "@/components/TerminalSearchContext";
import { WalletButton } from "@/components/WalletButton";
import { WalletProvider } from "@/components/WalletContext";
import { BaseNetworkIcon, MergenMark, PairAvatarStack } from "@/components/TokenIdentity";
import type { BasePair } from "@/types/baseTerminal";
import { APP_VERSION } from "@/lib/appInfo";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/dictionaries";

const navItems = [
  { href: "/", labelKey: "nav.pulse", view: "pulse", icon: Radar },
  { href: "/?view=markets", labelKey: "nav.markets", view: "markets", icon: Droplets },
  { href: "/?view=watchlist", labelKey: "nav.watchlist", view: "watchlist", icon: Star },
  { href: "/?view=alerts", labelKey: "nav.alerts", view: "alerts", icon: Bell, desktopOnly: true },
  { href: "/?view=wallet", labelKey: "nav.wallet", view: "wallet", icon: WalletCards }
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <WalletProvider>
      <TerminalSearchProvider>
      <div className="min-h-screen overflow-x-hidden bg-base-black text-base-text">
        <header
          className="fixed left-0 right-0 top-0 z-50 h-14 border-b border-base-line/60 bg-base-panel/95 backdrop-blur-xl"
          data-testid="terminal-topbar"
        >
          <div className="grid h-full grid-cols-[minmax(72px,100px)_minmax(65px,1fr)_auto_auto] items-center gap-1.5 px-2 lg:grid-cols-[minmax(220px,270px)_minmax(300px,1fr)_auto_auto_auto] lg:gap-2 lg:px-4">
            <Link href="/" className="flex min-w-0 items-center gap-2.5">
              <MergenMark className="h-7 w-5" />
              <span className="min-w-0">
                <span
                  className="block truncate text-[13px] font-semibold leading-4 text-base-text"
                  data-testid="product-brand"
                >
                  Mergen <span className="text-base-mint">Finance</span>
                </span>
                <span className="block truncate font-mono text-[9px] uppercase tracking-[0.14em] text-base-muted">
                  <HeaderProductLabel />
                </span>
              </span>
            </Link>

            <TerminalSearchBox />

            <div className="hidden min-w-0 items-center justify-end gap-1 overflow-hidden text-[10px] font-semibold uppercase tracking-[0.08em] lg:flex">
              <HeaderHeartbeat />
              <TopChip
                label="Base Mainnet"
                tone="mint"
                icon={<BaseNetworkIcon className="h-4 w-4" />}
              />
              <Suspense fallback={<DataSourceFallback />}>
                <DataSourceSwitcher />
              </Suspense>
              <HeaderAlertLink />
            </div>
            <LocaleSwitcher />
            <WalletButton compact />
          </div>
        </header>

        <aside className="fixed bottom-0 left-0 top-14 z-40 hidden w-[80px] border-r border-base-line/60 bg-base-panel/80 backdrop-blur-xl md:flex md:flex-col">
          <Suspense><TerminalNavigation /></Suspense>

          <div className="mt-auto p-2 text-center">
              <BaseNetworkIcon className="mx-auto h-6 w-6" />
              <Link
                href="/status"
                className="mt-2 block font-mono text-[9px] uppercase tracking-[0.1em] text-base-muted hover:text-base-mint"
                data-testid="app-version-label"
              >
                Status v{APP_VERSION}
              </Link>
          </div>
        </aside>

        <div className="min-w-0 pb-16 pt-14 md:pb-0 md:pl-[80px]">{children}</div>
        <Suspense><TerminalNavigation mobile /></Suspense>
      </div>
      </TerminalSearchProvider>
    </WalletProvider>
  );
}

function TerminalSearchBox() {
  const { t, formatCompactCurrency } = useI18n();
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
      <span className="sr-only">{t("header.search")}</span>
      <input
        aria-label={t("header.search")}
        type="search"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
        placeholder={t("header.searchPlaceholder")}
        className="h-9 w-full border border-base-line bg-base-black pl-7 pr-2 font-mono text-[12px] text-base-text outline-none placeholder:text-base-muted focus:border-base-mint lg:h-8"
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
                      {pair.dataSource === "mock" ? t("header.demoFallback") : t("header.marketData")} - {pair.dex}
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
                  {t("header.noSearchResults")}
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

function DataSourceSwitcher() {
  const { t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeMode: MarketDataMode =
    searchParams.get("data") === "mock" ? "mock" : "dexscreener";

  function selectMode(mode: MarketDataMode) {
    const nextParams = new URLSearchParams(searchParams.toString());

    if (mode === "mock") {
      nextParams.set("data", "mock");
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
        label={t("header.mock")}
        active={activeMode === "mock"}
        onClick={() => selectMode("mock")}
      />
      <DataSourceButton
        label={t("header.live")}
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
  const { t } = useI18n();
  return (
    <span className="hidden h-6 items-center border border-base-line bg-base-elevated px-1.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-base-muted lg:inline-flex">
      {t("header.readOnlyData")}
    </span>
  );
}

function HeaderHeartbeat() {
  const { t } = useI18n();
  const { providerHealth } = useTerminalSearch();
  const label = providerHealth?.status === "refreshing"
    ? t("header.heartbeatChecking")
    : providerHealth?.stale
      ? t("header.heartbeatDelayed")
      : providerHealth?.lastSuccessAt
        ? `Heartbeat · ${formatHeartbeat(providerHealth.lastSuccessAt)}`
        : t("header.heartbeatStarting");
  return <TopChip label={label} tone={providerHealth?.stale ? "amber" : "mint"} />;
}

function formatHeartbeat(value: string) {
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime())
    ? "source ready"
    : `${timestamp.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "UTC" })} UTC`;
}

function HeaderProductLabel() {
  return <>{useI18n().t("header.product")}</>;
}

function HeaderAlertLink() {
  const { t } = useI18n();
  return <Link href="/?view=alerts" className="grid h-8 w-8 place-items-center rounded-full bg-base-elevated text-base-muted hover:text-base-mint" aria-label={t("header.alerts")}><Bell size={13} /></Link>;
}

function LocaleSwitcher() {
  const { locale, setLocale, t } = useI18n();
  return <div className="inline-flex h-8 items-center rounded-full bg-base-elevated p-0.5" aria-label={t("header.language")} data-testid="locale-switcher">{(["tr", "en"] as const).map((item) => <button key={item} type="button" onClick={() => setLocale(item)} aria-pressed={locale === item} className={cx("h-7 rounded-full px-1.5 font-mono text-[9px] font-bold uppercase lg:px-2 lg:text-[10px]", locale === item ? "bg-base-mint text-[#031411]" : "text-base-muted hover:text-base-text")}>{item}</button>)}</div>;
}

function TerminalNavigation({ mobile = false }: { mobile?: boolean }) {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const activeView = searchParams.get("view") ?? "pulse";
  const items = navItems.filter((item) => !(mobile && "desktopOnly" in item && item.desktopOnly));
  if (mobile) return <nav className="fixed bottom-0 left-0 right-0 z-50 grid h-14 grid-cols-4 border-t border-base-line/60 bg-base-panel/95 px-1 backdrop-blur-xl md:hidden" aria-label={t("nav.mobile")}>{items.map((item) => { const Icon = item.icon; const active = activeView === item.view; return <Link key={`mobile-${item.view}`} href={item.href} className={cx("flex flex-col items-center justify-center gap-1 text-[9px] font-semibold", active ? "text-base-mint" : "text-base-muted")}><Icon size={15} /><span>{t(item.labelKey as TranslationKey)}</span></Link>; })}</nav>;
  return <nav className="space-y-1 p-2" aria-label={t("nav.desktop")}>{items.map((item) => { const Icon = item.icon; const active = activeView === item.view; return <Link key={item.view} href={item.href} className={cx("flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg text-[9px] font-semibold", active ? "bg-base-mint/10 text-base-mint" : "text-base-muted hover:bg-base-elevated hover:text-base-text")}><span className="grid h-5 w-5 shrink-0 place-items-center text-current"><Icon size={13} aria-hidden="true" /></span><span className="truncate">{t(item.labelKey as TranslationKey)}</span></Link>; })}</nav>;
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
