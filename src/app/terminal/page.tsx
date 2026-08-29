import type { Metadata } from "next";
import { BaseTerminal } from "@/components/BaseTerminal";
import { getMarketTerminalSnapshot, resolveUrlMarketDataMode } from "@/data/providers";
import { translate, type TranslationKey } from "@/i18n/dictionaries";
import { getInitialLocale } from "@/i18n/server";
import { APP_NAME } from "@/lib/appInfo";

export const revalidate = 60;

type PageProps = { searchParams?: Promise<{ data?: string | string[]; pair?: string | string[]; view?: string | string[] }> };

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const [params, locale] = await Promise.all([searchParams, getInitialLocale()]);
  const view = getFirst(params?.view);
  const titleKey: TranslationKey = view === "markets" ? "route.marketsTitle" : view === "watchlist" ? "route.watchlistTitle" : view === "portfolio" ? "route.portfolioTitle" : view === "alerts" ? "route.alertsTitle" : "route.terminalTitle";
  return { title: { absolute: `${translate(locale, titleKey)} | ${APP_NAME}` } };
}

export default async function TerminalPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const mode = resolveUrlMarketDataMode(params?.data);
  return <BaseTerminal data={await getMarketTerminalSnapshot(mode)} initialPairParam={getFirst(params?.pair)} initialViewParam={getFirst(params?.view)} />;
}

function getFirst(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }
