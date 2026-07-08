"use client";

import {
  AlertTriangle,
  BookOpenText,
  CircleDot,
  Droplets,
  Radar,
  Search,
  Shuffle,
  WalletCards
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import type { MarketDataMode } from "@/data/providers";
import { cx } from "@/lib/format";

const navItems = [
  { href: "/", label: "Radar", icon: Radar, active: "/" },
  { href: "/#new-pairs", label: "New Pools", icon: Droplets, active: "/new-pools" },
  { href: "/#risk", label: "Risk Flags", icon: AlertTriangle, active: "/risk" },
  { href: "/swap", label: "Swap Preview", icon: Shuffle, active: "/swap" },
  { href: "/docs", label: "Docs", icon: BookOpenText, active: "/docs" }
] as const;

export function AppShell({
  children,
  marketDataMode = "mock"
}: {
  children: ReactNode;
  marketDataMode?: MarketDataMode;
}) {
  const pathname = usePathname();
  const feedLabel =
    marketDataMode === "dexscreener" ? "DexScreener Read-Only" : "Mock Feed";

  return (
    <div className="min-h-screen overflow-x-hidden bg-base-black text-base-text">
      <header className="fixed left-0 right-0 top-0 z-50 h-10 border-b border-base-line bg-base-panel">
        <div className="grid h-full grid-cols-[minmax(164px,188px)_minmax(220px,520px)_minmax(0,1fr)] items-center gap-2 px-2">
          <Link href="/" className="flex min-w-0 items-center gap-2">
            <span className="grid h-5 w-5 place-items-center rounded-full bg-base-blue text-[10px] font-bold text-white">
              B
            </span>
            <span className="truncate text-[13px] font-semibold text-base-text">
              Base Terminal Lite
            </span>
            <span className="border border-base-mint/45 bg-base-mint/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-base-mint">
              Lite
            </span>
          </Link>

          <label className="relative">
            <Search
              size={14}
              aria-hidden="true"
              className="absolute left-2 top-1/2 -translate-y-1/2 text-base-muted"
            />
            <span className="sr-only">Search token, pair, or contract</span>
            <input
              type="search"
              placeholder="Search token / pair / contract"
              className="h-7 w-full border border-base-line bg-base-black pl-7 pr-2 font-mono text-[12px] text-base-text outline-none placeholder:text-base-muted focus:border-base-mint"
            />
          </label>

          <div className="flex min-w-0 items-center justify-end gap-1 overflow-hidden text-[10px] font-semibold uppercase tracking-[0.12em]">
            <TopChip label="Base Network Online" tone="mint" />
            <TopChip label={feedLabel} tone="blue" />
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

        <div className="mt-auto p-2">
          <div className="border border-base-line bg-base-elevated p-2">
            <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-base-mint">
              <CircleDot size={12} aria-hidden="true" />
              Base Demo Network
            </div>
            <p className="font-mono text-[11px] text-base-text">Chain ID 8453</p>
            <p className="mt-1 text-[11px] leading-4 text-base-muted">
              Mock pairs only. No transactions are sent.
            </p>
          </div>
          <p className="mt-3 text-[11px] text-base-muted">Demo data only.</p>
        </div>
      </aside>

      <div className="min-w-0 pt-10 md:pl-[160px]">{children}</div>
    </div>
  );
}

function TopChip({
  label,
  tone = "muted",
  icon
}: {
  label: string;
  tone?: "mint" | "blue" | "muted";
  icon?: ReactNode;
}) {
  const toneClassName = {
    mint: "border-base-mint/45 bg-base-mint/10 text-base-mint",
    blue: "border-base-blue/25 bg-base-blue/5 text-base-electric",
    muted: "border-base-line bg-base-elevated text-base-muted"
  };

  return (
    <span
      className={cx(
        "hidden h-6 min-w-0 max-w-[150px] items-center gap-1 whitespace-nowrap border px-1.5 lg:inline-flex",
        toneClassName[tone]
      )}
    >
      {icon}
      {label}
    </span>
  );
}
