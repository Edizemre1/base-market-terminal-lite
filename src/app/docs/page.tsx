import type { ReactNode } from "react";
import {
  CheckCircle2,
  FileText,
  GitBranch,
  ListChecks,
  ShieldCheck
} from "lucide-react";
import { StatusPill, TerminalPanel } from "@/components/TerminalWidgets";
import {
  builderLogEntries,
  futureArchitectureItems,
  publicSafetyChecklist
} from "@/data/builderLog";

const changelogItems = [
  {
    version: "v0.2",
    title: "Light finance terminal",
    detail:
      "Updated the public UI into a dense ivory terminal with mint accents, thin borders, compact tables, and mock market modules."
  },
  {
    version: "v0.1",
    title: "Public MVP shell",
    detail:
      "Created landing, dashboard, token detail, swap preview, and docs pages using local mock Base token data."
  }
];

export default function DocsPage() {
  return (
    <main className="terminal-grid bg-base-black px-4 py-4 sm:px-6">
      <section className="mb-4 border border-base-line bg-base-panel shadow-panel">
        <div className="border-b border-base-line bg-base-raised px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill label="Docs" />
            <StatusPill label="Public-safe" tone="blue" />
            <StatusPill label="Demo data" tone="muted" />
          </div>
        </div>

        <div className="grid gap-4 p-3 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-end">
          <div>
            <h1 className="text-2xl font-semibold text-base-text md:text-3xl">
              Builder log and safety boundaries
            </h1>
            <p className="mt-2 max-w-3xl text-xs leading-5 text-base-muted">
              Implementation notes for the standalone public Base Market
              Terminal Lite MVP, including demo-only data constraints and future
              integration boundaries.
            </p>
          </div>

          <div className="border border-base-mint/40 bg-base-mint/10 p-3">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-base-mint">
              <ShieldCheck size={14} aria-hidden="true" />
              Review status
            </div>
            <p className="text-xs leading-5 text-base-muted">
              Ready for UI review as a public demo. Real providers, wallets,
              route execution, secrets, and fee behavior remain outside this
              MVP.
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
        <div className="space-y-4">
          <TerminalPanel label="Changelog" title="Release notes">
            <div className="grid gap-2 md:grid-cols-2">
              {changelogItems.map((item) => (
                <article
                  key={item.version}
                  className="border border-base-line bg-base-elevated p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-xs font-semibold text-base-mint">
                      {item.version}
                    </span>
                    <StatusPill label="Demo" tone="muted" />
                  </div>
                  <h2 className="mt-3 text-sm font-semibold text-base-text">
                    {item.title}
                  </h2>
                  <p className="mt-2 text-xs leading-5 text-base-muted">
                    {item.detail}
                  </p>
                </article>
              ))}
            </div>
          </TerminalPanel>

          <TerminalPanel label="Build log" title="MVP implementation record">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-base-line bg-base-raised text-[10px] uppercase tracking-[0.16em] text-base-muted">
                    <th className="px-2 py-2 font-semibold">Step</th>
                    <th className="px-2 py-2 font-semibold">Module</th>
                    <th className="px-2 py-2 font-semibold">Scope</th>
                    <th className="px-2 py-2 text-right font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {builderLogEntries.map((entry, index) => (
                    <tr
                      key={entry.title}
                      className="border-b border-base-line last:border-0"
                    >
                      <td className="px-2 py-2 font-mono text-base-muted">
                        {(index + 1).toString().padStart(2, "0")}
                      </td>
                      <td className="px-2 py-2 font-semibold text-base-text">
                        {entry.title}
                      </td>
                      <td className="px-2 py-2 leading-5 text-base-muted">
                        {entry.detail}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <StatusPill label="Done" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TerminalPanel>

          <TerminalPanel label="Roadmap" title="Future integration boundaries">
            <div className="grid gap-2 md:grid-cols-2">
              {futureArchitectureItems.map((item) => {
                const Icon = item.icon;

                return (
                  <article
                    key={item.title}
                    className="border border-base-line bg-base-elevated p-3"
                  >
                    <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-base-mint">
                      <Icon size={14} aria-hidden="true" />
                      Future module
                    </div>
                    <h2 className="text-sm font-semibold text-base-text">
                      {item.title}
                    </h2>
                    <p className="mt-2 text-xs leading-5 text-base-muted">
                      {item.detail}
                    </p>
                  </article>
                );
              })}
            </div>
          </TerminalPanel>
        </div>

        <aside className="space-y-4">
          <TerminalPanel label="Safety" title="Boundary checklist">
            <div className="space-y-2">
              {publicSafetyChecklist.map((item) => (
                <div
                  key={item}
                  className="flex items-start gap-2 border border-base-line bg-base-elevated p-2 text-xs text-base-text"
                >
                  <CheckCircle2
                    size={14}
                    aria-hidden="true"
                    className="mt-0.5 shrink-0 text-base-mint"
                  />
                  <span className="leading-5">{item}</span>
                </div>
              ))}
            </div>
          </TerminalPanel>

          <TerminalPanel label="Status" title="Documentation state">
            <div className="space-y-2">
              <StatusRow icon={<FileText size={14} />} label="Docs mode" value="Terminal" />
              <StatusRow icon={<ListChecks size={14} />} label="Data source" value="Mock only" />
              <StatusRow icon={<GitBranch size={14} />} label="PR stance" value="Draft review" />
            </div>
          </TerminalPanel>

          <TerminalPanel label="Boundary" title="Public MVP note">
            <div className="border border-base-amber/40 bg-base-amber/10 p-3">
              <p className="text-xs leading-5 text-base-muted">
                Future architecture is named for review only. No paid product
                logic, secrets, real API calls, wallet signing, approvals, or
                live transaction execution is included.
              </p>
            </div>
          </TerminalPanel>
        </aside>
      </section>
    </main>
  );
}

function StatusRow({
  icon,
  label,
  value
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border border-base-line bg-base-elevated px-2 py-2 text-xs">
      <span className="flex items-center gap-2 text-base-muted">
        {icon}
        {label}
      </span>
      <span className="font-mono font-semibold text-base-text">{value}</span>
    </div>
  );
}
