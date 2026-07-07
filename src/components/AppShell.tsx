import {
  BookOpenText,
  CandlestickChart,
  LayoutDashboard,
  RotateCcw,
  ShieldCheck,
  Signal
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

const navItems = [
  { href: "/", label: "Home", icon: CandlestickChart },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/swap", label: "Swap preview", icon: RotateCcw },
  { href: "/docs", label: "Docs", icon: BookOpenText }
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-base-black text-base-text">
      <header className="sticky top-0 z-40 border-b border-base-line/80 bg-base-black/95 backdrop-blur-xl">
        <div className="border-b border-base-line/50 bg-base-raised/40">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-base-muted sm:px-6 lg:px-8">
            <span>Public market intelligence / Base ecosystem</span>
            <span className="hidden items-center gap-2 text-base-electric sm:inline-flex">
              <Signal size={13} aria-hidden="true" />
              Mock feed online
            </span>
          </div>
        </div>

        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-lg border border-base-blue/50 bg-base-blue/20 text-base-electric shadow-glow">
              <CandlestickChart size={20} aria-hidden="true" />
            </span>
            <span>
              <span className="block text-xs font-semibold uppercase tracking-[0.24em] text-base-electric">
                Base
              </span>
              <span className="block text-base font-semibold text-base-text">
                Market Terminal Lite
              </span>
            </span>
          </Link>

          <nav className="flex flex-wrap items-center gap-2" aria-label="Primary">
            {navItems.map((item) => {
              const Icon = item.icon;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-base-line bg-base-elevated/70 px-3 py-2 text-sm text-base-muted transition hover:border-base-blue/60 hover:bg-base-blue/10 hover:text-base-text"
                >
                  <Icon size={16} aria-hidden="true" />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="inline-flex w-fit items-center gap-2 rounded-lg border border-base-blue/30 bg-base-blue/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-base-electric">
            <ShieldCheck size={14} aria-hidden="true" />
            Demo-safe mode
          </div>
        </div>
      </header>

      {children}

      <footer className="border-t border-base-line bg-base-black">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-8 text-sm text-base-muted sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
          <p>Mock data only. No transactions, private logic, or backend secrets.</p>
          <p>Public terminal interface for Base market discovery.</p>
        </div>
      </footer>
    </div>
  );
}
