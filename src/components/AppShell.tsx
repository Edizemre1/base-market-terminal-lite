import {
  BookOpenText,
  CandlestickChart,
  LayoutDashboard,
  RotateCcw,
  ShieldCheck
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

const navItems = [
  { href: "/", label: "Home", icon: CandlestickChart },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/swap", label: "Swap preview", icon: RotateCcw },
  { href: "/docs", label: "Docs", icon: BookOpenText }
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-base-black text-emerald-50">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-base-black/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded border border-base-mint/40 bg-base-mint/10 text-base-mint shadow-glow">
              <CandlestickChart size={20} aria-hidden="true" />
            </span>
            <span>
              <span className="block text-sm font-semibold uppercase tracking-[0.22em] text-base-mint">
                Base
              </span>
              <span className="block text-base font-semibold text-white">
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
                  className="inline-flex min-h-10 items-center gap-2 rounded border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-emerald-50/80 transition hover:border-base-mint/40 hover:text-white"
                >
                  <Icon size={16} aria-hidden="true" />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="inline-flex w-fit items-center gap-2 rounded border border-base-amber/30 bg-base-amber/10 px-3 py-2 text-xs font-medium uppercase tracking-[0.18em] text-base-amber">
            <ShieldCheck size={14} aria-hidden="true" />
            Demo only
          </div>
        </div>
      </header>

      {children}

      <footer className="border-t border-white/10 bg-base-black">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-8 text-sm text-emerald-50/60 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
          <p>Mock data only. No transactions, private logic, or backend secrets.</p>
          <p>Future-ready public MVP for Base market discovery.</p>
        </div>
      </footer>
    </div>
  );
}
