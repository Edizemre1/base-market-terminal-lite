import { StatusPill, TerminalPanel } from "@/components/TerminalWidgets";

const safetyItems = [
  "Mock Base pair data only",
  "No wallet signing",
  "No approvals",
  "No real swaps or blockchain transactions",
  "No API keys or backend secrets",
  "No private product logic"
];

const buildItems = [
  "Focused single-page Base pair radar",
  "Clickable new pair, inflow, and momentum feeds",
  "Selected pair chart, risk, liquidity, and activity modules",
  "Always-visible disabled swap ticket",
  "Future-ready boundary for real data and routing adapters"
];

export default function DocsPage() {
  return (
    <main className="min-h-[calc(100vh-40px)] bg-base-black p-2">
      <section className="grid gap-2 xl:grid-cols-[320px_minmax(0,1fr)]">
        <TerminalPanel
          label="SAFETY"
          title="Public MVP boundaries"
          meta={<StatusPill label="Required" tone="amber" />}
        >
          <div className="space-y-1">
            {safetyItems.map((item) => (
              <div
                key={item}
                className="flex items-start gap-2 border border-base-line bg-base-elevated px-2 py-1.5 text-[11px] leading-4 text-base-text"
              >
                <span className="mt-1 h-1.5 w-1.5 shrink-0 bg-base-mint" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </TerminalPanel>

        <div className="space-y-2">
          <TerminalPanel
            label="BUILDER LOG"
            title="Base Terminal Lite direction"
            meta={<StatusPill label="Swap/radar" />}
          >
            <div className="grid gap-1 md:grid-cols-2">
              {buildItems.map((item, index) => (
                <article
                  key={item}
                  className="border border-base-line bg-base-elevated p-2"
                >
                  <p className="font-mono text-[10px] text-base-muted">
                    {(index + 1).toString().padStart(2, "0")}
                  </p>
                  <p className="mt-1 text-[12px] font-semibold text-base-text">
                    {item}
                  </p>
                </article>
              ))}
            </div>
          </TerminalPanel>

          <TerminalPanel label="ROADMAP" title="Future integration boundaries">
            <p className="text-[11px] leading-4 text-base-muted">
              Real Base pair discovery, wallet connection, swap routing, and fee
              handling should be added behind explicit adapters later. This MVP
              only renders local mock data and disabled UI states.
            </p>
          </TerminalPanel>
        </div>
      </section>
    </main>
  );
}
