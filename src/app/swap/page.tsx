import { SwapPreviewForm } from "@/components/SwapPreviewForm";
import { StatusPill, TerminalPanel } from "@/components/TerminalWidgets";
import { getSwapPreviewTokens } from "@/data/mockTokens";

export default function SwapPage() {
  const tokens = getSwapPreviewTokens();

  return (
    <main className="terminal-grid min-h-[calc(100vh-40px)] bg-base-black p-2">
      <TerminalPanel
        className="mb-2"
        label="SWAP PREVIEW"
        title="Compact execution ticket"
        meta={
          <div className="flex gap-1">
            <StatusPill label="Mock route" tone="blue" />
            <StatusPill label="No live transaction" tone="amber" />
          </div>
        }
      >
        <p className="text-[11px] leading-4 text-base-muted">
          Local quote math between demo tokens only. Wallet connection, route
          execution, approvals, signing, and blockchain transactions are absent
          from this MVP.
        </p>
      </TerminalPanel>

      <SwapPreviewForm tokens={tokens} />
    </main>
  );
}
