"use client";

import {
  Bell,
  BriefcaseBusiness,
  Droplets,
  PanelsTopLeft,
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
import { OverlayProvider } from "@/components/OverlayManager";

const navItems = [
  { href: "/terminal", labelKey: "nav.terminal", view: "terminal", icon: PanelsTopLeft },
  { href: "/terminal?view=markets", labelKey: "nav.markets", view: "markets", icon: Droplets },
  { href: "/terminal?view=watchlist", labelKey: "nav.watchlist", view: "watchlist", icon: Star },
  { href: "/terminal?view=portfolio", labelKey: "nav.portfolio", view: "portfolio", icon: BriefcaseBusiness, desktopOnly: true },
  { href: "/terminal?view=alerts", labelKey: "nav.alerts", view: "alerts", icon: Bell, desktopOnly: true },
  { href: "/terminal?view=portfolio", labelKey: "nav.wallet", view: "portfolio", icon: WalletCards, mobileOnly: true }
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <OverlayProvider>
    <WalletProvider>
      <TerminalSearchProvider>
      <div className="min-h-screen overflow-x-hidden bg-surface-canvas text-content-primary">
        <SkipLink />
        <header
          className="fixed left-0 right-0 top-0 z-layer-shell h-14 border-b border-border-subtle/60 bg-surface-panel/95 backdrop-blur-xl"
          data-testid="terminal-topbar"
        >
          <div className="grid h-full grid-cols-[minmax(72px,100px)_minmax(65px,1fr)_auto_auto_auto] items-center gap-2 px-2 lg:grid-cols-[minmax(220px,270px)_minmax(300px,1fr)_auto_auto_auto_auto] lg:px-4">
            <Link href="/terminal" className="flex min-w-0 items-center gap-3">
              <MergenMark className="h-7 w-5" />
              <span className="min-w-0">
                <span
                  className="block truncate text-data font-semibold leading-4 text-content-primary"
                  data-testid="product-brand"
                >
                  Mergen <span className="text-brand-accent">Finance</span>
                </span>
                <span className="block truncate font-mono text-meta uppercase tracking-eyebrow text-content-secondary">
                  <HeaderProductLabel />
                </span>
              </span>
            </Link>

            <TerminalSearchBox />

            <div className="hidden min-w-0 items-center justify-end gap-1 overflow-hidden text-meta font-semibold uppercase tracking-eyebrow xl:flex">
              <HeaderHeartbeat />
              <TopChip
                label={<HeaderBaseNetworkLabel />}
                tone="network"
                icon={<BaseNetworkIcon className="h-4 w-4" />}
              />
              <Suspense fallback={<DataSourceFallback />}>
                <DataSourceSwitcher />
              </Suspense>
            </div>
            <Suspense><HeaderAlertLink /></Suspense>
            <LocaleSwitcher />
            <WalletButton compact />
          </div>
        </header>

        <aside className="fixed bottom-0 left-0 top-14 z-layer-shell hidden w-shell-rail border-r border-border-subtle/60 bg-surface-panel/95 backdrop-blur-xl md:flex md:flex-col">
          <Suspense><TerminalNavigation /></Suspense>

          <div className="mt-auto p-2 text-center">
              <BaseNetworkIcon className="mx-auto h-6 w-6" />
              <Link
                href="/status"
                className="mt-2 block font-mono text-meta uppercase tracking-eyebrow text-content-secondary hover:text-content-primary"
                data-testid="app-version-label"
              >
                Status v{APP_VERSION}
              </Link>
              <div className="mt-2 flex justify-center gap-2 text-meta uppercase tracking-eyebrow"><Link href="/docs" className="text-content-secondary hover:text-content-primary">Docs</Link><Link href="/settings" className="text-content-secondary hover:text-content-primary"><SettingsLabel /></Link></div>
          </div>
        </aside>

        <div className="min-w-0 cmi-main-safe-bottom pt-shell-header md:pb-0 md:pl-shell-rail">{children}</div>
        <Suspense><TerminalNavigation mobile /></Suspense>
      </div>
      </TerminalSearchProvider>
    </WalletProvider>
    </OverlayProvider>
  );
}

function TerminalSearchBox() {
  const { t, locale, formatCompactCurrency } = useI18n();
  const { pairs, selectedPairId, selectPair, isPairPinned, togglePinnedPair } = useTerminalSearch();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  const results = useMemo(() => getSearchResults(pairs, query, locale), [locale, pairs, query]);
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

    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && results.length > 0) {
      event.preventDefault();
      setActiveResultIndex((current) => (current + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length);
      return;
    }

    if (event.key === "Enter" && results[activeResultIndex]) {
      event.preventDefault();
      selectResult(results[activeResultIndex].id);
    }
  }

  return (
    <label className="relative">
      <Search
        size={14}
        aria-hidden="true"
        className="absolute left-2 top-1/2 -translate-y-1/2 text-content-secondary"
      />
      <span className="sr-only">{t("header.search")}</span>
      <input
        aria-label={t("header.search")}
        type="search"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActiveResultIndex(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shouldShowResults}
        aria-controls="terminal-search-results"
        aria-activedescendant={shouldShowResults && results[activeResultIndex] ? `terminal-search-option-${results[activeResultIndex].id}` : undefined}
        data-search-ready={pairs.length > 0 ? "true" : "false"}
        placeholder={t("header.searchPlaceholder")}
        className="h-9 w-full border border-border-subtle bg-surface-canvas pl-8 pr-2 font-mono text-label text-content-primary outline-none placeholder:text-content-secondary focus:border-focus lg:h-8"
      />
      {shouldShowResults ? (
        <div id="terminal-search-results" role="listbox" aria-label={t("header.search")} className="absolute left-0 right-0 top-control-s z-layer-popover max-h-[300px] overflow-y-auto border border-border-subtle bg-surface-panel shadow-none">
          {results.length > 0 ? (
            results.map((pair, resultIndex) => (
              <div
                key={pair.id}
                className={cx(
                  "grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 border-b border-border-subtle px-2 py-2 text-left text-meta last:border-b-0 hover:bg-surface-interactive",
                  pair.id === selectedPairId && "bg-surface-selected",
                  resultIndex === activeResultIndex && "ring-1 ring-inset ring-focus"
                )}
              >
                <button
                  id={`terminal-search-option-${pair.id}`}
                  role="option"
                  aria-selected={pair.id === results[activeResultIndex]?.id}
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
                    <span className="block truncate font-mono font-semibold text-content-primary">
                      {pair.pair}
                    </span>
                    <span className="block truncate text-meta text-content-secondary">
                      {pair.dataSource === "mock" ? t("header.demoFallback") : t("header.marketData")} - {pair.dex}
                    </span>
                  </span>
                </button>
                <span className="text-right font-mono text-meta text-content-secondary">
                  <span className="block text-content-primary">
                    {pair.liquidity === undefined ? "N/A" : formatCompactCurrency(pair.liquidity)}
                  </span>
                  <span>{pair.volume24h === undefined ? "N/A" : formatCompactCurrency(pair.volume24h)}</span>
                </span>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => togglePinnedPair(pair)}
                  className={cx(
                    "grid h-6 w-6 place-items-center border border-border-subtle bg-surface-interactive text-content-secondary hover:border-border-strong hover:text-content-primary",
                    isPairPinned(pair) && "border-brand-accent/45 bg-brand-accent/10 text-brand-accent"
                  )}
                  aria-label={t(isPairPinned(pair) ? "a11y.unpin" : "a11y.pin", { pair: pair.pair })}
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
            <div className="px-2 py-2 font-mono text-meta text-content-secondary">
                  {t("header.noSearchResults")}
            </div>
          )}
        </div>
      ) : null}
    </label>
  );
}

function getSearchResults(pairs: BasePair[], query: string, locale: "tr" | "en" = "en") {
  const normalizedQuery = normalizeSearch(query, locale);

  if (!normalizedQuery) {
    return [];
  }

  return pairs
    .filter((pair) => getSearchPairShape(pair, locale).haystack.includes(normalizedQuery))
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
}, locale: "tr" | "en" = "en") {
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
      .map((value) => normalizeSearch(String(value), locale))
      .join(" ")
  };
}

function normalizeSearch(value: string, locale: "tr" | "en" = "en") {
  return value
    .toLocaleLowerCase(locale === "tr" ? "tr-TR" : "en-US")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/ı/g, "i")
    .replace(/[^\p{L}\p{N}]/gu, "");
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

  // Mock data stays available to explicit development and test routes, but it
  // is not presented as a production/staging market mode.
  if (process.env.NODE_ENV === "production") return null;

  return (
    <div className="hidden h-6 items-center border border-border-subtle bg-surface-interactive lg:inline-flex">
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
        "h-full border-r border-border-subtle px-2 text-meta font-semibold uppercase tracking-eyebrow last:border-r-0",
        active
          ? "bg-network-base/5 text-network-base"
          : "text-content-secondary hover:bg-surface-panel hover:text-content-primary"
      )}
    >
      {label}
    </button>
  );
}

function DataSourceFallback() {
  const { t } = useI18n();
  return (
    <span className="hidden h-6 items-center border border-border-subtle bg-surface-interactive px-2 text-meta font-semibold uppercase tracking-eyebrow text-content-secondary lg:inline-flex">
      {t("header.readOnlyData")}
    </span>
  );
}

function HeaderHeartbeat() {
  const { t, locale } = useI18n();
  const { providerHealth } = useTerminalSearch();
  const label = providerHealth?.status === "refreshing"
    ? t("header.heartbeatChecking")
    : providerHealth?.stale
      ? t("header.heartbeatDelayed")
      : providerHealth?.lastSuccessAt
        ? `${locale === "tr" ? "Veri akışı" : "Heartbeat"} · ${formatHeartbeat(providerHealth.lastSuccessAt, locale, t("header.sourceReady"))}`
        : t("header.heartbeatStarting");
  return <TopChip label={label} tone={providerHealth?.stale ? "delayed" : "live"} />;
}

function SettingsLabel() {
  return useI18n().t("settings.nav");
}

function SkipLink() {
  const { t } = useI18n();
  return <a href="#terminal-main" className="fixed left-3 top-2 z-layer-a11y -translate-y-20 rounded-control bg-brand-accent px-3 py-2 text-label font-bold text-content-on-accent transition-transform focus:translate-y-0">{t("a11y.skipContent")}</a>;
}

function HeaderBaseNetworkLabel() {
  return <>{useI18n().t("header.baseMainnet")}</>;
}

function formatHeartbeat(value: string, locale: "tr" | "en", fallback: string) {
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime())
    ? fallback
    : `${timestamp.toLocaleTimeString(locale === "tr" ? "tr-TR" : "en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "UTC" })} UTC`;
}

function HeaderProductLabel() {
  return <>{useI18n().t("header.product")}</>;
}

function HeaderAlertLink() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  return <Link href={withTerminalContext("/terminal?view=alerts", searchParams)} className="cmi-icon-button" aria-label={t("header.alerts")} title={t("header.alerts")}><Bell size={16} /></Link>;
}

function LocaleSwitcher() {
  const { locale, setLocale, t } = useI18n();
  return <div className="inline-flex h-8 items-center rounded-pill bg-surface-interactive p-1" aria-label={t("header.language")} data-testid="locale-switcher">{(["tr", "en"] as const).map((item) => <button key={item} type="button" onClick={() => setLocale(item)} aria-pressed={locale === item} className={cx("h-7 rounded-pill px-2 font-mono text-meta font-bold uppercase lg:px-2 lg:text-meta", locale === item ? "bg-surface-selected text-content-primary" : "text-content-secondary hover:text-content-primary")}>{item}</button>)}</div>;
}

function TerminalNavigation({ mobile = false }: { mobile?: boolean }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedView = searchParams.get("view");
  const activeView = requestedView === "markets" || requestedView === "watchlist" || requestedView === "alerts" || requestedView === "portfolio" ? requestedView : "terminal";
  const isTerminalRoute = pathname === "/terminal" || pathname === "/" || pathname === "/dashboard" || pathname === "/swap";
  const items = navItems.filter((item) => mobile ? !("desktopOnly" in item && item.desktopOnly) && !("mobileHidden" in item && item.mobileHidden) : !("mobileOnly" in item && item.mobileOnly));
  if (mobile) return <nav className="cmi-mobile-nav-safe fixed bottom-0 left-0 right-0 z-layer-shell grid min-h-14 grid-cols-4 border-t border-border-subtle/60 bg-surface-panel/95 px-1 backdrop-blur-xl md:hidden" aria-label={t("nav.mobile")}>{items.map((item) => { const Icon = item.icon; const active = isTerminalRoute && activeView === item.view; const label = t(item.labelKey as TranslationKey); return <Link key={`mobile-${item.labelKey}`} href={withTerminalContext(item.href, searchParams)} aria-current={active ? "page" : undefined} title={label} className={cx("flex min-h-14 flex-col items-center justify-center gap-1 border-t-2 text-meta font-semibold", active ? "border-brand-accent bg-surface-selected text-content-primary" : "border-transparent text-content-secondary")}><Icon size={16} className={active ? "text-brand-accent" : undefined} aria-hidden="true" /><span>{label}</span></Link>; })}</nav>;
  return <nav className="space-y-1 p-2" aria-label={t("nav.desktop")}>{items.map((item) => { const Icon = item.icon; const active = isTerminalRoute && activeView === item.view; const label = t(item.labelKey as TranslationKey); return <Link key={item.view} href={withTerminalContext(item.href, searchParams)} aria-current={active ? "page" : undefined} title={label} className={cx("flex min-h-12 flex-col items-center justify-center gap-1 rounded-card border-l-2 text-meta font-semibold", active ? "border-brand-accent bg-surface-selected text-content-primary" : "border-transparent text-content-secondary hover:bg-surface-interactive hover:text-content-primary")}><span className={cx("grid h-5 w-5 shrink-0 place-items-center", active && "text-brand-accent")}><Icon size={16} aria-hidden="true" /></span><span className="max-w-full truncate">{label}</span></Link>; })}</nav>;
}

function withTerminalContext(href: string, current: { get: (name: string) => string | null }) {
  const [pathname, rawQuery = ""] = href.split("?", 2);
  const next = new URLSearchParams(rawQuery);
  for (const key of ["data", "pair"] as const) {
    const value = current.get(key);
    if (value && !next.has(key)) next.set(key, value);
  }
  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function TopChip({
  label,
  tone = "muted",
  icon,
  title,
  dataTestId
}: {
  label: ReactNode;
  tone?: "live" | "network" | "delayed" | "muted";
  icon?: ReactNode;
  title?: string;
  dataTestId?: string;
}) {
  const toneClassName = {
    live: "border-freshness-live/35 bg-freshness-live/10 text-freshness-live",
    network: "border-network-base/30 bg-network-base/10 text-network-base",
    delayed: "border-freshness-delayed/45 bg-freshness-delayed/10 text-freshness-delayed",
    muted: "border-border-subtle bg-surface-interactive text-content-secondary"
  };

  return (
    <span
      data-testid={dataTestId}
      title={title}
      className={cx(
        "hidden h-6 min-w-0 max-w-[170px] items-center gap-1 whitespace-nowrap border px-2 lg:inline-flex",
        toneClassName[tone]
      )}
    >
      {icon}
      {label}
    </span>
  );
}
