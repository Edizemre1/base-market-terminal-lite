import { CheckCircle2, FileText, GitBranch, ShieldCheck } from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import {
  builderLogEntries,
  futureArchitectureItems,
  publicSafetyChecklist
} from "@/data/builderLog";

export default function DocsPage() {
  return (
    <main className="bg-base-black">
      <section className="border-b border-base-line bg-base-raised">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="mb-4 inline-flex items-center gap-2 rounded border border-base-blue/40 bg-base-blue/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-base-electric">
            <FileText size={14} aria-hidden="true" />
            Terminal docs
          </div>
          <h1 className="text-4xl font-semibold text-base-text md:text-5xl">
            Builder log and public boundaries
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-base-muted">
            Implementation notes for the standalone public Base market terminal
            MVP, including demo-only data constraints and future integration
            boundaries.
          </p>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_380px] lg:px-8">
        <div className="space-y-10">
          <div>
            <SectionHeader
              eyebrow="Build log"
              title="What exists in this MVP"
              description="A concise implementation record for the public terminal interface."
            />
            <div className="space-y-4">
              {builderLogEntries.map((entry, index) => (
                <article
                  key={entry.title}
                  className="grid gap-4 rounded-lg border border-base-line bg-base-panel p-5 shadow-panel sm:grid-cols-[72px_1fr]"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-base-blue/40 bg-base-blue/10 text-sm font-semibold text-base-electric">
                    {(index + 1).toString().padStart(2, "0")}
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold text-base-text">
                      {entry.title}
                    </h2>
                    <p className="mt-2 text-sm leading-7 text-base-muted">
                      {entry.detail}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div>
            <SectionHeader
              eyebrow="Architecture"
              title="Future integration map"
              description="Boundaries are named now so real providers and wallet flows can be added without rewiring the UI."
            />
            <div className="grid gap-4 md:grid-cols-2">
              {futureArchitectureItems.map((item) => {
                const Icon = item.icon;

                return (
                  <article
                    key={item.title}
                    className="rounded-lg border border-base-line bg-base-panel p-5 shadow-panel"
                  >
                    <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg border border-base-blue/40 bg-base-blue/10 text-base-electric">
                      <Icon size={18} aria-hidden="true" />
                    </div>
                    <h2 className="text-lg font-semibold text-base-text">
                      {item.title}
                    </h2>
                    <p className="mt-2 text-sm leading-7 text-base-muted">
                      {item.detail}
                    </p>
                  </article>
                );
              })}
            </div>
          </div>
        </div>

        <aside className="space-y-6">
          <div className="rounded-lg border border-base-line bg-base-panel p-5 shadow-panel">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-base-electric">
              <ShieldCheck size={16} aria-hidden="true" />
              Public safety checklist
            </div>
            <div className="space-y-3">
              {publicSafetyChecklist.map((item) => (
                <div
                  key={item}
                  className="flex items-start gap-3 rounded border border-base-line bg-base-elevated/60 p-3 text-sm text-base-text/80"
                >
                  <CheckCircle2
                    size={16}
                    aria-hidden="true"
                    className="mt-0.5 shrink-0 text-base-electric"
                  />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-base-amber/30 bg-base-amber/10 p-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.18em] text-base-amber">
              <GitBranch size={16} aria-hidden="true" />
              Review stance
            </div>
            <p className="text-sm leading-7 text-base-muted">
              This app is ready for UI review as a public demo. Real data,
              wallets, routing, secrets, and fee behavior are deliberately
              outside the MVP.
            </p>
          </div>
        </aside>
      </section>
    </main>
  );
}
