import type { Metadata } from "next";
import { BaseTerminal } from "@/components/BaseTerminal";
import { getMarketTerminalSnapshot, resolveUrlMarketDataMode } from "@/data/providers";
import { translate, type TranslationKey } from "@/i18n/dictionaries";
import { getInitialLocale } from "@/i18n/server";
import { APP_NAME } from "@/lib/appInfo";

export const revalidate = 60;

type PageProps = {
  searchParams?: Promise<{
    data?: string | string[];
    pair?: string | string[];
    view?: string | string[];
  }>;
};

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const [params, locale] = await Promise.all([searchParams, getInitialLocale()]);
  const view = getFirstSearchParam(params?.view);
  const titleKey: TranslationKey = view === "markets" ? "route.marketsTitle"
    : view === "watchlist" ? "route.watchlistTitle"
      : view === "alerts" ? "route.alertsTitle"
        : view === "wallet" ? "route.walletTitle"
          : view === "pair" ? "route.pairTitle"
            : "route.pulseTitle";
  const pair = formatPairParam(getFirstSearchParam(params?.pair)) ?? translate(locale, "common.unknown");
  return { title: { absolute: `${translate(locale, titleKey, { pair })} | ${APP_NAME}` } };
}

export default async function HomePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const mode = resolveUrlMarketDataMode(params?.data);

  return (
    <BaseTerminal
      data={await getMarketTerminalSnapshot(mode)}
      initialPairParam={getFirstSearchParam(params?.pair)}
      initialViewParam={getFirstSearchParam(params?.view)}
    />
  );
}

function getFirstSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatPairParam(value: string | undefined) {
  const symbols = value?.split("-");
  if (symbols?.length !== 2 || symbols.some((symbol) => !/^[a-z0-9._]{1,20}$/i.test(symbol))) return undefined;
  return symbols.map((symbol) => symbol.toUpperCase()).join(" / ");
}
