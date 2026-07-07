import {
  builderLogEntries,
  futureArchitectureItems,
  publicSafetyChecklist
} from "@/data/builderLog";
import { StatusPill, TerminalPanel } from "@/components/TerminalWidgets";

export default function DocsPage() {
  return (
    <main className="terminal-grid min-h-[calc(100vh-40px)] bg-base-black p-2">
      <section className="grid gap-2 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-2">
          <TerminalPanel
            label="SAFETY"
            title="Public boundary checklist"
            meta={<StatusPill label="Required" tone="amber" />}
          >
            <div className="space-y-1">
              {publicSafetyChecklist.map((item) => (
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

          <TerminalPanel label="STATUS" title="Terminal documentation">
            <div className="space-y-1">
              <StatusRow label="Mode" value="Public demo" />
              <StatusRow label="Data" value="Mock only" />
              <StatusRow label="Secrets" value="None in source" />
              <StatusRow label="Execution" value="Disabled" />
            </div>
          </TerminalPanel>
        </aside>

        <div className="space-y-2">
          <TerminalPanel
            label="BUILD LOG"
            title="Implementation register"
            meta={<StatusPill label="Lite MVP" />}
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left text-[11px]">
                <thead>
                  <tr className="border-b border-base-line bg-base-raised text-[10px] uppercase tracking-[0.12em] text-base-muted">
                    <th className="px-2 py-1.5 font-semibold">Step</th>
                    <th className="px-2 py-1.5 font-semibold">Module</th>
                    <th className="px-2 py-1.5 font-semibold">Detail</th>
                    <th className="px-2 py-1.5 text-right font-semibold">State</th>
                  </tr>
                </thead>
                <tbody>
                  {builderLogEntries.map((entry, index) => (
                    <tr
                      key={entry.title}
                      className="h-10 border-b border-base-line last:border-0"
                    >
                      <td className="px-2 py-1.5 font-mono text-base-muted">
                        {(index + 1).toString().padStart(2, "0")}
                      </td>
                      <td className="px-2 py-1.5 font-semibold text-base-text">
                        {entry.title}
                      </td>
                      <td className="px-2 py-1.5 leading-4 text-base-muted">
                        {entry.detail}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <StatusPill label="Done" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TerminalPanel>

          <TerminalPanel
            label="ROADMAP"
            title="Future integration boundaries"
            meta={<StatusPill label="Not implemented" tone="muted" />}
          >
            <div className="grid gap-1 md:grid-cols-2 xl:grid-cols-3">
              {futureArchitectureItems.map((item) => {
                const Icon = item.icon;

                return (
                  <article
                    key={item.title}
                    className="min-h-[122px] border border-base-line bg-base-elevated p-2"
                  >
                    <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-base-mint">
                      <Icon size={13} aria-hidden="true" />
                      Future module
                    </div>
                    <h2 className="text-[12px] font-semibold text-base-text">
                      {item.title}
                    </h2>
                    <p className="mt-1 text-[11px] leading-4 text-base-muted">
                      {item.detail}
                    </p>
                  </article>
                );
              })}
            </div>
          </TerminalPanel>

          <TerminalPanel label="BOUNDARY NOTE" title="Public-safe implementation">
            <p className="text-[11px] leading-4 text-base-muted">
              This repository keeps the lite terminal standalone. It does not
              contain private business logic, real API keys, backend secrets,
              wallet signing, approvals, live swaps, blockchain transactions, or
              paid product logic.
            </p>
          </TerminalPanel>
        </div>
      </section>
    </main>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 border border-base-line bg-base-elevated px-2 py-1.5 text-[11px]">
      <span className="uppercase tracking-[0.12em] text-base-muted">{label}</span>
      <span className="font-mono font-semibold text-base-text">{value}</span>
    </div>
  );
}
