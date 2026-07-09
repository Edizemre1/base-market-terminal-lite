import type { Metadata } from "next";
import Link from "next/link";
import { StatusPill, TerminalPanel } from "@/components/TerminalWidgets";
import { getMarketTerminalSnapshot, resolveUrlMarketDataMode } from "@/data/providers";
import { APP_DESCRIPTION, APP_NAME, APP_VERSION } from "@/lib/appInfo";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Status",
  description: `Public read-only demo status for ${APP_NAME}.`
};

type StatusPageProps = {
  searchParams?: Promise<{
    data?: string | string[];
  }>;
};

export default async function StatusPage({ searchParams }: StatusPageProps) {
  const params = await searchParams;
  const mode = resolveUrlMarketDataMode(params?.data);
  const snapshot = await getMarketTerminalSnapshot(mode);
  const lastUpdate =
    snapshot.generatedAt === "mock-static" ? "Static mock snapshot" : snapshot.generatedAt;

  return (
    <main className="min-h-[calc(100vh-40px)] bg-base-black p-2">
      <section className="grid gap-2 xl:grid-cols-[320px_minmax(0,1fr)]">
        <TerminalPanel
          label="STATUS"
          title="Public demo status"
          meta={<StatusPill label="Read-only" />}
        >
          <div className="space-y-2">
            <StatusRow label="App" value={APP_NAME} />
            <StatusRow label="Version" value={`v${APP_VERSION}`} />
            <StatusRow label="State" value="Operational demo" tone="mint" />
            <StatusRow label="Boundary" value="No transaction execution" tone="amber" />
          </div>
          <p className="mt-3 text-[11px] leading-4 text-base-muted">{APP_DESCRIPTION}</p>
          <Link
            href="/"
            className="mt-3 inline-flex border border-base-line bg-base-panel px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-base-mint hover:border-base-mint hover:text-base-text"
          >
            Open terminal
          </Link>
        </TerminalPanel>

        <div className="space-y-2">
          <TerminalPanel
            label="DATA"
            title="Read-only data surface"
            meta={<StatusPill label={snapshot.feedStatusLabel} tone="mint" />}
          >
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              <StatusRow label="Data mode" value={snapshot.mode} />
              <StatusRow label="Provider mode" value={snapshot.providerName} />
              <StatusRow label="Last successful data update" value={lastUpdate} />
              <StatusRow
                label="Fallback"
                value={snapshot.fallbackReason ?? "None active"}
                tone={snapshot.fallbackReason ? "amber" : "mint"}
              />
            </div>
          </TerminalPanel>

          <TerminalPanel label="BOUNDARY" title="Public demo boundary">
            <div className="grid gap-1 md:grid-cols-2">
              {[
                "Swap UI is disabled",
                "No wallet connection is required",
                "No signing or approvals are enabled",
                "No transaction construction exists",
                "No API keys or secrets are exposed",
                "Public/provider data only"
              ].map((item) => (
                <div
                  key={item}
                  className="border border-base-line bg-base-elevated px-2 py-1.5 text-[11px] text-base-text"
                >
                  {item}
                </div>
              ))}
            </div>
          </TerminalPanel>

          <TerminalPanel
            label="QUALITY"
            title="Regression coverage"
            meta={<StatusPill label="CI smoke tests" tone="blue" />}
          >
            <p className="text-[11px] leading-4 text-base-muted">
              Pull requests run typecheck, lint, build, and Playwright smoke tests for the
              read-only terminal flows. The health endpoint returns safe metadata at{" "}
              <Link href="/api/health" className="font-mono text-base-mint hover:text-base-text">
                /api/health
              </Link>
              .
            </p>
          </TerminalPanel>
        </div>
      </section>
    </main>
  );
}

function StatusRow({
  label,
  value,
  tone = "default"
}: {
  label: string;
  value: string;
  tone?: "default" | "mint" | "amber";
}) {
  return (
    <div className="border border-base-line bg-base-elevated p-2">
      <p className="text-[10px] uppercase tracking-[0.12em] text-base-muted">{label}</p>
      <p
        className={
          tone === "mint"
            ? "mt-1 break-words font-mono text-[12px] font-semibold text-base-mint"
            : tone === "amber"
              ? "mt-1 break-words font-mono text-[12px] font-semibold text-base-amber"
              : "mt-1 break-words font-mono text-[12px] font-semibold text-base-text"
        }
      >
        {value}
      </p>
    </div>
  );
}
