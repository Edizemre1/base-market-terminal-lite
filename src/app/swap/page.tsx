import { ShieldAlert } from "lucide-react";
import { SwapPreviewForm } from "@/components/SwapPreviewForm";
import { StatusPill } from "@/components/TerminalWidgets";
import { getSwapPreviewTokens } from "@/data/mockTokens";

export default function SwapPage() {
  const tokens = getSwapPreviewTokens();

  return (
    <main className="terminal-grid bg-base-black px-4 py-4 sm:px-6">
      <section className="mb-4 border border-base-line bg-base-panel shadow-panel">
        <div className="border-b border-base-line bg-base-raised px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill label="Route sandbox" />
            <StatusPill label="Mock tokens" tone="blue" />
            <StatusPill label="No live transaction" tone="amber" />
          </div>
        </div>

        <div className="grid gap-4 p-3 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-end">
          <div>
            <h1 className="text-2xl font-semibold text-base-text md:text-3xl">
              Swap preview ticket
            </h1>
            <p className="mt-2 max-w-3xl text-xs leading-5 text-base-muted">
              Preview a local mock quote between demo tokens. Wallet connection,
              route execution, contract approvals, and signing are intentionally
              absent from this public MVP.
            </p>
          </div>

          <div className="border border-base-rose/40 bg-base-rose/10 p-3">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-base-rose">
              <ShieldAlert size={14} aria-hidden="true" />
              UI-only execution boundary
            </div>
            <p className="text-xs leading-5 text-base-muted">
              This page cannot create, sign, approve, or submit blockchain
              transactions.
            </p>
          </div>
        </div>
      </section>

      <SwapPreviewForm tokens={tokens} />
    </main>
  );
}
