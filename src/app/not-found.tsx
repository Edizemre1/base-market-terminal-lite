import type { Metadata } from "next";
import Link from "next/link";
import { translate } from "@/i18n/dictionaries";
import { getInitialLocale } from "@/i18n/server";
import { APP_NAME } from "@/lib/appInfo";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getInitialLocale();
  return { title: { absolute: `${translate(locale, "notFound.title")} | ${APP_NAME}` } };
}

export default async function NotFound() {
  const locale = await getInitialLocale();
  return (
    <main id="terminal-main" tabIndex={-1} className="min-h-[calc(100vh-56px)] scroll-mt-16 bg-base-black p-4 outline-none">
      <section className="pulse-surface mx-auto max-w-2xl rounded-xl p-6">
        <p className="font-mono text-[11px] font-bold text-base-mint">404</p>
        <h1 className="mt-2 text-xl font-semibold text-base-text">{translate(locale, "notFound.title")}</h1>
        <p className="mt-2 text-[12px] leading-6 text-base-muted">{translate(locale, "notFound.body")}</p>
        <Link href="/" className="mt-4 inline-flex min-h-10 items-center rounded-lg bg-base-mint px-4 text-[11px] font-bold text-[#031411]">{translate(locale, "notFound.back")}</Link>
      </section>
    </main>
  );
}
