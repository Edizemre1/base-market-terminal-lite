import type { Metadata } from "next";
import { StatusPill, TerminalPanel } from "@/components/TerminalWidgets";
import { translate } from "@/i18n/dictionaries";
import { getInitialLocale } from "@/i18n/server";
import { APP_NAME } from "@/lib/appInfo";
import { getTradeCapabilities } from "@/lib/trade/quoteProviders";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getInitialLocale();
  return { title: { absolute: `${translate(locale, "docs.h1")} | ${APP_NAME}` } };
}

export default async function DocsPage() {
  const locale = await getInitialLocale();
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const trade = getTradeCapabilities();
  const safetyItems = t(trade.transactionExecutionEnabled ? "docs.stagingSafetyItems" : "docs.safetyItems").split("|");
  const buildItems = t(trade.transactionExecutionEnabled ? "docs.stagingBuildItems" : "docs.buildItems").split("|");
  return (
    <main id="terminal-main" tabIndex={-1} className="min-h-[calc(100vh-40px)] scroll-mt-16 bg-base-black p-2 outline-none">
      <h1 className="sr-only">{t("docs.h1")}</h1>
      <section className="grid gap-2 xl:grid-cols-[320px_minmax(0,1fr)]">
        <TerminalPanel
          label={t("docs.safety")}
          title={t("docs.safetyTitle")}
          meta={<StatusPill label={t("docs.required")} tone="amber" />}
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
            label={t("docs.builder")}
            title={t("docs.builderTitle")}
            meta={<StatusPill label={t("docs.builderBadge")} />}
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

          <TerminalPanel label={t("docs.roadmap")} title={t("docs.roadmapTitle")}>
            <p className="text-[11px] leading-4 text-base-muted">
              {t(trade.transactionExecutionEnabled ? "docs.stagingRoadmapBody" : "docs.roadmapBody")}
            </p>
          </TerminalPanel>
          <TerminalPanel label={t("docs.formula")} title={t("docs.formulaTitle")}>
            <p className="text-[11px] leading-5 text-base-muted">{t("docs.formulaBody")}</p>
          </TerminalPanel>
        </div>
      </section>
    </main>
  );
}
