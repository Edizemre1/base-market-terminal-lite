"use client";

import {
  BarChart3,
  Bot,
  BriefcaseBusiness,
  Building2,
  Database,
  FileText,
  Grid2X2,
  LineChart,
  Moon,
  Newspaper,
  Search,
  Sun
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { cx } from "@/lib/format";

const navItems = [
  { href: "/", label: "General", icon: Grid2X2, active: "/" },
  { href: "/dashboard", label: "Markets", icon: LineChart, active: "/dashboard" },
  { href: "/dashboard", label: "Analysis", icon: BarChart3, active: "/analysis" },
  { href: "/dashboard", label: "Macro", icon: Database, active: "/macro" },
  { href: "/docs", label: "KAP", icon: Building2, active: "/kap" },
  { href: "/docs", label: "News", icon: Newspaper, active: "/news" },
  { href: "/swap", label: "Bots", icon: Bot, active: "/swap" },
  { href: "/tokens/blue", label: "Portfolio", icon: BriefcaseBusiness, active: "/tokens" },
  { href: "/docs", label: "Docs", icon: FileText, active: "/docs" }
] as const;

const watchlist = [
  { symbol: "BTC", price: "63,740.00" },
  { symbol: "ETH", price: "1,788.25" },
  { symbol: "SOL", price: "81.29" },
  { symbol: "BASE IDX", price: "612.80" },
  { symbol: "USDC", price: "1.000" }
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [theme, setTheme] = useState<"light" | "dark">("light");

  return (
    <div data-theme={theme} className="min-h-screen bg-base-black text-base-text">
      <aside className="fixed inset-y-0 left-0 z-50 hidden w-[176px] border-r border-base-line bg-base-panel md:flex md:flex-col">
        <Link href="/" className="flex h-11 items-center border-b border-base-line px-3">
          <span className="text-[13px] font-semibold text-base-text">
            Base Terminal Lite
          </span>
        </Link>

        <div className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-[0.16em] text-base-muted">
          Main Modules
        </div>
        <nav className="border-b border-base-line pb-3" aria-label="Modules">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active =
              item.active === "/"
                ? pathname === "/"
                : pathname.startsWith(item.active);

            return (
              <Link
                key={`${item.label}-${item.active}`}
                href={item.href}
                className={cx(
                  "mx-2 mb-1 flex h-8 items-center gap-2 border-l-2 px-2 text-[11px] font-medium",
                  active
                    ? "border-base-mint bg-base-mint/10 text-base-mint"
                    : "border-transparent text-base-muted hover:border-base-line hover:bg-base-elevated hover:text-base-text"
                )}
              >
                <span className="grid h-5 w-5 place-items-center bg-base-elevated text-base-muted">
                  <Icon size={13} aria-hidden="true" />
                </span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <section className="border-b border-base-line px-3 py-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-base-muted">
            Watchlist
          </div>
          <div className="space-y-1.5">
            {watchlist.map((asset) => (
              <div
                key={asset.symbol}
                className="grid grid-cols-[1fr_auto] items-center gap-2 text-[11px]"
              >
                <span className="font-mono text-base-muted">{asset.symbol}</span>
                <span className="font-mono font-semibold text-base-text">
                  {asset.price}
                </span>
              </div>
            ))}
          </div>
        </section>

        <div className="mt-auto px-3 py-3">
          <p className="text-[10px] leading-4 text-base-muted">Demo data only.</p>
        </div>
      </aside>

      <header className="fixed left-0 right-0 top-0 z-40 h-10 border-b border-base-line bg-base-panel md:left-[176px]">
        <div className="grid h-full grid-cols-[1fr_auto] items-center gap-2 px-2 md:grid-cols-[minmax(120px,1fr)_minmax(260px,520px)_auto]">
          <div className="hidden text-[10px] font-semibold uppercase tracking-[0.16em] text-base-muted md:block">
            Public demo terminal
          </div>
          <label className="relative">
            <Search
              size={13}
              aria-hidden="true"
              className="absolute left-2 top-1/2 -translate-y-1/2 text-base-muted"
            />
            <span className="sr-only">Search</span>
            <input
              type="search"
              placeholder="ara - symbol, token, command"
              className="h-7 w-full border border-base-line bg-base-black pl-7 pr-2 font-mono text-[11px] text-base-text outline-none placeholder:text-base-muted focus:border-base-mint"
            />
          </label>
          <div className="flex items-center justify-end gap-1 text-[10px] font-semibold uppercase tracking-[0.12em]">
            <TopChip label="SYSTEM ONLINE" tone="mint" />
            <TopChip label="MOCK DATA FEED" />
            <TopChip label="20:11 UTC" />
            <button
              type="button"
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
              className="grid h-6 w-7 place-items-center border border-base-line bg-base-elevated text-base-muted hover:text-base-mint"
              aria-label="Toggle theme"
            >
              {theme === "light" ? <Moon size={13} /> : <Sun size={13} />}
            </button>
            <TopChip label="EN" />
            <TopChip label="TR" tone="blue" />
            <TopChip label="0 credit" />
          </div>
        </div>
      </header>

      <div className="pt-10 md:pl-[176px]">{children}</div>
    </div>
  );
}

function TopChip({
  label,
  tone = "muted"
}: {
  label: string;
  tone?: "mint" | "blue" | "muted";
}) {
  const toneClassName = {
    mint: "border-base-mint/45 bg-base-mint/10 text-base-mint",
    blue: "border-base-blue/25 bg-base-blue/5 text-base-electric",
    muted: "border-base-line bg-base-elevated text-base-muted"
  };

  return (
    <span className={cx("hidden whitespace-nowrap border px-1.5 py-0.5 sm:inline-flex", toneClassName[tone])}>
      {label}
    </span>
  );
}
