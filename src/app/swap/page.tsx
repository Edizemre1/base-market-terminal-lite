import { ShieldAlert } from "lucide-react";
import { SwapPreviewForm } from "@/components/SwapPreviewForm";
import { getSwapPreviewTokens } from "@/data/mockTokens";

export default function SwapPage() {
  const tokens = getSwapPreviewTokens();

  return (
    <main className="bg-base-black">
      <section className="border-b border-white/10 bg-base-raised">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="mb-4 inline-flex items-center gap-2 rounded border border-base-rose/30 bg-base-rose/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-base-rose">
            <ShieldAlert size={14} aria-hidden="true" />
            No real transactions
          </div>
          <h1 className="text-4xl font-semibold text-white md:text-5xl">
            Swap preview
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-emerald-50/60">
            Preview a local mock quote between demo tokens. Wallet connection,
            route execution, contract approvals, and signing are intentionally
            absent from this MVP.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <SwapPreviewForm tokens={tokens} />
      </section>
    </main>
  );
}
