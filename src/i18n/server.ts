import { cookies, headers } from "next/headers";
import { isLocale, type Locale } from "@/i18n/dictionaries";

const LOCALE_COOKIE_NAME = "mergen_locale";

export async function getInitialLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const savedLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  if (isLocale(savedLocale)) return savedLocale;

  const requestHeaders = await headers();
  const language = requestHeaders.get("accept-language")?.toLowerCase() ?? "";
  return language.split(",")[0]?.trim().startsWith("tr") ? "tr" : "en";
}
