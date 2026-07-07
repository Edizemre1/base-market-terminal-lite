"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cx } from "@/lib/format";

const navItems = [
  { href: "/", label: "General", active: "/" },
  { href: "/dashboard", label: "Markets", active: "/dashboard" },
  { href: "/dashboard", label: "Analysis", active: "/analysis" },
  { href: "/dashboard", label: "Macro", active: "/macro" },
  { href: "/docs", label: "KAP", active: "/kap" },
  { href: "/docs", label: "News", active: "/news" },
  { href: "/swap", label: "Bots", active: "/swap" },
  { href: "/tokens/blue", label: "Portfolio", active: "/tokens" },
  { href: "/docs", label: "Docs", active: "/docs" }
] as const;

const watchlist = [
  { symbol: "BTC", price: "109,420", change: "+1.2" },
  { symbol: "ETH", price: "3,864", change: "+0.8" },
  { symbol: "SOL", price: "168.42", change: "-0.4" },
  { symbol: "BASE IDX", price: "612.8", change: "+2.1" },
  { symbol: "USDC", price: "1.000", change: "0.0" }
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-base-black text-base-text">
      <aside className="fixed inset-y-0 left-0 z-50 hidden w-[170px] border-r border-base-line bg-base-panel md:flex md:flex-col">
        <Link
          href="/"
          className="flex h-12 items-center border-b border-base-line px-3"
        >
          <span className="text-[13px] font-semibold leading-4 text-base-text">
            Base Terminal Lite
          </span>
        </Link>

        <nav className="border-b border-base-line py-2" aria-label="Modules">
          {navItems.map((item) => {
            const active =
              item.active === "/"
                ? pathname === "/"
                : pathname.startsWith(item.active);

            return (
              <Link
                key={`${item.label}-${item.active}`}
                href={item.href}
                className={cx(
                  "flex h-7 items-center border-l-2 px-3 text-[11px] font-semibold uppercase tracking-[0.12em]",
                  active
                    ? "border-base-mint bg-base-mint/10 text-base-text"
                    : "border-transparent text-base-muted hover:border-base-line hover:bg-base-elevated hover:text-base-text"
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <section className="border-b border-base-line px-3 py-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-base-muted">
            Watchlist
          </div>
          <div className="space-y-1">
            {watchlist.map((asset) => {
              const positive = !asset.change.startsWith("-");

              return (
                <div
                  key={asset.symbol}
                  className="grid grid-cols-[1fr_auto] gap-2 text-[11px]"
                >
                  <span className="font-mono font-semibold text-base-text">
                    {asset.symbol}
                  </span>
                  <span className="text-right font-mono text-base-text">
                    {asset.price}
                  </span>
                  <span className="col-span-2 text-right font-mono">
                    <span
                      className={positive ? "text-base-mint" : "text-base-rose"}
                    >
                      {asset.change}%
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <div className="mt-auto border-t border-base-line px-3 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-base-muted">
            Demo data only.
          </p>
        </div>
      </aside>

      <header className="fixed left-0 right-0 top-0 z-40 h-10 border-b border-base-line bg-base-panel md:left-[170px]">
        <div className="grid h-full grid-cols-[1fr_auto] items-center gap-2 px-2 md:grid-cols-[minmax(150px,1fr)_minmax(260px,520px)_auto]">
          <div className="hidden text-[10px] font-semibold uppercase tracking-[0.16em] text-base-muted md:block">
            Public terminal / mock feed
          </div>
          <label className="relative">
            <span className="sr-only">Search</span>
            <input
              type="search"
              placeholder="Search token, pool, mock address"
              className="h-7 w-full border border-base-line bg-base-black px-2 text-[12px] text-base-text outline-none placeholder:text-base-muted focus:border-base-mint"
            />
          </label>
          <div className="flex items-center justify-end gap-1 overflow-hidden text-[10px] font-semibold uppercase tracking-[0.12em]">
            <TopChip label="SYSTEM ONLINE" tone="mint" />
            <TopChip label="MOCK DATA FEED" tone="blue" />
            <TopChip label="UTC 00:00" />
            <TopChip label="EN" />
            <TopChip label="TR" />
            <TopChip label="Demo account" />
          </div>
        </div>
      </header>

      <div className="pt-10 md:pl-[170px]">{children}</div>
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
    mint: "border-base-mint/40 bg-base-mint/10 text-base-mint",
    blue: "border-base-blue/25 bg-base-blue/5 text-base-electric",
    muted: "border-base-line bg-base-elevated text-base-muted"
  };

  return (
    <span className={cx("whitespace-nowrap border px-1.5 py-0.5", toneClassName[tone])}>
      {label}
    </span>
  );
}
