import type { Metadata } from "next";
import Link from "next/link";
import { StatusPill, TerminalPanel } from "@/components/TerminalWidgets";
import { getMarketTerminalSnapshot, resolveUrlMarketDataMode } from "@/data/providers";
import { APP_NAME, APP_VERSION } from "@/lib/appInfo";
import { translate } from "@/i18n/dictionaries";
import { getInitialLocale } from "@/i18n/server";
import { getTradeCapabilities } from "@/lib/trade/quoteProviders";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getInitialLocale();
  return {
    title: { absolute: `${translate(locale, "status.h1")} | ${APP_NAME}` },
    description: `Market data and transaction capability status for ${APP_NAME}.`
  };
}

type StatusPageProps = {
  searchParams?: Promise<{
    data?: string | string[];
  }>;
};

export default async function StatusPage({ searchParams }: StatusPageProps) {
  const params = await searchParams;
  const mode = resolveUrlMarketDataMode(params?.data);
  const snapshot = await getMarketTerminalSnapshot(mode);
  const trade = getTradeCapabilities();
  const locale = await getInitialLocale();
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const lastUpdate =
    snapshot.generatedAt === "mock-static" ? t("status.staticSnapshot") : snapshot.generatedAt;

  return (
    <main id="terminal-main" tabIndex={-1} className="min-h-[calc(100vh-40px)] scroll-mt-16 bg-surface-canvas p-2 outline-none">
      <h1 className="sr-only">{t("status.h1")}</h1>
      <section className="grid gap-2 xl:grid-cols-[320px_minmax(0,1fr)]">
        <TerminalPanel
          label={t("status.label")}
          title={t("status.title")}
          meta={<StatusPill label={trade.transactionExecutionEnabled ? t("status.stagingExecution") : t("status.readOnly")} tone={trade.transactionExecutionEnabled ? "amber" : "muted"} />}
        >
          <div className="space-y-2">
            <StatusRow label={t("status.app")} value={APP_NAME} />
            <StatusRow label={t("status.version")} value={`v${APP_VERSION}`} />
            <StatusRow label={t("status.state")} value={t("status.operational")} tone="mint" />
            <StatusRow label={t("status.boundary")} value={trade.transactionExecutionEnabled ? t("status.explicitTransactions") : t("status.noTransactions")} tone="amber" />
          </div>
          <Link
            href="/terminal"
            className="mt-3 inline-flex border border-border-subtle bg-surface-panel px-2 py-1 text-meta uppercase tracking-eyebrow text-brand-accent hover:border-border-strong hover:text-content-primary"
          >
            {t("status.openTerminal")}
          </Link>
        </TerminalPanel>

        <div className="space-y-2">
          <TerminalPanel
            label={t("status.data")}
            title={t("status.dataTitle")}
            meta={<StatusPill label={snapshot.feedStatusLabel} tone="mint" />}
          >
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              <StatusRow label={t("status.dataMode")} value={snapshot.mode} />
              <StatusRow label={t("status.provider")} value={snapshot.providerName} />
              <StatusRow label={t("status.lastUpdate")} value={lastUpdate} />
              <StatusRow
                label={t("status.fallback")}
                value={snapshot.fallbackReason ? translate(locale, "common.delayed") : t("status.noneActive")}
                tone={snapshot.fallbackReason ? "amber" : "mint"}
              />
            </div>
          </TerminalPanel>

          <TerminalPanel label={t("status.boundary")} title={t("status.boundaryTitle")}>
            <div className="grid gap-1 md:grid-cols-2">
              {t(trade.transactionExecutionEnabled ? "status.executionItems" : "status.boundaryItems").split("|").map((item) => (
                <div
                  key={item}
                  className="border border-border-subtle bg-surface-interactive px-2 py-2 text-meta text-content-primary"
                >
                  {item}
                </div>
              ))}
            </div>
          </TerminalPanel>

          <TerminalPanel
            label={t("status.quality")}
            title={t("status.qualityTitle")}
            meta={<StatusPill label={t("status.qualityBadge")} tone="blue" />}
          >
            <p className="text-meta leading-4 text-content-secondary">
              {t("status.qualityBody")}{" "}
              <Link href="/api/health" className="font-mono text-brand-accent hover:text-content-primary">
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
    <div className="border border-border-subtle bg-surface-interactive p-2">
      <p className="text-meta uppercase tracking-eyebrow text-content-secondary">{label}</p>
      <p
        className={
          tone === "mint"
            ? "mt-1 break-words font-mono text-label font-semibold text-brand-accent"
            : tone === "amber"
              ? "mt-1 break-words font-mono text-label font-semibold text-freshness-delayed"
              : "mt-1 break-words font-mono text-label font-semibold text-content-primary"
        }
      >
        {value}
      </p>
    </div>
  );
}
