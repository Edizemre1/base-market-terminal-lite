import type { Metadata } from "next";
import Link from "next/link";
import { StatusPill, TerminalPanel } from "@/components/TerminalWidgets";
import { translate } from "@/i18n/dictionaries";
import { getInitialLocale } from "@/i18n/server";
import { APP_NAME } from "@/lib/appInfo";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getInitialLocale();
  return { title: { absolute: `${translate(locale, "settings.h1")} | ${APP_NAME}` } };
}

export default async function SettingsPage() {
  const locale = await getInitialLocale();
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  return <main id="terminal-main" tabIndex={-1} className="min-h-[calc(100vh-56px)] bg-base-black p-3 outline-none"><h1 className="sr-only">{t("settings.h1")}</h1><div className="mx-auto max-w-3xl"><TerminalPanel label={t("settings.label")} title={t("settings.title")} meta={<StatusPill label={t("settings.local")} tone="mint" />}><p className="text-[11px] leading-6 text-base-muted">{t("settings.body")}</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{t("settings.items").split("|").map((item) => <div key={item} className="rounded-sm bg-base-elevated p-3 text-[11px] text-base-text">{item}</div>)}</div><Link href="/terminal?view=markets" className="mt-4 inline-flex min-h-10 items-center rounded-sm bg-base-mint px-3 text-[11px] font-bold text-[#031411]">{t("settings.openMarkets")}</Link></TerminalPanel></div></main>;
}
