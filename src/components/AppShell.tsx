import {
  BarChart3,
  BookOpenText,
  BriefcaseBusiness,
  CandlestickChart,
  CircleDot,
  Cpu,
  Globe2,
  LayoutDashboard,
  LineChart,
  Search,
  ShieldCheck
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

const navItems = [
  { href: "/", label: "General", icon: LayoutDashboard },
  { href: "/dashboard", label: "Markets", icon: CandlestickChart },
  { href: "/dashboard", label: "Analysis", icon: LineChart },
  { href: "/dashboard", label: "Macro", icon: Globe2 },
  { href: "/dashboard", label: "Tokens", icon: BarChart3 },
  { href: "/swap", label: "Portfolio", icon: BriefcaseBusiness },
  { href: "/docs", label: "Docs", icon: BookOpenText }
] as const;

const watchlist = [
  { symbol: "BTC", value: "$64.2K", change: "+1.2%" },
  { symbol: "ETH", value: "$3.42K", change: "+0.8%" },
  { symbol: "SOL", value: "$142.8", change: "-0.4%" },
  { symbol: "BASE", value: "Index 72", change: "+2.1%" }
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-base-black text-base-text">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-base-line bg-base-panel lg:flex lg:flex-col">
        <div className="border-b border-base-line px-4 py-4">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center border border-base-mint bg-base-mint/10 text-base-mint">
              <CandlestickChart size={18} aria-hidden="true" />
            </span>
            <span>
              <span className="block text-[11px] font-semibold uppercase tracking-[0.22em] text-base-muted">
                Public lite
              </span>
              <span className="block text-sm font-semibold text-base-text">
                Base Terminal Lite
              </span>
            </span>
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Primary">
          <p className="px-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-base-muted">
            Modules
          </p>
          <div className="mt-2 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;

              return (
                <Link
                  key={`${item.href}-${item.label}`}
                  href={item.href}
                  className="flex min-h-9 items-center gap-2 border border-transparent px-2 py-2 text-xs font-medium text-base-muted transition hover:border-base-line hover:bg-base-elevated hover:text-base-text"
                >
                  <Icon size={15} aria-hidden="true" />
                  {item.label}
                </Link>
              );
            })}
          </div>

          <div className="mt-6 border-t border-base-line pt-4">
            <p className="px-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-base-muted">
              Watchlist
            </p>
            <div className="mt-2 space-y-1">
              {watchlist.map((item) => (
                <div
                  key={item.symbol}
                  className="grid grid-cols-[44px_1fr_52px] items-center gap-2 border border-base-line bg-base-elevated px-2 py-2 text-[11px]"
                >
                  <span className="font-semibold text-base-text">{item.symbol}</span>
                  <span className="font-mono text-base-muted">{item.value}</span>
                  <span
                    className={
                      item.change.startsWith("+")
                        ? "font-mono text-base-mint"
                        : "font-mono text-base-rose"
                    }
                  >
                    {item.change}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </nav>

        <div className="border-t border-base-line p-3">
          <div className="border border-base-mint/30 bg-base-mint/10 p-3">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-base-mint">
              <ShieldCheck size={14} aria-hidden="true" />
              Demo safe
            </div>
            <p className="mt-2 text-xs leading-5 text-base-muted">
              Mock data only. No signing, approvals, swaps, API keys, or
              backend secrets.
            </p>
          </div>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 border-b border-base-line bg-base-panel/95 backdrop-blur">
          <div className="flex min-h-14 flex-col gap-3 px-4 py-3 sm:px-6 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center gap-3 lg:hidden">
              <span className="flex h-9 w-9 items-center justify-center border border-base-mint bg-base-mint/10 text-base-mint">
                <CandlestickChart size={18} aria-hidden="true" />
              </span>
              <span className="text-sm font-semibold text-base-text">
                Base Terminal Lite
              </span>
            </div>

            <label className="flex min-h-9 w-full max-w-xl items-center gap-2 border border-base-line bg-base-elevated px-3 text-sm text-base-muted">
              <Search size={15} aria-hidden="true" />
              <input
                className="w-full bg-transparent text-sm text-base-text outline-none placeholder:text-base-muted"
                placeholder="Search token, pool, mock address"
              />
            </label>

            <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em]">
              <span className="inline-flex items-center gap-1 border border-base-mint/30 bg-base-mint/10 px-2 py-1 text-base-mint">
                <CircleDot size={12} aria-hidden="true" />
                System online
              </span>
              <span className="inline-flex items-center gap-1 border border-base-line bg-base-elevated px-2 py-1 text-base-muted">
                <Cpu size={12} aria-hidden="true" />
                Mock feed
              </span>
              <span className="border border-base-line bg-base-elevated px-2 py-1 text-base-muted">
                EN
              </span>
              <span className="border border-base-blue/30 bg-base-blue/10 px-2 py-1 text-base-blue">
                Base
              </span>
              <button
                type="button"
                className="border border-base-line bg-base-panel px-3 py-1 text-base-text"
              >
                Demo account
              </button>
            </div>
          </div>

          <nav
            className="flex gap-2 overflow-x-auto border-t border-base-line px-4 py-2 sm:px-6 lg:hidden"
            aria-label="Mobile primary"
          >
            {navItems.map((item) => {
              const Icon = item.icon;

              return (
                <Link
                  key={`mobile-${item.href}-${item.label}`}
                  href={item.href}
                  className="inline-flex min-h-8 shrink-0 items-center gap-2 border border-base-line bg-base-elevated px-2.5 py-1.5 text-xs font-medium text-base-muted"
                >
                  <Icon size={14} aria-hidden="true" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </header>

        {children}

        <footer className="border-t border-base-line bg-base-panel">
          <div className="flex flex-col gap-2 px-4 py-5 text-xs text-base-muted sm:px-6 md:flex-row md:items-center md:justify-between">
            <p>Mock data only. Public-safe lite terminal.</p>
            <p>No transactions, wallet signing, approvals, or backend secrets.</p>
          </div>
        </footer>
      </div>
    </div>
  );
}
